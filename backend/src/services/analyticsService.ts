import { portfolioStorage } from './portfolioStorage.js'
import { ReflectorService } from './reflector.js'
import { logger } from '../utils/logger.js'
import {
    dbInsertAnalyticsSnapshot,
    dbGetAnalyticsSnapshots,
    dbGetLatestSnapshot,
    dbGetSnapshotAt,
    dbGetClosestSnapshot,
} from '../db/analyticsDb.js'

interface PortfolioSnapshot {
    portfolioId: string
    timestamp: string
    totalValue: number
    allocations: Record<string, number>
    balances: Record<string, number>
}

interface PerformanceMetrics {
    totalReturn: number
    dailyChange: number | null
    weeklyChange: number | null
    monthlyChange: number | null
    allTimeChange: number | null
    maxDrawdown: number
    bestDay: { date: string; change: number }
    worstDay: { date: string; change: number }
    sharpeRatio: number
    volatility: number
}

class AnalyticsService {
    private lastSnapshotTimes: Map<string, number> = new Map()
    private readonly MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

    // NOTE: No setInterval here. Periodic snapshots are driven by
    // the BullMQ analytics-snapshot worker (src/queue/workers/analyticsSnapshotWorker.ts).

    /**
     * Capture snapshots for every portfolio.
     * Called by the BullMQ analytics-snapshot worker.
     */
    async captureAllPortfolios() {
        try {
            const portfolios = portfolioStorage.getAllPortfolios()
            const reflector = new ReflectorService()
            const prices = await reflector.getCurrentPrices()

            for (const portfolio of portfolios) {
                await this.captureSnapshot(portfolio.id, prices)
            }
        } catch (error) {
            logger.error('Failed to capture portfolio snapshots', { error })
        }
    }

    async captureSnapshot(portfolioId: string, prices?: Record<string, any>) {
        try {
            const portfolio = portfolioStorage.getPortfolio(portfolioId)
            if (!portfolio) return

            const now = Date.now()
            const lastSnapshotTime = this.lastSnapshotTimes.get(portfolioId) || 0
            if (now - lastSnapshotTime < this.MIN_SNAPSHOT_INTERVAL_MS) return

            if (!prices) {
                const reflector = new ReflectorService()
                prices = await reflector.getCurrentPrices()
            }

            let totalValue = 0
            const allocations: Record<string, number> = {}

            for (const [asset, balance] of Object.entries(portfolio.balances)) {
                const price = prices[asset]?.price || 0
                const value = balance * price
                totalValue += value
            }

            for (const [asset, balance] of Object.entries(portfolio.balances)) {
                const price = prices[asset]?.price || 0
                const value = balance * price
                allocations[asset] = totalValue > 0 ? (value / totalValue) * 100 : 0
            }

            this.lastSnapshotTimes.set(portfolioId, now)

            // Persist to database
            try {
                await dbInsertAnalyticsSnapshot(portfolioId, totalValue, allocations, { ...portfolio.balances })
            } catch (dbError) {
                logger.error('Failed to persist snapshot to DB', { portfolioId, error: dbError })
            }

            logger.info('Portfolio snapshot captured', { portfolioId, totalValue })
        } catch (error) {
            logger.error('Failed to capture snapshot', { portfolioId, error })
        }
    }

    async getAnalytics(portfolioId: string, days: number = 30): Promise<PortfolioSnapshot[]> {
        try {
            return await dbGetAnalyticsSnapshots(portfolioId, days)
        } catch (error) {
            logger.error('Failed to get analytics from DB', { portfolioId, error })
            return []
        }
    }

    /**
     * Compute percentage change between two snapshot values.
     * Returns null when the baseline is zero or missing.
     */
    private pctChange(current: number, previous: number): number | null {
        if (previous === 0) return null
        return ((current - previous) / previous) * 100
    }

    /**
     * Generic change calculator: finds the closest snapshot to `lookbackMs` ago
     * within a `windowMs` tolerance and returns the % change from that snapshot
     * to the latest one. Pass `windowMs = 0` to use `dbGetSnapshotAt` (exact-or-before)
     * instead of `dbGetClosestSnapshot`.
     */
    async getChangeForWindow(
        portfolioId: string,
        lookbackMs: number,
        windowMs: number
    ): Promise<number | null> {
        try {
            const latest = await dbGetLatestSnapshot(portfolioId)
            if (!latest) return null

            const targetTime = new Date(Date.now() - lookbackMs)
            const previous = windowMs > 0
                ? await dbGetClosestSnapshot(portfolioId, targetTime, windowMs)
                : await dbGetSnapshotAt(portfolioId, targetTime)
            if (!previous) return null

            return this.pctChange(latest.totalValue, previous.totalValue)
        } catch (error) {
            logger.error('Failed to calculate change', { portfolioId, lookbackMs, windowMs, error })
            return null
        }
    }

