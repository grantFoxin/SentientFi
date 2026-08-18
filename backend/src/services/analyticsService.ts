import { portfolioStorage } from './portfolioStorage.js'
import { ReflectorService } from './reflector.js'
import { logger } from '../utils/logger.js'
import {
    dbInsertAnalyticsSnapshot,
    dbGetLatestSnapshot,
    dbGetClosestSnapshot,
    dbGetAnalyticsSnapshots
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
    maxDrawdown: number
    bestDay: { date: string; change: number }
    worstDay: { date: string; change: number }
    sharpeRatio: number
    volatility: number
}

class AnalyticsService {
    private snapshots: Map<string, PortfolioSnapshot[]> = new Map()
    private lastSnapshotTimes: Map<string, number> = new Map()
    private readonly MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

    /**
     * Capture snapshots for every portfolio.
     * Called by the BullMQ analytics-snapshot worker.
     */
    async captureAllPortfolios() {
        try {
            const portfolios = await portfolioStorage.getAllPortfolios()
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
            const portfolio = await portfolioStorage.getPortfolio(portfolioId)
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

            const snapshot: PortfolioSnapshot = {
                portfolioId,
                timestamp: new Date().toISOString(),
                totalValue,
                allocations,
                balances: { ...portfolio.balances },
            }

            if (!this.snapshots.has(portfolioId)) {
                this.snapshots.set(portfolioId, [])
            }

            const snapshotsForPortfolio = this.snapshots.get(portfolioId)!
            snapshotsForPortfolio.push(snapshot)
            this.lastSnapshotTimes.set(portfolioId, now)

            const maxSnapshots = 1000
            if (snapshotsForPortfolio.length > maxSnapshots) {
                snapshotsForPortfolio.shift()
            }

            try {
                await dbInsertAnalyticsSnapshot(
                    portfolioId,
                    totalValue,
                    allocations,
                    portfolio.balances
                )
            } catch {
                // Non-fatal if SQL DB is not active
            }

            logger.info('Portfolio snapshot captured', { portfolioId, totalValue })
        } catch (error) {
            logger.error('Failed to capture snapshot', { portfolioId, error })
        }
    }

    getAnalytics(portfolioId: string, days: number = 30): PortfolioSnapshot[] {
        const snapshots = this.snapshots.get(portfolioId) || []
        const cutoffDate = new Date()
        cutoffDate.setDate(cutoffDate.getDate() - days)

        return snapshots.filter(snapshot => {
            const snapshotDate = new Date(snapshot.timestamp)
            return snapshotDate >= cutoffDate
        })
    }

    getClosestSnapshotInList(
        snapshots: PortfolioSnapshot[],
        targetDate: Date,
        maxDiffMs: number = 2 * 60 * 60 * 1000
    ): PortfolioSnapshot | null {
        if (snapshots.length === 0) return null

        let closest: PortfolioSnapshot | null = null
        let minDiff = Infinity

        for (const s of snapshots) {
            const time = new Date(s.timestamp).getTime()
            const diff = Math.abs(time - targetDate.getTime())
            if (diff <= maxDiffMs && diff < minDiff) {
                minDiff = diff
                closest = s
            }
        }

        return closest
    }

    async calculateDayChange(portfolioId: string): Promise<number | null> {
        return this.calculatePeriodChange(portfolioId, 24 * 60 * 60 * 1000, 2 * 60 * 60 * 1000)
    }

    async calculateWeekChange(portfolioId: string): Promise<number | null> {
        return this.calculatePeriodChange(portfolioId, 7 * 24 * 60 * 60 * 1000, 12 * 60 * 60 * 1000)
    }

    async calculateMonthChange(portfolioId: string): Promise<number | null> {
        return this.calculatePeriodChange(portfolioId, 30 * 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000)
    }

    async calculateAllTimeChange(portfolioId: string): Promise<number | null> {
        let firstSnap: PortfolioSnapshot | null = null
        let latestSnap: PortfolioSnapshot | null = null

        try {
            const dbSnaps = await dbGetAnalyticsSnapshots(portfolioId, 365)
            if (dbSnaps.length > 0) {
                firstSnap = dbSnaps[0]
                latestSnap = dbSnaps[dbSnaps.length - 1]
            }
        } catch {
            // DB unavailable
        }

        const inMem = this.snapshots.get(portfolioId) || []
        if (!latestSnap && inMem.length > 0) {
            latestSnap = inMem[inMem.length - 1]
        }
        if (!firstSnap && inMem.length > 0) {
            firstSnap = inMem[0]
        }

        if (!latestSnap || !firstSnap || firstSnap === latestSnap || firstSnap.totalValue === 0) {
            return null
        }

        return ((latestSnap.totalValue - firstSnap.totalValue) / firstSnap.totalValue) * 100
    }

    async calculatePeriodChange(
        portfolioId: string,
        periodMs: number,
        maxDiffMs: number = 2 * 60 * 60 * 1000
    ): Promise<number | null> {
        const now = new Date()
        const targetDate = new Date(now.getTime() - periodMs)

        let latest: PortfolioSnapshot | null = null
        let previous: PortfolioSnapshot | null = null

        try {
            latest = await dbGetLatestSnapshot(portfolioId)
            previous = await dbGetClosestSnapshot(portfolioId, targetDate, maxDiffMs)
        } catch {
            // DB unavailable
        }

        const inMemSnapshots = this.snapshots.get(portfolioId) || []
        if (!latest && inMemSnapshots.length > 0) {
            latest = inMemSnapshots[inMemSnapshots.length - 1]
        }
        if (!previous && inMemSnapshots.length > 0) {
            previous = this.getClosestSnapshotInList(inMemSnapshots, targetDate, maxDiffMs)
        }

        if (!latest || !previous || previous.totalValue === 0) return null

        return ((latest.totalValue - previous.totalValue) / previous.totalValue) * 100
    }

    calculatePerformanceMetrics(portfolioId: string): PerformanceMetrics {
        const snapshots = this.getAnalytics(portfolioId, 90)

        if (snapshots.length < 2) {
            return {
                totalReturn: 0,
                dailyChange: null,
                weeklyChange: null,
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

        const latestTimestamp = new Date(sortedSnapshots[sortedSnapshots.length - 1].timestamp).getTime()
        const oneDayAgo = new Date(latestTimestamp - 24 * 60 * 60 * 1000)
        const sevenDaysAgo = new Date(latestTimestamp - 7 * 24 * 60 * 60 * 1000)

        const closestDaySnap = this.getClosestSnapshotInList(sortedSnapshots, oneDayAgo, 2 * 60 * 60 * 1000)
        const dailyChange = closestDaySnap && closestDaySnap.totalValue > 0
            ? ((finalValue - closestDaySnap.totalValue) / closestDaySnap.totalValue) * 100
            : null

        const closestWeekSnap = this.getClosestSnapshotInList(sortedSnapshots, sevenDaysAgo, 12 * 60 * 60 * 1000)
        const weeklyChange = closestWeekSnap && closestWeekSnap.totalValue > 0
            ? ((finalValue - closestWeekSnap.totalValue) / closestWeekSnap.totalValue) * 100
            : null

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
            maxDrawdown,
            bestDay: bestDay.change !== -Infinity ? bestDay : { date: '', change: 0 },
            worstDay: worstDay.change !== Infinity ? worstDay : { date: '', change: 0 },
            sharpeRatio,
            volatility,
        }
    }

    getPerformanceSummary(portfolioId: string) {
        const metrics = this.calculatePerformanceMetrics(portfolioId)
        const snapshots = this.getAnalytics(portfolioId, 30)

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
