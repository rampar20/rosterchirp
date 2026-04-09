const express = require('express');
const router = express.Router();
const fs = require('fs');

const ABOUT_FILE = '/app/data/about.json';

const DEFAULTS = {
  built_with: 'Node.js · Express · Socket.io · PostgreSQL · React · Vite · Claude.ai',
  developer: 'Ricky Stretch',
  license: 'AGPL 3.0',
  license_url: 'https://www.gnu.org/licenses/agpl-3.0.html',
  description: 'Self-hosted, privacy-first team messaging.',
};

// GET /api/about — public, no auth required
router.get('/', (req, res) => {
  let overrides = {};
  try {
    if (fs.existsSync(ABOUT_FILE)) {
      const raw = fs.readFileSync(ABOUT_FILE, 'utf8');
      overrides = JSON.parse(raw);
    }
  } catch (e) {
    console.warn('about.json parse error:', e.message);
  }

  // Version always comes from the runtime env (same source as Settings window)
  const about = {
    ...DEFAULTS,
    ...overrides,
    version: process.env.ROSTERCHIRP_VERSION || process.env.TEAMCHAT_VERSION || 'dev',
    // Always expose original app identity — not overrideable via about.json or settings
    default_app_name: 'rosterchirp',
    default_logo: '/icons/rosterchirp.png',
  };

  // Never expose docker_image — removed from UI
  delete about.docker_image;

  res.json({ about });
});

module.exports = router;
