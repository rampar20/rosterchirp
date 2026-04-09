-- Migration 009: Extended user profile fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_minor   BOOLEAN NOT NULL DEFAULT FALSE;

-- Back-fill first_name / last_name from existing combined name for non-deleted users
UPDATE users
SET
  first_name = SPLIT_PART(TRIM(name), ' ', 1),
  last_name  = CASE
    WHEN POSITION(' ' IN TRIM(name)) > 0
    THEN NULLIF(TRIM(SUBSTR(TRIM(name), POSITION(' ' IN TRIM(name)) + 1)), '')
    ELSE NULL
  END
WHERE first_name IS NULL
  AND TRIM(name) NOT IN ('Deleted User', '');
