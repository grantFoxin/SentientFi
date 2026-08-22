import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import express, { Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import { Keypair } from '@stellar/stellar-sdk'
import { portfolioRouter } from '../api/routes.js'
import { v1Router } from '../api/v1Router.js'
import { legacyApiDeprecation } from '../middleware/legacyApiDeprecation.js'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Setup ──────────────────────────────────────────────────────────────────

let app: Express
let testDbPath: string

beforeAll(async () => {
    // Create temporary database for tests
    const testDir = join(tmpdir(), `stellar-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'test.db')
    process.env.DB_PATH = testDbPath

    app = express()

    app.use(cors({
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
    }))

    app.options('*', (req, res) => {
        res.header('Access-Control-Allow-Origin', '*')
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With')
        res.status(200).end()
    })

    app.use(express.json({ limit: '10mb' }))
    app.use(express.urlencoded({ extended: true, limit: '10mb' }))

    app.set('trust proxy', 1)

    // Mount v1 (canonical) and legacy API routes
    app.use('/api/v1', v1Router)
    app.use('/api', legacyApiDeprecation, portfolioRouter)

    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.error('API Error:', err)
        res.status(500).json({ error: 'Internal server error' })
    })
})

afterAll(() => {
    
    if (existsSync(testDbPath)) {
        try {
            rmSync(testDbPath, { force: true })
        } catch (e) {
            // Ignore cleanup errors
        }
    }
    delete process.env.DB_PATH
})

// ─── Health Check Tests ─────────────────────────────────────────────────────

describe.skip('API Health Check', () => {
    it('GET /api/health returns healthy status', async () => {
        const response = await request(app)
            .get('/api/health')
            .expect((res) => {
                expect([200, 201]).toContain(res.status)
            })

        expect(response.body.status).toMatch(/ok|healthy/)
        expect(response.body.timestamp).toBeDefined()
    })
})

// ─── Portfolio Creation Tests ────────────────────────────────────────────────

describe('Portfolio Management - POST /api/portfolio', () => {
    it('should create a portfolio with valid input', async () => {
        // userAddress deliberately not a real Stellar address here — the
        // frontend sends a "demo-user" placeholder when no wallet is
        // connected, and createPortfolioSchema doesn't require StrKey format.
        const testPayload = {
            userAddress: 'GTEST123456789ABCDEF0',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect(201)

        expect(response.body.success).toBe(true)
        expect(response.body.portfolio.id).toBeDefined()
        expect(response.body.portfolio.userAddress).toBe(testPayload.userAddress)
        expect(response.body.portfolio.allocations).toEqual(testPayload.allocations)
    })

    it('should return 400 for missing required fields', async () => {
        const testPayload = {
            userAddress: 'GTEST123456789'
            // Missing allocations and threshold
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect(400)

        expect(response.body.error).toBe('Invalid request payload')
        expect(response.body.details.some((d: any) => d.field === 'allocations')).toBe(true)
        expect(response.body.details.some((d: any) => d.field === 'threshold')).toBe(true)
    })

    it('should return 400 if allocations do not sum to 100%', async () => {
        const testPayload = {
            userAddress: 'GTEST123456789ABCDEF1',
            allocations: { XLM: 60, USDC: 30 },
            threshold: 5
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect(400)

        expect(response.body.details.some((d: any) => d.message.includes('100%'))).toBe(true)
    })

    it('should return 400 if threshold is out of range', async () => {
        const testPayload = {
            userAddress: 'GTEST123456789ABCDEF2',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 100
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect(400)

        expect(response.body.details.some((d: any) => d.message.includes('Threshold'))).toBe(true)
    })

    it('should return 400 if asset allocation is invalid', async () => {
        const testPayload = {
            userAddress: 'GTEST123456789ABCDEF3',
            allocations: { XLM: 120, USDC: -20 },
            threshold: 5
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect(400)

        expect(response.body.error).toBeDefined()
    })
})

// ─── Portfolio Retrieval Tests ───────────────────────────────────────────────

describe('Portfolio Management - GET /api/portfolio/:id', () => {
    it('should return portfolio data for valid portfolio ID', async () => {
        // First create a portfolio
        const createPayload = {
            userAddress: 'GGET123456789ABCDEF0',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id
        expect(portfolioId).toBeDefined()

        // Now fetch it
        const getResponse = await request(app)
            .get(`/api/portfolio/${portfolioId}`)
            .expect(200)

        expect(getResponse.body.portfolio).toBeDefined()
        expect(getResponse.body.portfolio.id).toBe(portfolioId)
        expect(Array.isArray(getResponse.body.portfolio.allocations)).toBe(true)
    })

    it('should return 404 for missing portfolio ID', async () => {
        // Express doesn't match an empty :id segment, so this 404s at the
        // router level rather than reaching the handler.
        await request(app)
            .get('/api/portfolio/')
            .expect(404)
    })

    it('should handle non-existent portfolio gracefully', async () => {
        const response = await request(app)
            .get('/api/portfolio/nonexistent-id-xyz')
            .expect(404)

        expect(response.body.error).toBe('Portfolio not found')
    })
})

// ─── Prices Tests ───────────────────────────────────────────────────────────

describe('Price Data - GET /api/prices', () => {
    it('should return price data for major assets', async () => {
        const response = await request(app)
            .get('/api/prices')
            .expect(200)

        // Should have at least one asset
        expect(Object.keys(response.body).length).toBeGreaterThan(0)

        // Check for common assets (might be fallback data)
        const hasAssets = response.body.XLM || response.body.BTC || response.body.ETH || response.body.USDC
        expect(hasAssets).toBeTruthy()
    })

    it('should return objects with required price fields', async () => {
        const response = await request(app)
            .get('/api/prices')
            .expect(200)

        const assets = Object.values(response.body) as any[]
        expect(assets.length).toBeGreaterThan(0)

        const firstAsset = assets[0]
        expect(firstAsset).toBeDefined()
        expect(firstAsset.price).toBeDefined()
        expect(typeof firstAsset.price).toBe('number')
        expect(firstAsset.timestamp).toBeDefined()
    })

    it('should return consistent asset structure', async () => {
        const response = await request(app)
            .get('/api/prices')
            .expect(200)

        // All assets should have consistent structure
        for (const [assetName, assetData] of Object.entries(response.body)) {
            const asset = assetData as any
            expect(asset.price).toBeDefined()
            expect(typeof asset.price).toBe('number')
            expect(asset.timestamp).toBeDefined()
        }
    })
})

// ─── Rebalancing Tests ──────────────────────────────────────────────────────

describe('Rebalancing - POST /api/portfolio/:id/rebalance', () => {
    it('should reject a rebalance immediately after creation (cooldown)', async () => {
        // createPortfolio sets lastRebalance to the creation timestamp, so
        // executeRebalance's 1-hour cooldown check blocks it right away —
        // before it even gets to checking balances or drift. Same generic
        // 500 + {success:false, error} shape every other service-layer
        // failure in this router uses.
        const createPayload = {
            userAddress: 'GREBALANCE123456789A',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id
        expect(portfolioId).toBeDefined()

        const rebalanceResponse = await request(app)
            .post(`/api/portfolio/${portfolioId}/rebalance`)
            .send({})
            .expect(500)

        expect(rebalanceResponse.body.success).toBe(false)
        expect(rebalanceResponse.body.error).toContain('Cooldown')
    })

    it('should return 404 for a nonexistent portfolio ID', async () => {
        const response = await request(app)
            .post('/api/portfolio/invalid-id-xyz-123/rebalance')
            .send({})
            .expect(404)

        expect(response.body.error).toBe('Portfolio not found')
    })

    it('should require a portfolio ID in the URL', async () => {
        await request(app)
            .post('/api/portfolio//rebalance')
            .send({})
            .expect(404)
    })
})

// ─── User Portfolios Tests ──────────────────────────────────────────────────

describe('Portfolio Management - GET /api/user/:address/portfolios', () => {
    it('should return user portfolios for valid address', async () => {
        const userAddress = 'GUSER123456789ABCDEF0'

        // Create a portfolio for this user
        const createPayload = {
            userAddress,
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        // Now fetch user portfolios
        const response = await request(app)
            .get(`/api/user/${userAddress}/portfolios`)
            .expect(200)

        expect(Array.isArray(response.body)).toBe(true)
        expect(response.body.length).toBeGreaterThan(0)
        expect(response.body[0].userAddress).toBe(userAddress)
    })

    it('should return empty array for user with no portfolios', async () => {
        // Deliberately not a well-formed Stellar address either — this
        // route doesn't validate address format (it's a read, not an
        // identity-keyed write), a malformed address just matches nothing.
        const response = await request(app)
            .get('/api/user/GNEWUSER123456789ABCDEF/portfolios')
            .expect(200)

        expect(Array.isArray(response.body)).toBe(true)
        expect(response.body).toHaveLength(0)
    })
})

// ─── Portfolio Update Tests ─────────────────────────────────────────────────

describe('Portfolio Management - PUT /api/portfolio/:id', () => {
    it('should update allocations with valid data', async () => {
        const userAddress = 'GPUT123456789ABCDEF0'
        const createPayload = {
            userAddress,
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id

        const updateResponse = await request(app)
            .put(`/api/portfolio/${portfolioId}`)
            .set('X-Public-Key', userAddress)
            .send({ allocations: { XLM: 70, USDC: 30 } })
            .expect(200)

        expect(updateResponse.body.success).toBe(true)
        expect(updateResponse.body.portfolio.allocations).toEqual({ XLM: 70, USDC: 30 })
    })

    it('should update threshold with valid data', async () => {
        const userAddress = 'GPUT123456789ABCDEF1'
        const createPayload = {
            userAddress,
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id

        const updateResponse = await request(app)
            .put(`/api/portfolio/${portfolioId}`)
            .set('X-Public-Key', userAddress)
            .send({ threshold: 10 })
            .expect(200)

        expect(updateResponse.body.success).toBe(true)
        expect(updateResponse.body.portfolio.threshold).toBe(10)
    })

    it('should return 404 for nonexistent portfolio', async () => {
        const response = await request(app)
            .put('/api/portfolio/nonexistent-id-xyz')
            .set('X-Public-Key', 'GTEST123456789ABCDEF0')
            .send({ threshold: 10 })
            .expect(404)

        expect(response.body.error).toBe('Portfolio not found')
    })

    it('should return 400 for invalid allocations (not summing to 100%)', async () => {
        const userAddress = 'GPUT123456789ABCDEF2'
        const createPayload = {
            userAddress,
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id

        const response = await request(app)
            .put(`/api/portfolio/${portfolioId}`)
            .set('X-Public-Key', userAddress)
            .send({ allocations: { XLM: 60, USDC: 30 } })
            .expect(400)

        expect(response.body.error).toBe('Invalid request payload')
    })

    it('should return 400 for empty body', async () => {
        const userAddress = 'GPUT123456789ABCDEF3'
        const createPayload = {
            userAddress,
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id

        const response = await request(app)
            .put(`/api/portfolio/${portfolioId}`)
            .set('X-Public-Key', userAddress)
            .send({})
            .expect(400)

        expect(response.body.error).toBe('Invalid request payload')
    })

    it('should return 401 when X-Public-Key header is missing', async () => {
        const createPayload = {
            userAddress: 'GPUT123456789ABCDEF5',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id

        const response = await request(app)
            .put(`/api/portfolio/${portfolioId}`)
            .send({ threshold: 10 })
            .expect(401)

        expect(response.body.error).toContain('X-Public-Key')
    })

    it('should return 403 when caller is not the portfolio owner', async () => {
        const createPayload = {
            userAddress: 'GPUT123456789ABCDEF4',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id

        const response = await request(app)
            .put(`/api/portfolio/${portfolioId}`)
            .set('X-Public-Key', 'GDIFFERENT123456789ABCDEF')
            .send({ threshold: 10 })
            .expect(403)

        expect(response.body.error).toContain('Not authorized')
    })
})

// ─── Portfolio Delete Tests ─────────────────────────────────────────────────

describe('Portfolio Management - DELETE /api/portfolio/:id', () => {
    it('should delete a portfolio and return 204', async () => {
        const userAddress = 'GDEL123456789ABCDEF0'
        const createPayload = {
            userAddress,
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id

        await request(app)
            .delete(`/api/portfolio/${portfolioId}`)
            .set('X-Public-Key', userAddress)
            .expect(204)

        // Verify it's gone
        await request(app)
            .get(`/api/portfolio/${portfolioId}`)
            .expect(404)
    })

    it('should return 404 for nonexistent portfolio', async () => {
        const response = await request(app)
            .delete('/api/portfolio/nonexistent-id-xyz')
            .set('X-Public-Key', 'GTEST123456789ABCDEF0')
            .expect(404)

        expect(response.body.error).toBe('Portfolio not found')
    })

    it('should return 401 when X-Public-Key header is missing', async () => {
        const createPayload = {
            userAddress: 'GDEL123456789ABCDEF2',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id

        const response = await request(app)
            .delete(`/api/portfolio/${portfolioId}`)
            .expect(401)

        expect(response.body.error).toContain('X-Public-Key')
    })

    it('should return 403 when caller is not the portfolio owner', async () => {
        const createPayload = {
            userAddress: 'GDEL123456789ABCDEF1',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect(201)

        const portfolioId = createResponse.body.portfolio.id

        const response = await request(app)
            .delete(`/api/portfolio/${portfolioId}`)
            .set('X-Public-Key', 'GDIFFERENT123456789ABCDEF')
            .expect(403)

        expect(response.body.error).toContain('Not authorized')
    })
})

// ─── Notification userId Validation Tests ────────────────────────────────────

describe('Notifications - userId must be a valid Stellar public key', () => {
    const validUserId = Keypair.random().publicKey()
    const invalidUserId = 'not-a-stellar-address'

    it('POST /api/notifications/subscribe rejects an invalid userId with 400', async () => {
        const response = await request(app)
            .post('/api/notifications/subscribe')
            .send({
                userId: invalidUserId,
                emailEnabled: true,
                emailAddress: 'user@example.com',
                webhookEnabled: false,
                events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true }
            })
            .expect(400)

        expect(response.body.success).toBe(false)
        expect(response.body.error).toMatch(/valid Stellar public key/i)
    })

    it('GET /api/notifications/preferences rejects an invalid userId with 400', async () => {
        const response = await request(app)
            .get('/api/notifications/preferences')
            .query({ userId: invalidUserId })
            .expect(400)

        expect(response.body.success).toBe(false)
        expect(response.body.error).toMatch(/valid Stellar public key/i)
    })

    it('DELETE /api/notifications/unsubscribe rejects an invalid userId with 400', async () => {
        const response = await request(app)
            .delete('/api/notifications/unsubscribe')
            .query({ userId: invalidUserId })
            .expect(400)

        expect(response.body.success).toBe(false)
        expect(response.body.error).toMatch(/valid Stellar public key/i)
    })

    it('GET /api/notifications/preferences accepts a valid Stellar public key', async () => {
        const response = await request(app)
            .get('/api/notifications/preferences')
            .query({ userId: validUserId })
            .expect(200)

        expect(response.body.success).toBe(true)
    })
})

// ─── v1 API Namespace Tests ─────────────────────────────────────────────────

describe('API Namespace - /api/v1 (canonical) vs /api (legacy)', () => {
    it('GET /api/v1/prices returns 200 (canonical namespace)', async () => {
        const response = await request(app)
            .get('/api/v1/prices')
            .expect(200)

        expect(Object.keys(response.body).length).toBeGreaterThan(0)
    })

    it('GET /api/prices returns 200 with deprecation headers (legacy namespace)', async () => {
        const response = await request(app)
            .get('/api/prices')
            .expect(200)

        // Check for deprecation headers
        expect(response.headers['deprecation']).toBe('true')
        expect(response.headers['sunset']).toBeDefined()
        expect(response.headers['link']).toContain('deprecation')

        // Data should still work
        expect(Object.keys(response.body).length).toBeGreaterThan(0)
    })

    it('/api/v1/* and /api/* return same data structure', async () => {
        const v1Response = await request(app)
            .get('/api/v1/prices')
            .expect(200)

        const legacyResponse = await request(app)
            .get('/api/prices')
            .expect(200)

        // Both should return price data with same structure
        expect(Object.keys(v1Response.body).length).toBeGreaterThan(0)
        expect(Object.keys(legacyResponse.body).length).toBeGreaterThan(0)

        // Structure should match
        const v1Keys = Object.keys(v1Response.body).sort()
        const legacyKeys = Object.keys(legacyResponse.body).sort()
        expect(v1Keys).toEqual(legacyKeys)
    })

    it('root-level routes are not exposed (no /prices without prefix)', async () => {
        const response = await request(app)
            .get('/prices')
            .expect((res) => {
                expect(res.status).toBe(404)
            })
    })
})
