-- Migration 002: updated_at auto-trigger + additional indexes
--
-- Adds a reusable Postgres trigger function that automatically sets
-- updated_at = NOW() on any UPDATE, eliminating the need to set it
-- manually in every route. Also adds a few missing indexes.

-- ── Auto-updated_at trigger function ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables that have an updated_at column

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_groups_updated_at') THEN
    CREATE TRIGGER trg_groups_updated_at
      BEFORE UPDATE ON groups
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_settings_updated_at') THEN
    CREATE TRIGGER trg_settings_updated_at
      BEFORE UPDATE ON settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_groups_updated_at') THEN
    CREATE TRIGGER trg_user_groups_updated_at
      BEFORE UPDATE ON user_groups
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_multi_group_dms_updated_at') THEN
    CREATE TRIGGER trg_multi_group_dms_updated_at
      BEFORE UPDATE ON multi_group_dms
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_events_updated_at') THEN
    CREATE TRIGGER trg_events_updated_at
      BEFORE UPDATE ON events
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── Additional indexes ────────────────────────────────────────────────────────

-- Notifications: most queries filter by user + read status
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read)
  WHERE is_read = FALSE;

-- Sessions: lookup by user is common on logout / session cleanup
CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions(user_id);

-- Active sessions: covered by PK (user_id, device) but explicit for clarity
CREATE INDEX IF NOT EXISTS idx_active_sessions_token
  ON active_sessions(token);

-- Push subscriptions: lookup by user is the hot path
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

-- User group members: reverse lookup (which groups is a user in?)
CREATE INDEX IF NOT EXISTS idx_user_group_members_user
  ON user_group_members(user_id);

-- Event availability: reverse lookup (which events has a user responded to?)
CREATE INDEX IF NOT EXISTS idx_event_availability_user
  ON event_availability(user_id);

-- Events: filter by created_by (schedule manager views)
CREATE INDEX IF NOT EXISTS idx_events_type
  ON events(event_type_id);
