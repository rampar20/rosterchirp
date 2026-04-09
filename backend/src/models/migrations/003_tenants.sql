-- Migration 003: Tenant registry (JAMA-HOST mode)
--
-- This table lives in the 'public' schema and is the source of truth for
-- all tenants in host mode. In selfhost mode this table exists but stays
-- empty — it has no effect on anything.

CREATE TABLE IF NOT EXISTS tenants (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,        -- used as schema name: tenant_{slug}
  name         TEXT NOT NULL,               -- display name
  schema_name  TEXT NOT NULL UNIQUE,        -- actual Postgres schema: tenant_{slug}
  custom_domain TEXT,                       -- optional: team1.example.com
  plan         TEXT NOT NULL DEFAULT 'chat', -- chat | brand | team
  status       TEXT NOT NULL DEFAULT 'active', -- active | suspended
  admin_email  TEXT,                        -- first admin email for this tenant
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug          ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain ON tenants(custom_domain) WHERE custom_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_status        ON tenants(status);

-- Auto-update updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tenants_updated_at') THEN
    CREATE TRIGGER trg_tenants_updated_at
      BEFORE UPDATE ON tenants
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