    async calculatePerformanceMetrics(portfolioId: string): Promise<PerformanceMetrics> {
        const snapshots = await this.getAnalytics(portfolioId, 90)

        if (snapshots.length < 2) {
            return {
                totalReturn: 0,
                dailyChange: null,
                weeklyChange: null,
                monthlyChange: null,
                allTimeChange: null,
                maxDrawdown: 0,
                bestDay: { date: '', change: 0 },
                worstDay: { date: '', change: 0 },
                sharpeRatio: 0,
                volatility: 0,
            }
        }

        const sortedSnapshots = [...snapshots].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )

        const initialValue = sortedSnapshots[0].totalValue
        const finalValue = sortedSnapshots[sortedSnapshots.length - 1].totalValue
        const totalReturn = initialValue > 0 ? ((finalValue - initialValue) / initialValue) * 100 : 0

        const dailyChanges: number[] = []
        const dailyChangeData: Array<{ date: string; change: number }> = []

        for (let i = 1; i < sortedSnapshots.length; i++) {
            const prevValue = sortedSnapshots[i - 1].totalValue
            const currValue = sortedSnapshots[i].totalValue
            const change = prevValue > 0 ? ((currValue - prevValue) / prevValue) * 100 : 0
            dailyChanges.push(change)
            dailyChangeData.push({ date: sortedSnapshots[i].timestamp, change })
        }

        const [dailyChange, weeklyChange, monthlyChange, allTimeChange] = await Promise.all([
            this.getChangeForWindow(portfolioId, 24 * 60 * 60 * 1000, 2 * 60 * 60 * 1000),
            this.getChangeForWindow(portfolioId, 7 * 24 * 60 * 60 * 1000, 6 * 60 * 60 * 1000),
            this.getChangeForWindow(portfolioId, 30 * 24 * 60 * 60 * 1000, 12 * 60 * 60 * 1000),
            this.getChangeForWindow(portfolioId, Date.now(), 0),
        ])

        let maxDrawdown = 0
        let peak = initialValue
        for (const snapshot of sortedSnapshots) {
            if (snapshot.totalValue > peak) peak = snapshot.totalValue
            const drawdown = peak > 0 ? ((peak - snapshot.totalValue) / peak) * 100 : 0
            if (drawdown > maxDrawdown) maxDrawdown = drawdown
        }

        const bestDay = dailyChangeData.reduce(
            (best, curr) => (curr.change > best.change ? curr : best),
            { date: '', change: -Infinity }
        )
        const worstDay = dailyChangeData.reduce(
            (worst, curr) => (curr.change < worst.change ? curr : worst),
            { date: '', change: Infinity }
        )

        const meanChange =
            dailyChanges.length > 0
                ? dailyChanges.reduce((sum, c) => sum + c, 0) / dailyChanges.length
                : 0
        const variance =
            dailyChanges.length > 0
                ? dailyChanges.reduce((sum, c) => sum + Math.pow(c - meanChange, 2), 0) /
                dailyChanges.length
                : 0
        const volatility = Math.sqrt(variance)

        const riskFreeRate = 0.02 / 365
        const excessReturn = meanChange / 100 - riskFreeRate
        const sharpeRatio = volatility > 0 ? (excessReturn / (volatility / 100)) * Math.sqrt(365) : 0

        return {
            totalReturn,
            dailyChange,
            weeklyChange,
            monthlyChange,
            allTimeChange,
            maxDrawdown,
            bestDay: bestDay.change !== -Infinity ? bestDay : { date: '', change: 0 },
            worstDay: worstDay.change !== Infinity ? worstDay : { date: '', change: 0 },
            sharpeRatio,
            volatility,
        }
    }

    async getPerformanceSummary(portfolioId: string) {
        const metrics = await this.calculatePerformanceMetrics(portfolioId)
        const snapshots = await this.getAnalytics(portfolioId, 30)

        return {
            metrics,
            dataPoints: snapshots.length,
            period: '30 days',
            lastUpdated: snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : null,
        }
    }

    /** No-op – kept for API compatibility. Workers are stopped in index.ts. */
    stop() {
        // Nothing to clear; no setInterval is used.
    }
}

export const analyticsService = new AnalyticsService()
export type { PortfolioSnapshot, PerformanceMetrics }
