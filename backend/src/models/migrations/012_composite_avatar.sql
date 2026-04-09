-- Migration 012: Add composite_members to groups for private group avatar composites
-- Stores up to 4 member previews (id, name, avatar) as a JSONB snapshot.
-- Only set for non-managed, non-direct private groups with 3+ members.
-- Updated only when a member is added and pre-add membership count was ≤3.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS composite_members JSONB;
