import { Queue } from 'bullmq'
import { getConnectionOptions } from './connection.js'
import { logger } from '../utils/logger.js'

// ─── Queue Names ─────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
    PORTFOLIO_CHECK: 'portfolio-check',
    REBALANCE: 'rebalance',
    ANALYTICS_SNAPSHOT: 'analytics-snapshot',
    WEBHOOK_DELIVERY: 'webhook-delivery',
} as const

// ─── Job Data Types ───────────────────────────────────────────────────────────

export interface PortfolioCheckJobData {
    triggeredBy?: 'scheduler' | 'manual' | 'startup'
}

export interface RebalanceJobData {
    portfolioId: string
    triggeredBy?: 'auto' | 'manual' | 'force'
}

export interface AnalyticsSnapshotJobData {
    triggeredBy?: 'scheduler' | 'manual' | 'startup'
}

export interface WebhookDeliveryJobData {
    eventId: string
    url: string
    payload: any
    webhookSecret?: string
    attempt: number
}

// ─── Singleton Queues ─────────────────────────────────────────────────────────

let portfolioCheckQueue: Queue<PortfolioCheckJobData> | null = null
let rebalanceQueue: Queue<RebalanceJobData> | null = null
let analyticsSnapshotQueue: Queue<AnalyticsSnapshotJobData> | null = null
let webhookDeliveryQueue: Queue<WebhookDeliveryJobData> | null = null

function getDefaultJobOptions() {
    return {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
        attempts: 5,
        backoff: {
            type: 'exponential' as const,
            delay: 5000, // 5s → 10s → 20s → 40s → 80s
        },
    }
}

export function getPortfolioCheckQueue(): Queue<PortfolioCheckJobData> | null {
    try {
        if (!portfolioCheckQueue) {
            portfolioCheckQueue = new Queue(QUEUE_NAMES.PORTFOLIO_CHECK, {
                connection: getConnectionOptions(),
                defaultJobOptions: getDefaultJobOptions(),
            })
            logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.PORTFOLIO_CHECK}`)
        }
        return portfolioCheckQueue
    } catch {
        return null
    }
}

export function getRebalanceQueue(): Queue<RebalanceJobData> | null {
    try {
        if (!rebalanceQueue) {
            rebalanceQueue = new Queue(QUEUE_NAMES.REBALANCE, {
                connection: getConnectionOptions(),
                defaultJobOptions: getDefaultJobOptions(),
            })
            logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.REBALANCE}`)
        }
        return rebalanceQueue
    } catch {
        return null
    }
}

export function getAnalyticsSnapshotQueue(): Queue<AnalyticsSnapshotJobData> | null {
    try {
        if (!analyticsSnapshotQueue) {
            analyticsSnapshotQueue = new Queue(QUEUE_NAMES.ANALYTICS_SNAPSHOT, {
                connection: getConnectionOptions(),
                defaultJobOptions: getDefaultJobOptions(),
            })
            logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.ANALYTICS_SNAPSHOT}`)
        }
        return analyticsSnapshotQueue
    } catch {
        return null
    }
}

export function getWebhookDeliveryQueue(): Queue<WebhookDeliveryJobData> | null {
    try {
        if (!webhookDeliveryQueue) {
            webhookDeliveryQueue = new Queue(QUEUE_NAMES.WEBHOOK_DELIVERY, {
                connection: getConnectionOptions(),
                defaultJobOptions: {
                    removeOnComplete: { count: 50 },
                    removeOnFail: { count: 100 },
                    attempts: 4,
                    backoff: {
                        type: 'exponential' as const,
                        delay: 10000,
                    },
                },
            })
            logger.info(`[QUEUE] Created queue: ${QUEUE_NAMES.WEBHOOK_DELIVERY}`)
        }
        return webhookDeliveryQueue
    } catch {
        return null
    }
}

// ─── Graceful Close ───────────────────────────────────────────────────────────

export async function closeAllQueues(): Promise<void> {
    await Promise.all([
        portfolioCheckQueue?.close(),
        rebalanceQueue?.close(),
        analyticsSnapshotQueue?.close(),
        webhookDeliveryQueue?.close(),
    ])
    portfolioCheckQueue = null
    rebalanceQueue = null
    analyticsSnapshotQueue = null
    webhookDeliveryQueue = null
    logger.info('[QUEUE] All queues closed')
}
