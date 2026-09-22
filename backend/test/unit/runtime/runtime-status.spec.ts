import { describe, it, expect } from '@jest/globals';
import { deriveRuntimeStatus, RESTART_TIMEOUT_MS } from '@modules/runtimes/index.js';
import type { RuntimeEvent, RuntimeHeartbeat } from '@packages/runtime/index.js';

const NOW = Date.parse('2026-09-22T10:00:00.000Z');
const storm = { count: 3, windowMin: 10 };

const hb = (overrides: Partial<RuntimeHeartbeat> = {}): RuntimeHeartbeat =>
  ({
    id: 'worker',
    state: 'running',
    uptimeSec: 120,
    alerts: [],
    issues: [],
    ...overrides,
  }) as RuntimeHeartbeat;

const event = (
  type: RuntimeEvent['type'],
  msAgo: number,
  data: RuntimeEvent['data'] = {},
): RuntimeEvent => ({
  id: `${NOW - msAgo}-0`,
  runtime: 'worker',
  type,
  at: new Date(NOW - msAgo).toISOString(),
  data,
});

const derive = (input: {
  heartbeat?: RuntimeHeartbeat | null;
  events?: RuntimeEvent[];
  telemetry?: boolean;
}) =>
  deriveRuntimeStatus({
    telemetryAvailable: input.telemetry ?? true,
    heartbeat: input.heartbeat ?? null,
    events: input.events ?? [],
    now: NOW,
    restartStorm: storm,
  });

describe('deriveRuntimeStatus', () => {
  it('is unknown without telemetry', () => {
    expect(derive({ telemetry: false, heartbeat: hb() })).toEqual({
      status: 'unknown',
      reasons: [{ code: 'noTelemetry' }],
    });
  });

  it('is unknown when the runtime was never seen', () => {
    expect(derive({}).status).toBe('unknown');
  });

  it('is healthy for a running runtime without alerts', () => {
    expect(derive({ heartbeat: hb() })).toEqual({ status: 'healthy', reasons: [] });
  });

  it('is starting during the grace period', () => {
    expect(derive({ heartbeat: hb({ uptimeSec: 3 }) }).status).toBe('starting');
  });

  it('is degraded with the threshold reason', () => {
    const result = derive({
      heartbeat: hb({
        alerts: [{ key: 'memory', value: 91, threshold: 85, since: new Date(NOW).toISOString() }],
      }),
    });
    expect(result.status).toBe('degraded');
    expect(result.reasons).toEqual([
      { code: 'alert.memory', params: { value: 91, threshold: 85 } },
    ]);
  });

  it('is degraded when contributor reports an issue', () => {
    const result = derive({
      heartbeat: hb({ issues: [{ key: 'runtime.issue.jobsFailing', params: { count: 2 } }] }),
    });
    expect(result.reasons[0]).toEqual({
      code: 'issue:runtime.issue.jobsFailing',
      params: { count: 2 },
    });
  });

  it('detects a restart storm', () => {
    const events = [event('started', 60_000), event('started', 120_000), event('started', 180_000)];
    const result = derive({ heartbeat: hb(), events });
    expect(result.status).toBe('degraded');
    expect(result.reasons[0]?.code).toBe('restartStorm');
  });

  it('is stopping / stopped from the agent state', () => {
    expect(derive({ heartbeat: hb({ state: 'stopping' }) }).status).toBe('stopping');
    expect(derive({ heartbeat: hb({ state: 'paused' }) })).toEqual({
      status: 'stopped',
      reasons: [{ code: 'paused' }],
    });
  });

  it('is restarting shortly after a restart request, crashed after the timeout', () => {
    expect(derive({ events: [event('restart_requested', 5_000)] }).status).toBe('restarting');
    expect(derive({ events: [event('restart_requested', RESTART_TIMEOUT_MS + 1)] }).status).toBe(
      'crashed',
    );
  });

  it('is stopped after a clean stop event and crashed after a crash event', () => {
    expect(derive({ events: [event('stopped', 1000, { reason: 'signal' })] })).toEqual({
      status: 'stopped',
      reasons: [{ code: 'stop.signal' }],
    });
    expect(derive({ events: [event('crashed', 1000, { message: 'boom' })] }).status).toBe(
      'crashed',
    );
  });

  it('is crashed when the heartbeat disappears without a stop event', () => {
    expect(derive({ events: [event('started', 60_000)] })).toEqual({
      status: 'crashed',
      reasons: [{ code: 'heartbeatLost' }],
    });
  });

  it('is restarting right after a restart stop, crashed if it never comes back', () => {
    expect(derive({ events: [event('stopped', 1000, { reason: 'manual_restart' })] }).status).toBe(
      'restarting',
    );
    expect(
      derive({ events: [event('stopped', RESTART_TIMEOUT_MS + 1, { reason: 'force_restart' })] }),
    ).toEqual({
      status: 'crashed',
      reasons: [{ code: 'restartTimeout' }],
    });
  });
});
