/**
 * routes/host.js — RosterChirp-Host control plane
 *
 * All routes require the HOST_ADMIN_KEY header.
 * These routes operate on the 'public' schema (tenant registry).
 * They provision/deprovision per-tenant schemas.
 *
 * APP_TYPE must be 'host' for these routes to be registered.
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const {
  query, queryOne, queryResult, exec,
  runMigrations, ensureSchema,
  seedSettings, seedEventTypes, seedAdmin, seedUserGroups,
  refreshTenantCache,
} = require('../models/db');

const HOST_ADMIN_KEY = process.env.HOST_ADMIN_KEY || '';

// ── Host admin key guard ──────────────────────────────────────────────────────

function hostAdminMiddleware(req, res, next) {
  if (!HOST_ADMIN_KEY) {
    return res.status(503).json({ error: 'HOST_ADMIN_KEY is not configured' });
  }
  const key = req.headers['x-host-admin-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!key || key !== HOST_ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid host admin key' });
  }
  next();
}

// All routes in this file require the host admin key
router.use(hostAdminMiddleware);

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugToSchema(slug) {
  return `tenant_${slug.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}

function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug);
}

async function reloadTenantCache() {
  const tenants = await query('public', "SELECT * FROM tenants WHERE status = 'active'");
  refreshTenantCache(tenants);
  return tenants;
}

// ── GET /api/host/tenants — list all tenants ──────────────────────────────────

router.get('/tenants', async (req, res) => {
  try {
    const tenants = await query('public',
      'SELECT * FROM tenants ORDER BY created_at DESC'
    );
    res.json({ tenants });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/host/tenants/:slug — get single tenant ───────────────────────────

router.get('/tenants/:slug', async (req, res) => {
  try {
    const tenant = await queryOne('public',
      'SELECT * FROM tenants WHERE slug = $1', [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json({ tenant });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/host/tenants — provision a new tenant ───────────────────────────
//
// Body: { slug, name, plan, adminEmail, adminName, adminPass, customDomain? }
//
// This:
//  1. Validates the slug (becomes subdomain + schema name)
//  2. Creates the Postgres schema
//  3. Runs all migrations in the new schema
//  4. Seeds settings, event types, and the first admin user
//  5. Records the tenant in the registry
//  6. Reloads the tenant domain cache

router.post('/tenants', async (req, res) => {
  const { slug, name, plan, adminEmail, adminName, adminPass, customDomain } = req.body;

  if (!slug || !name) return res.status(400).json({ error: 'slug and name are required' });
  if (!isValidSlug(slug)) {
    return res.status(400).json({
      error: 'slug must be 3-32 lowercase alphanumeric characters or hyphens, starting and ending with alphanumeric'
    });
  }

  const schemaName = slugToSchema(slug);

  try {
    // Check slug not already taken
    const existing = await queryOne('public',
      'SELECT id FROM tenants WHERE slug = $1', [slug]
    );
    if (existing) return res.status(400).json({ error: `Tenant '${slug}' already exists` });

    if (customDomain) {
      const domainTaken = await queryOne('public',
        'SELECT id FROM tenants WHERE custom_domain = $1', [customDomain.toLowerCase()]
      );
      if (domainTaken) return res.status(400).json({ error: `Custom domain '${customDomain}' is already in use` });
    }

    console.log(`[Host] Provisioning tenant: ${slug} (schema: ${schemaName})`);

    // 1. Create schema + run migrations
    await runMigrations(schemaName);

    // 2. Seed settings (uses env defaults unless overridden by body)
    await seedSettings(schemaName);

    // 3. Seed event types
    await seedEventTypes(schemaName);

    // 3b. Seed default user groups (Coaches, Players, Parents)
    await seedUserGroups(schemaName);

    // 4. Seed admin user — temporarily override env vars for this tenant
    const origEmail = process.env.ADMIN_EMAIL;
    const origName  = process.env.ADMIN_NAME;
    const origPass  = process.env.ADMIN_PASS;
    if (adminEmail) process.env.ADMIN_EMAIL = adminEmail;
    if (adminName)  process.env.ADMIN_NAME  = adminName;
    if (adminPass)  process.env.ADMIN_PASS  = adminPass;

    await seedAdmin(schemaName);

    process.env.ADMIN_EMAIL = origEmail;
    process.env.ADMIN_NAME  = origName;
    process.env.ADMIN_PASS  = origPass;

    // 5. Set app_type based on plan
    const planAppType = { chat: 'RosterChirp-Chat', brand: 'RosterChirp-Brand', team: 'RosterChirp-Team' }[plan] || 'RosterChirp-Chat';
    await exec(schemaName, "UPDATE settings SET value=$1 WHERE key='app_type'", [planAppType]);
    if (plan === 'brand' || plan === 'team') {
      await exec(schemaName, "UPDATE settings SET value='true' WHERE key='feature_branding'");
    }
    if (plan === 'team') {
      await exec(schemaName, "UPDATE settings SET value='true' WHERE key='feature_group_manager'");
      await exec(schemaName, "UPDATE settings SET value='true' WHERE key='feature_schedule_manager'");
    }

    // 6. Register in tenants table
    const tr = await queryResult('public', `
      INSERT INTO tenants (slug, name, schema_name, custom_domain, plan, admin_email)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [slug, name, schemaName, customDomain?.toLowerCase() || null, plan || 'chat', adminEmail || null]);

    // 7. Reload domain cache
    await reloadTenantCache();

    const baseDomain = process.env.APP_DOMAIN || 'rosterchirp.com';
    const tenant = tr.rows[0];
    tenant.url = `https://${slug}.${baseDomain}`;

    console.log(`[Host] Tenant provisioned: ${slug} → ${schemaName}`);
    res.status(201).json({ tenant });

  } catch (e) {
    console.error(`[Host] Provisioning failed for ${slug}:`, e.message);
    // Attempt cleanup of partially-created schema
    try {
      await exec('public', `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      console.log(`[Host] Cleaned up schema ${schemaName} after failed provision`);
    } catch (cleanupErr) {
      console.error(`[Host] Cleanup failed:`, cleanupErr.message);
    }
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/host/tenants/:slug — update tenant ─────────────────────────────
//
// Supports updating: name, plan, customDomain, status

router.patch('/tenants/:slug', async (req, res) => {
  const { name, plan, customDomain, status, adminPassword } = req.body;
  try {
    const tenant = await queryOne('public',
      'SELECT * FROM tenants WHERE slug = $1', [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    if (customDomain && customDomain !== tenant.custom_domain) {
      const taken = await queryOne('public',
        'SELECT id FROM tenants WHERE custom_domain=$1 AND slug!=$2',
        [customDomain.toLowerCase(), req.params.slug]
      );
      if (taken) return res.status(400).json({ error: 'Custom domain already in use' });
    }

    if (status && !['active','suspended'].includes(status))
      return res.status(400).json({ error: 'status must be active or suspended' });

    await exec('public', `
      UPDATE tenants SET
        name          = COALESCE($1, name),
        plan          = COALESCE($2, plan),
        custom_domain = $3,
        status        = COALESCE($4, status),
        updated_at    = NOW()
      WHERE slug = $5
    `, [name || null, plan || null, customDomain?.toLowerCase() ?? tenant.custom_domain, status || null, req.params.slug]);

    // If plan changed, update feature flags in tenant schema
    if (plan && plan !== tenant.plan) {
      const s = tenant.schema_name;
      await exec(s, "UPDATE settings SET value=CASE WHEN $1 IN ('brand','team') THEN 'true' ELSE 'false' END WHERE key='feature_branding'", [plan]);
      await exec(s, "UPDATE settings SET value=CASE WHEN $1 = 'team' THEN 'true' ELSE 'false' END WHERE key='feature_group_manager'", [plan]);
      await exec(s, "UPDATE settings SET value=CASE WHEN $1 = 'team' THEN 'true' ELSE 'false' END WHERE key='feature_schedule_manager'", [plan]);
      const planAppType = { chat: 'RosterChirp-Chat', brand: 'RosterChirp-Brand', team: 'RosterChirp-Team' }[plan] || 'RosterChirp-Chat';
      await exec(s, "UPDATE settings SET value=$1 WHERE key='app_type'", [planAppType]);
    }

    // Reset tenant admin password if provided
    if (adminPassword && adminPassword.length >= 6) {
      const hash = bcrypt.hashSync(adminPassword, 10);
      await exec(tenant.schema_name,
        "UPDATE users SET password=$1, must_change_password=TRUE, updated_at=NOW() WHERE is_default_admin=TRUE",
        [hash]
      );
    }

    await reloadTenantCache();
    const updated = await queryOne('public', 'SELECT * FROM tenants WHERE slug=$1', [req.params.slug]);
    res.json({ tenant: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/host/tenants/:slug — deprovision tenant ───────────────────────
//
// Permanently drops the tenant's Postgres schema and all data.
// Requires confirmation: body must include { confirm: "DELETE {slug}" }

router.delete('/tenants/:slug', async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== `DELETE ${req.params.slug}`) {
    return res.status(400).json({
      error: `Confirmation required. Send { "confirm": "DELETE ${req.params.slug}" } in the request body.`
    });
  }

  try {
    const tenant = await queryOne('public',
      'SELECT * FROM tenants WHERE slug=$1', [req.params.slug]
    );
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    console.log(`[Host] Deprovisioning tenant: ${req.params.slug} (schema: ${tenant.schema_name})`);

    // Drop the entire schema — CASCADE removes all tables, indexes, triggers
    await exec('public', `DROP SCHEMA IF EXISTS "${tenant.schema_name}" CASCADE`);

    // Remove from registry
    await exec('public', 'DELETE FROM tenants WHERE slug=$1', [req.params.slug]);

    await reloadTenantCache();

    console.log(`[Host] Tenant deprovisioned: ${req.params.slug}`);
    res.json({ success: true, message: `Tenant '${req.params.slug}' and all its data have been permanently deleted.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/host/tenants/:slug/migrate — run pending migrations ─────────────
//
// Useful after deploying a new migration file to apply it to all tenants.

router.post('/tenants/:slug/migrate', async (req, res) => {
  try {
    const tenant = await queryOne('public', 'SELECT * FROM tenants WHERE slug=$1', [req.params.slug]);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    await runMigrations(tenant.schema_name);
    await seedSettings(tenant.schema_name);
    await seedEventTypes(tenant.schema_name);
    await seedUserGroups(tenant.schema_name);
    const applied = await query(tenant.schema_name, 'SELECT * FROM schema_migrations ORDER BY version');
    res.json({ success: true, migrations: applied });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/host/migrate-all — run pending migrations on every tenant ───────

router.post('/migrate-all', async (req, res) => {
  try {
    const tenants = await query('public', "SELECT * FROM tenants WHERE status='active'");
    const results = [];
    for (const t of tenants) {
      try {
        await runMigrations(t.schema_name);
        // Also re-run seeding so new defaults (e.g. user groups, event types)
        // are applied to existing tenants that were provisioned before they existed.
        await seedSettings(t.schema_name);
        await seedEventTypes(t.schema_name);
        await seedUserGroups(t.schema_name);
        results.push({ slug: t.slug, status: 'ok' });
      } catch (e) {
        results.push({ slug: t.slug, status: 'error', error: e.message });
      }
    }
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/host/status — host health check ──────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const tenantCount = await queryOne('public', 'SELECT COUNT(*) AS count FROM tenants');
    const active = await queryOne('public', "SELECT COUNT(*) AS count FROM tenants WHERE status='active'");
    const baseDomain = process.env.APP_DOMAIN || 'rosterchirp.com';
    res.json({
      ok: true,
      appType: process.env.APP_TYPE || 'selfhost',
      baseDomain,
      tenants: { total: parseInt(tenantCount.count), active: parseInt(active.count) },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
