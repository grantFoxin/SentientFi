-- Migration: 005_add_webhook_deliveries (down)
-- Description: Remove webhook_deliveries table.

DROP INDEX IF EXISTS idx_webhook_deliveries_created;
DROP INDEX IF EXISTS idx_webhook_deliveries_user;
DROP INDEX IF EXISTS idx_webhook_deliveries_status;
DROP TABLE IF EXISTS webhook_deliveries;
