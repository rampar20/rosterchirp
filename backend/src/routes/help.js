const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const { exec, queryOne } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

const HELP_FILE = path.join(__dirname, '../data/help.md');

router.get('/', authMiddleware, (req, res) => {
  let content = '';
  try { content = fs.readFileSync(HELP_FILE, 'utf8'); }
  catch (e) { content = '# Getting Started\n\nHelp content is not available yet.'; }
  res.json({ content });
});

router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = await queryOne(req.schema, 'SELECT help_dismissed FROM users WHERE id = $1', [req.user.id]);
    res.json({ dismissed: !!user?.help_dismissed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/dismiss', authMiddleware, async (req, res) => {
  const { dismissed } = req.body;
  try {
    await exec(req.schema, 'UPDATE users SET help_dismissed = $1 WHERE id = $2', [!!dismissed, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
