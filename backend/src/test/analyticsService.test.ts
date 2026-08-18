import { describe, it, expect, beforeEach } from 'vitest'
import { analyticsService } from '../services/analyticsService.js'

describe('AnalyticsService', () => {
    const portfolioId = 'test-portfolio-1'

    beforeEach(() => {
        (analyticsService as any).snapshots.clear()
        (analyticsService as any).lastSnapshotTimes.clear()
    })

    it('returns null for calculateDayChange when no snapshot exists in 2h window', async () => {
        const change = await analyticsService.calculateDayChange(portfolioId)
        expect(change).toBeNull()
    })

    it('calculates real day change when snapshot exists within 2h window', async () => {
        const now = Date.now()
        const oneDayAgo = now - 24 * 60 * 60 * 1000

        const snapshots = [
            {
                portfolioId,
                timestamp: new Date(oneDayAgo).toISOString(),
                totalValue: 1000,
                allocations: { XLM: 100 },
                balances: { XLM: 1000 },
            },
            {
                portfolioId,
                timestamp: new Date(now).toISOString(),
                totalValue: 1100,
                allocations: { XLM: 100 },
                balances: { XLM: 1000 },
            }
        ]

        ;(analyticsService as any).snapshots.set(portfolioId, snapshots)

        const change = await analyticsService.calculateDayChange(portfolioId)
        expect(change).not.toBeNull()
        expect(change).toBeCloseTo(10)
    })

    it('returns null if snapshot is outside 2h window', async () => {
        const now = Date.now()
        const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000

        const snapshots = [
            {
                portfolioId,
                timestamp: new Date(threeDaysAgo).toISOString(),
                totalValue: 1000,
                allocations: { XLM: 100 },
                balances: { XLM: 1000 },
            },
            {
                portfolioId,
                timestamp: new Date(now).toISOString(),
                totalValue: 1100,
                allocations: { XLM: 100 },
                balances: { XLM: 1000 },
            }
        ]

        ;(analyticsService as any).snapshots.set(portfolioId, snapshots)

        const dayChange = await analyticsService.calculateDayChange(portfolioId)
        expect(dayChange).toBeNull()
    })
})
