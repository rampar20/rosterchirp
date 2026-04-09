-- 016_guardian_partners.sql
-- Partner/spouse relationship between guardians.
-- Partners share the same child alias list (both can manage it) and can
-- respond to events on behalf of each other within shared user groups.

CREATE TABLE IF NOT EXISTS guardian_partners (
  id         SERIAL PRIMARY KEY,
  user_id_1  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_2  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id_1, user_id_2),
  CHECK (user_id_1 < user_id_2)
);

CREATE INDEX IF NOT EXISTS idx_guardian_partners_user1 ON guardian_partners(user_id_1);
CREATE INDEX IF NOT EXISTS idx_guardian_partners_user2 ON guardian_partners(user_id_2);
