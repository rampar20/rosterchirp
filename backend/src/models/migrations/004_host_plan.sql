-- Migration 004: Host plan feature flags placeholder
--
-- Feature flag enforcement for APP_TYPE=host is handled in db.js initDb()
-- which runs on every startup and upserts the correct values.
-- This migration exists as a version marker — no SQL changes needed.
SELECT 1;
