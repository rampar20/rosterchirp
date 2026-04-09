-- Migration 011: Add Web Push (VAPID) subscription columns for iOS PWA support
-- iOS uses the standard W3C Web Push protocol (not FCM). A subscription consists of
-- an endpoint URL (web.push.apple.com) plus two crypto keys (p256dh + auth).
-- Rows will have either fcm_token set (Android/Chrome) OR the three webpush_* columns
-- set (iOS/Firefox/Edge). Never both on the same row.
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS webpush_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS webpush_p256dh   TEXT,
  ADD COLUMN IF NOT EXISTS webpush_auth     TEXT;
