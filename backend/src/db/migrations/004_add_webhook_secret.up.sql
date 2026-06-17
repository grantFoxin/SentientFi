-- Migration: 004_add_webhook_secret (up)
-- Description: Add webhook_secret column to notification_preferences for HMAC signature verification.
-- Rollback: See 004_add_webhook_secret.down.sql

-- Add webhook_secret column to notification_preferences table
ALTER TABLE notification_preferences 
ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(64);

-- Generate random secrets for existing webhook-enabled rows
UPDATE notification_preferences 
SET webhook_secret = encode(gen_random_bytes(32), 'hex')
WHERE webhook_enabled = TRUE AND webhook_secret IS NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_notification_preferences_webhook_secret 
ON notification_preferences(webhook_secret);
