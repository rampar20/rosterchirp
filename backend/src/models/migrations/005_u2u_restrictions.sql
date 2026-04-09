-- Migration 005: User-to-user DM restrictions
--
-- Stores which user groups are blocked from initiating 1-to-1 DMs with
-- users in another group. This is an allowlist-by-omission model:
--   - No rows for a group = no restrictions (can DM anyone)
--   - A row (A, B) = users in group A cannot INITIATE a DM with users in group B
--
-- Enforcement rules:
--   - Restriction is one-way (A→B does not imply B→A)
--   - Least-restrictive-wins: if the initiating user is in any group that is
--     NOT restricted from the target, the DM is allowed
--   - Own group is always exempt (users can DM members of their own groups)
--   - Admins are always exempt from all restrictions
--   - Existing DMs are preserved when a restriction is added
--   - Only 1-to-1 DMs are affected; group chats (3+ people) are always allowed

CREATE TABLE IF NOT EXISTS user_group_dm_restrictions (
  restricting_group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  blocked_group_id     INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restricting_group_id, blocked_group_id),
  -- A group cannot restrict itself (own group is always exempt)
  CHECK (restricting_group_id != blocked_group_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_restrictions_restricting
  ON user_group_dm_restrictions(restricting_group_id);

CREATE INDEX IF NOT EXISTS idx_dm_restrictions_blocked
  ON user_group_dm_restrictions(blocked_group_id);
