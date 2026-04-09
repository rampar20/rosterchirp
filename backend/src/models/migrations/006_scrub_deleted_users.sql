-- Migration 006: Scrub pre-existing deleted users
--
-- Prior to v0.11.11, deleting a user only set status='deleted' — the original
-- email, name, avatar, and messages were left untouched. This meant:
--   • The email address was permanently blocked from re-use
--   • Message content was still stored and attributable
--   • Direct messages were left in an inconsistent half-alive state
--
-- v0.11.11 introduced proper anonymisation in the delete route, but that only
-- applies to users deleted from that point forward. This migration back-fills
-- the same treatment for any users already sitting in status='deleted'.
--
-- Data mutation note: the MIGRATIONS.md convention discourages data changes in
-- migrations. This is a deliberate exception — the whole point of this migration
-- is to correct orphaned rows that cannot be fixed any other way. The UPDATE
-- statements are all guarded by WHERE status='deleted' so they are safe to
-- replay against schemas that are already clean.

-- ── 1. Anonymise deleted user records ────────────────────────────────────────
-- Scrub email to deleted_{id}@deleted to free the address for re-use.
-- Only touch rows where the email hasn't already been scrubbed (idempotent).
UPDATE users
SET
  email        = 'deleted_' || id || '@deleted',
  name         = 'Deleted User',
  display_name = NULL,
  avatar       = NULL,
  about_me     = NULL,
  password     = '',
  updated_at   = NOW()
WHERE status = 'deleted'
  AND email NOT LIKE 'deleted\_%@deleted' ESCAPE '\';

-- ── 2. Anonymise their messages ───────────────────────────────────────────────
-- Mark all non-deleted messages from deleted users as deleted so they render
-- as "This message was deleted" rather than remaining attributable.
UPDATE messages
SET
  is_deleted = TRUE,
  content    = NULL,
  image_url  = NULL
WHERE is_deleted = FALSE
  AND user_id IN (SELECT id FROM users WHERE status = 'deleted');

-- ── 3. Freeze their direct messages ──────────────────────────────────────────
-- Any 1:1 DM involving a deleted user becomes read-only. The surviving member
-- keeps their history but can no longer send into a dead conversation.
UPDATE groups
SET
  is_readonly = TRUE,
  updated_at  = NOW()
WHERE is_direct = TRUE
  AND is_readonly = FALSE
  AND (
    direct_peer1_id IN (SELECT id FROM users WHERE status = 'deleted')
    OR
    direct_peer2_id IN (SELECT id FROM users WHERE status = 'deleted')
  );
