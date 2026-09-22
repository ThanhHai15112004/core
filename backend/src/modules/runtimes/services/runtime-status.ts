import type { RuntimeEvent, RuntimeHeartbeat } from '@packages/runtime/index.js';
import type { RuntimeStatus } from '../responses/runtime.response.js';

/** Runtime vừa start < khoảng này được coi là `starting`. */
export const STARTING_GRACE_SEC = 10;
/** Sau khoảng này mà chưa có heartbeat mới thì restart được coi là thất bại. */
export const RESTART_TIMEOUT_MS = 2 * 60_000;

const LIFECYCLE = new Set(['started', 'stopped', 'crashed', 'restart_requested']);
const RESTART_REASONS = new Set(['manual_restart', 'force_restart']);

export interface StatusReason {
  code: string;
  params?: Record<string, string | number>;
}

export interface StatusInput {
  telemetryAvailable: boolean;
  heartbeat: RuntimeHeartbeat | null;
  /** Sự kiện của runtime này, mới nhất trước. */
  events: RuntimeEvent[];
  now: number;
  restartStorm: { count: number; windowMin: number };
}

/** Suy ra trạng thái hiển thị + lý do từ heartbeat và sự kiện vòng đời — không đoán. */
export function deriveRuntimeStatus(input: StatusInput): {
  status: RuntimeStatus;
  reasons: StatusReason[];
} {
  const { heartbeat: hb, events, now } = input;
  if (!input.telemetryAvailable) return { status: 'unknown', reasons: [{ code: 'noTelemetry' }] };

  if (hb) {
    if (hb.state === 'stopping') return { status: 'stopping', reasons: [] };
    if (hb.state === 'paused') return { status: 'stopped', reasons: [{ code: 'paused' }] };
    if (hb.uptimeSec < STARTING_GRACE_SEC) return { status: 'starting', reasons: [] };

    const reasons: StatusReason[] = [
      ...hb.alerts.map((a) => ({
        code: `alert.${a.key}`,
        params: { value: a.value, threshold: a.threshold },
      })),
      ...hb.issues.map((i) => ({
        code: `issue:${i.key}`,
        ...(i.params ? { params: i.params } : {}),
      })),
    ];
    const windowStart = now - input.restartStorm.windowMin * 60_000;
    const recentStarts = events.filter(
      (e) => e.type === 'started' && Date.parse(e.at) >= windowStart,
    ).length;
    if (recentStarts >= input.restartStorm.count) {
      reasons.push({
        code: 'restartStorm',
        params: { count: recentStarts, minutes: input.restartStorm.windowMin },
      });
    }
    return { status: reasons.length > 0 ? 'degraded' : 'healthy', reasons };
  }

  const last = events.find((e) => LIFECYCLE.has(e.type));
  if (!last) return { status: 'unknown', reasons: [{ code: 'neverSeen' }] };

  switch (last.type) {
    case 'restart_requested':
      return now - Date.parse(last.at) < RESTART_TIMEOUT_MS
        ? { status: 'restarting', reasons: [] }
        : { status: 'crashed', reasons: [{ code: 'restartTimeout' }] };
    case 'stopped': {
      const reason = String(last.data['reason'] ?? 'shutdown');
      if (!RESTART_REASONS.has(reason))
        return { status: 'stopped', reasons: [{ code: `stop.${reason}` }] };
      // Dừng để restart: supervisor sẽ dựng lại process trong giây lát.
      return now - Date.parse(last.at) < RESTART_TIMEOUT_MS
        ? { status: 'restarting', reasons: [] }
        : { status: 'crashed', reasons: [{ code: 'restartTimeout' }] };
    }
    case 'crashed':
      return {
        status: 'crashed',
        reasons: [{ code: 'crash', params: { message: String(last.data['message'] ?? '') } }],
      };
    default:
      // Có `started` nhưng mất heartbeat mà không có sự kiện dừng → process chết đột ngột (kill -9, OOM...).
      return { status: 'crashed', reasons: [{ code: 'heartbeatLost' }] };
  }
}
