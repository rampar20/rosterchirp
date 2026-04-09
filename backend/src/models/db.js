/**
 * db.js — Postgres database layer for rosterchirp
 *
 * APP_TYPE environment variable controls tenancy:
 *   selfhost (default) → single schema 'public', one Postgres database
 *   host               → one schema per tenant, derived from HTTP Host header
 *
 * All routes call:  query(req.schema, sql, $params)
 * req.schema is set by tenantMiddleware before any route handler runs.
 */

const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// APP_TYPE validation — host mode requires HOST_DOMAIN and HOST_ADMIN_KEY.
// If either is missing, fall back to selfhost and warn rather than silently
// exposing a broken or insecure host control plane.
let APP_TYPE = (process.env.APP_TYPE || 'selfhost').toLowerCase().trim();
if (APP_TYPE === 'host') {
  if (!process.env.HOST_DOMAIN || !process.env.HOST_ADMIN_KEY) {
    console.warn('[DB] WARNING: APP_TYPE=host requires HOST_DOMAIN and HOST_ADMIN_KEY to be set.');
    console.warn('[DB] WARNING: Falling back to APP_TYPE=selfhost for safety.');
    APP_TYPE = 'selfhost';
  }
}
if (APP_TYPE !== 'host') APP_TYPE = 'selfhost'; // only two valid values

// ── Connection pool ───────────────────────────────────────────────────────────

const pool = new Pool({
  host:                    process.env.DB_HOST     || 'db',
  port:                    parseInt(process.env.DB_PORT || '5432'),
  database:                process.env.DB_NAME     || 'rosterchirp',
  user:                    process.env.DB_USER     || 'rosterchirp',
  password:                process.env.DB_PASSWORD || '',
  max:                     20,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// ── Schema resolution ─────────────────────────────────────────────────────────

const tenantDomainCache = new Map();

function resolveSchema(req) {
  if (APP_TYPE === 'selfhost') return 'public';

  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  const baseDomain = (process.env.HOST_DOMAIN || 'rosterchirp.com').toLowerCase();

  // Internal requests (Docker health checks, localhost) → public schema
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'public';

  // Subdomain: team1.rosterchirp.com → tenant_team1
  if (host.endsWith(`.${baseDomain}`)) {
    const slug = host.slice(0, -(baseDomain.length + 1));
    if (!slug || slug === 'www') throw new Error(`Invalid tenant slug: ${slug}`);
    return `tenant_${slug.replace(/[^a-z0-9]/g, '_')}`;
  }

  // Custom domain lookup (populated from host admin DB)
  if (tenantDomainCache.has(host)) return tenantDomainCache.get(host);

  // Base domain → public schema (host admin panel)
  if (host === baseDomain || host === `www.${baseDomain}`) return 'public';

  throw new Error(`Unknown tenant for host: ${host}`);
}

function refreshTenantCache(tenants) {
  tenantDomainCache.clear();
  for (const t of tenants) {
    if (t.custom_domain) {
      tenantDomainCache.set(t.custom_domain.toLowerCase(), `tenant_${t.slug}`);
    }
  }
}

// ── Schema name safety guard ──────────────────────────────────────────────────

function assertSafeSchema(schema) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`Unsafe schema name rejected: ${schema}`);
  }
}

// ── Core query helpers ────────────────────────────────────────────────────────

async function query(schema, sql, params = []) {
  assertSafeSchema(schema);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}", public`);
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function queryOne(schema, sql, params = []) {
  const rows = await query(schema, sql, params);
  return rows[0] || null;
}

async function queryResult(schema, sql, params = []) {
  assertSafeSchema(schema);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}", public`);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function exec(schema, sql, params = []) {
  await query(schema, sql, params);
}

async function withTransaction(schema, callback) {
  assertSafeSchema(schema);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Migration runner ──────────────────────────────────────────────────────────

async function ensureSchema(schema) {
  assertSafeSchema(schema);
  // Use a direct client outside of search_path for schema creation
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } finally {
    client.release();
  }
}

