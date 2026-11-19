import { afterEach, describe, expect, it } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BaseHttpClientProvider,
  CircuitBreakerRegistry,
  HttpClientManageableAdapter,
  HttpClientMetricsService,
  HttpServiceRegistry,
  HttpStatusError,
} from '@packages/http-client/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { CorePackageId, PackageStatus } from '@packages/kernel/index.js';
import { HttpClientOpsController } from '@modules/http-client-ops/controllers/http-client-ops.controller.js';
import {
  HttpClientServiceNotFoundException,
  HttpClientOpsValidationException,
} from '@modules/http-client-ops/exceptions/http-client-ops.exceptions.js';
import { HttpClientOpsService } from '@modules/http-client-ops/services/http-client-ops.service.js';

const originalFetch = globalThis.fetch;

function setupOpsHarness() {
  const config = new CoreConfigService();
  const i18n = new CoreI18nService();
  const registry = new HttpServiceRegistry(config);
  const circuitBreaker = new CircuitBreakerRegistry();
  const metrics = new HttpClientMetricsService();
  const client = new BaseHttpClientProvider(registry, circuitBreaker, metrics, config);
  const opsService = new HttpClientOpsService(registry, circuitBreaker, metrics, config, i18n);
  const controller = new HttpClientOpsController(opsService);
  const adapter = new HttpClientManageableAdapter(registry, circuitBreaker, metrics, config, i18n);
  return { config, registry, circuitBreaker, metrics, client, opsService, controller, adapter };
}

describe('Phase 10.1 — HttpClientOpsModule & HttpClientManageableAdapter', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports overview, services, circuits, redacted config and resets open circuits', async () => {
    const { registry, client, controller, adapter } = setupOpsHarness();

    expect((await adapter.getStatus()).status).toBe(PackageStatus.IDLE);

    registry.registerService('payment-gateway', {
      baseUrl: 'https://api.stripe.com/v1?api_key=sk_live_999',
      timeoutMs: 3_000,
      defaultHeaders: { Authorization: 'Bearer sk_live_secret_token' },
      retry: { maxRetries: 0 },
      circuitBreaker: { enabled: true, failureThreshold: 2, resetTimeoutMs: 60_000 },
    });

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'service unavailable' }), {
        status: 503,
      })) as typeof fetch;

    const svcClient = client.forService('payment-gateway');
    await expect(svcClient.get('/charges')).rejects.toBeInstanceOf(HttpStatusError);
    await expect(svcClient.get('/charges')).rejects.toBeInstanceOf(HttpStatusError);

    const overview = controller.overview();
    expect(overview.status).toBe('error');
    expect(overview.totals.openCircuits).toBe(1);
    expect(overview.totals.totalRequests).toBe(2);
    expect(overview.services[0]?.service).toBe('payment-gateway');
    expect(overview.services[0]?.circuit.state).toBe('OPEN');
    expect(overview.recentErrors.length).toBeGreaterThan(0);

    const safeCfg = controller.config();
    const svcCfg = safeCfg.configuredServices.find((s) => s.name === 'payment-gateway');
    expect(svcCfg?.baseUrl).not.toContain('sk_live_999');
    expect(svcCfg?.defaultHeaders['Authorization']).toBe('[REDACTED]');

    // Manageable adapter shows ERROR while circuit is OPEN, then resets via action
    expect((await adapter.getStatus()).status).toBe(PackageStatus.ERROR);
    expect(adapter.getActions().some((a) => a.id === 'reset-all-circuits')).toBe(true);

    const resetOneRes = controller.resetCircuit('payment-gateway');
    expect(resetOneRes.reset).toBe(true);
    expect(resetOneRes.state).toBe('CLOSED');

    expect(controller.overview().totals.openCircuits).toBe(0);
    expect(controller.circuits()[0]?.state).toBe('CLOSED');

    // Trip again and reset via ManageableAdapter action
    await expect(svcClient.get('/charges')).rejects.toBeInstanceOf(HttpStatusError);
    await expect(svcClient.get('/charges')).rejects.toBeInstanceOf(HttpStatusError);
    const actionRes = await adapter.executeAction('reset-all-circuits');
    expect(actionRes.success).toBe(true);
    expect(controller.overview().totals.openCircuits).toBe(0);

    const resetAllRes = controller.resetAllCircuits();
    expect(resetAllRes.resetCount).toBe(0);

    const pkgStatus = await adapter.getStatus();
    expect(adapter.packageId).toBe(CorePackageId.HTTP_CLIENT);
    expect(pkgStatus.status).toBe(PackageStatus.WARNING);
  });

  it('throws 404 when resetting unknown service and validates limit query', () => {
    const { controller } = setupOpsHarness();
    expect(() => controller.resetCircuit('non-existent-service')).toThrow(
      HttpClientServiceNotFoundException,
    );
    expect(() => controller.errors({ limit: '0' })).toThrow(HttpClientOpsValidationException);
  });
});
