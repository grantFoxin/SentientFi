-- Price cache: stores the last known good price for each asset.
-- Survives backend restarts so ReflectorService can fall back to
-- real prices instead of random noise when the oracle is down.

CREATE TABLE IF NOT EXISTS price_cache (
    asset       VARCHAR(32) PRIMARY KEY,
    price       NUMERIC(20, 8) NOT NULL,
    source      VARCHAR(32) NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on fetched_at so we can quickly find stale entries
CREATE INDEX IF NOT EXISTS idx_price_cache_fetched ON price_cache(fetched_at DESC);
