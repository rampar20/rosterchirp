# jama Migration Guide

## How migrations work

jama uses a simple file-based migration system. On every startup, `db.js` reads
all `.sql` files in this directory, sorted by version number, and applies any
that haven't been recorded in the `schema_migrations` table.

Migrations run inside a transaction — if anything fails, the whole migration
rolls back and the version is not recorded, so startup will retry it next time.

---

## Adding a new migration

1. Create a new file in this directory named `NNN_description.sql` where `NNN`
   is the next sequential number (zero-padded to 3 digits):

   ```
   001_initial_schema.sql   ← already applied
   002_add_user_preferences.sql
   003_add_tenant_table.sql
   ```

2. Write standard Postgres SQL. Use `IF NOT EXISTS` / `IF EXISTS` guards where
   possible so migrations are safe to replay:

   ```sql
   -- Add a new column
   ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system';

   -- Add a new table
   CREATE TABLE IF NOT EXISTS user_preferences (
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     key        TEXT NOT NULL,
     value      TEXT NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (user_id, key)
   );

   -- Add an index
   CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
   ```

3. Deploy. On next startup jama will automatically detect and apply the new
   migration, logging:

   ```
   [DB:public] Applying migration 2: 002_add_user_preferences.sql
   [DB:public] Migration 2 done
   ```

---

## Rules

- **Never edit an applied migration.** Once `001_initial_schema.sql` has been
  applied to any database, it must not change. Add a new numbered file instead.

- **Always use `IF NOT EXISTS` / `IF EXISTS`.** This makes migrations safe to
  run against schemas that may be partially applied (e.g. after a failed deploy).

- **One logical change per file.** Easier to reason about and roll back mentally.

- **No data mutations in migrations unless unavoidable.** Seed data lives in
  `db.js` (`seedSettings`, `seedEventTypes`, `seedAdmin`). Migrations are for
  schema structure only.

- **JAMA-HOST:** When a new tenant is provisioned, `runMigrations(schema)` is
  called on their fresh schema — they get all migrations from `001` onward
  applied at creation time. Existing tenants get new migrations on the next
  startup automatically.

---

## Checking migration status

```bash
# Connect to the running Postgres container
docker compose exec db psql -U jama -d jama

# See which migrations have been applied
SELECT * FROM schema_migrations ORDER BY version;

# In host mode, check a specific tenant schema
SET search_path TO tenant_teamname;
SELECT * FROM schema_migrations ORDER BY version;
```

---

## Emergency rollback

Migrations do not include automatic down/rollback scripts. If a migration causes
problems in production:

1. Stop the app container: `docker compose stop jama`
2. Connect to Postgres and manually reverse the change
3. Delete the migration record: `DELETE FROM schema_migrations WHERE version = NNN;`
4. Fix the migration file
5. Restart: `docker compose start jama`
