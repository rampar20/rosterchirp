-- 017_partner_respond_separately.sql
-- Adds respond_separately flag to guardian_partners.
-- When true, linked partners can each respond to events on behalf of children
-- in the shared alias list, but cannot respond on behalf of each other.

ALTER TABLE guardian_partners ADD COLUMN IF NOT EXISTS respond_separately BOOLEAN NOT NULL DEFAULT FALSE;
