import { query } from './client.js'

export interface CachedPrice {
    asset: string
    price: number
    source: string
    fetched_at: Date
}

/**
 * Upserts a price into the cache. If the asset already exists,
 * updates the price and fetched_at timestamp.
 */
export async function upsertPrice(
    asset: string,
    price: number,
    source: string
): Promise<void> {
    await query(
        `INSERT INTO price_cache (asset, price, source, fetched_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (asset) DO UPDATE
         SET price = EXCLUDED.price,
             source = EXCLUDED.source,
             fetched_at = EXCLUDED.fetched_at`,
        [asset, price, source]
    )
}

/**
 * Gets a cached price for an asset. Returns null if not found.
 */
export async function getCachedPrice(asset: string): Promise<CachedPrice | null> {
    const result = await query<CachedPrice>(
        'SELECT asset, price, source, fetched_at FROM price_cache WHERE asset = $1',
        [asset]
    )
    return result.rows[0] ?? null
}

/**
 * Gets all cached prices. Useful for bulk lookups when the oracle is down.
 */
export async function getAllCachedPrices(): Promise<CachedPrice[]> {
    const result = await query<CachedPrice>(
        'SELECT asset, price, source, fetched_at FROM price_cache'
    )
    return result.rows
}

/**
 * Deletes cached prices older than the given age in milliseconds.
 * Can be used for cleanup if needed.
 */
export async function deleteStalePrices(maxAgeMs: number): Promise<number> {
    const result = await query(
        'DELETE FROM price_cache WHERE fetched_at < NOW() - INTERVAL \'1 millisecond\' * $1',
        [maxAgeMs]
    )
    return result.rowCount ?? 0
}
