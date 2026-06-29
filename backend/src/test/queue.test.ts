/**
 * Queue worker tests (issue #38)
 *
 * Tests are structured to use Vitest's module-level mocking with proper
 * constructor functions (not arrow functions) for class-based services.
 *
 * These tests invoke the processor functions directly to validate job
 * processing logic without requiring Redis, Stellar, or a database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

// ─── Hoisted Variables ──────────────────────────────────────────────────────
// vi.hoisted guarantees execution order before any vi.mock calls take place.
const {
  mockQueueAdd,
  mockQueueClientGet,
  mockGetPortfolio,
  mockCheckRebalanceNeeded,
  mockExecuteRebalance,
  mockGetCurrentPrices,
  mockRecordRebalanceEvent,
  mockGetRecentAutoRebalances,
  mockGetAutoRebalancesSince,
  mockShouldAllowRebalance,
  mockUpdatePriceData,
  sharedMockQueue,
} = vi.hoisted(() => {
  const queueAddSpy = vi.fn();
  const queueClientGetSpy = vi.fn();

  return {
    mockQueueAdd: queueAddSpy,
    mockQueueClientGet: queueClientGetSpy,

    mockGetPortfolio: vi.fn(),
    mockCheckRebalanceNeeded: vi.fn(),
    mockExecuteRebalance: vi.fn(),

    mockGetCurrentPrices: vi.fn(),

    mockRecordRebalanceEvent: vi.fn(),
    mockGetRecentAutoRebalances: vi.fn(),
    mockGetAutoRebalancesSince: vi.fn(),

    mockShouldAllowRebalance: vi.fn(),
    mockUpdatePriceData: vi.fn(),

    sharedMockQueue: {
      add: queueAddSpy,

      // Needed by processPortfolioCheckJob()
      client: Promise.resolve({
        get: queueClientGetSpy,
      }),
    },
  };
}); // ─── Module Level Mocks ─────────────────────────────────────────────────────

vi.mock("../services/stellar.js", () => {
  function StellarService(this: any) {
    this.getPortfolio = mockGetPortfolio;
    this.checkRebalanceNeeded = mockCheckRebalanceNeeded;
    this.executeRebalance = mockExecuteRebalance;
  }
  return { StellarService };
});

vi.mock("../services/reflector.js", () => {
  function ReflectorService(this: any) {
    this.getCurrentPrices = mockGetCurrentPrices;
  }
  return { ReflectorService };
});

vi.mock("../services/rebalanceHistory.js", () => {
  function RebalanceHistoryService(this: any) {
    this.recordRebalanceEvent = mockRecordRebalanceEvent;
    this.getRecentAutoRebalances = mockGetRecentAutoRebalances;
    this.getAutoRebalancesSince = mockGetAutoRebalancesSince;
  }
  return { RebalanceHistoryService };
});

vi.mock("../services/riskManagements.js", () => {
  function RiskManagementService(this: any) {
    this.shouldAllowRebalance = mockShouldAllowRebalance;
    this.updatePriceData = mockUpdatePriceData;
  }
  return { RiskManagementService };
});

vi.mock("../services/serviceContainer.js", () => ({
  rebalanceHistoryService: {
    recordRebalanceEvent: mockRecordRebalanceEvent,
    getRecentAutoRebalances: mockGetRecentAutoRebalances,
    getAutoRebalancesSince: mockGetAutoRebalancesSince,
    getAllAutoRebalances: vi.fn().mockResolvedValue([]),
    getHistoryStats: vi.fn().mockResolvedValue({
      totalEvents: 0,
      portfolios: 0,
      recentActivity: 0,
      autoRebalances: 0,
    }),
  },
  riskManagementService: {
    shouldAllowRebalance: mockShouldAllowRebalance,
    updatePriceData: mockUpdatePriceData,
    getCircuitBreakerStatus: vi.fn().mockReturnValue({}),
  },
}));

vi.mock("../services/portfolioStorage.js", () => ({
  portfolioStorage: {
    getAllPortfolios: vi.fn(),
    getPortfolio: vi.fn(),
  },
}));

vi.mock("../services/circuitBreakers.js", () => ({
  CircuitBreakers: {
    checkMarketConditions: vi.fn(),
    checkCooldownPeriod: vi.fn(),
    checkConcentrationRisk: vi.fn(),
  },
}));

vi.mock("../services/notificationService.js", () => ({
  notificationService: { notify: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../services/analyticsService.js", () => ({
  analyticsService: {
    captureAllPortfolios: vi.fn().mockResolvedValue(undefined),
    captureSnapshot: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../queue/queues.js", () => ({
  getRebalanceQueue: vi.fn().mockReturnValue(sharedMockQueue),
  getPortfolioCheckQueue: vi.fn().mockReturnValue(sharedMockQueue),
  QUEUE_NAMES: {
    PORTFOLIO_CHECK: "portfolio-check",
    REBALANCE: "rebalance",
    ANALYTICS_SNAPSHOT: "analytics-snapshot",
  },
}));

vi.mock("../queue/connection.js", () => ({
  getConnectionOptions: vi
    .fn()
    .mockReturnValue({ url: "redis://localhost:6379" }),
  isRedisAvailable: vi.fn().mockResolvedValue(false),
  logQueueStartup: vi.fn(),
  REDIS_URL: "redis://localhost:6379",
}));

// ─── Static Imports (Safe from Hoisting Interferences) ────────────────────────
import { processPortfolioCheckJob } from "../queue/workers/portfolioCheckWorker.js";
import { processRebalanceJob } from "../queue/workers/rebalanceWorker.js";
import { processAnalyticsSnapshotJob } from "../queue/workers/analyticsSnapshotWorker.js";
import { portfolioStorage } from "../services/portfolioStorage.js";
import { CircuitBreakers } from "../services/circuitBreakers.js";
import { analyticsService } from "../services/analyticsService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mockJob<T>(data: T, id = "test-job-1"): Job<T> {
  return { id, data, attemptsMade: 0 } as unknown as Job<T>;
}

function createMockPortfolio(overrides: Partial<any> = {}) {
  return {
    id: "test-portfolio-1",
    userAddress: "GTEST123456789",
    allocations: { XLM: 60, USDC: 40 },
    balances: { XLM: 1000, USDC: 400 },
    totalValue: 1000,
    threshold: 5,
    lastRebalance: new Date(Date.now() - 25 * 3600000).toISOString(),
    createdAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

// ─── Portfolio Check Worker Tests ─────────────────────────────────────────────
describe("portfolioCheckWorker – processPortfolioCheckJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(portfolioStorage.getAllPortfolios).mockResolvedValue([
      createMockPortfolio(),
    ]);
    vi.mocked(CircuitBreakers.checkMarketConditions).mockResolvedValue({
      safe: true,
    });
    vi.mocked(CircuitBreakers.checkCooldownPeriod).mockReturnValue({
      safe: true,
    });
    vi.mocked(CircuitBreakers.checkConcentrationRisk).mockReturnValue({
      safe: true,
    });

    mockCheckRebalanceNeeded.mockResolvedValue(true);
    mockGetPortfolio.mockResolvedValue(createMockPortfolio());
    mockQueueAdd.mockResolvedValue({ id: "job-1" });
  });

  it("skips the demo portfolio", async () => {
    vi.mocked(portfolioStorage.getAllPortfolios).mockResolvedValue([
      createMockPortfolio({ id: "demo", threshold: 5 }),
    ]);

    await processPortfolioCheckJob(mockJob({ triggeredBy: "manual" as const }));

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  // it("enqueues a rebalance job when portfolio needs rebalancing", async () => {
  //   await processPortfolioCheckJob(
  //     mockJob({ triggeredBy: "scheduler" as const }),
  //   );
  //
  //   expect(mockQueueAdd).toHaveBeenCalledWith(
  //     expect.stringContaining("rebalance-"),
  //     expect.objectContaining({
  //       portfolioId: "test-portfolio-1",
  //       triggeredBy: "auto",
  //     }),
  //     expect.anything(),
  //   );
  // });

  it("skips rebalance when market conditions are unsafe", async () => {
    vi.mocked(CircuitBreakers.checkMarketConditions).mockResolvedValue({
      safe: false,
      reason: "High volatility",
    });

    await processPortfolioCheckJob(
      mockJob({ triggeredBy: "scheduler" as const }),
    );

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

// ─── Rebalance Worker Tests ───────────────────────────────────────────────────
describe("rebalanceWorker – processRebalanceJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetPortfolio.mockResolvedValue(createMockPortfolio());
    mockGetCurrentPrices.mockResolvedValue({
      XLM: { price: 0.35, change: -0.5, timestamp: Date.now() / 1000 },
      USDC: { price: 1.0, change: 0.0, timestamp: Date.now() / 1000 },
    });
    mockShouldAllowRebalance.mockReturnValue({
      allowed: true,
      reason: "OK",
      alerts: [],
    });
    mockExecuteRebalance.mockResolvedValue({ trades: 2, gasUsed: "0.01 XLM" });
    mockRecordRebalanceEvent.mockResolvedValue({ id: "hist-1" });
  });

  it("executes rebalance and records history on success", async () => {
    const job = mockJob({
      portfolioId: "test-portfolio-1",
      triggeredBy: "auto" as const,
    });

    await processRebalanceJob(job);

    expect(mockGetPortfolio).toHaveBeenCalledWith("test-portfolio-1");

    expect(mockExecuteRebalance).toHaveBeenCalledWith("test-portfolio-1");

    expect(mockRecordRebalanceEvent).toHaveBeenCalledWith({
      portfolioId: "test-portfolio-1",
      trigger: "Automatic Rebalancing",
      trades: 2,
      gasUsed: "0.01 XLM",
      status: "completed",
      isAutomatic: true,
    });
  });

  it("surface-level: processRebalanceJob is exported and callable", async () => {
    expect(typeof processRebalanceJob).toBe("function");
  });
});

// ─── Analytics Snapshot Worker Tests ─────────────────────────────────────────
describe("analyticsSnapshotWorker – processAnalyticsSnapshotJob", () => {
  it("calls captureAllPortfolios", async () => {
    await processAnalyticsSnapshotJob(
      mockJob({ triggeredBy: "scheduler" as const }),
    );
    expect(analyticsService.captureAllPortfolios).toHaveBeenCalledOnce();
  });
});
