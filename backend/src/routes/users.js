const express = require('express');
const bcrypt  = require('bcryptjs');
const multer  = require('multer');
const path    = require('path');
const router  = express.Router();
const { query, queryOne, queryResult, exec, addUserToPublicGroups, getOrCreateSupportGroup } = require('../models/db');
const { authMiddleware, teamManagerMiddleware } = require('../middleware/auth');

const avatarStorage = multer.diskStorage({
  destination: '/app/uploads/avatars',
  filename: (req, file, cb) => cb(null, `avatar_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`),
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only')),
});

// Alias avatar upload (separate from user avatar so filename doesn't collide)
const aliasAvatarStorage = multer.diskStorage({
  destination: '/app/uploads/avatars',
  filename: (req, file, cb) => cb(null, `alias_${req.params.aliasId}_${Date.now()}${path.extname(file.originalname)}`),
});
const uploadAliasAvatar = multer({
  storage: aliasAvatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only')),
});

async function resolveUniqueName(schema, baseName, excludeId = null) {
  const existing = await query(schema,
    "SELECT name FROM users WHERE status != 'deleted' AND id != $1 AND (name = $2 OR name LIKE $3)",
    [excludeId ?? -1, baseName, `${baseName} (%)`]
  );
  if (existing.length === 0) return baseName;
  let max = 0;
  for (const u of existing) { const m = u.name.match(/\((\d+)\)$/); if (m) max = Math.max(max, parseInt(m[1])); else max = Math.max(max, 0); }
  return `${baseName} (${max + 1})`;
}

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// Returns true if the given date-of-birth string corresponds to age <= 15
function isMinorFromDOB(dob) {
  if (!dob) return false;
  const birth = new Date(dob);
  if (isNaN(birth)) return false;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age <= 15;
}

async function getLoginType(schema) {
  const row = await queryOne(schema, "SELECT value FROM settings WHERE key='feature_login_type'");
  return row?.value || 'all_ages';
}

