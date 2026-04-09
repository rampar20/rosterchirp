const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const cors       = require('cors');
const path       = require('path');
const jwt        = require('jsonwebtoken');

const {
  initDb, tenantMiddleware,
  query, queryOne, queryResult, exec,
  APP_TYPE, refreshTenantCache,
} = require('./models/db');

const { router: pushRouter, sendPushToUser } = require('./routes/push');
const { getLinkPreview } = require('./utils/linkPreview');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const JWT_SECRET = process.env.JWT_SECRET || 'changeme_super_secret';
const PORT       = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(tenantMiddleware);
app.use('/uploads', express.static('/app/uploads'));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth')(io));
app.use('/api/users',      require('./routes/users'));
app.use('/api/groups',     require('./routes/groups')(io));
app.use('/api/messages',   require('./routes/messages')(io));
app.use('/api/usergroups', require('./routes/usergroups')(io));
app.use('/api/schedule',   require('./routes/schedule')(io));
app.use('/api/settings',   require('./routes/settings'));
app.use('/api/about',      require('./routes/about'));
app.use('/api/help',       require('./routes/help'));
app.use('/api/push',       pushRouter);

// RosterChirp-Host control plane — only registered when APP_TYPE=host
if (APP_TYPE === 'host') {
  app.use('/api/host', require('./routes/host'));
  console.log('[Server] RosterChirp-Host control plane enabled at /api/host');
}

