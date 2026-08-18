import { query } from './client.js'

export interface AnalyticsSnapshotRow {
    id: number
    portfolio_id: string
    timestamp: Date
    total_value: number
    allocations: unknown
    balances: unknown
}

export interface AnalyticsSnapshot {
    portfolioId: string
    timestamp: string
    totalValue: number
    allocations: Record<string, number>
    balances: Record<string, number>
}

export async function dbInsertAnalyticsSnapshot(
    portfolioId: string,
    totalValue: number,
    allocations: Record<string, number>,
    balances: Record<string, number>
) {
    await query(
        `INSERT INTO analytics_snapshots (portfolio_id, total_value, allocations, balances) VALUES ($1, $2, $3, $4)`,
        [portfolioId, totalValue, JSON.stringify(allocations), JSON.stringify(balances)]
    )
}

export async function dbGetAnalyticsSnapshots(portfolioId: string, days: number): Promise<AnalyticsSnapshot[]> {
    const result = await query<AnalyticsSnapshotRow>(
        `SELECT * FROM analytics_snapshots WHERE portfolio_id = $1 AND timestamp > NOW() - INTERVAL '1 day' * $2 ORDER BY timestamp ASC`,
        [portfolioId, days]
    )
    return result.rows.map(r => ({
        portfolioId: r.portfolio_id,
        timestamp: r.timestamp.toISOString(),
        totalValue: Number(r.total_value),
        allocations: (r.allocations as Record<string, number>) ?? {},
        balances: (r.balances as Record<string, number>) ?? {}
    }))
}

export async function dbGetLatestSnapshot(portfolioId: string): Promise<AnalyticsSnapshot | null> {
    const result = await query<AnalyticsSnapshotRow>(
        `SELECT * FROM analytics_snapshots WHERE portfolio_id = $1 ORDER BY timestamp DESC LIMIT 1`,
        [portfolioId]
    )
    if (result.rows.length === 0) return null
    const r = result.rows[0]
    return {
        portfolioId: r.portfolio_id,
        timestamp: r.timestamp.toISOString(),
        totalValue: Number(r.total_value),
        allocations: (r.allocations as Record<string, number>) ?? {},
        balances: (r.balances as Record<string, number>) ?? {}
    }
}

export async function dbGetClosestSnapshot(
    portfolioId: string,
    targetDate: Date,
    maxDiffMs: number = 2 * 60 * 60 * 1000
): Promise<AnalyticsSnapshot | null> {
    const result = await query<AnalyticsSnapshotRow & { diff_sec: number }>(
        `SELECT *, ABS(EXTRACT(EPOCH FROM (timestamp - $2::timestamp))) AS diff_sec
         FROM analytics_snapshots
         WHERE portfolio_id = $1
           AND ABS(EXTRACT(EPOCH FROM (timestamp - $2::timestamp))) <= $3
         ORDER BY diff_sec ASC
         LIMIT 1`,
        [portfolioId, targetDate.toISOString(), maxDiffMs / 1000]
    )
    if (result.rows.length === 0) return null
    const r = result.rows[0]
    return {
        portfolioId: r.portfolio_id,
        timestamp: r.timestamp.toISOString(),
        totalValue: Number(r.total_value),
        allocations: (r.allocations as Record<string, number>) ?? {},
        balances: (r.balances as Record<string, number>) ?? {}
    }
}

export async function dbGetSnapshotAt(
    portfolioId: string,
    targetDate: Date
): Promise<AnalyticsSnapshot | null> {
    return dbGetClosestSnapshot(portfolioId, targetDate)
}

export const getLatestSnapshot = dbGetLatestSnapshot
export const getClosestSnapshot = dbGetClosestSnapshot
export const getSnapshotAt = dbGetSnapshotAt