// List users
router.get('/', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const users = await query(req.schema,
      "SELECT id,name,first_name,last_name,phone,is_minor,date_of_birth,guardian_user_id,guardian_approval_required,email,role,status,is_default_admin,must_change_password,avatar,about_me,display_name,allow_dm,created_at,last_online FROM users WHERE status != 'deleted' ORDER BY name ASC"
    );
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Search users
// When q is empty (full-list load by GroupManagerPage / NewChatModal) — return ALL active users,
// no LIMIT, so the complete roster is available for member-picker UIs.
// When q is non-empty (typed search / mention autocomplete) — keep LIMIT 10 for performance.
router.get('/search', authMiddleware, async (req, res) => {
  const { q, groupId } = req.query;
  const isTyped = q && q.length > 0;
  try {
    let users;
    if (groupId) {
      const group = await queryOne(req.schema, 'SELECT type, is_direct FROM groups WHERE id = $1', [parseInt(groupId)]);
      if (group && (group.type === 'private' || group.is_direct)) {
        users = await query(req.schema,
          `SELECT u.id,u.name,u.display_name,u.avatar,u.role,u.status,u.hide_admin_tag,u.allow_dm,u.is_minor,u.is_default_admin FROM users u JOIN group_members gm ON gm.user_id=u.id AND gm.group_id=$1 WHERE u.status='active' AND u.id!=$2 AND (u.name ILIKE $3 OR u.display_name ILIKE $3) ORDER BY u.name ASC${isTyped ? ' LIMIT 10' : ''}`,
          [parseInt(groupId), req.user.id, `%${q}%`]
        );
      } else {
        users = await query(req.schema,
          `SELECT id,name,display_name,avatar,role,status,hide_admin_tag,allow_dm,is_minor,is_default_admin FROM users WHERE status='active' AND id!=$1 AND (name ILIKE $2 OR display_name ILIKE $2) ORDER BY name ASC${isTyped ? ' LIMIT 10' : ''}`,
          [req.user.id, `%${q}%`]
        );
      }
    } else {
      users = await query(req.schema,
        `SELECT id,name,display_name,avatar,role,status,hide_admin_tag,allow_dm,is_minor,is_default_admin FROM users WHERE status='active' AND (name ILIKE $1 OR display_name ILIKE $1) ORDER BY name ASC${isTyped ? ' LIMIT 10' : ''}`,
        [`%${q}%`]
      );
    }
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Check display name
router.get('/check-display-name', authMiddleware, async (req, res) => {
  const { name } = req.query;
  if (!name) return res.json({ taken: false });
  try {
    const conflict = await queryOne(req.schema,
      "SELECT id FROM users WHERE LOWER(display_name)=LOWER($1) AND id!=$2 AND status!='deleted'",
      [name, req.user.id]
    );
    res.json({ taken: !!conflict });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create user
router.post('/', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { firstName, lastName, email, password, role, phone, dateOfBirth } = req.body;
  if (!firstName?.trim() || !lastName?.trim() || !email)
    return res.status(400).json({ error: 'First name, last name and email required' });
  if (!isValidEmail(email.trim())) return res.status(400).json({ error: 'Invalid email address' });
  const validRoles = ['member', 'admin', 'manager'];
  const assignedRole = validRoles.includes(role) ? role : 'member';
  const name = `${firstName.trim()} ${lastName.trim()}`;
  try {
    const loginType = await getLoginType(req.schema);
    const dob     = dateOfBirth || null;
    const isMinor = isMinorFromDOB(dob);
    // In mixed_age mode, minors start suspended and need guardian approval
    const initStatus = (loginType === 'mixed_age' && isMinor) ? 'suspended' : 'active';

    const exists = await queryOne(req.schema, "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND status != 'deleted'", [email.trim()]);
    if (exists) return res.status(400).json({ error: 'Email already in use' });
    const resolvedName = await resolveUniqueName(req.schema, name);
    const pw   = (password || '').trim() || process.env.USER_PASS || 'user@1234';
    const hash = bcrypt.hashSync(pw, 10);
    const r    = await queryResult(req.schema,
      "INSERT INTO users (name,first_name,last_name,email,password,role,phone,is_minor,date_of_birth,status,must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE) RETURNING id",
      [resolvedName, firstName.trim(), lastName.trim(), email.trim().toLowerCase(), hash, assignedRole, phone?.trim() || null, isMinor, dob, initStatus]
    );
    const userId = r.rows[0].id;
    if (initStatus === 'active') await addUserToPublicGroups(req.schema, userId);
    if (assignedRole === 'admin') {
      const sgId = await getOrCreateSupportGroup(req.schema);
      if (sgId) await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sgId, userId]);
    }
    const user = await queryOne(req.schema,
      'SELECT id,name,first_name,last_name,phone,is_minor,date_of_birth,guardian_user_id,guardian_approval_required,email,role,status,must_change_password,created_at FROM users WHERE id=$1',
      [userId]
    );
    res.json({ user, pendingApproval: initStatus === 'suspended' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update user (general — name components, phone, DOB, is_minor, role, optional password reset)
router.patch('/:id', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });
  const { firstName, lastName, phone, role, password, dateOfBirth, guardianUserId } = req.body;
  if (!firstName?.trim() || !lastName?.trim())
    return res.status(400).json({ error: 'First and last name required' });
  const validRoles = ['member', 'admin', 'manager'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const target = await queryOne(req.schema, 'SELECT * FROM users WHERE id=$1', [id]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.is_default_admin && role !== 'admin')
      return res.status(403).json({ error: 'Cannot change default admin role' });

    const dob     = dateOfBirth || null;
    const isMinor = isMinorFromDOB(dob);
    const name    = `${firstName.trim()} ${lastName.trim()}`;
    const resolvedName = await resolveUniqueName(req.schema, name, id);

    // Validate guardian if provided
    let guardianId = null;
    if (guardianUserId) {
      const gUser = await queryOne(req.schema, 'SELECT id,is_minor FROM users WHERE id=$1 AND status=$2', [parseInt(guardianUserId), 'active']);
      if (!gUser) return res.status(400).json({ error: 'Guardian user not found or inactive' });
      if (gUser.is_minor) return res.status(400).json({ error: 'A minor cannot be a guardian' });
      guardianId = gUser.id;
    }

    await exec(req.schema,
      'UPDATE users SET name=$1,first_name=$2,last_name=$3,phone=$4,is_minor=$5,date_of_birth=$6,guardian_user_id=$7,role=$8,updated_at=NOW() WHERE id=$9',
      [resolvedName, firstName.trim(), lastName.trim(), phone?.trim() || null, isMinor, dob, guardianId, role, id]
    );
    if (password && password.length >= 6) {
      const hash = bcrypt.hashSync(password, 10);
      await exec(req.schema, 'UPDATE users SET password=$1,must_change_password=TRUE,updated_at=NOW() WHERE id=$2', [hash, id]);
    }
    if (role === 'admin' && target.role !== 'admin') {
      const sgId = await getOrCreateSupportGroup(req.schema);
      if (sgId) await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sgId, id]);
    }
    // Auto-unsuspend minor in players group if both guardian and DOB are now set
    if (isMinor && guardianId && dob && target.status === 'suspended') {
      const playersRow = await queryOne(req.schema, "SELECT value FROM settings WHERE key='feature_players_group_id'");
      const playersGroupId = parseInt(playersRow?.value);
      if (playersGroupId) {
        const inPlayers = await queryOne(req.schema, 'SELECT 1 FROM user_group_members WHERE user_id=$1 AND user_group_id=$2', [id, playersGroupId]);
        if (inPlayers) {
          await exec(req.schema, "UPDATE users SET status='active',updated_at=NOW() WHERE id=$1", [id]);
          await addUserToPublicGroups(req.schema, id);
        }
      }
    }
    const user = await queryOne(req.schema,
      'SELECT id,name,first_name,last_name,phone,is_minor,date_of_birth,guardian_user_id,guardian_approval_required,email,role,status,must_change_password,last_online,created_at FROM users WHERE id=$1',
      [id]
    );
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk create
router.post('/bulk', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { users } = req.body;
  const results = { created: [], skipped: [] };
  const seenEmails = new Set();
  const defaultPw = process.env.USER_PASS || 'user@1234';
  const validRoles = ['member', 'manager', 'admin'];
  try {
    for (const u of users) {
      const email     = (u.email     || '').trim().toLowerCase();
      const firstName = (u.firstName || '').trim();
      const lastName  = (u.lastName  || '').trim();
      // Support legacy name field too
      const name = (firstName && lastName) ? `${firstName} ${lastName}` : (u.name || '').trim();
      if (!email)              { results.skipped.push({ email: '(blank)', reason: 'Email required' }); continue; }
      if (!isValidEmail(email)){ results.skipped.push({ email, reason: 'Invalid email address' }); continue; }
      if (!name)               { results.skipped.push({ email, reason: 'First and last name required' }); continue; }
      if (seenEmails.has(email)){ results.skipped.push({ email, reason: 'Duplicate email in CSV' }); continue; }
      seenEmails.add(email);
      const exists = await queryOne(req.schema, "SELECT id FROM users WHERE email=$1 AND status != 'deleted'", [email]);
      if (exists) { results.skipped.push({ email, reason: 'Email already exists' }); continue; }
      try {
        const resolvedName = await resolveUniqueName(req.schema, name);
        const pw       = (u.password || '').trim() || defaultPw;
        const hash     = bcrypt.hashSync(pw, 10);
        const newRole  = validRoles.includes(u.role) ? u.role : 'member';
        const fn       = firstName || name.split(' ')[0] || '';
        const ln       = lastName  || name.split(' ').slice(1).join(' ') || '';
        const dob      = (u.dateOfBirth || u.dob || '').trim() || null;
        const isMinor  = isMinorFromDOB(dob);
        const loginType = await getLoginType(req.schema);
        const initStatus = (loginType === 'mixed_age' && isMinor) ? 'suspended' : 'active';
        const r = await queryResult(req.schema,
          "INSERT INTO users (name,first_name,last_name,email,password,role,date_of_birth,is_minor,status,must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE) RETURNING id",
          [resolvedName, fn, ln, email, hash, newRole, dob, isMinor, initStatus]
        );
        const userId = r.rows[0].id;
        if (initStatus === 'active') await addUserToPublicGroups(req.schema, userId);
        if (newRole === 'admin') {
          const sgId = await getOrCreateSupportGroup(req.schema);
          if (sgId) await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sgId, userId]);
        }
        // Add to user group if specified (silent — user was just created, no socket needed)
        if (u.userGroupId) {
          const ug = await queryOne(req.schema, 'SELECT * FROM user_groups WHERE id=$1', [u.userGroupId]);
          if (ug) {
            await exec(req.schema, 'INSERT INTO user_group_members (user_group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ug.id, userId]);
            if (ug.dm_group_id) {
              await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ug.dm_group_id, userId]);
            }
          }
        }
        results.created.push(email);
      } catch (e) { results.skipped.push({ email, reason: e.message }); }
    }
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Patch name
router.patch('/:id/name', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const target = await queryOne(req.schema, 'SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const resolvedName = await resolveUniqueName(req.schema, name.trim(), req.params.id);
    await exec(req.schema, 'UPDATE users SET name=$1, updated_at=NOW() WHERE id=$2', [resolvedName, target.id]);
    res.json({ success: true, name: resolvedName });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Patch role
router.patch('/:id/role', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { role } = req.body;
  if (!['member','admin','manager'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const target = await queryOne(req.schema, 'SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.is_default_admin) return res.status(403).json({ error: 'Cannot modify default admin role' });
    await exec(req.schema, 'UPDATE users SET role=$1, updated_at=NOW() WHERE id=$2', [role, target.id]);
    if (role === 'admin') {
      const sgId = await getOrCreateSupportGroup(req.schema);
      if (sgId) await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sgId, target.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset password
router.patch('/:id/reset-password', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password too short' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    await exec(req.schema, 'UPDATE users SET password=$1, must_change_password=TRUE, updated_at=NOW() WHERE id=$2', [hash, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Suspend / activate / delete
router.patch('/:id/suspend',  authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const t = await queryOne(req.schema, 'SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'User not found' });
    if (t.is_default_admin) return res.status(403).json({ error: 'Cannot suspend default admin' });
    await exec(req.schema, "UPDATE users SET status='suspended', updated_at=NOW() WHERE id=$1", [t.id]);
    // Clear active sessions so suspended user is immediately kicked
    await exec(req.schema, 'DELETE FROM active_sessions WHERE user_id=$1', [t.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.patch('/:id/activate', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    await exec(req.schema, "UPDATE users SET status='active', updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/:id',         authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const t = await queryOne(req.schema, 'SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'User not found' });
    if (t.is_default_admin) return res.status(403).json({ error: 'Cannot delete default admin' });

    // ── 1. Anonymise the user record ─────────────────────────────────────────
    // Scrub the email immediately so the address is free for re-use.
    // Replace name/display_name/avatar/about_me so no PII is retained.
    await exec(req.schema, `
      UPDATE users SET
        status        = 'deleted',
        email         = $1,
        name          = 'Deleted User',
        first_name    = NULL,
        last_name     = NULL,
        phone         = NULL,
        is_minor      = FALSE,
        display_name  = NULL,
        avatar        = NULL,
        about_me      = NULL,
        password      = '',
        updated_at    = NOW()
      WHERE id = $2
    `, [`deleted_${t.id}@deleted`, t.id]);

    // ── 2. Anonymise their messages ───────────────────────────────────────────
    // Mark all their messages as deleted so they render as "This message was
    // deleted" in conversation history — no content holes for other members.
    await exec(req.schema,
      'UPDATE messages SET is_deleted=TRUE, content=NULL, image_url=NULL WHERE user_id=$1 AND is_deleted=FALSE',
      [t.id]
    );

    // ── 3. Freeze any DMs that only had this user + one other person ──────────
    // The surviving peer still has their DM visible but it becomes read-only
    // (frozen) since the other party is gone. Group chats (3+ people) are
    // left intact — the other members' history and ongoing chat is unaffected.
    await exec(req.schema, `
      UPDATE groups SET is_readonly=TRUE, updated_at=NOW()
      WHERE is_direct=TRUE
        AND (direct_peer1_id=$1 OR direct_peer2_id=$1)
    `, [t.id]);

    // ── 4. Remove memberships ────────────────────────────────────────────────
    await exec(req.schema, 'DELETE FROM group_members    WHERE user_id=$1', [t.id]);
    await exec(req.schema, 'DELETE FROM user_group_members WHERE user_id=$1', [t.id]);

    // ── 5. Purge sessions, push subscriptions, notifications ─────────────────
    await exec(req.schema, 'DELETE FROM active_sessions    WHERE user_id=$1', [t.id]);
    await exec(req.schema, 'DELETE FROM push_subscriptions WHERE user_id=$1', [t.id]);
    await exec(req.schema, 'DELETE FROM notifications      WHERE user_id=$1', [t.id]);
    await exec(req.schema, 'DELETE FROM event_availability WHERE user_id=$1', [t.id]);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update own profile
router.patch('/me/profile', authMiddleware, async (req, res) => {
  const { displayName, aboutMe, hideAdminTag, allowDm, dateOfBirth, phone } = req.body;
  try {
    if (displayName) {
      const conflict = await queryOne(req.schema,
        "SELECT id FROM users WHERE LOWER(display_name)=LOWER($1) AND id!=$2 AND status!='deleted'",
        [displayName, req.user.id]
      );
      if (conflict) return res.status(400).json({ error: 'Display name already in use' });
    }
    const dob     = dateOfBirth || null;
    const isMinor = isMinorFromDOB(dob);
    await exec(req.schema,
      'UPDATE users SET display_name=$1, about_me=$2, hide_admin_tag=$3, allow_dm=$4, date_of_birth=$5, is_minor=$6, phone=$7, updated_at=NOW() WHERE id=$8',
      [displayName || null, aboutMe || null, !!hideAdminTag, allowDm !== false, dob, isMinor, phone?.trim() || null, req.user.id]
    );
    const user = await queryOne(req.schema,
      'SELECT id,name,email,role,status,avatar,about_me,display_name,hide_admin_tag,allow_dm,date_of_birth,phone FROM users WHERE id=$1',
      [req.user.id]
    );
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload avatar
router.post('/me/avatar', authMiddleware, uploadAvatar.single('avatar'), async (req, res) => {
  if (req.user.is_default_admin) return res.status(403).json({ error: 'Default admin avatar cannot be changed' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const sharp    = require('sharp');
    const filePath = req.file.path;
    const MAX_DIM  = 256;
    const image    = sharp(filePath);
    const meta     = await image.metadata();
    const needsResize = meta.width > MAX_DIM || meta.height > MAX_DIM;
    if (req.file.size >= 500 * 1024 || needsResize) {
      const outPath = filePath.replace(/\.[^.]+$/, '.webp');
      await sharp(filePath).resize(MAX_DIM,MAX_DIM,{fit:'cover',withoutEnlargement:true}).webp({quality:82}).toFile(outPath);
      const fs = require('fs');
      fs.unlinkSync(filePath);
      const avatarUrl = `/uploads/avatars/${path.basename(outPath)}`;
      await exec(req.schema, 'UPDATE users SET avatar=$1, updated_at=NOW() WHERE id=$2', [avatarUrl, req.user.id]);
      return res.json({ avatarUrl });
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    await exec(req.schema, 'UPDATE users SET avatar=$1, updated_at=NOW() WHERE id=$2', [avatarUrl, req.user.id]);
    res.json({ avatarUrl });
  } catch (err) {
    console.error('Avatar error:', err);
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    await exec(req.schema, 'UPDATE users SET avatar=$1, updated_at=NOW() WHERE id=$2', [avatarUrl, req.user.id]).catch(()=>{});
    res.json({ avatarUrl });
  }
});

// ── Guardian alias routes (Guardian Only mode) ──────────────────────────────

// List ALL aliases — admin/manager only (for Group Manager alias management)
router.get('/aliases-all', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const aliases = await query(req.schema,
      `SELECT ga.id, ga.first_name, ga.last_name, ga.guardian_id, ga.avatar, ga.date_of_birth,
              u.name AS guardian_name, u.display_name AS guardian_display_name
       FROM guardian_aliases ga
       JOIN users u ON u.id = ga.guardian_id
       ORDER BY ga.first_name, ga.last_name`,
    );
    res.json({ aliases });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get current user's partner (spouse/partner relationship)
router.get('/me/partner', authMiddleware, async (req, res) => {
  try {
    const partner = await queryOne(req.schema,
      `SELECT u.id, u.name, u.display_name, u.avatar, gp.respond_separately
       FROM guardian_partners gp
       JOIN users u ON u.id = CASE WHEN gp.user_id_1=$1 THEN gp.user_id_2 ELSE gp.user_id_1 END
       WHERE gp.user_id_1=$1 OR gp.user_id_2=$1`,
      [req.user.id]
    );
    res.json({ partner: partner || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set partner (replaces any existing partnership for this user)
// If the partner is changing to a different person, the user's child aliases are also removed.
router.post('/me/partner', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const partnerId = parseInt(req.body.partnerId);
  const respondSeparately = !!req.body.respondSeparately;
  if (!partnerId || partnerId === userId) return res.status(400).json({ error: 'Invalid partner' });
  const uid1 = Math.min(userId, partnerId);
  const uid2 = Math.max(userId, partnerId);
  try {
    // Check current partner before replacing
    const currentRow = await queryOne(req.schema,
      `SELECT CASE WHEN user_id_1=$1 THEN user_id_2 ELSE user_id_1 END AS partner_id
       FROM guardian_partners WHERE user_id_1=$1 OR user_id_2=$1`,
      [userId]
    );
    const currentPartnerId = currentRow?.partner_id ? parseInt(currentRow.partner_id) : null;
    await exec(req.schema, 'DELETE FROM guardian_partners WHERE user_id_1=$1 OR user_id_2=$1', [userId]);
    // If switching to a different partner, remove user's own child aliases
    if (currentPartnerId && currentPartnerId !== partnerId) {
      await exec(req.schema, 'DELETE FROM guardian_aliases WHERE guardian_id=$1', [userId]);
    }
    await exec(req.schema, 'INSERT INTO guardian_partners (user_id_1,user_id_2,respond_separately) VALUES ($1,$2,$3)', [uid1, uid2, respondSeparately]);
    const partner = await queryOne(req.schema,
      'SELECT id,name,display_name,avatar FROM users WHERE id=$1',
      [partnerId]
    );
    res.json({ partner: { ...partner, respond_separately: respondSeparately } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update respond_separately on existing partnership
router.patch('/me/partner', authMiddleware, async (req, res) => {
  const respondSeparately = !!req.body.respondSeparately;
  try {
    await exec(req.schema,
      'UPDATE guardian_partners SET respond_separately=$1 WHERE user_id_1=$2 OR user_id_2=$2',
      [respondSeparately, req.user.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove partner — also removes the requesting user's child aliases
router.delete('/me/partner', authMiddleware, async (req, res) => {
  try {
    await exec(req.schema, 'DELETE FROM guardian_aliases WHERE guardian_id=$1', [req.user.id]);
    await exec(req.schema, 'DELETE FROM guardian_partners WHERE user_id_1=$1 OR user_id_2=$1', [req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List current user's aliases (includes partner's aliases)
router.get('/me/aliases', authMiddleware, async (req, res) => {
  try {
    const aliases = await query(req.schema,
      `SELECT id,first_name,last_name,email,date_of_birth,avatar,phone
       FROM guardian_aliases
       WHERE guardian_id=$1
          OR guardian_id IN (
            SELECT CASE WHEN user_id_1=$1 THEN user_id_2 ELSE user_id_1 END
            FROM guardian_partners WHERE user_id_1=$1 OR user_id_2=$1
          )
       ORDER BY first_name,last_name`,
      [req.user.id]
    );
    res.json({ aliases });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create alias
router.post('/me/aliases', authMiddleware, async (req, res) => {
  const { firstName, lastName, email, dateOfBirth, phone } = req.body;
  if (!firstName?.trim() || !lastName?.trim()) return res.status(400).json({ error: 'First and last name required' });
  try {
    const r = await queryResult(req.schema,
      'INSERT INTO guardian_aliases (guardian_id,first_name,last_name,email,date_of_birth,phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [req.user.id, firstName.trim(), lastName.trim(), email?.trim() || null, dateOfBirth || null, phone?.trim() || null]
    );
    const aliasId = r.rows[0].id;

    // Auto-add alias to players group if designated
    const playersRow = await queryOne(req.schema, "SELECT value FROM settings WHERE key='feature_players_group_id'");
    const playersGroupId = parseInt(playersRow?.value);
    if (playersGroupId) {
      await exec(req.schema,
        'INSERT INTO alias_group_members (user_group_id,alias_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [playersGroupId, aliasId]
      );
    }
    const alias = await queryOne(req.schema,
      'SELECT id,first_name,last_name,email,date_of_birth,avatar,phone FROM guardian_aliases WHERE id=$1',
      [aliasId]
    );
    res.json({ alias });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update alias
router.patch('/me/aliases/:aliasId', authMiddleware, async (req, res) => {
  const aliasId = parseInt(req.params.aliasId);
  const { firstName, lastName, email, dateOfBirth, phone } = req.body;
  if (!firstName?.trim() || !lastName?.trim()) return res.status(400).json({ error: 'First and last name required' });
  try {
    const existing = await queryOne(req.schema,
      `SELECT id FROM guardian_aliases WHERE id=$1 AND (
         guardian_id=$2 OR guardian_id IN (
           SELECT CASE WHEN user_id_1=$2 THEN user_id_2 ELSE user_id_1 END
           FROM guardian_partners WHERE user_id_1=$2 OR user_id_2=$2
         )
       )`,
      [aliasId, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Alias not found' });
    await exec(req.schema,
      'UPDATE guardian_aliases SET first_name=$1,last_name=$2,email=$3,date_of_birth=$4,phone=$5,updated_at=NOW() WHERE id=$6',
      [firstName.trim(), lastName.trim(), email?.trim() || null, dateOfBirth || null, phone?.trim() || null, aliasId]
    );
    const alias = await queryOne(req.schema,
      'SELECT id,first_name,last_name,email,date_of_birth,avatar,phone FROM guardian_aliases WHERE id=$1',
      [aliasId]
    );
    res.json({ alias });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete alias
router.delete('/me/aliases/:aliasId', authMiddleware, async (req, res) => {
  const aliasId = parseInt(req.params.aliasId);
  try {
    const existing = await queryOne(req.schema,
      `SELECT id FROM guardian_aliases WHERE id=$1 AND (
         guardian_id=$2 OR guardian_id IN (
           SELECT CASE WHEN user_id_1=$2 THEN user_id_2 ELSE user_id_1 END
           FROM guardian_partners WHERE user_id_1=$2 OR user_id_2=$2
         )
       )`,
      [aliasId, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Alias not found' });
    await exec(req.schema, 'DELETE FROM guardian_aliases WHERE id=$1', [aliasId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload alias avatar
router.post('/me/aliases/:aliasId/avatar', authMiddleware, uploadAliasAvatar.single('avatar'), async (req, res) => {
  const aliasId = parseInt(req.params.aliasId);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const existing = await queryOne(req.schema,
      `SELECT id FROM guardian_aliases WHERE id=$1 AND (
         guardian_id=$2 OR guardian_id IN (
           SELECT CASE WHEN user_id_1=$2 THEN user_id_2 ELSE user_id_1 END
           FROM guardian_partners WHERE user_id_1=$2 OR user_id_2=$2
         )
       )`,
      [aliasId, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Alias not found' });
    const sharp    = require('sharp');
    const filePath = req.file.path;
    const MAX_DIM  = 256;
    const image    = sharp(filePath);
    const meta     = await image.metadata();
    const needsResize = meta.width > MAX_DIM || meta.height > MAX_DIM;
    let avatarUrl;
    if (req.file.size >= 500 * 1024 || needsResize) {
      const outPath = filePath.replace(/\.[^.]+$/, '.webp');
      await sharp(filePath).resize(MAX_DIM,MAX_DIM,{fit:'cover',withoutEnlargement:true}).webp({quality:82}).toFile(outPath);
      require('fs').unlinkSync(filePath);
      avatarUrl = `/uploads/avatars/${path.basename(outPath)}`;
    } else {
      avatarUrl = `/uploads/avatars/${req.file.filename}`;
    }
    await exec(req.schema, 'UPDATE guardian_aliases SET avatar=$1,updated_at=NOW() WHERE id=$2', [avatarUrl, aliasId]);
    res.json({ avatarUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Search minor users (Mixed Age — for Add Child in profile)
router.get('/search-minors', authMiddleware, async (req, res) => {
  const { q } = req.query;
  try {
    const users = await query(req.schema,
      `SELECT id,name,first_name,last_name,date_of_birth,avatar,phone FROM users
       WHERE is_minor=TRUE AND status='suspended' AND guardian_user_id IS NULL AND status!='deleted'
       AND (name ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1)
       ORDER BY name ASC LIMIT 20`,
      [`%${q || ''}%`]
    );
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Approve guardian link (Mixed Age — manager+ sets guardian, clears approval flag, unsuspends)
router.patch('/:id/approve-guardian', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const minor = await queryOne(req.schema, 'SELECT * FROM users WHERE id=$1', [id]);
    if (!minor) return res.status(404).json({ error: 'User not found' });
    if (!minor.guardian_approval_required) return res.status(400).json({ error: 'No pending approval' });
    await exec(req.schema,
      "UPDATE users SET guardian_approval_required=FALSE,status='active',updated_at=NOW() WHERE id=$1",
      [id]
    );
    await addUserToPublicGroups(req.schema, id);
    const user = await queryOne(req.schema,
      'SELECT id,name,first_name,last_name,phone,is_minor,date_of_birth,guardian_user_id,guardian_approval_required,email,role,status FROM users WHERE id=$1',
      [id]
    );
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Deny guardian link (Mixed Age — clears guardian, keeps suspended)
router.patch('/:id/deny-guardian', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const minor = await queryOne(req.schema, 'SELECT * FROM users WHERE id=$1', [id]);
    if (!minor) return res.status(404).json({ error: 'User not found' });
    await exec(req.schema,
      'UPDATE users SET guardian_approval_required=FALSE,guardian_user_id=NULL,updated_at=NOW() WHERE id=$1',
      [id]
    );
    const user = await queryOne(req.schema,
      'SELECT id,name,first_name,last_name,phone,is_minor,date_of_birth,guardian_user_id,guardian_approval_required,email,role,status FROM users WHERE id=$1',
      [id]
    );
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List minor players available for this guardian to claim (Mixed Age — Family Manager)
// Returns minors in the players group who either have no guardian yet or are already linked to me.
router.get('/minor-players', authMiddleware, async (req, res) => {
  try {
    const playersRow = await queryOne(req.schema, "SELECT value FROM settings WHERE key='feature_players_group_id'");
    const playersGroupId = parseInt(playersRow?.value);
    if (!playersGroupId) return res.json({ users: [] });
    const users = await query(req.schema,
      `SELECT u.id,u.name,u.first_name,u.last_name,u.date_of_birth,u.avatar,u.status,u.guardian_user_id
       FROM users u
       JOIN user_group_members ugm ON ugm.user_id=u.id AND ugm.user_group_id=$1
       WHERE u.is_minor=TRUE AND u.status!='deleted'
         AND (u.guardian_user_id IS NULL OR u.guardian_user_id=$2)
       ORDER BY u.first_name,u.last_name`,
      [playersGroupId, req.user.id]
    );
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Claim minor as guardian (Mixed Age — Family Manager direct link, no approval needed)
// dateOfBirth is required to activate the minor — without it the guardian is saved but the account stays suspended.
router.post('/me/guardian-children/:minorId', authMiddleware, async (req, res) => {
  const minorId = parseInt(req.params.minorId);
  const { dateOfBirth } = req.body;
  try {
    const minor = await queryOne(req.schema, "SELECT * FROM users WHERE id=$1 AND status!='deleted'", [minorId]);
    if (!minor) return res.status(404).json({ error: 'User not found' });
    if (!minor.is_minor) return res.status(400).json({ error: 'User is not a minor' });
    if (minor.guardian_user_id && minor.guardian_user_id !== req.user.id)
      return res.status(409).json({ error: 'This minor already has a guardian' });
    const dob = dateOfBirth || minor.date_of_birth || null;
    const isMinor = dob ? isMinorFromDOB(dob) : minor.is_minor;
    const shouldActivate = !!dob;
    const newStatus = shouldActivate ? 'active' : 'suspended';
    await exec(req.schema,
      'UPDATE users SET guardian_user_id=$1,guardian_approval_required=FALSE,date_of_birth=$2,is_minor=$3,status=$4,updated_at=NOW() WHERE id=$5',
      [req.user.id, dob, isMinor, newStatus, minorId]
    );
    if (shouldActivate) await addUserToPublicGroups(req.schema, minorId);
    const user = await queryOne(req.schema,
      'SELECT id,name,first_name,last_name,date_of_birth,avatar,status,guardian_user_id FROM users WHERE id=$1',
      [minorId]
    );
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove minor from guardian's list (Mixed Age — re-suspends the minor)
router.delete('/me/guardian-children/:minorId', authMiddleware, async (req, res) => {
  const minorId = parseInt(req.params.minorId);
  try {
    const minor = await queryOne(req.schema, 'SELECT * FROM users WHERE id=$1', [minorId]);
    if (!minor) return res.status(404).json({ error: 'User not found' });
    if (minor.guardian_user_id !== req.user.id)
      return res.status(403).json({ error: 'You are not the guardian of this user' });
    await exec(req.schema,
      "UPDATE users SET guardian_user_id=NULL,status='suspended',updated_at=NOW() WHERE id=$1",
      [minorId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Guardian self-link (Mixed Age — user links themselves as guardian of a minor, triggers approval)
router.patch('/me/link-minor/:minorId', authMiddleware, async (req, res) => {
  const minorId = parseInt(req.params.minorId);
  try {
    const minor = await queryOne(req.schema, 'SELECT * FROM users WHERE id=$1', [minorId]);
    if (!minor) return res.status(404).json({ error: 'Minor user not found' });
    if (!minor.is_minor) return res.status(400).json({ error: 'User is not flagged as a minor' });
    if (minor.guardian_user_id && !minor.guardian_approval_required)
      return res.status(400).json({ error: 'This minor already has an approved guardian' });
    await exec(req.schema,
      'UPDATE users SET guardian_user_id=$1,guardian_approval_required=TRUE,updated_at=NOW() WHERE id=$2',
      [req.user.id, minorId]
    );
    res.json({ success: true, pendingApproval: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
