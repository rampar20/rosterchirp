const express = require('express');
const bcrypt  = require('bcryptjs');
const { query, queryOne, queryResult, exec, getOrCreateSupportGroup } = require('../models/db');
const { generateToken, authMiddleware, setActiveSession, clearActiveSession } = require('../middleware/auth');

const R = (schema, type, id) => `${schema}:${type}:${id}`;

module.exports = function(io) {
  const router = express.Router();

  // Login
  router.post('/login', async (req, res) => {
    const { email, password, rememberMe } = req.body;
    try {
      const user = await queryOne(req.schema, 'SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      if (user.status === 'suspended') {
        const admin = await queryOne(req.schema, 'SELECT email FROM users WHERE is_default_admin = TRUE');
        return res.status(403).json({ error: 'suspended', adminEmail: admin?.email });
      }
      if (user.status === 'deleted') return res.status(403).json({ error: 'Account not found' });

      if (!bcrypt.compareSync(password, user.password))
        return res.status(401).json({ error: 'Invalid credentials' });

      const token  = generateToken(user.id);
      const ua     = req.headers['user-agent'] || '';
      const device = await setActiveSession(req.schema, user.id, token, ua);
      if (io) io.to(R(req.schema,'user',user.id)).emit('session:displaced', { device });

      const { password: _, ...userSafe } = user;
      res.json({ token, user: userSafe, mustChangePassword: !!user.must_change_password, rememberMe: !!rememberMe });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Change password
  router.post('/change-password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
      const user = await queryOne(req.schema, 'SELECT * FROM users WHERE id = $1', [req.user.id]);
      if (!bcrypt.compareSync(currentPassword, user.password))
        return res.status(400).json({ error: 'Current password is incorrect' });
      if (newPassword.length < 8)
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      const hash = bcrypt.hashSync(newPassword, 10);
      await exec(req.schema,
        'UPDATE users SET password = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2',
        [hash, req.user.id]
      );
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get current user
  router.get('/me', authMiddleware, (req, res) => {
    const { password, ...user } = req.user;
    res.json({ user });
  });

  // Logout
  router.post('/logout', authMiddleware, async (req, res) => {
    try {
      await clearActiveSession(req.schema, req.user.id, req.device);
      await exec(req.schema, 'DELETE FROM push_subscriptions WHERE user_id=$1 AND device=$2', [req.user.id, req.device]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Support contact form
  router.post('/support', async (req, res) => {
    const { name, email, message } = req.body;
    if (!name?.trim() || !email?.trim() || !message?.trim())
      return res.status(400).json({ error: 'All fields are required' });
    if (message.trim().length > 2000)
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    try {
      const groupId = await getOrCreateSupportGroup(req.schema);
      if (!groupId) return res.status(500).json({ error: 'Support group unavailable' });

      const admin = await queryOne(req.schema, 'SELECT id FROM users WHERE is_default_admin = TRUE');
      if (!admin) return res.status(500).json({ error: 'No admin configured' });

      const content = `📬 **Support Request**\n**Name:** ${name.trim()}\n**Email:** ${email.trim()}\n\n${message.trim()}`;
      const mr = await queryResult(req.schema,
        "INSERT INTO messages (group_id, user_id, content, type) VALUES ($1,$2,$3,'text') RETURNING id",
        [groupId, admin.id, content]
      );
      const newMsg = await queryOne(req.schema, `
        SELECT m.*, u.name AS user_name, u.display_name AS user_display_name, u.avatar AS user_avatar
        FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = $1
      `, [mr.rows[0].id]);
      if (newMsg) { newMsg.reactions = []; io.to(R(req.schema,'group',groupId)).emit('message:new', newMsg); }

      const admins = await query(req.schema, "SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
      for (const a of admins) io.to(R(req.schema,'user',a.id)).emit('notification:new', { type: 'support', groupId });

      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
