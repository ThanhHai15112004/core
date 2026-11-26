import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { applyTestEnv } from '../../fixtures/env.fixture.js';
import { mockRedisFactory } from '../../concerns/test-app.concern.js';
import { CoreConfigService } from '@packages/config/index.js';
import { SettingRegistryService } from '@packages/kernel/index.js';
import { MetricsRegistryService, PrometheusQueryClient } from '@packages/metrics/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  RUNTIME_CPU_PERCENT_METRIC,
  RUNTIME_MEMORY_LIMIT_BYTES_METRIC,
  RUNTIME_MEMORY_PERCENT_METRIC,
  RUNTIME_MEMORY_RSS_BYTES_METRIC,
  RuntimeAgentService,
  evaluateAutoscalingDbImpact,
  evaluateAutoscalingDecision,
  renderKubernetesHpaYaml,
  type AutoscalingWorkloadPolicy,
} from '@packages/runtime/index.js';
import { AUTOSCALING_SETTING_KEYS } from '@modules/runtimes/index.js';
import { resolveAutoscalingConfig } from '@modules/runtimes/helpers/autoscaling-config.helper.js';
import {
  QUEUE_ACTIVE_WORKERS_METRIC,
  QUEUE_BACKLOG_METRIC,
  QUEUE_BACKLOG_TOTAL_METRIC,
  WorkerMetricsService,
} from '@modules/worker-ops/services/worker-metrics.service.js';

const BASE_API_POLICY: AutoscalingWorkloadPolicy = {
  minReplicas: 2,
  maxReplicas: 6,
  scaleUpCooldownSec: 60,
  scaleDownCooldownSec: 300,
  scaleUpMaxStep: 2,
  scaleDownMaxStep: 1,
  targetCpuPercent: 70,
  targetMemoryPercent: 75,
  targetInFlightPerInstance: 50,
};

const BASE_WORKER_POLICY: AutoscalingWorkloadPolicy = {
  minReplicas: 1,
  maxReplicas: 5,
  scaleUpCooldownSec: 30,
  scaleDownCooldownSec: 300,
  scaleUpMaxStep: 2,
  scaleDownMaxStep: 1,
  targetCpuPercent: 75,
  targetMemoryPercent: 80,
  targetBacklogPerInstance: 40,
};

