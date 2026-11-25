import { describe, expect, it, jest } from '@jest/globals';
import type { CoreConfigService } from '@packages/config/index.js';
import type { HttpClientContract } from '@packages/http-client/index.js';
import { DomainEventBusService } from '@packages/kernel/index.js';
import type { INotificationsPublicService } from '@modules/notifications/contracts/index.js';
import type { AlertEventEntity } from '@modules/metrics-ops/entities/alert-event.entity.js';
import type { AlertRuleEntity } from '@modules/metrics-ops/entities/alert-rule.entity.js';
import {
  buildAlertFingerprint,
  compareMetric,
  resolveAlertChannels,
} from '@modules/metrics-ops/helpers/alert-rule-eval.helper.js';
import { AlertDispatcherService } from '@modules/metrics-ops/services/alert-dispatcher.service.js';
import { AlertEvaluatorService } from '@modules/metrics-ops/services/alert-evaluator.service.js';

describe('12.3 Alert Rules Engine & Severity Dispatch Unit Tests', () => {
  it('evaluates operators, fingerprints, and default severity channel mappings', () => {
    expect(compareMetric(10, 'gt', 5)).toBe(true);
    expect(compareMetric(5, 'gt', 5)).toBe(false);
    expect(compareMetric(5, 'gte', 5)).toBe(true);
    expect(compareMetric(3, 'lt', 5)).toBe(true);
    expect(compareMetric(5, 'lte', 5)).toBe(true);

    expect(buildAlertFingerprint('CPU_HIGH', { instance: 'api-1', runtime: 'api' })).toBe(
      'CPU_HIGH|instance=api-1,runtime=api',
    );
    expect(resolveAlertChannels('INFO', null)).toEqual(['log', 'domain_event']);
    expect(resolveAlertChannels('WARNING', null)).toEqual(['log', 'webhook', 'domain_event']);
    expect(resolveAlertChannels('CRITICAL', null)).toEqual([
      'log',
      'webhook',
      'notification',
      'domain_event',
    ]);
  });

  it('dispatches CRITICAL alerts to webhook, notifications, and DomainEventBus with HMAC signature', async () => {
    const config = {
      metrics: {
        alerts: {
          enabled: true,
          evaluateMs: 30_000,
          defaultCooldownSec: 300,
          webhookTimeoutMs: 3000,
          webhookSecret: 'super-secret',
          webhooks: {
            info: '',
            warning: 'https://hooks.example.com/warn',
            critical: 'https://hooks.example.com/crit',
          },
          notifyRoleCodes: ['SUPER_ADMIN'],
          notifyUserIds: [1],
          notifyChannels: ['IN_APP', 'EMAIL'],
        },
      },
    } as unknown as CoreConfigService;

    const httpClient = {
      post: jest.fn(async () => ({ status: 200, data: { ok: true } })),
    } as unknown as HttpClientContract;

    const notifications = {
      dispatch: jest.fn(async () => ({ id: 99 })),
    } as unknown as INotificationsPublicService;

    const eventBus = new DomainEventBusService();
    const publishedTypes: string[] = [];
    eventBus.registerHandler({
      id: 'test.alert.listener',
      module: 'metrics-ops',
      eventPattern: 'metrics.alert.*',
      handler: (evt) => {
        publishedTypes.push(evt.metadata.dotName);
      },
    });

    const dispatcher = new AlertDispatcherService(config, httpClient, notifications, eventBus);
    const results = await dispatcher.dispatch({
      kind: 'fired',
      eventId: 42,
      ruleId: 1,
      ruleCode: 'SYS_HTTP_ERROR_RATE_HIGH',
      ruleName: 'High 5xx rate',
      fingerprint: 'SYS_HTTP_ERROR_RATE_HIGH|module=users,version=1.0.0',
      severity: 'CRITICAL',
      metricKey: 'http.error_rate',
      metricValue: 12.5,
      threshold: 5,
      operator: 'gt',
      labels: { module: 'users', version: '1.0.0' },
      summary: '[CRITICAL] High 5xx rate: 12.5%',
    });

    expect(results.every((r) => r.status === 'sent')).toBe(true);
    expect(httpClient.post).toHaveBeenCalledTimes(1);
    const [, , reqOpts] = (httpClient.post as jest.Mock).mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    expect(reqOpts.headers['X-Alert-Severity']).toBe('CRITICAL');
    expect(reqOpts.headers['X-Alert-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(notifications.dispatch).toHaveBeenCalledTimes(2); // 1 for userIds, 1 for roleCodes
    expect(publishedTypes).toEqual(['metrics.alert.fired']);
  });

  it('handles forSeconds sustain window, cooldown dedup, and auto-resolve in AlertEvaluatorService', async () => {
    const rule = {
      id: 10,
      code: 'CPU_HIGH',
      name: 'CPU High',
      description: null,
      isEnabled: true,
      metricKey: 'runtime.cpu_percent',
      scopeJson: null,
      operator: 'gt',
      threshold: 80,
      windowSeconds: 300,
      forSeconds: 60,
      cooldownSeconds: 300,
      severity: 'WARNING',
      channelsJson: JSON.stringify(['log', 'domain_event']),
      webhookUrl: null,
      notifyTargetsJson: null,
      isSystem: false,
      lastEvaluatedAt: null,
      lastTriggeredAt: null,
      createdBy: null,
      updatedBy: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as unknown as AlertRuleEntity;

    const eventsStore: AlertEventEntity[] = [];
    let nextId = 1;
    let currentCpu = 92;

    const ruleRepo = {
      isDatabaseReady: () => true,
      listEnabled: jest.fn(async () => [rule]),
      saveEntity: jest.fn(async (e: AlertRuleEntity) => e),
    };
    const eventRepo = {
      listOpenEvents: jest.fn(async () => eventsStore.filter((e) => e.status !== 'RESOLVED')),
      saveEntity: jest.fn(async (e: Partial<AlertEventEntity>) => {
        if (!e.id) {
          const created = {
            id: nextId++,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            lastNotifiedAt: null,
            acknowledgedAt: null,
            acknowledgedBy: null,
            acknowledgeNote: null,
            resolvedAt: null,
            resolvedBy: null,
            deliveryStatusJson: null,
            ...e,
          } as AlertEventEntity;
          eventsStore.push(created);
          return created;
        }
        return e as AlertEventEntity;
      }),
    };
    const collector = {
      sampleMetricForRule: jest.fn(async () => [
        { value: currentCpu, labels: { runtime: 'api', instance: 'api-1', version: '1.0.0' } },
      ]),
    };
    const dispatcher = {
      dispatch: jest.fn(async () => [
        { channel: 'log' as const, status: 'sent' as const, at: new Date().toISOString() },
      ]),
    };
    const txManager = {
      runInTransaction: async <T>(fn: () => Promise<T>) => fn(),
    };
    const config = {
      isTest: true,
      metrics: { alerts: { enabled: false, evaluateMs: 30_000 } },
    } as unknown as CoreConfigService;

    const evaluator = new AlertEvaluatorService(
      config,
      ruleRepo as never,
      eventRepo as never,
      {} as never,
      collector as never,
      dispatcher as never,
      txManager as never,
    );

    const t0 = 1_700_000_000_000;
    // t=0s: exceeds threshold, starts sustain window (forSeconds=60) -> does NOT fire yet
    const r1 = await evaluator.evaluateAll(t0);
    expect(r1.firedNew).toBe(0);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();

    // t=70s: sustained > 60s -> fires new alert
    const r2 = await evaluator.evaluateAll(t0 + 70_000);
    expect(r2.firedNew).toBe(1);
    expect(eventsStore).toHaveLength(1);
    expect(eventsStore[0]?.status).toBe('FIRING');
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    // t=120s: still firing, inside cooldown (300s) -> does NOT renotify
    const r3 = await evaluator.evaluateAll(t0 + 120_000);
    expect(r3.firedNew).toBe(0);
    expect(r3.renotified).toBe(0);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);

    // t=400s: CPU recovered -> auto-resolves & dispatches resolved event
    currentCpu = 40;
    const r4 = await evaluator.evaluateAll(t0 + 400_000);
    expect(r4.autoResolved).toBe(1);
    expect(eventsStore[0]?.status).toBe('RESOLVED');
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
    expect((dispatcher.dispatch as jest.Mock).mock.calls[1]?.[0]).toMatchObject({
      kind: 'resolved',
    });
  });
});
