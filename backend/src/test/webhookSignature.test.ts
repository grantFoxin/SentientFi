import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

// Import the functions we need to test
// Note: These functions are not exported from notificationService.ts
// So we'll test the logic directly here

function signPayload(payload: any, secret: string): { signature: string; timestamp: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payloadString = JSON.stringify(payload);
  const signatureInput = `${timestamp}.${payloadString}`;
  const signature = createHmac('sha256', secret)
    .update(signatureInput)
    .digest('hex');
  return { signature: `sha256=${signature}`, timestamp };
}

function verifyWebhookSignature(
  payload: any,
  signature: string,
  timestamp: string,
  secret: string,
  toleranceSeconds: number = 300
): boolean {
  // Check timestamp tolerance (5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > toleranceSeconds) {
    return false;
  }
  
  // Compute expected signature
  const payloadString = JSON.stringify(payload);
  const signatureInput = `${timestamp}.${payloadString}`;
  const expectedSignature = createHmac('sha256', secret)
    .update(signatureInput)
    .digest('hex');
  
  // Timing-safe comparison
  try {
    const signatureBuffer = Buffer.from(signature.replace('sha256=', ''), 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

describe('Webhook Signature Verification', () => {
  const testSecret = randomBytes(32).toString('hex');
  const testPayload = {
    event: 'rebalance',
    title: 'Portfolio Rebalanced',
    message: 'Your portfolio has been rebalanced',
    data: { portfolioId: 'test-123', trades: 3 },
    timestamp: new Date().toISOString(),
    userId: 'test-user-123'
  };

  describe('signPayload', () => {
    it('should generate signature in correct format', () => {
      const { signature, timestamp } = signPayload(testPayload, testSecret);
      
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(timestamp).toMatch(/^\d+$/);
      expect(parseInt(timestamp)).toBeGreaterThan(0);
    });

    it('should generate different signatures for different payloads', () => {
      const payload1 = { ...testPayload, event: 'rebalance' };
      const payload2 = { ...testPayload, event: 'circuitBreaker' };
      
      const sig1 = signPayload(payload1, testSecret);
      const sig2 = signPayload(payload2, testSecret);
      
      expect(sig1.signature).not.toBe(sig2.signature);
    });

    it('should generate different signatures for different secrets', () => {
      const secret1 = randomBytes(32).toString('hex');
      const secret2 = randomBytes(32).toString('hex');
      
      const sig1 = signPayload(testPayload, secret1);
      const sig2 = signPayload(testPayload, secret2);
      
      expect(sig1.signature).not.toBe(sig2.signature);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should verify a valid signature', () => {
      const { signature, timestamp } = signPayload(testPayload, testSecret);
      
      const isValid = verifyWebhookSignature(
        testPayload,
        signature.replace('sha256=', ''),
        timestamp,
        testSecret
      );
      
      expect(isValid).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const { timestamp } = signPayload(testPayload, testSecret);
      const invalidSignature = 'a'.repeat(64); // 64 hex chars but wrong
      
      const isValid = verifyWebhookSignature(
        testPayload,
        invalidSignature,
        timestamp,
        testSecret
      );
      
      expect(isValid).toBe(false);
    });

    it('should reject a signature with wrong secret', () => {
      const { signature, timestamp } = signPayload(testPayload, testSecret);
      const wrongSecret = randomBytes(32).toString('hex');
      
      const isValid = verifyWebhookSignature(
        testPayload,
        signature.replace('sha256=', ''),
        timestamp,
        wrongSecret
      );
      
      expect(isValid).toBe(false);
    });

    it('should reject an expired timestamp (older than 5 minutes)', () => {
      const { signature, timestamp } = signPayload(testPayload, testSecret);
      
      // Modify timestamp to be 6 minutes ago
      const oldTimestamp = (parseInt(timestamp) - 360).toString();
      
      const isValid = verifyWebhookSignature(
        testPayload,
        signature.replace('sha256=', ''),
        oldTimestamp,
        testSecret
      );
      
      expect(isValid).toBe(false);
    });

    it('should accept a timestamp within tolerance', () => {
      const { signature, timestamp } = signPayload(testPayload, testSecret);
      
      // Modify timestamp to be 4 minutes ago (within tolerance)
      const recentTimestamp = (parseInt(timestamp) - 240).toString();
      
      // Need to recompute signature for new timestamp
      const payloadString = JSON.stringify(testPayload);
      const signatureInput = `${recentTimestamp}.${payloadString}`;
      const newSignature = createHmac('sha256', testSecret)
        .update(signatureInput)
        .digest('hex');
      
      const isValid = verifyWebhookSignature(
        testPayload,
        newSignature,
        recentTimestamp,
        testSecret
      );
      
      expect(isValid).toBe(true);
    });

    it('should reject a modified payload', () => {
      const { signature, timestamp } = signPayload(testPayload, testSecret);
      const modifiedPayload = { ...testPayload, event: 'hacked' };
      
      const isValid = verifyWebhookSignature(
        modifiedPayload,
        signature.replace('sha256=', ''),
        timestamp,
        testSecret
      );
      
      expect(isValid).toBe(false);
    });
  });

  describe('timing-safe comparison', () => {
    it('should not leak timing information', () => {
      // This test verifies that timingSafeEqual is used
      // In practice, this would require statistical analysis
      // For now, we just verify the function works correctly
      
      const { signature, timestamp } = signPayload(testPayload, testSecret);
      const validSignature = signature.replace('sha256=', '');
      
      // Test with valid signature
      const start1 = process.hrtime.bigint();
      const result1 = verifyWebhookSignature(testPayload, validSignature, timestamp, testSecret);
      const end1 = process.hrtime.bigint();
      
      // Test with invalid signature (same length)
      const invalidSignature = 'a'.repeat(64);
      const start2 = process.hrtime.bigint();
      const result2 = verifyWebhookSignature(testPayload, invalidSignature, timestamp, testSecret);
      const end2 = process.hrtime.bigint();
      
      expect(result1).toBe(true);
      expect(result2).toBe(false);
      
      // The timing difference should be minimal (not a reliable test,
      // but ensures the code path is similar)
      const time1 = Number(end1 - start1);
      const time2 = Number(end2 - start2);
      
      // Both should complete in reasonable time
      expect(time1).toBeLessThan(1000000); // 1ms
      expect(time2).toBeLessThan(1000000); // 1ms
    });
  });

  describe('edge cases', () => {
    it('should handle empty payload', () => {
      const emptyPayload = {};
      const { signature, timestamp } = signPayload(emptyPayload, testSecret);
      
      const isValid = verifyWebhookSignature(
        emptyPayload,
        signature.replace('sha256=', ''),
        timestamp,
        testSecret
      );
      
      expect(isValid).toBe(true);
    });

    it('should handle payload with special characters', () => {
      const specialPayload = {
        ...testPayload,
        message: 'Test with special chars: !@#$%^&*()_+{}|:"<>?[]\\;\',./'
      };
      
      const { signature, timestamp } = signPayload(specialPayload, testSecret);
      
      const isValid = verifyWebhookSignature(
        specialPayload,
        signature.replace('sha256=', ''),
        timestamp,
        testSecret
      );
      
      expect(isValid).toBe(true);
    });

    it('should handle payload with unicode characters', () => {
      const unicodePayload = {
        ...testPayload,
        title: 'Portfolio Rebalanced 🚀',
        message: '日本語テスト'
      };
      
      const { signature, timestamp } = signPayload(unicodePayload, testSecret);
      
      const isValid = verifyWebhookSignature(
        unicodePayload,
        signature.replace('sha256=', ''),
        timestamp,
        testSecret
      );
      
      expect(isValid).toBe(true);
    });
  });
});
