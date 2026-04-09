const jwt     = require('jsonwebtoken');
const { query, queryOne, exec } = require('../models/db');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme_super_secret';

function getDeviceClass(ua) {
  if (!ua) return 'desktop';
  const s = ua.toLowerCase();
  if (/mobile|android(?!.*tablet)|iphone|ipod|blackberry|windows phone|opera mini|silk/.test(s)) return 'mobile';
  if (/tablet|ipad|kindle|playbook|android/.test(s)) return 'mobile';
  return 'desktop';
}

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await queryOne(req.schema,
      "SELECT * FROM users WHERE id = $1 AND status = 'active'", [decoded.id]
    );
    if (!user) return res.status(401).json({ error: 'User not found or suspended' });
    const session = await queryOne(req.schema,
      'SELECT * FROM active_sessions WHERE user_id = $1 AND token = $2', [decoded.id, token]
    );
    if (!session) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    req.user   = user;
    req.token  = token;
    req.device = session.device;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

async function teamManagerMiddleware(req, res, next) {
  if (req.user?.role === 'admin' || req.user?.role === 'manager') return next();
  try {
    const tmSetting = await queryOne(req.schema,
      "SELECT value FROM settings WHERE key = 'team_tool_managers'"
    );
    const gmSetting = await queryOne(req.schema,
      "SELECT value FROM settings WHERE key = 'team_group_managers'"
    );
    const allowedGroupIds = [
      ...new Set([
        ...JSON.parse(tmSetting?.value || '[]'),
        ...JSON.parse(gmSetting?.value  || '[]'),
      ])
    ];
    if (allowedGroupIds.length === 0) return res.status(403).json({ error: 'Access denied' });
    const placeholders = allowedGroupIds.map((_, i) => `$${i + 2}`).join(',');
    const member = await queryOne(req.schema,
      `SELECT 1 FROM user_group_members WHERE user_id = $1 AND user_group_id IN (${placeholders})`,
      [req.user.id, ...allowedGroupIds]
    );
    if (!member) return res.status(403).json({ error: 'Access denied' });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function generateToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });
}

async function setActiveSession(schema, userId, token, userAgent) {
  const device = getDeviceClass(userAgent);
  await exec(schema, `
    INSERT INTO active_sessions (user_id, device, token, ua, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (user_id, device) DO UPDATE SET token = $3, ua = $4, created_at = NOW()
  `, [userId, device, token, userAgent || null]);
  return device;
}

async function clearActiveSession(schema, userId, device) {
  if (device) {
    await exec(schema, 'DELETE FROM active_sessions WHERE user_id = $1 AND device = $2', [userId, device]);
  } else {
    await exec(schema, 'DELETE FROM active_sessions WHERE user_id = $1', [userId]);
  }
}

module.exports = {
  authMiddleware, adminMiddleware, teamManagerMiddleware,
  generateToken, setActiveSession, clearActiveSession, getDeviceClass,
};