// ── Link preview proxy ────────────────────────────────────────────────────────
app.get('/api/link-preview', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const preview = await getLinkPreview(url);
  res.json({ preview });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Dynamic PWA manifest ──────────────────────────────────────────────────────
app.get('/manifest.json', async (req, res) => {
  try {
    const rows = await query(req.schema,
      "SELECT key, value FROM settings WHERE key IN ('app_name','logo_url','pwa_icon_192','pwa_icon_512')"
    );
    const s = {};
    for (const r of rows) s[r.key] = r.value;

    const appName = s.app_name || process.env.APP_NAME || 'rosterchirp';
    const icon192 = s.pwa_icon_192 || '/icons/icon-192.png';
    const icon512 = s.pwa_icon_512 || '/icons/icon-512.png';

    const icons = [
      { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any'      },
      { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any'      },
      { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ];

    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      name: appName,
      short_name: appName.length > 12 ? appName.substring(0, 12) : appName,
      description: `${appName} - Team messaging`,
      start_url: '/', scope: '/', display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#ffffff', theme_color: '#1a73e8',
      icons,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Frontend ──────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Socket.io authentication ──────────────────────────────────────────────────
// Socket connections do not go through Express middleware, so we resolve
// schema from the handshake headers manually.
const { resolveSchema } = require('./models/db');

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Resolve tenant schema from socket handshake headers
    const schema = resolveSchema({ headers: socket.handshake.headers });

    const user = await queryOne(schema,
      'SELECT id, name, display_name, avatar, role, status FROM users WHERE id = $1 AND status = $2',
      [decoded.id, 'active']
    );
    if (!user) return next(new Error('User not found'));

    const session = await queryOne(schema,
      'SELECT * FROM active_sessions WHERE user_id = $1 AND token = $2',
      [decoded.id, token]
    );
    if (!session) return next(new Error('Session displaced'));

    socket.user   = user;
    socket.token  = token;
    socket.device = session.device;
    socket.schema = schema;
    next();
  } catch (e) {
    next(new Error('Invalid token'));
  }
});

// ── Online user tracking ──────────────────────────────────────────────────────
// Key is `${schema}:${userId}` — user IDs are per-schema integers, so two tenants
// can have the same integer ID for completely different people. Without the schema
// prefix, tenant A's user 5 and tenant B's user 5 would collide: push notifications
// could be suppressed for the wrong user, and users:online would leak IDs across tenants.
const onlineUsers = new Map(); // `${schema}:${userId}` → Set<socketId>

io.on('connection', async (socket) => {
  const userId = socket.user.id;
  const schema = socket.schema;
  // Prefix rooms with schema so tenant rooms never collide (IDs are per-schema only)
  const R = (type, id) => `${schema}:${type}:${id}`;
  // Scoped key for the onlineUsers map — must match schema for correct tenant isolation
  const onlineKey = `${schema}:${userId}`;

  if (!onlineUsers.has(onlineKey)) onlineUsers.set(onlineKey, new Set());
  onlineUsers.get(onlineKey).add(socket.id);

  // Update last_online
  exec(schema, 'UPDATE users SET last_online = NOW() WHERE id = $1', [userId]).catch(() => {});

  io.to(R('schema', 'all')).emit('user:online', { userId });
  socket.join(R('user', userId));
  socket.join(R('schema', 'all')); // tenant-scoped broadcast room for public group events

  // Join socket rooms for all groups this user belongs to
  try {
    const publicGroups = await query(schema, "SELECT id FROM groups WHERE type = 'public'");
    for (const g of publicGroups) socket.join(R('group', g.id));

    const privateGroups = await query(schema,
      'SELECT group_id FROM group_members WHERE user_id = $1', [userId]
    );
    for (const g of privateGroups) socket.join(R('group', g.group_id));
  } catch (e) {
    console.error('[Socket] Room join error:', e.message);
  }

  socket.on('group:join-room',  ({ groupId }) => socket.join(R('group', groupId)));
  socket.on('group:leave-room', ({ groupId }) => socket.leave(R('group', groupId)));

  // ── New message ─────────────────────────────────────────────────────────────
  socket.on('message:send', async (data) => {
    const { groupId, content, replyToId, imageUrl, linkPreview } = data;
    try {
      const group = await queryOne(schema, 'SELECT * FROM groups WHERE id = $1', [groupId]);
      if (!group) return;
      if (group.is_readonly && socket.user.role !== 'admin') return;

      if (group.type === 'private') {
        const member = await queryOne(schema,
          'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
          [groupId, userId]
        );
        if (!member) return;
      }

      const mr = await queryResult(schema, `
        INSERT INTO messages (group_id, user_id, content, image_url, type, reply_to_id, link_preview)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
      `, [
        groupId, userId,
        content  || null,
        imageUrl || null,
        imageUrl ? 'image' : 'text',
        replyToId || null,
        linkPreview ? JSON.stringify(linkPreview) : null,
      ]);
      const msgId = mr.rows[0].id;

      const message = await queryOne(schema, `
        SELECT m.*,
          u.name AS user_name, u.display_name AS user_display_name,
          u.avatar AS user_avatar, u.role AS user_role, u.status AS user_status,
          u.hide_admin_tag AS user_hide_admin_tag, u.about_me AS user_about_me,
          rm.content AS reply_content, rm.image_url AS reply_image_url,
          rm.is_deleted AS reply_is_deleted,
          ru.name AS reply_user_name, ru.display_name AS reply_user_display_name
        FROM messages m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN messages rm ON m.reply_to_id = rm.id
        LEFT JOIN users ru ON rm.user_id = ru.id
        WHERE m.id = $1
      `, [msgId]);

      message.reactions = [];
      io.to(R('group', groupId)).emit('message:new', message);

      // Push notifications
      const senderName = socket.user.display_name || socket.user.name || 'Someone';
      const msgBody    = (content || (imageUrl ? '📷 Image' : '')).slice(0, 100);

      if (group.type === 'private') {
        const members = await query(schema,
          'SELECT user_id FROM group_members WHERE group_id = $1', [groupId]
        );
        for (const m of members) {
          if (m.user_id === userId) continue;
          const memberKey = `${schema}:${m.user_id}`;
          if (onlineUsers.has(memberKey)) {
            // In-app notification for connected sockets
            for (const sid of onlineUsers.get(memberKey)) {
              io.to(sid).emit('notification:new', { type: 'private_message', groupId, fromUser: socket.user });
            }
          }
          // Always send push — when the app is in the foreground FCM delivers
          // silently (no system notification); when backgrounded or offline the
          // service worker shows the system notification. This covers the common
          // Android case where the socket appears online but is silently dead
          // after the PWA was backgrounded (OS kills WebSocket before ping timeout).
          sendPushToUser(schema, m.user_id, {
            title: senderName,
            body:  msgBody,
            url: '/', groupId, badge: 1,
          }).catch(() => {});
        }
      } else if (group.type === 'public') {
        // Push to all users who have a push subscription — everyone is implicitly
        // a member of every public group. Skip the sender.
        const subUsers = await query(schema,
          'SELECT DISTINCT user_id FROM push_subscriptions WHERE (fcm_token IS NOT NULL OR webpush_endpoint IS NOT NULL) AND user_id != $1',
          [userId]
        );
        for (const sub of subUsers) {
          sendPushToUser(schema, sub.user_id, {
            title: `${senderName} in ${group.name}`,
            body:  msgBody,
            url: '/', groupId, badge: 1,
          }).catch(() => {});
        }
      }

      // @mention notifications
      if (content) {
        const mentionNames = [...new Set((content.match(/@\[([^\]]+)\]/g) || []).map(m => m.slice(2, -1)))];
        for (const mentionName of mentionNames) {
          const mentioned = await queryOne(schema,
            "SELECT id FROM users WHERE status='active' AND (LOWER(display_name)=LOWER($1) OR LOWER(name)=LOWER($1))",
            [mentionName]
          );
          if (!mentioned || mentioned.id === userId) continue;

          const nr = await queryResult(schema,
            "INSERT INTO notifications (user_id, type, message_id, group_id, from_user_id) VALUES ($1,'mention',$2,$3,$4) RETURNING id",
            [mentioned.id, msgId, groupId, userId]
          );
          const notif = { id: nr.rows[0].id, type: 'mention', groupId, messageId: msgId, fromUser: socket.user };
          const mentionedKey = `${schema}:${mentioned.id}`;
          if (onlineUsers.has(mentionedKey)) {
            for (const sid of onlineUsers.get(mentionedKey)) io.to(sid).emit('notification:new', notif);
          }
          const senderName = socket.user.display_name || socket.user.name || 'Someone';
          sendPushToUser(schema, mentioned.id, {
            title: `${senderName} mentioned you`,
            body: (content || '').replace(/@\[([^\]]+)\]/g, '@$1').slice(0, 100),
            url: '/', badge: 1,
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[Socket] message:send error:', e.message);
    }
  });

  // ── Reaction toggle ─────────────────────────────────────────────────────────
  socket.on('reaction:toggle', async ({ messageId, emoji }) => {
    try {
      const message = await queryOne(schema,
        'SELECT m.*, g.id AS gid FROM messages m JOIN groups g ON m.group_id=g.id WHERE m.id=$1 AND m.is_deleted=FALSE',
        [messageId]
      );
      if (!message) return;

      const existing = await queryOne(schema,
        'SELECT * FROM reactions WHERE message_id=$1 AND user_id=$2',
        [messageId, userId]
      );

      if (existing) {
        if (existing.emoji === emoji) {
          await exec(schema, 'DELETE FROM reactions WHERE id=$1', [existing.id]);
        } else {
          await exec(schema, 'UPDATE reactions SET emoji=$1 WHERE id=$2', [emoji, existing.id]);
        }
      } else {
        await exec(schema,
          'INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)',
          [messageId, userId, emoji]
        );
      }

      const reactions = await query(schema, `
        SELECT r.emoji, r.user_id, u.name AS user_name
        FROM reactions r JOIN users u ON r.user_id=u.id
        WHERE r.message_id=$1
      `, [messageId]);

      io.to(R('group', message.group_id)).emit('reaction:updated', { messageId, reactions });
    } catch (e) {
      console.error('[Socket] reaction:toggle error:', e.message);
    }
  });

  // ── Message delete ──────────────────────────────────────────────────────────
  socket.on('message:delete', async ({ messageId }) => {
    try {
      const message = await queryOne(schema, `
        SELECT m.*, g.type AS group_type, g.owner_id AS group_owner_id, g.is_direct
        FROM messages m JOIN groups g ON m.group_id=g.id WHERE m.id=$1
      `, [messageId]);
      if (!message) return;

      const isAdmin  = socket.user.role === 'admin';
      const isOwner  = message.group_owner_id === userId;
      const isAuthor = message.user_id === userId;
      let canDelete  = isAuthor || isOwner;

      if (!canDelete && isAdmin) {
        if (message.group_type === 'public') {
          canDelete = true;
        } else {
          const membership = await queryOne(schema,
            'SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2',
            [message.group_id, userId]
          );
          if (membership) canDelete = true;
        }
      }
      if (!canDelete) return;

      await exec(schema,
        'UPDATE messages SET is_deleted=TRUE, content=NULL, image_url=NULL WHERE id=$1',
        [messageId]
      );
      io.to(R('group', message.group_id)).emit('message:deleted', { messageId, groupId: message.group_id });
    } catch (e) {
      console.error('[Socket] message:delete error:', e.message);
    }
  });

  // ── Typing indicators ───────────────────────────────────────────────────────
  socket.on('typing:start', ({ groupId }) => {
    socket.to(R('group', groupId)).emit('typing:start', { userId, groupId, user: socket.user });
  });
  socket.on('typing:stop', ({ groupId }) => {
    socket.to(R('group', groupId)).emit('typing:stop', { userId, groupId });
  });

  socket.on('users:online', () => {
    // Return only the user IDs for this tenant by filtering keys matching this schema prefix
    const prefix = `${schema}:`;
    const userIds = [...onlineUsers.keys()]
      .filter(k => k.startsWith(prefix))
      .map(k => parseInt(k.slice(prefix.length), 10));
    socket.emit('users:online', { userIds });
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (onlineUsers.has(onlineKey)) {
      onlineUsers.get(onlineKey).delete(socket.id);
      if (onlineUsers.get(onlineKey).size === 0) {
        onlineUsers.delete(onlineKey);
        exec(schema, 'UPDATE users SET last_online=NOW() WHERE id=$1', [userId]).catch(() => {});
        io.to(R('schema', 'all')).emit('user:offline', { userId });
      }
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDb().then(async () => {
  if (APP_TYPE === 'host') {
    try {
      const tenants = await query('public', "SELECT * FROM tenants WHERE status='active'");
      refreshTenantCache(tenants);
      console.log(`[Server] Loaded ${tenants.length} tenant(s) into domain cache`);
    } catch (e) {
      console.warn('[Server] Could not load tenant cache:', e.message);
    }
  }
  server.listen(PORT, () => console.log(`[Server] RosterChirp listening on port ${PORT}`));
}).catch(err => {
  console.error('[Server] DB init failed:', err);
  process.exit(1);
});

module.exports = { io };