async function runMigrations(schema) {
  await ensureSchema(schema);

  await exec(schema, `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await query(schema, 'SELECT version FROM schema_migrations ORDER BY version');
  const appliedSet = new Set(applied.map(r => r.version));

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const m = file.match(/^(\d+)_/);
    if (!m) continue;
    const version = parseInt(m[1]);
    if (appliedSet.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`[DB:${schema}] Applying migration ${version}: ${file}`);

    await withTransaction(schema, async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [version, file]
      );
    });

    console.log(`[DB:${schema}] Migration ${version} done`);
  }
}

// ── Seeding ───────────────────────────────────────────────────────────────────

async function seedSettings(schema) {
  const defaults = [
    ['app_name',                 process.env.APP_NAME || 'rosterchirp'],
    ['logo_url',                 ''],
    ['pw_reset_active',          process.env.ADMPW_RESET === 'true' ? 'true' : 'false'],
    ['icon_newchat',             ''],
    ['icon_groupinfo',           ''],
    ['pwa_icon_192',             ''],
    ['pwa_icon_512',             ''],
    ['color_title',              ''],
    ['color_title_dark',         ''],
    ['color_avatar_public',      ''],
    ['color_avatar_dm',          ''],
    ['registration_code',        ''],
    ['feature_branding',         'false'],
    ['feature_group_manager',    'false'],
    ['feature_schedule_manager', 'false'],
    ['app_type',                 'RosterChirp-Chat'],
    ['team_group_managers',      ''],
    ['team_schedule_managers',   ''],
    ['team_tool_managers',       ''],
  ];
  for (const [key, value] of defaults) {
    await exec(schema,
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }
}

async function seedEventTypes(schema) {
  await exec(schema, `
    INSERT INTO event_types (name, colour, is_default, is_protected, default_duration_hrs)
    VALUES ('Event', '#6366f1', TRUE, TRUE, 1.0)
    ON CONFLICT (name) DO UPDATE SET is_default=TRUE, is_protected=TRUE, default_duration_hrs=1.0
  `);
  await exec(schema,
    "INSERT INTO event_types (name, colour, default_duration_hrs) VALUES ('Game', '#22c55e', 3.0) ON CONFLICT (name) DO NOTHING"
  );
  await exec(schema,
    "INSERT INTO event_types (name, colour, default_duration_hrs) VALUES ('Practice', '#f59e0b', 1.0) ON CONFLICT (name) DO NOTHING"
  );
}

async function seedUserGroups(schema) {
  // Seed three default user groups with their associated DM groups.
  // Uses ON CONFLICT DO NOTHING so re-runs on existing installs are safe.
  const defaults = ['Coaches', 'Players', 'Parents'];
  for (const name of defaults) {
    // Skip if a group with this name already exists
    const existing = await queryOne(schema,
      'SELECT id FROM user_groups WHERE name = $1', [name]
    );
    if (existing) {
      // Auto-configure feature settings if not already set
      if (name === 'Players') {
        await exec(schema,
          "INSERT INTO settings (key, value) VALUES ('feature_players_group_id', $1) ON CONFLICT (key) DO NOTHING",
          [existing.id.toString()]
        );
      } else if (name === 'Parents') {
        await exec(schema,
          "INSERT INTO settings (key, value) VALUES ('feature_guardians_group_id', $1) ON CONFLICT (key) DO NOTHING",
          [existing.id.toString()]
        );
      }
      continue;
    }

    // Create the managed DM chat group first
    const gr = await queryResult(schema,
      "INSERT INTO groups (name, type, is_readonly, is_managed) VALUES ($1, 'private', FALSE, TRUE) RETURNING id",
      [name]
    );
    const dmGroupId = gr.rows[0].id;

    // Create the user group linked to the DM group
    const ugr = await queryResult(schema,
      'INSERT INTO user_groups (name, dm_group_id) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING id',
      [name, dmGroupId]
    );
    const ugId = ugr.rows[0]?.id;
    console.log(`[DB:${schema}] Default user group created: ${name}`);

    // Auto-configure feature settings for players/parents groups
    if (ugId && name === 'Players') {
      await exec(schema,
        "INSERT INTO settings (key, value) VALUES ('feature_players_group_id', $1) ON CONFLICT (key) DO NOTHING",
        [ugId.toString()]
      );
    } else if (ugId && name === 'Parents') {
      await exec(schema,
        "INSERT INTO settings (key, value) VALUES ('feature_guardians_group_id', $1) ON CONFLICT (key) DO NOTHING",
        [ugId.toString()]
      );
    }
  }
}

async function seedAdmin(schema) {
  const strip = s => (s || '').replace(/^['"]+|['"]+$/g, '').trim();
  const adminEmail = (strip(process.env.ADMIN_EMAIL) || 'admin@rosterchirp.local').toLowerCase();
  const adminName  = strip(process.env.ADMIN_NAME)  || 'Admin User';
  const adminPass  = strip(process.env.ADMIN_PASS)  || 'Admin@1234';
  const pwReset    = process.env.ADMPW_RESET === 'true';

  console.log(`[DB:${schema}] Checking for default admin (${adminEmail})...`);

  const existing = await queryOne(schema,
    'SELECT * FROM users WHERE is_default_admin = TRUE'
  );

  if (!existing) {
    const hash = bcrypt.hashSync(adminPass, 10);
    const ur = await queryResult(schema, `
      INSERT INTO users (name, email, password, role, status, is_default_admin, must_change_password, avatar)
      VALUES ($1, $2, $3, 'admin', 'active', TRUE, TRUE, '/avatar/admin.png') RETURNING id
    `, [adminName, adminEmail, hash]);
    const adminId = ur.rows[0].id;

    const chatName = strip(process.env.DEFCHAT_NAME) || 'General Chat';
    const gr = await queryResult(schema,
      "INSERT INTO groups (name, type, is_default, owner_id) VALUES ($1, 'public', TRUE, $2) RETURNING id",
      [chatName, adminId]
    );
    await exec(schema,
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [gr.rows[0].id, adminId]
    );

    const sr = await queryResult(schema,
      "INSERT INTO groups (name, type, owner_id, is_default) VALUES ('Support', 'private', $1, FALSE) RETURNING id",
      [adminId]
    );
    await exec(schema,
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [sr.rows[0].id, adminId]
    );

    console.log(`[DB:${schema}] Default admin + groups created`);
    return;
  }

  console.log(`[DB:${schema}] Default admin exists (id=${existing.id})`);
  // Always ensure admin has the fixed avatar
  await exec(schema,
    "UPDATE users SET avatar='/avatar/admin.png', updated_at=NOW() WHERE is_default_admin=TRUE AND (avatar IS NULL OR avatar != '/avatar/admin.png')"
  );
  if (pwReset) {
    const hash = bcrypt.hashSync(adminPass, 10);
    await exec(schema,
      "UPDATE users SET password=$1, must_change_password=TRUE, updated_at=NOW() WHERE is_default_admin=TRUE",
      [hash]
    );
    await exec(schema, "UPDATE settings SET value='true', updated_at=NOW() WHERE key='pw_reset_active'");
    console.log(`[DB:${schema}] Admin password reset`);
  } else {
    await exec(schema, "UPDATE settings SET value='false', updated_at=NOW() WHERE key='pw_reset_active'");
  }
}

// ── Main init (called on server startup) ─────────────────────────────────────

async function initDb() {
  // Wait for Postgres to be ready (up to 30s)
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('[DB] Connected to Postgres');
      break;
    } catch (e) {
      console.log(`[DB] Waiting for Postgres... (${i + 1}/30)`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await runMigrations('public');
  await seedSettings('public');
  await seedEventTypes('public');
  await seedAdmin('public');
  await seedUserGroups('public');

  // Host mode: run migrations on all existing tenant schemas so new migrations
  // (e.g. 007_fcm_push) are applied to tenants that were created before the migration existed.
  if (APP_TYPE === 'host') {
    const tenantResult = await pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%'"
    );
    for (const row of tenantResult.rows) {
      console.log(`[DB] Running migrations for tenant schema: ${row.schema_name}`);
      await runMigrations(row.schema_name);
      await seedSettings(row.schema_name);
      await seedEventTypes(row.schema_name);
      await seedUserGroups(row.schema_name);
    }
  }

  // Host mode: the public schema is the host's own workspace — always full RosterChirp-Team plan.
  // ON CONFLICT DO UPDATE ensures existing installs get corrected on restart too.
  if (APP_TYPE === 'host') {
    const hostPlan = [
      ['app_type',                  'RosterChirp-Team'],
      ['feature_branding',          'true'],
      ['feature_group_manager',     'true'],
      ['feature_schedule_manager',  'true'],
    ];
    for (const [key, value] of hostPlan) {
      await exec('public',
        'INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
        [key, value]
      );
    }
    console.log('[DB] Host mode: public schema upgraded to RosterChirp-Team plan');
  }

  console.log('[DB] Initialisation complete');
}

// ── Helper functions used by routes ──────────────────────────────────────────

async function addUserToPublicGroups(schema, userId) {
  const groups = await query(schema, "SELECT id FROM groups WHERE type = 'public'");
  for (const g of groups) {
    await exec(schema,
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [g.id, userId]
    );
  }
}

async function getOrCreateSupportGroup(schema) {
  const g = await queryOne(schema, "SELECT id FROM groups WHERE name='Support' AND type='private'");
  if (g) return g.id;

  const admin = await queryOne(schema, 'SELECT id FROM users WHERE is_default_admin = TRUE');
  if (!admin) return null;

  const r = await queryResult(schema,
    "INSERT INTO groups (name, type, owner_id, is_default) VALUES ('Support','private',$1,FALSE) RETURNING id",
    [admin.id]
  );
  const groupId = r.rows[0].id;
  const admins = await query(schema, "SELECT id FROM users WHERE role='admin' AND status='active'");
  for (const a of admins) {
    await exec(schema,
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [groupId, a.id]
    );
  }
  return groupId;
}

// ── Tenant middleware ─────────────────────────────────────────────────────────

function tenantMiddleware(req, res, next) {
  try {
    req.schema = resolveSchema(req);
    next();
  } catch (err) {
    console.error('[Tenant]', err.message);
    res.status(404).json({ error: 'Unknown tenant' });
  }
}

module.exports = {
  query, queryOne, queryResult, exec, withTransaction,
  initDb, runMigrations, ensureSchema,
  tenantMiddleware, resolveSchema, refreshTenantCache,
  APP_TYPE, pool,
  addUserToPublicGroups, getOrCreateSupportGroup,
  seedSettings, seedEventTypes, seedAdmin, seedUserGroups,
};
