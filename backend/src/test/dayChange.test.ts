import { describe, it, expect, vi, beforeEach } from 'vitest'

// #57 — getPortfolio().dayChange must come from recorded snapshots, never
// from Math.random(), and must be null when there is no history to compare.

const { getChangeForWindow } = vi.hoisted(() => ({ getChangeForWindow: vi.fn() }))

vi.mock('../services/analyticsService.js', () => ({
    analyticsService: { getChangeForWindow }
}))

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: {
        getPortfolio: vi.fn(async () => ({
            id: 'p1',
            userAddress: 'GUSER',
            allocations: { XLM: 60, USDC: 40 },
            balances: { XLM: 100, USDC: 50 },
            threshold: 5,
            totalValue: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastRebalance: '2026-01-01T00:00:00.000Z'
        }))
    }
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        async getCurrentPrices() {
            return { XLM: { price: 0.5 }, USDC: { price: 1 } }
        }
    }
}))

vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: {},
    riskManagementService: {}
}))

import { StellarService } from '../services/stellar.js'

describe('StellarService.getPortfolio dayChange (#57)', () => {
    beforeEach(() => {
        getChangeForWindow.mockReset()
    })

    it('uses the 24h snapshot change with a 2h tolerance window', async () => {
        getChangeForWindow.mockResolvedValue(3.25)
        const randomSpy = vi.spyOn(Math, 'random')

        const portfolio = await new StellarService().getPortfolio('p1')

        expect(portfolio.dayChange).toBe(3.25)
        expect(getChangeForWindow).toHaveBeenCalledWith('p1', 24 * 60 * 60 * 1000, 2 * 60 * 60 * 1000)
        expect(randomSpy).not.toHaveBeenCalled()
        randomSpy.mockRestore()
    })

    it('is null when there is no snapshot history', async () => {
        getChangeForWindow.mockResolvedValue(null)

        const portfolio = await new StellarService().getPortfolio('p1')

        expect(portfolio.dayChange).toBeNull()
    })

    it('is stable across calls for the same history', async () => {
        getChangeForWindow.mockResolvedValue(-1.5)
        const service = new StellarService()

        const first = await service.getPortfolio('p1')
        const second = await service.getPortfolio('p1')

        expect(first.dayChange).toBe(second.dayChange)
    })
})
