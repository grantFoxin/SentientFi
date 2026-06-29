-- Migration: 005_add_webhook_deliveries (up)
-- Description: Add webhook_deliveries table for tracking delivery attempts and enabling retries.
-- Rollback: See 005_add_webhook_deliveries.down.sql

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    event_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(256) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    url VARCHAR(1024) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_user ON webhook_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON webhook_deliveries(created_at DESC);
