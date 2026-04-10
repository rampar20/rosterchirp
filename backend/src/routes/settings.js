const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp');
const router  = express.Router();
const { query, queryOne, exec } = require('../models/db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

function makeIconStorage(prefix) {
  return multer.diskStorage({
    destination: '/app/uploads/logos',
    filename: (req, file, cb) => cb(null, `${prefix}_${Date.now()}${path.extname(file.originalname)}`),
  });
}
const iconOpts = {
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only')),
};
const uploadLogo      = multer({ storage: makeIconStorage('logo'),      ...iconOpts });
const uploadNewChat   = multer({ storage: makeIconStorage('newchat'),   ...iconOpts });
const uploadGroupInfo = multer({ storage: makeIconStorage('groupinfo'), ...iconOpts });

// Helper: upsert a setting
async function setSetting(schema, key, value) {
  await exec(schema,
    "INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()",
    [key, value]
  );
}

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const rows  = await query(req.schema, 'SELECT key, value FROM settings');
    const obj   = {};
    for (const r of rows) obj[r.key] = r.value;
    const admin = await queryOne(req.schema, 'SELECT email FROM users WHERE is_default_admin = TRUE');
    if (admin) obj.admin_email = admin.email;
    obj.app_version = process.env.ROSTERCHIRP_VERSION || 'dev';
    obj.user_pass   = process.env.USER_PASS || 'user@1234';
    // Tell the frontend whether this request came from the host control panel subdomain.
    // Used to show/hide the Control Panel menu item — only visible on the host's own subdomain.
    const reqHost = (req.headers.host || '').toLowerCase().split(':')[0];
    const appDomain = (process.env.APP_DOMAIN || '').toLowerCase();
    const hostSlug  = (process.env.HOST_SLUG  || 'host').toLowerCase();
    const hostControlDomain = appDomain ? `${hostSlug}.${appDomain}` : '';
    obj.is_host_domain = (
      process.env.APP_TYPE === 'host' &&
      !!hostControlDomain &&
      (reqHost === hostControlDomain || reqHost === 'localhost')
    ) ? 'true' : 'false';
    res.json({ settings: obj });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/app-name', authMiddleware, adminMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    await exec(req.schema, "UPDATE settings SET value=$1, updated_at=NOW() WHERE key='app_name'", [name.trim()]);
    res.json({ success: true, name: name.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/logo', authMiddleware, adminMiddleware, uploadLogo.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const logoUrl = `/uploads/logos/${req.file.filename}`;
  try {
    await sharp(req.file.path).resize(192,192,{fit:'contain',background:{r:255,g:255,b:255,alpha:0}}).png().toFile('/app/uploads/logos/pwa-icon-192.png');
    await sharp(req.file.path).resize(512,512,{fit:'contain',background:{r:255,g:255,b:255,alpha:0}}).png().toFile('/app/uploads/logos/pwa-icon-512.png');
    await exec(req.schema, "UPDATE settings SET value=$1, updated_at=NOW() WHERE key='logo_url'", [logoUrl]);
    await setSetting(req.schema, 'pwa_icon_192', '/uploads/logos/pwa-icon-192.png');
    await setSetting(req.schema, 'pwa_icon_512', '/uploads/logos/pwa-icon-512.png');
    res.json({ logoUrl });
  } catch (err) {
    console.error('[Logo] icon gen failed:', err.message);
    await exec(req.schema, "UPDATE settings SET value=$1, updated_at=NOW() WHERE key='logo_url'", [logoUrl]);
    res.json({ logoUrl });
  }
});

router.post('/icon-newchat', authMiddleware, adminMiddleware, uploadNewChat.single('icon'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const iconUrl = `/uploads/logos/${req.file.filename}`;
  try { await setSetting(req.schema, 'icon_newchat', iconUrl); res.json({ iconUrl }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/icon-groupinfo', authMiddleware, adminMiddleware, uploadGroupInfo.single('icon'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const iconUrl = `/uploads/logos/${req.file.filename}`;
  try { await setSetting(req.schema, 'icon_groupinfo', iconUrl); res.json({ iconUrl }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/colors', authMiddleware, adminMiddleware, async (req, res) => {
  const { colorTitle, colorTitleDark, colorAvatarPublic, colorAvatarDm } = req.body;
  try {
    if (colorTitle        !== undefined) await setSetting(req.schema, 'color_title',         colorTitle        || '');
    if (colorTitleDark    !== undefined) await setSetting(req.schema, 'color_title_dark',    colorTitleDark    || '');
    if (colorAvatarPublic !== undefined) await setSetting(req.schema, 'color_avatar_public', colorAvatarPublic || '');
    if (colorAvatarDm     !== undefined) await setSetting(req.schema, 'color_avatar_dm',     colorAvatarDm     || '');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/reset', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const originalName = process.env.APP_NAME || 'rosterchirp';
    await exec(req.schema, "UPDATE settings SET value=$1, updated_at=NOW() WHERE key='app_name'", [originalName]);
    await exec(req.schema, "UPDATE settings SET value='', updated_at=NOW() WHERE key='logo_url'");
    await exec(req.schema, "UPDATE settings SET value='', updated_at=NOW() WHERE key IN ('icon_newchat','icon_groupinfo','pwa_icon_192','pwa_icon_512','color_title','color_title_dark','color_avatar_public','color_avatar_dm')");
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const VALID_CODES = {
  'ROSTERCHIRP-TEAM-2024':  { appType:'RosterChirp-Team',  branding:true,  groupManager:true,  scheduleManager:true  },
  'ROSTERCHIRP-BRAND-2024': { appType:'RosterChirp-Brand', branding:true,  groupManager:false, scheduleManager:false },
  'ROSTERCHIRP-FULL-2024':  { appType:'RosterChirp-Team',  branding:true,  groupManager:true,  scheduleManager:true  },
};

router.post('/register', authMiddleware, adminMiddleware, async (req, res) => {
  const { code } = req.body;
  try {
    if (!code?.trim()) {
      await setSetting(req.schema, 'registration_code', '');
      await setSetting(req.schema, 'app_type', 'RosterChirp-Chat');
      await setSetting(req.schema, 'feature_branding', 'false');
      await setSetting(req.schema, 'feature_group_manager', 'false');
      await setSetting(req.schema, 'feature_schedule_manager', 'false');
      return res.json({ success:true, features:{branding:false,groupManager:false,scheduleManager:false,appType:'RosterChirp-Chat'} });
    }
    const match = VALID_CODES[code.trim().toUpperCase()];
    if (!match) return res.status(400).json({ error: 'Invalid registration code' });
    await setSetting(req.schema, 'registration_code',        code.trim());
    await setSetting(req.schema, 'app_type',                  match.appType);
    await setSetting(req.schema, 'feature_branding',          match.branding        ? 'true' : 'false');
    await setSetting(req.schema, 'feature_group_manager',     match.groupManager    ? 'true' : 'false');
    await setSetting(req.schema, 'feature_schedule_manager',  match.scheduleManager ? 'true' : 'false');
    res.json({ success:true, features:{ branding:match.branding, groupManager:match.groupManager, scheduleManager:match.scheduleManager, appType:match.appType } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/messages', authMiddleware, adminMiddleware, async (req, res) => {
  const { msgPublic, msgGroup, msgPrivateGroup, msgU2U } = req.body;
  try {
    if (msgPublic        !== undefined) await setSetting(req.schema, 'feature_msg_public',         msgPublic        ? 'true' : 'false');
    if (msgGroup         !== undefined) await setSetting(req.schema, 'feature_msg_group',          msgGroup         ? 'true' : 'false');
    if (msgPrivateGroup  !== undefined) await setSetting(req.schema, 'feature_msg_private_group',  msgPrivateGroup  ? 'true' : 'false');
    if (msgU2U           !== undefined) await setSetting(req.schema, 'feature_msg_u2u',            msgU2U           ? 'true' : 'false');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const VALID_LOGIN_TYPES = ['all_ages', 'guardian_only', 'mixed_age'];

router.patch('/login-type', authMiddleware, adminMiddleware, async (req, res) => {
  const { loginType, playersGroupId, guardiansGroupId } = req.body;
  if (!VALID_LOGIN_TYPES.includes(loginType)) return res.status(400).json({ error: 'Invalid login type' });
  try {
    // Enforce: can only change when no non-admin users exist, UNLESS staying on same value
    const existing = await queryOne(req.schema, "SELECT value FROM settings WHERE key='feature_login_type'");
    const current  = existing?.value || 'all_ages';
    if (loginType !== current) {
      const { count } = await queryOne(req.schema, "SELECT COUNT(*)::int AS count FROM users WHERE role != 'admin' AND status != 'deleted'");
      if (count > 0) return res.status(400).json({ error: 'Login Type can only be changed when no non-admin users exist.' });
    }
    await setSetting(req.schema, 'feature_login_type',       loginType);
    await setSetting(req.schema, 'feature_players_group_id', playersGroupId  != null ? String(playersGroupId)  : '');
    await setSetting(req.schema, 'feature_guardians_group_id', guardiansGroupId != null ? String(guardiansGroupId) : '');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/team', authMiddleware, adminMiddleware, async (req, res) => {
  const { toolManagers } = req.body;
  try {
    if (toolManagers !== undefined) {
      const val = JSON.stringify(toolManagers || []);
      await setSetting(req.schema, 'team_tool_managers',     val);
      await setSetting(req.schema, 'team_group_managers',    val);
      await setSetting(req.schema, 'team_schedule_managers', val);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
