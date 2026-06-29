import { WebSocketServer } from "ws";
import { StellarService } from "./stellar.js";
import { ReflectorService } from "./reflector.js";
import { rebalanceHistoryService } from "./serviceContainer.js";
import { portfolioStorage } from "./portfolioStorage.js";
import { CircuitBreakers } from "./circuitBreakers.js";
import { notificationService } from "./notificationService.js";
import { logger } from "../utils/logger.js";
import { getPortfolioCheckQueue } from "../queue/queues.js";
import { isRedisAvailable } from "../queue/connection.js";

export class AutoRebalancerService {
  private stellarService: StellarService;
  private reflectorService: ReflectorService;
  private isRunning = false;
  private wss: WebSocketServer | null = null;

  // Configuration (kept for getStatus() compatibility)
  private readonly CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes
  private readonly MIN_REBALANCE_INTERVAL = 24 * 60 * 60 * 1000;
  private readonly MAX_AUTO_REBALANCES_PER_DAY = 3;

  constructor() {
    this.stellarService = new StellarService();
    this.reflectorService = new ReflectorService();
  }

  /**
   * Start the automatic monitoring service.
   * With BullMQ, this just flags the service as running – the scheduler
   * already registered the repeatable job. We also enqueue an immediate
   * check so the first run happens without waiting 30 min.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("[AUTO-REBALANCER] Already running");
      return;
    }

    this.isRunning = true;
    logger.info("[AUTO-REBALANCER] Service started (queue-backed)");

    const redisUp = await isRedisAvailable();
    if (redisUp) {
      const queue = getPortfolioCheckQueue();
      if (queue) {
        // Fix Root Cause 1: Use a deterministic jobId to prevent overlapping startup states
        await queue.add(
          "startup-portfolio-check",
          { triggeredBy: "startup" },
          {
            jobId: "rebalancer-startup-singleton",
            priority: 1,
            removeOnComplete: true, // Allows the job ID to clear out once done
            removeOnFail: true,
          },
        );
        logger.info("[AUTO-REBALANCER] Enqueued startup portfolio-check job");
      }
    } else {
      logger.warn(
        "[AUTO-REBALANCER] Redis not available – startup check skipped",
      );
    }
  }
  /**
   * Stop the service flag (workers are stopped separately by index.ts).
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    logger.info("[AUTO-REBALANCER] Service stopped");
  }

  /**
   * Force an immediate check of all portfolios.
   */
  async forceCheck(): Promise<boolean> {
    const queue = getPortfolioCheckQueue();
    if (!queue) throw new Error("Redis unavailable – cannot force check");

    const job = await queue.add(
      "force-portfolio-check",
      { triggeredBy: "manual" },
      {
        jobId: "rebalancer-manual-singleton",
        priority: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    logger.info(
      `[AUTO-REBALANCER] Force check job handled (Job ID: ${job.id})`,
    );
    return true;
  }

  /**
   * Get service status
   */
  getStatus(): {
    isRunning: boolean;
    checkInterval: number;
    minRebalanceInterval: number;
    maxRebalancesPerDay: number;
    backend: string;
  } {
    return {
      isRunning: this.isRunning,
      checkInterval: this.CHECK_INTERVAL,
      minRebalanceInterval: this.MIN_REBALANCE_INTERVAL,
      maxRebalancesPerDay: this.MAX_AUTO_REBALANCES_PER_DAY,
      backend: "bullmq",
    };
  }

  /**
   * Get statistics about auto-rebalancing activity
   */
  async getStatistics(): Promise<{
    totalAutoRebalances: number;
    rebalancesToday: number;
    lastCheckTime: string | null;
    averageRebalancesPerDay: number;
  }> {
    try {
      const allAutoRebalances =
        await rebalanceHistoryService.getAllAutoRebalances();

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayRebalances = allAutoRebalances.filter(
        (r) => new Date(r.timestamp) >= today,
      );

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentRebalances = allAutoRebalances.filter(
        (r) => new Date(r.timestamp) >= thirtyDaysAgo,
      );

      return {
        totalAutoRebalances: allAutoRebalances.length,
        rebalancesToday: todayRebalances.length,
        lastCheckTime: new Date().toISOString(),
        averageRebalancesPerDay: recentRebalances.length / 30,
      };
    } catch (error) {
      logger.error("[AUTO-REBALANCER] Error getting statistics", { error });
      return {
        totalAutoRebalances: 0,
        rebalancesToday: 0,
        lastCheckTime: null,
        averageRebalancesPerDay: 0,
      };
    }
  }

  /**
   * Inject the WebSocket server so portfolio events can be pushed to clients.
   * Called from index.ts once wss is available.
   */
  setWss(wss: WebSocketServer): void {
    this.wss = wss;
  }

  /**
   * Returns true once setWss() has been called.
   */
  hasWss(): boolean {
    return this.wss !== null;
  }

  // ─── WebSocket broadcasting ──────────────────────────────────────────────

  /**
   * Push a portfolio-specific event to all connected WebSocket clients.
   */
  notifyClients(
    portfolioId: string,
    event: string,
    data: Record<string, unknown> = {},
  ): void {
    if (!this.wss) return;
    const message = JSON.stringify({
      type: "portfolio_update",
      portfolioId,
      event,
      data,
      timestamp: new Date().toISOString(),
    });
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(message);
    });
    logger.info(
      `[AUTO-REBALANCER] Pushed "${event}" event to WebSocket clients`,
      { portfolioId },
    );
  }

  /**
   * Broadcast a market-wide event to all connected WebSocket clients.
   */
  broadcastToAllClients(
    event: string,
    data: Record<string, unknown> = {},
  ): void {
    if (!this.wss) return;
    const message = JSON.stringify({
      type: "market_update",
      event,
      data,
      timestamp: new Date().toISOString(),
    });
    this.wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(message);
    });
    logger.info(
      `[AUTO-REBALANCER] Broadcast "${event}" to all WebSocket clients`,
    );
  }
}
