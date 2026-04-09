const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { query, queryOne, queryResult, exec } = require('../models/db');
const { sendPushToUser } = require('./push');

function deleteImageFile(imageUrl) {
  if (!imageUrl) return;
  try { const fp = '/app' + imageUrl; if (fs.existsSync(fp)) fs.unlinkSync(fp); }
  catch (e) { console.warn('[Messages] Could not delete image:', e.message); }
}

const R = (schema, type, id) => `${schema}:${type}:${id}`;

module.exports = function(io) {
  const router = express.Router();
  const { authMiddleware } = require('../middleware/auth');

  const imgStorage = multer.diskStorage({
    destination: '/app/uploads/images',
    filename: (req, file, cb) => cb(null, `img_${Date.now()}_${Math.random().toString(36).substr(2,6)}${path.extname(file.originalname)}`),
  });
  const uploadImage = multer({ storage: imgStorage, limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only')),
  });

  async function canAccessGroup(schema, groupId, userId) {
    const group = await queryOne(schema, 'SELECT * FROM groups WHERE id=$1', [groupId]);
    if (!group) return null;
    if (group.type === 'public') return group;
    const member = await queryOne(schema, 'SELECT id FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
    return member ? group : null;
  }

  // GET messages for group
  router.get('/group/:groupId', authMiddleware, async (req, res) => {
    try {
      const group = await canAccessGroup(req.schema, req.params.groupId, req.user.id);
      if (!group) return res.status(403).json({ error: 'Access denied' });

      const { before, limit = 50 } = req.query;
      let joinedAt = null;
      if (group.is_managed) {
        const membership = await queryOne(req.schema,
          'SELECT joined_at FROM group_members WHERE group_id=$1 AND user_id=$2',
          [group.id, req.user.id]
        );
        if (membership?.joined_at) joinedAt = new Date(membership.joined_at).toISOString().slice(0,10);
      }

      let sql = `
        SELECT m.*,
          u.name AS user_name, u.display_name AS user_display_name,
          u.avatar AS user_avatar, u.role AS user_role, u.status AS user_status,
          u.hide_admin_tag AS user_hide_admin_tag, u.about_me AS user_about_me, u.allow_dm AS user_allow_dm,
          rm.content AS reply_content, rm.image_url AS reply_image_url,
          ru.name AS reply_user_name, ru.display_name AS reply_user_display_name,
          rm.is_deleted AS reply_is_deleted
        FROM messages m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN messages rm ON m.reply_to_id = rm.id
        LEFT JOIN users ru ON rm.user_id = ru.id
        WHERE m.group_id = $1
      `;
      const params = [req.params.groupId];
      let pi = 2;
      if (joinedAt)  { sql += ` AND m.created_at::date >= $${pi++}::date`; params.push(joinedAt); }
      if (before)    { sql += ` AND m.id < $${pi++}`;  params.push(before); }
      sql += ` ORDER BY m.created_at DESC LIMIT $${pi}`;
      params.push(parseInt(limit));

      const messages = await query(req.schema, sql, params);
      for (const msg of messages) {
        msg.reactions = await query(req.schema,
          'SELECT r.emoji, r.user_id, u.name AS user_name FROM reactions r JOIN users u ON r.user_id=u.id WHERE r.message_id=$1',
          [msg.id]
        );
      }
      res.json({ messages: messages.reverse() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST send message
  router.post('/group/:groupId', authMiddleware, async (req, res) => {
    try {
      const group = await canAccessGroup(req.schema, req.params.groupId, req.user.id);
      if (!group) return res.status(403).json({ error: 'Access denied' });
      if (group.is_readonly && req.user.role !== 'admin') return res.status(403).json({ error: 'Read-only group' });
      const { content, replyToId, linkPreview } = req.body;
      if (!content?.trim() && !req.body.imageUrl) return res.status(400).json({ error: 'Message cannot be empty' });
      const r = await queryResult(req.schema,
        'INSERT INTO messages (group_id,user_id,content,reply_to_id,link_preview) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [req.params.groupId, req.user.id, content?.trim()||null, replyToId||null, linkPreview ? JSON.stringify(linkPreview) : null]
      );
      const message = await queryOne(req.schema, `
        SELECT m.*, u.name AS user_name, u.display_name AS user_display_name, u.avatar AS user_avatar, u.role AS user_role, u.allow_dm AS user_allow_dm,
          rm.content AS reply_content, ru.name AS reply_user_name, ru.display_name AS reply_user_display_name
        FROM messages m JOIN users u ON m.user_id=u.id
        LEFT JOIN messages rm ON m.reply_to_id=rm.id LEFT JOIN users ru ON rm.user_id=ru.id
        WHERE m.id=$1
      `, [r.rows[0].id]);
      message.reactions = [];
      io.to(R(req.schema,'group',req.params.groupId)).emit('message:new', message);

      // Push notifications
      const senderName = message.user_display_name || message.user_name || 'Someone';
      const msgBody    = (content?.trim() || '').slice(0, 100);
      if (group.type === 'private') {
        const members = await query(req.schema,
          'SELECT user_id FROM group_members WHERE group_id = $1', [req.params.groupId]
        );
        for (const m of members) {
          if (m.user_id === req.user.id) continue;
          sendPushToUser(req.schema, m.user_id, {
            title: senderName, body: msgBody, url: '/', groupId: group.id,
          }).catch(() => {});
        }
      } else if (group.type === 'public') {
        const subUsers = await query(req.schema,
          'SELECT DISTINCT user_id FROM push_subscriptions WHERE (fcm_token IS NOT NULL OR webpush_endpoint IS NOT NULL) AND user_id != $1',
          [req.user.id]
        );
        for (const sub of subUsers) {
          sendPushToUser(req.schema, sub.user_id, {
            title: `${senderName} in ${group.name}`, body: msgBody, url: '/', groupId: group.id,
          }).catch(() => {});
        }
      }

      res.json({ message });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST image message
  router.post('/group/:groupId/image', authMiddleware, uploadImage.single('image'), async (req, res) => {
    try {
      const group = await canAccessGroup(req.schema, req.params.groupId, req.user.id);
      if (!group) return res.status(403).json({ error: 'Access denied' });
      if (group.is_readonly && req.user.role !== 'admin') return res.status(403).json({ error: 'Read-only group' });
      if (!req.file) return res.status(400).json({ error: 'No image' });
      const imageUrl = `/uploads/images/${req.file.filename}`;
      const { content, replyToId } = req.body;
      const r = await queryResult(req.schema,
        "INSERT INTO messages (group_id,user_id,content,image_url,type,reply_to_id) VALUES ($1,$2,$3,$4,'image',$5) RETURNING id",
        [req.params.groupId, req.user.id, content||null, imageUrl, replyToId||null]
      );
      const message = await queryOne(req.schema,
        'SELECT m.*, u.name AS user_name, u.display_name AS user_display_name, u.avatar AS user_avatar, u.role AS user_role, u.allow_dm AS user_allow_dm FROM messages m JOIN users u ON m.user_id=u.id WHERE m.id=$1',
        [r.rows[0].id]
      );
      message.reactions = [];
      io.to(R(req.schema,'group',req.params.groupId)).emit('message:new', message);

      // Push notifications for image messages
      const senderName = message.user_display_name || message.user_name || 'Someone';
      if (group.type === 'private') {
        const members = await query(req.schema,
          'SELECT user_id FROM group_members WHERE group_id = $1', [req.params.groupId]
        );
        for (const m of members) {
          if (m.user_id === req.user.id) continue;
          sendPushToUser(req.schema, m.user_id, {
            title: senderName, body: '📷 Image', url: '/', groupId: group.id,
          }).catch(() => {});
        }
      } else if (group.type === 'public') {
        const subUsers = await query(req.schema,
          'SELECT DISTINCT user_id FROM push_subscriptions WHERE (fcm_token IS NOT NULL OR webpush_endpoint IS NOT NULL) AND user_id != $1',
          [req.user.id]
        );
        for (const sub of subUsers) {
          sendPushToUser(req.schema, sub.user_id, {
            title: `${senderName} in ${group.name}`, body: '📷 Image', url: '/', groupId: group.id,
          }).catch(() => {});
        }
      }

      res.json({ message });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE message
  router.delete('/:id', authMiddleware, async (req, res) => {
    try {
      const message = await queryOne(req.schema,
        'SELECT m.*, g.type AS group_type, g.owner_id AS group_owner_id FROM messages m JOIN groups g ON m.group_id=g.id WHERE m.id=$1',
        [req.params.id]
      );
      if (!message) return res.status(404).json({ error: 'Message not found' });
      const canDelete = message.user_id === req.user.id || req.user.role === 'admin' ||
        (message.group_type === 'private' && message.group_owner_id === req.user.id);
      if (!canDelete) return res.status(403).json({ error: 'Cannot delete this message' });
      const imageUrl = message.image_url;
      await exec(req.schema, 'UPDATE messages SET is_deleted=TRUE, content=NULL, image_url=NULL WHERE id=$1', [message.id]);
      deleteImageFile(imageUrl);
      io.to(R(req.schema,'group',message.group_id)).emit('message:deleted', { messageId: message.id, groupId: message.group_id });
      res.json({ success: true, messageId: message.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST reaction
  router.post('/:id/reactions', authMiddleware, async (req, res) => {
    const { emoji } = req.body;
    try {
      const message = await queryOne(req.schema, 'SELECT * FROM messages WHERE id=$1 AND is_deleted=FALSE', [req.params.id]);
      if (!message) return res.status(404).json({ error: 'Message not found' });
      const existing = await queryOne(req.schema,
        'SELECT * FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
        [message.id, req.user.id, emoji]
      );
      if (existing) {
        await exec(req.schema, 'DELETE FROM reactions WHERE id=$1', [existing.id]);
      } else {
        await exec(req.schema, 'INSERT INTO reactions (message_id,user_id,emoji) VALUES ($1,$2,$3)', [message.id, req.user.id, emoji]);
      }
      const reactions = await query(req.schema,
        'SELECT r.emoji, r.user_id, u.name AS user_name FROM reactions r JOIN users u ON r.user_id=u.id WHERE r.message_id=$1',
        [message.id]
      );
      io.to(R(req.schema,'group',message.group_id)).emit('reaction:updated', { messageId: message.id, reactions });
      res.json({ reactions });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