describe('Autoscaling (Phase 13.2) — Unit Tests', () => {
  const clearAutoscalingEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AUTOSCALING_')) {
        delete process.env[key];
      }
    }
  };

  beforeEach(() => {
    clearAutoscalingEnv();
    applyTestEnv({});
  });

  afterEach(() => {
    clearAutoscalingEnv();
  });

  describe('runtimeConfig() autoscaling fail-fast validation', () => {
    it('loads defaults and honors AUTOSCALING_* environment variables', () => {
      applyTestEnv({
        AUTOSCALING_API_MIN_REPLICAS: '2',
        AUTOSCALING_API_MAX_REPLICAS: '12',
        AUTOSCALING_API_SCALE_UP_COOLDOWN_SEC: '45',
        AUTOSCALING_API_SCALE_DOWN_COOLDOWN_SEC: '240',
        AUTOSCALING_WORKER_TARGET_BACKLOG: '80',
        AUTOSCALING_DB_MAX_CONNECTIONS_BUDGET: '200',
      });
      const cfg = new CoreConfigService();
      expect(cfg.runtime.autoscaling.api.minReplicas).toBe(2);
      expect(cfg.runtime.autoscaling.api.maxReplicas).toBe(12);
      expect(cfg.runtime.autoscaling.api.scaleUpCooldownSec).toBe(45);
      expect(cfg.runtime.autoscaling.api.scaleDownCooldownSec).toBe(240);
      expect(cfg.runtime.autoscaling.worker.targetBacklogPerInstance).toBe(80);
      expect(cfg.runtime.autoscaling.database.maxConnectionsBudget).toBe(200);
    });

    it('fails fast when maxReplicas < minReplicas', () => {
      applyTestEnv({
        AUTOSCALING_API_MIN_REPLICAS: '6',
        AUTOSCALING_API_MAX_REPLICAS: '3',
      });
      expect(() => new CoreConfigService()).toThrow(/AUTOSCALING_API_MAX_REPLICAS/);
    });

    it('fails fast when minReplicas < 1', () => {
      applyTestEnv({
        AUTOSCALING_WORKER_MIN_REPLICAS: '0',
      });
      expect(() => new CoreConfigService()).toThrow(/AUTOSCALING_WORKER_MIN_REPLICAS/);
    });
  });

  describe('resolveAutoscalingConfig() (.env + dynamic SettingRegistryService override)', () => {
    it('keeps .env values when settings are at manifest default, and applies explicit overrides', () => {
      applyTestEnv({
        AUTOSCALING_API_MIN_REPLICAS: '3',
        AUTOSCALING_API_MAX_REPLICAS: '9',
        AUTOSCALING_API_SCALE_DOWN_COOLDOWN_SEC: '420',
      });
      const cfg = new CoreConfigService();
      const registry = new SettingRegistryService('test');

      const fromEnv = resolveAutoscalingConfig(cfg, registry);
      expect(fromEnv.overriddenKeys).toEqual([]);
      expect(fromEnv.api.minReplicas).toBe(3);
      expect(fromEnv.api.maxReplicas).toBe(9);
      expect(fromEnv.api.scaleDownCooldownSec).toBe(420);

      // Override động qua SettingRegistryService
      registry.setGlobalValue(AUTOSCALING_SETTING_KEYS.API_MIN_REPLICAS, 4);
      registry.setGlobalValue(AUTOSCALING_SETTING_KEYS.API_MAX_REPLICAS, 2); // nhỏ hơn min -> tự nâng max = min
      registry.setGlobalValue(AUTOSCALING_SETTING_KEYS.API_SCALE_DOWN_COOLDOWN_SEC, 180);

      const overridden = resolveAutoscalingConfig(cfg, registry);
      expect(overridden.api.minReplicas).toBe(4);
      expect(overridden.api.maxReplicas).toBe(4);
      expect(overridden.api.scaleDownCooldownSec).toBe(180);
      expect(overridden.overriddenKeys).toContain(AUTOSCALING_SETTING_KEYS.API_MIN_REPLICAS);
      expect(overridden.overriddenKeys).toContain(
        AUTOSCALING_SETTING_KEYS.API_SCALE_DOWN_COOLDOWN_SEC,
      );
    });
  });

  describe('evaluateAutoscalingDecision()', () => {
    it('scales up API when in-flight requests spike, respecting scaleUpMaxStep and maxReplicas clamp', () => {
      const decision = evaluateAutoscalingDecision({
        target: 'api',
        currentReplicas: 2,
        policy: BASE_API_POLICY,
        signals: { cpuPercent: 40, memoryPercent: 45, inFlightRequests: 500 },
        nowMs: 1_000_000,
      });

      expect(decision.dominantSignal).toBe('in_flight_requests');
      expect(decision.rawDesiredReplicas).toBe(10); // ceil(500/50)
      expect(decision.clampedDesiredReplicas).toBe(6); // clamped to maxReplicas=6
      expect(decision.clampedBy).toBe('max');
      expect(decision.recommendedReplicas).toBe(4); // 2 + scaleUpMaxStep(2)
      expect(decision.action).toBe('scale_up');
      expect(decision.cooldownActive).toBe(false);
    });

    it('blocks scale-up during scaleUpCooldownSec', () => {
      const nowMs = 1_000_000;
      const decision = evaluateAutoscalingDecision({
        target: 'api',
        currentReplicas: 3,
        policy: BASE_API_POLICY,
        signals: { cpuPercent: 95, memoryPercent: 50, inFlightRequests: 250 },
        cooldown: { lastScaleUpAtMs: nowMs - 20_000 }, // mới scale-up 20s trước, cooldown 60s
        nowMs,
      });

      expect(decision.action).toBe('hold');
      expect(decision.recommendedReplicas).toBe(3);
      expect(decision.cooldownActive).toBe(true);
      expect(decision.cooldownRemainingSec).toBe(40);
      expect(decision.blockedReason).toBe('scale_up_cooldown');
    });

    it('prevents flapping by holding replicas during scaleDownCooldownSec after a scale-up', () => {
      const nowMs = 2_000_000;
      const held = evaluateAutoscalingDecision({
        target: 'api',
        currentReplicas: 5,
        policy: BASE_API_POLICY,
        signals: { cpuPercent: 10, memoryPercent: 20, inFlightRequests: 5 },
        cooldown: { lastScaleUpAtMs: nowMs - 120_000 }, // 120s < 300s cooldown
        nowMs,
      });

      expect(held.action).toBe('hold');
      expect(held.recommendedReplicas).toBe(5);
      expect(held.cooldownActive).toBe(true);
      expect(held.cooldownRemainingSec).toBe(180);
      expect(held.blockedReason).toBe('scale_down_cooldown');

      // Sau khi qua 300s -> giảm 1 bước theo scaleDownMaxStep=1
      const scaledDown = evaluateAutoscalingDecision({
        target: 'api',
        currentReplicas: 5,
        policy: BASE_API_POLICY,
        signals: { cpuPercent: 10, memoryPercent: 20, inFlightRequests: 5 },
        cooldown: { lastScaleUpAtMs: nowMs - 305_000 },
        nowMs,
      });

      expect(scaledDown.action).toBe('scale_down');
      expect(scaledDown.recommendedReplicas).toBe(4);
      expect(scaledDown.cooldownActive).toBe(false);
    });

    it('never scales below minReplicas even when load is zero', () => {
      const decision = evaluateAutoscalingDecision({
        target: 'api',
        currentReplicas: 2,
        policy: BASE_API_POLICY,
        signals: { cpuPercent: 1, memoryPercent: 5, inFlightRequests: 0 },
        nowMs: 3_000_000,
      });

      expect(decision.clampedDesiredReplicas).toBe(2);
      expect(decision.recommendedReplicas).toBe(2);
      expect(decision.action).toBe('hold');
    });

    it('scales worker based on queue backlog and clamps to worker maxReplicas', () => {
      const decision = evaluateAutoscalingDecision({
        target: 'worker',
        currentReplicas: 1,
        policy: BASE_WORKER_POLICY,
        signals: { cpuPercent: 25, memoryPercent: 30, queueBacklog: 320 },
        nowMs: 1_000_000,
      });

      expect(decision.dominantSignal).toBe('queue_backlog');
      expect(decision.rawDesiredReplicas).toBe(8); // ceil(320/40)
      expect(decision.clampedDesiredReplicas).toBe(5); // maxReplicas=5
      expect(decision.clampedBy).toBe('max');
      expect(decision.recommendedReplicas).toBe(3); // 1 + scaleUpMaxStep(2)
      expect(decision.action).toBe('scale_up');
    });

    it('holds steady within tolerance deadband around target utilization', () => {
      const decision = evaluateAutoscalingDecision({
        target: 'api',
        currentReplicas: 2,
        policy: BASE_API_POLICY,
        signals: { cpuPercent: 74, memoryPercent: 72, inFlightRequests: 104 }, // ratio ~1.057 <= 1.10
        tolerancePercent: 10,
        nowMs: 1_000_000,
      });

      expect(decision.action).toBe('hold');
      expect(decision.recommendedReplicas).toBe(2);
      expect(decision.blockedReason).toBe('within_tolerance');
    });
  });

  describe('evaluateAutoscalingDbImpact()', () => {
    it('classifies ok, warn and crit DB connection pool projection risks', () => {
      const ok = evaluateAutoscalingDbImpact({
        activeApiReplicas: 1,
        activeWorkerReplicas: 1,
        recommendedApiReplicas: 2,
        recommendedWorkerReplicas: 1,
        maxApiReplicas: 6,
        maxWorkerReplicas: 4,
        perInstancePoolLimit: 10,
        maxConnectionsBudget: 200,
        warnUtilizationPercent: 80,
      });
      expect(ok.maxProjectedConnections).toBe(100);
      expect(ok.risk).toBe('ok');

      const warn = evaluateAutoscalingDbImpact({
        activeApiReplicas: 2,
        activeWorkerReplicas: 1,
        recommendedApiReplicas: 2,
        recommendedWorkerReplicas: 1,
        maxApiReplicas: 8,
        maxWorkerReplicas: 5,
        perInstancePoolLimit: 10,
        maxConnectionsBudget: 150,
        warnUtilizationPercent: 80,
      });
      expect(warn.maxProjectedConnections).toBe(130);
      expect(warn.risk).toBe('warn');

      const crit = evaluateAutoscalingDbImpact({
        activeApiReplicas: 2,
        activeWorkerReplicas: 1,
        recommendedApiReplicas: 4,
        recommendedWorkerReplicas: 2,
        maxApiReplicas: 10,
        maxWorkerReplicas: 8,
        perInstancePoolLimit: 10,
        maxConnectionsBudget: 150,
        warnUtilizationPercent: 80,
      });
      expect(crit.maxProjectedConnections).toBe(180);
      expect(crit.risk).toBe('crit');
    });
  });

  describe('renderKubernetesHpaYaml()', () => {
    it('renders valid autoscaling/v2 HPA YAML for API and Worker matching policy', () => {
      const apiYaml = renderKubernetesHpaYaml({
        target: 'api',
        policy: BASE_API_POLICY,
        namespace: 'prod',
      });
      expect(apiYaml).toContain('apiVersion: autoscaling/v2');
      expect(apiYaml).toContain('kind: HorizontalPodAutoscaler');
      expect(apiYaml).toContain('namespace: prod');
      expect(apiYaml).toContain('minReplicas: 2');
      expect(apiYaml).toContain('maxReplicas: 6');
      expect(apiYaml).toContain('name: http_requests_in_flight');
      expect(apiYaml).toContain('averageValue: "50"');
      expect(apiYaml).toContain('stabilizationWindowSeconds: 60');
      expect(apiYaml).toContain('stabilizationWindowSeconds: 300');

      const workerYaml = renderKubernetesHpaYaml({
        target: 'worker',
        policy: BASE_WORKER_POLICY,
      });
      expect(workerYaml).toContain('name: core-worker');
      expect(workerYaml).toContain('name: core_queue_backlog_total');
      expect(workerYaml).toContain('averageValue: "40"');
      expect(workerYaml).toContain('minReplicas: 1');
      expect(workerYaml).toContain('maxReplicas: 5');
    });
  });

  describe('Prometheus Gauges publication (CPU/RAM & Queue Backlog)', () => {
    let redis: RedisService;
    let agent: RuntimeAgentService;

    afterEach(async () => {
      if (agent) await agent.beforeApplicationShutdown();
      if (redis) await redis.onApplicationShutdown();
    });

    it('RuntimeAgentService publishes CPU & RAM gauges to MetricsRegistryService', async () => {
      applyTestEnv({});
      const cfg = new CoreConfigService();
      redis = new RedisService(cfg, mockRedisFactory);
      await redis.client.flushall();
      const metrics = new MetricsRegistryService({ runtime: 'api' }, cfg);
      agent = new RuntimeAgentService({ id: 'api', kind: 'long-running' }, redis, cfg, metrics);
      await agent.onApplicationBootstrap();

      const exposition = await metrics.metrics();
      expect(exposition).toContain(RUNTIME_CPU_PERCENT_METRIC);
      expect(exposition).toContain(RUNTIME_MEMORY_PERCENT_METRIC);
      expect(exposition).toContain(RUNTIME_MEMORY_RSS_BYTES_METRIC);
      expect(exposition).toContain(RUNTIME_MEMORY_LIMIT_BYTES_METRIC);
      expect(exposition).toContain('http_requests_in_flight');
    });

    it('WorkerMetricsService publishes per-queue backlog, total backlog and active workers gauges', async () => {
      applyTestEnv({});
      const cfg = new CoreConfigService();
      const metrics = new MetricsRegistryService({ runtime: 'api' }, cfg);
      const prom = new PrometheusQueryClient(cfg);
      const svc = new WorkerMetricsService(prom, metrics);

      svc.recordQueues([
        {
          name: 'system.events',
          paused: false,
          counts: {
            waiting: 30,
            prioritized: 5,
            active: 2,
            delayed: 10,
            failed: 0,
            completed: 100,
          },
          oldestWaitingAt: Date.now() - 5_000,
          oldestWaitingId: 'job-1',
          workers: [{ name: 'worker-1', addr: '127.0.0.1:1', ageSec: 10, idleSec: 0 }],
        },
        {
          name: 'notifications',
          paused: false,
          counts: { waiting: 12, prioritized: 0, active: 1, delayed: 3, failed: 1, completed: 50 },
          oldestWaitingAt: Date.now() - 2_000,
          oldestWaitingId: 'job-2',
          workers: [
            { name: 'worker-2', addr: '127.0.0.1:2', ageSec: 10, idleSec: 0 },
            { name: 'worker-3', addr: '127.0.0.1:3', ageSec: 10, idleSec: 0 },
          ],
        },
      ]);

      const text = await metrics.metrics();
      expect(text).toContain(`${QUEUE_BACKLOG_METRIC}{`);
      expect(text).toContain('queue="system.events"');
      expect(text).toMatch(/core_queue_backlog\{[^}]*queue="system\.events"[^}]*\}\s+45/);
      expect(text).toMatch(/core_queue_backlog\{[^}]*queue="notifications"[^}]*\}\s+15/);
      expect(text).toMatch(new RegExp(`${QUEUE_BACKLOG_TOTAL_METRIC}\\{[^}]*\\}\\s+60`));
      expect(text).toMatch(
        new RegExp(`${QUEUE_ACTIVE_WORKERS_METRIC}\\{[^}]*queue="notifications"[^}]*\\}\\s+2`),
      );
    });
  });
});
