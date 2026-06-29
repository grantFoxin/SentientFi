-- Migration: 004_add_webhook_secret (down)
-- Description: Remove webhook_secret column from notification_preferences.
-- Rollback: See 004_add_webhook_secret.up.sql

-- Remove index
DROP INDEX IF EXISTS idx_notification_preferences_webhook_secret;

-- Remove webhook_secret column
ALTER TABLE notification_preferences 
DROP COLUMN IF EXISTS webhook_secret;
