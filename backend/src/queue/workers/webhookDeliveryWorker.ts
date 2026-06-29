import { Worker, Job } from 'bullmq'
import { getConnectionOptions } from '../connection.js'
import { dbUpdateWebhookDeliveryStatus } from '../../db/notificationDb.js'
import { logger } from '../../utils/logger.js'
import type { WebhookDeliveryJobData } from '../queues.js'

let worker: Worker | null = null

const TIMEOUT_MS = 5000

export async function processWebhookDeliveryJob(
    job: Job<WebhookDeliveryJobData>
): Promise<void> {
    const { eventId, url, payload, webhookSecret, attempt } = job.data

    logger.info('[WORKER:webhook-delivery] Attempting webhook delivery', {
        jobId: job.id,
        eventId,
        attempt: attempt + 1,
        url,
    })

    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'StellarPortfolioRebalancer/1.0',
            'X-SentientFi-Event-Id': eventId,
        }

        if (webhookSecret) {
            const { createHmac } = await import('crypto')
            const timestamp = Math.floor(Date.now() / 1000).toString()
            const payloadString = JSON.stringify(payload)
            const signatureInput = `${timestamp}.${eventId}.${payloadString}`
            const signature = createHmac('sha256', webhookSecret)
                .update(signatureInput)
                .digest('hex')
            headers['X-Webhook-Signature'] = `sha256=${signature}`
            headers['X-Webhook-Timestamp'] = timestamp
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
            throw new Error(`Webhook returned status ${response.status}`)
        }

        dbUpdateWebhookDeliveryStatus(eventId, 'delivered', attempt + 1)

        logger.info('[WORKER:webhook-delivery] Webhook delivered successfully', {
            eventId,
            attempt: attempt + 1,
        })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        dbUpdateWebhookDeliveryStatus(eventId, 'failed', attempt + 1)

        logger.error('[WORKER:webhook-delivery] Webhook delivery failed', {
            eventId,
            attempt: attempt + 1,
            error: errorMessage,
        })

        // BullMQ will handle retry based on job options
        throw error
    }
}

export function startWebhookDeliveryWorker(): Worker | null {
    try {
        worker = new Worker('webhook-delivery', processWebhookDeliveryJob, {
            connection: getConnectionOptions(),
            concurrency: 3,
            limiter: {
                max: 10,
                duration: 60000,
            },
        })

        worker.on('completed', (job) => {
            logger.info('[WORKER:webhook-delivery] Job completed', {
                jobId: job.id,
                eventId: job.data.eventId,
            })
        })

        worker.on('failed', (job, err) => {
            logger.error('[WORKER:webhook-delivery] Job failed', {
                jobId: job?.id,
                eventId: job?.data.eventId,
                error: err.message,
            })
        })

        logger.info('[WORKER:webhook-delivery] Worker started')
        return worker
    } catch (error) {
        logger.error('[WORKER:webhook-delivery] Failed to start worker', {
            error: error instanceof Error ? error.message : String(error),
        })
        return null
    }
}

export async function stopWebhookDeliveryWorker(): Promise<void> {
    if (worker) {
        await worker.close()
        worker = null
        logger.info('[WORKER:webhook-delivery] Worker stopped')
    }
}
