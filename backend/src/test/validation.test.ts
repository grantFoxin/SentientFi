import { describe, it, expect } from 'vitest'
import { createPortfolioSchema, updatePortfolioSchema } from '../api/validation.js'

describe('updatePortfolioSchema', () => {
    it('accepts valid allocations', () => {
        const result = updatePortfolioSchema.safeParse({
            allocations: { XLM: 60, USDC: 40 }
        })
        expect(result.success).toBe(true)
    })

    it('accepts valid threshold', () => {
        const result = updatePortfolioSchema.safeParse({ threshold: 10 })
        expect(result.success).toBe(true)
    })

    it('accepts both allocations and threshold', () => {
        const result = updatePortfolioSchema.safeParse({
            allocations: { XLM: 50, USDC: 50 },
            threshold: 5
        })
        expect(result.success).toBe(true)
    })

    it('rejects empty body (no fields provided)', () => {
        const result = updatePortfolioSchema.safeParse({})
        expect(result.success).toBe(false)
    })

    it('rejects allocations not summing to 100%', () => {
        const result = updatePortfolioSchema.safeParse({
            allocations: { XLM: 60, USDC: 30 }
        })
        expect(result.success).toBe(false)
    })

    it('rejects threshold out of range', () => {
        const result = updatePortfolioSchema.safeParse({ threshold: 0 })
        expect(result.success).toBe(false)
    })

    it('rejects unknown keys (strict mode)', () => {
        const result = updatePortfolioSchema.safeParse({
            threshold: 5,
            unknownField: 'hello'
        })
        expect(result.success).toBe(false)
    })

    it('rejects allocation values over 100', () => {
        const result = updatePortfolioSchema.safeParse({
            allocations: { XLM: 120, USDC: -20 }
        })
        expect(result.success).toBe(false)
    })
})

describe('createPortfolioSchema', () => {
    it('accepts valid input', () => {
        const result = createPortfolioSchema.safeParse({
            userAddress: 'GTEST123456789ABCDEF0',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        })
        expect(result.success).toBe(true)
    })

    it('rejects missing userAddress', () => {
        const result = createPortfolioSchema.safeParse({
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        })
        expect(result.success).toBe(false)
    })

    it('rejects missing allocations', () => {
        const result = createPortfolioSchema.safeParse({
            userAddress: 'GTEST123456789ABCDEF0',
            threshold: 5
        })
        expect(result.success).toBe(false)
    })

    it('rejects allocations not summing to 100%', () => {
        const result = createPortfolioSchema.safeParse({
            userAddress: 'GTEST123456789ABCDEF0',
            allocations: { XLM: 60, USDC: 30 },
            threshold: 5
        })
        expect(result.success).toBe(false)
    })
})
