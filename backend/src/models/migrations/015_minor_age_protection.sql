-- 015_minor_age_protection.sql
-- Adds tables and columns for Guardian Only and Mixed Age login type modes.

-- 1. guardian_approval_required on users (Mixed Age: minor needs approval before unsuspend)
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_approval_required BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. guardian_aliases — children as name aliases under a guardian (Guardian Only mode)
CREATE TABLE IF NOT EXISTS guardian_aliases (
  id            SERIAL PRIMARY KEY,
  guardian_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT,
  date_of_birth DATE,
  avatar        TEXT,
  phone         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_aliases_guardian ON guardian_aliases(guardian_id);

-- 3. alias_group_members — links guardian aliases to user groups (e.g. players group)
CREATE TABLE IF NOT EXISTS alias_group_members (
  user_group_id INTEGER NOT NULL REFERENCES user_groups(id)      ON DELETE CASCADE,
  alias_id      INTEGER NOT NULL REFERENCES guardian_aliases(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_group_id, alias_id)
);

-- 4. event_alias_availability — availability responses for guardian aliases
CREATE TABLE IF NOT EXISTS event_alias_availability (
  event_id   INTEGER NOT NULL REFERENCES events(id)           ON DELETE CASCADE,
  alias_id   INTEGER NOT NULL REFERENCES guardian_aliases(id) ON DELETE CASCADE,
  response   TEXT NOT NULL CHECK(response IN ('going','maybe','not_going')),
  note       VARCHAR(20),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, alias_id)
);

CREATE INDEX IF NOT EXISTS idx_event_alias_availability_event ON event_alias_availability(event_id);
