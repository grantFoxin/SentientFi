import { query } from './client.js'

export interface AnalyticsSnapshotRow {
    id: number
    portfolio_id: string
    timestamp: Date
    total_value: number
    allocations: unknown
    balances: unknown
}

function rowToSnapshot(r: AnalyticsSnapshotRow) {
    return {
        portfolioId: r.portfolio_id,
        timestamp: r.timestamp.toISOString(),
        totalValue: Number(r.total_value),
        allocations: (r.allocations as Record<string, number>) ?? {},
        balances: (r.balances as Record<string, number>) ?? {}
    }
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

export async function dbGetAnalyticsSnapshots(portfolioId: string, days: number) {
    const result = await query<AnalyticsSnapshotRow>(
        `SELECT * FROM analytics_snapshots WHERE portfolio_id = $1 AND timestamp > NOW() - INTERVAL '1 day' * $2 ORDER BY timestamp ASC`,
        [portfolioId, days]
    )
    return result.rows.map(rowToSnapshot)
}

export async function dbGetLatestSnapshot(portfolioId: string) {
    const result = await query<AnalyticsSnapshotRow>(
        `SELECT * FROM analytics_snapshots WHERE portfolio_id = $1 ORDER BY timestamp DESC LIMIT 1`,
        [portfolioId]
    )
    return result.rows[0] ? rowToSnapshot(result.rows[0]) : null
}

export async function dbGetSnapshotAt(portfolioId: string, targetTime: Date) {
    const result = await query<AnalyticsSnapshotRow>(
        `SELECT * FROM analytics_snapshots WHERE portfolio_id = $1 AND timestamp <= $2 ORDER BY timestamp DESC LIMIT 1`,
        [portfolioId, targetTime]
    )
    return result.rows[0] ? rowToSnapshot(result.rows[0]) : null
}

export async function dbGetClosestSnapshot(portfolioId: string, targetTime: Date, windowMs: number) {
    const windowStart = new Date(targetTime.getTime() - windowMs)
    const windowEnd = new Date(targetTime.getTime() + windowMs)
    const result = await query<AnalyticsSnapshotRow>(
        `SELECT * FROM analytics_snapshots
         WHERE portfolio_id = $1 AND timestamp BETWEEN $2 AND $3
         ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - $4))) ASC
         LIMIT 1`,
        [portfolioId, windowStart, windowEnd, targetTime]
    )
    return result.rows[0] ? rowToSnapshot(result.rows[0]) : null
}
