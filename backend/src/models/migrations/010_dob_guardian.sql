-- Migration 010: Date of birth and guardian fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth    DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
