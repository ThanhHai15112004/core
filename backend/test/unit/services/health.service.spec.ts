import { describe, it, expect } from '@jest/globals';
import { HealthService } from '@modules/health/services/health.service.js';

describe('HealthService Unit Tests', () => {
  it('should return ok status with valid uptime and timestamp', () => {
    const service = new HealthService();
    const result = service.check();

    expect(result.status).toBe('ok');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });
});
