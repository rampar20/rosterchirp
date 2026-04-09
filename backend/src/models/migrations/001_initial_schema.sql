-- Migration 001: Initial schema
-- Converts all SQLite tables to Postgres-native types.
-- TIMESTAMPTZ replaces TEXT for dates.
-- SERIAL replaces AUTOINCREMENT.
-- Constraints use Postgres syntax throughout.

CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT UNIQUE NOT NULL,
  password            TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'member',
  status              TEXT NOT NULL DEFAULT 'active',
  is_default_admin    BOOLEAN NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  avatar              TEXT,
  about_me            TEXT,
  display_name        TEXT,
  hide_admin_tag      BOOLEAN NOT NULL DEFAULT FALSE,
  allow_dm            BOOLEAN NOT NULL DEFAULT TRUE,
  last_online         TIMESTAMPTZ,
  help_dismissed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'public',
  owner_id         INTEGER REFERENCES users(id),
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  is_readonly      BOOLEAN NOT NULL DEFAULT FALSE,
  is_direct        BOOLEAN NOT NULL DEFAULT FALSE,
  direct_peer1_id  INTEGER,
  direct_peer2_id  INTEGER,
  is_managed       BOOLEAN NOT NULL DEFAULT FALSE,
  is_multi_group   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id         SERIAL PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id           SERIAL PRIMARY KEY,
  group_id     INTEGER NOT NULL REFERENCES groups(id)   ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  content      TEXT,
  type         TEXT NOT NULL DEFAULT 'text',
  image_url    TEXT,
  reply_to_id  INTEGER REFERENCES messages(id),
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  link_preview TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reactions (
  id         SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS notifications (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  message_id   INTEGER,
  group_id     INTEGER,
  from_user_id INTEGER,
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS active_sessions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device     TEXT NOT NULL DEFAULT 'desktop',
  token      TEXT NOT NULL,
  ua         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, device)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  device     TEXT NOT NULL DEFAULT 'desktop',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, device)
);

CREATE TABLE IF NOT EXISTS user_group_names (
  user_id   INTEGER NOT NULL,
  group_id  INTEGER NOT NULL,
  name      TEXT NOT NULL,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS pinned_conversations (
  user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  group_id  INTEGER NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS user_groups (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  dm_group_id  INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_group_members (
  user_group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_group_id, user_id)
);

CREATE TABLE IF NOT EXISTS multi_group_dms (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  dm_group_id  INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS multi_group_dm_members (
  multi_group_dm_id INTEGER NOT NULL REFERENCES multi_group_dms(id) ON DELETE CASCADE,
  user_group_id     INTEGER NOT NULL REFERENCES user_groups(id)     ON DELETE CASCADE,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (multi_group_dm_id, user_group_id)
);

-- ── Schedule Manager ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_types (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  colour                TEXT NOT NULL DEFAULT '#6366f1',
  default_user_group_id INTEGER REFERENCES user_groups(id) ON DELETE SET NULL,
  default_duration_hrs  NUMERIC,
  is_default            BOOLEAN NOT NULL DEFAULT FALSE,
  is_protected          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id                 SERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  event_type_id      INTEGER REFERENCES event_types(id) ON DELETE SET NULL,
  start_at           TIMESTAMPTZ NOT NULL,
  end_at             TIMESTAMPTZ NOT NULL,
  all_day            BOOLEAN NOT NULL DEFAULT FALSE,
  location           TEXT,
  description        TEXT,
  is_public          BOOLEAN NOT NULL DEFAULT TRUE,
  track_availability BOOLEAN NOT NULL DEFAULT FALSE,
  recurrence_rule    JSONB,
  created_by         INTEGER NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_user_groups (
  event_id      INTEGER NOT NULL REFERENCES events(id)      ON DELETE CASCADE,
  user_group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_group_id)
);

CREATE TABLE IF NOT EXISTS event_availability (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  response   TEXT NOT NULL CHECK(response IN ('going','maybe','not_going')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- ── Indexes for common query patterns ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_messages_group_id    ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at  ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_user   ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group  ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_events_start_at      ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_created_by    ON events(created_by);
CREATE INDEX IF NOT EXISTS idx_reactions_message    ON reactions(message_id);
