import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  RESILIENCE_SETTING_KEYS,
  SettingRegistryService,
  defaultSettingRegistry,
  readDynamicResilienceBoolean,
  readDynamicResilienceNumber,
} from '@packages/kernel/index.js';
import type {
  HttpRetryStormPolicy,
  RetryStormOverviewSnapshot,
  RetryStormServiceSnapshot,
  RetryStormSeverity,
} from '../contracts/http-client.contract.js';

const WINDOW_MS = 60_000;
const MAX_TIMESTAMPS_PER_SERVICE = 20_000;

interface ServiceStormState {
  requestTimestamps: number[];
  retryTimestamps: number[];
  sheddedRetriesCount: number;
  active: boolean;
  detectedAtMs: number | null;
}

export type RetryStormListener = (event: {
  readonly type: 'started' | 'recovered';
  readonly snapshot: RetryStormServiceSnapshot;
}) => void;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pruneWindow(timestamps: number[], cutoffMs: number): number[] {
  let firstValid = 0;
  while (firstValid < timestamps.length && (timestamps[firstValid] ?? 0) < cutoffMs) {
    firstValid += 1;
  }
  if (firstValid === 0) {
    if (timestamps.length > MAX_TIMESTAMPS_PER_SERVICE) {
      return timestamps.slice(timestamps.length - MAX_TIMESTAMPS_PER_SERVICE);
    }
    return timestamps;
  }
  return timestamps.slice(firstValid);
}

/**
 * Giám sát & phát hiện bão thử lại (Retry Storm) trên cửa sổ trượt 60 giây theo từng dịch vụ ngoài:
 * - Phát hiện khi `retries/phút >= retriesPerMinThreshold` hoặc `retryRatio >= retryRatioPercent` (đủ `minRequests`).
 * - Hỗ trợ cơ chế tự bảo vệ **Retry Budget Shedding** (`sheddingEnabled = true`): tạm dừng retry thêm khi storm đang
 *   xảy ra để ngăn lỗi lan rộng (cascading failure) sang hệ thống nội bộ và provider.
 */
@Injectable()
export class RetryStormMonitor {
  private readonly logger = new Logger(RetryStormMonitor.name);
  private readonly states = new Map<string, ServiceStormState>();
  private readonly listeners = new Set<RetryStormListener>();
  private clock: () => number = () => Date.now();
  private overridePolicy: Partial<HttpRetryStormPolicy> | null = null;

  constructor(
    @Optional() private readonly config?: CoreConfigService,
    @Optional() private readonly settingsRegistry?: SettingRegistryService,
  ) {}

  /** Cho phép test kiểm soát đồng hồ xác định trên cửa sổ 60s. */
  public setClock(clock: () => number): void {
    this.clock = clock;
  }

  /** Cho phép test hoặc runtime ghi đè ngưỡng storm cục bộ. */
  public setPolicyOverride(policy: Partial<HttpRetryStormPolicy> | null): void {
    this.overridePolicy = policy;
  }

  /** Đăng ký listener nhận thông báo khi storm bắt đầu hoặc kết thúc. */
  public onStormEvent(listener: RetryStormListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Đọc chính sách Retry Storm hiện hành (Override -> Settings động -> `.env` -> Mặc định). */
  public resolvePolicy(): HttpRetryStormPolicy {
    const envStorm = this.config?.httpClient?.retryStorm;
    const reg = this.settingsRegistry ?? defaultSettingRegistry;
    const retriesPerMinThreshold =
      this.overridePolicy?.retriesPerMinThreshold ??
      readDynamicResilienceNumber(
        RESILIENCE_SETTING_KEYS.HTTP_RETRY_STORM_PER_MIN,
        envStorm?.retriesPerMinThreshold ?? 60,
        { min: 5, max: 100_000, round: true, registry: reg },
      );
    const retryRatioPercent =
      this.overridePolicy?.retryRatioPercent ??
      readDynamicResilienceNumber(
        RESILIENCE_SETTING_KEYS.HTTP_RETRY_STORM_RATIO_PERCENT,
        envStorm?.retryRatioPercent ?? 25,
        { min: 5, max: 100, round: false, registry: reg },
      );
    const minRequests =
      this.overridePolicy?.minRequests ??
      readDynamicResilienceNumber(
        RESILIENCE_SETTING_KEYS.HTTP_RETRY_STORM_MIN_REQUESTS,
        envStorm?.minRequests ?? 20,
        { min: 5, max: 10_000, round: true, registry: reg },
      );
    const sheddingEnabled =
      this.overridePolicy?.sheddingEnabled ??
      readDynamicResilienceBoolean(
        RESILIENCE_SETTING_KEYS.HTTP_RETRY_STORM_SHEDDING,
        envStorm?.sheddingEnabled ?? true,
        { registry: reg },
      );

    return {
      retriesPerMinThreshold,
      retryRatioPercent,
      minRequests,
      sheddingEnabled,
    };
  }

  /** Ghi nhận một lượt gọi đầu (request) tới dịch vụ ngoài. */
  public recordRequest(service: string, now = this.clock()): void {
    const state = this.getOrCreate(service);
    state.requestTimestamps = pruneWindow(state.requestTimestamps, now - WINDOW_MS);
    state.requestTimestamps.push(now);
  }

  /** Ghi nhận một lượt thử lại (retry) và đánh giá lại trạng thái Retry Storm. */
  public recordRetry(service: string, now = this.clock()): RetryStormServiceSnapshot {
    const state = this.getOrCreate(service);
    state.retryTimestamps = pruneWindow(state.retryTimestamps, now - WINDOW_MS);
    state.retryTimestamps.push(now);
    return this.evaluateService(service, now);
  }

  /**
   * Kiểm tra trước khi thực hiện retry: nếu dịch vụ đang trong trạng thái Retry Storm và `sheddingEnabled = true`,
   * tạm dừng retry thêm (Retry Budget Shedding) để ngăn bão retry làm sập dây chuyền.
   */
  public shouldShedRetry(
    service: string,
    now = this.clock(),
  ): { readonly shed: boolean; readonly snapshot: RetryStormServiceSnapshot } {
    const snapshot = this.evaluateService(service, now);
    if (snapshot.active && snapshot.sheddingActive) {
      const state = this.getOrCreate(service);
      state.sheddedRetriesCount += 1;
      const updated: RetryStormServiceSnapshot = {
        ...snapshot,
        sheddedRetriesCount: state.sheddedRetriesCount,
      };
      return { shed: true, snapshot: updated };
    }
    return { shed: false, snapshot };
  }

  /** Đánh giá trạng thái Retry Storm của một dịch vụ tại thời điểm hiện tại. */
  public evaluateService(service: string, now = this.clock()): RetryStormServiceSnapshot {
    const state = this.getOrCreate(service);
    const policy = this.resolvePolicy();
    const cutoff = now - WINDOW_MS;
    state.requestTimestamps = pruneWindow(state.requestTimestamps, cutoff);
    state.retryTimestamps = pruneWindow(state.retryTimestamps, cutoff);

    const requestsInLastMin = state.requestTimestamps.length;
    const retriesInLastMin = state.retryTimestamps.length;
    const denominator = Math.max(requestsInLastMin, retriesInLastMin);
    const retryRatioPercent = denominator > 0 ? round2((retriesInLastMin / denominator) * 100) : 0;

    const hitRateThreshold = retriesInLastMin >= policy.retriesPerMinThreshold;
    const hitRatioThreshold =
      requestsInLastMin >= policy.minRequests && retryRatioPercent >= policy.retryRatioPercent;
    const active = hitRateThreshold || hitRatioThreshold;

    let severity: RetryStormSeverity | null = null;
    let reason: string | null = null;
    if (active) {
      const critical =
        retriesInLastMin >= policy.retriesPerMinThreshold * 2 ||
        (requestsInLastMin >= policy.minRequests &&
          retryRatioPercent >= Math.min(100, policy.retryRatioPercent * 2));
      severity = critical ? 'critical' : 'warning';
      if (hitRateThreshold && hitRatioThreshold) {
        reason = `retries=${retriesInLastMin}/min (>=${policy.retriesPerMinThreshold}) & ratio=${retryRatioPercent}% (>=${policy.retryRatioPercent}%)`;
      } else if (hitRateThreshold) {
        reason = `retries=${retriesInLastMin}/min (>=${policy.retriesPerMinThreshold})`;
      } else {
        reason = `retry_ratio=${retryRatioPercent}% (>=${policy.retryRatioPercent}%, reqs=${requestsInLastMin})`;
      }
    }

    const wasActive = state.active;
    if (active && !wasActive) {
      state.active = true;
      state.detectedAtMs = now;
    } else if (!active && wasActive) {
      state.active = false;
      state.detectedAtMs = null;
    }

    const snapshot: RetryStormServiceSnapshot = {
      service,
      active,
      severity,
      retriesInLastMin,
      requestsInLastMin,
      retryRatioPercent,
      retriesPerMinThreshold: policy.retriesPerMinThreshold,
      retryRatioThresholdPercent: policy.retryRatioPercent,
      sheddingActive: active && policy.sheddingEnabled,
      sheddedRetriesCount: state.sheddedRetriesCount,
      detectedAt: state.detectedAtMs !== null ? new Date(state.detectedAtMs).toISOString() : null,
      reason,
    };

    if (active && !wasActive) {
      this.logger.warn(
        `[RetryStorm][STARTED] service="${service}" severity=${severity} ${reason ?? ''} shedding=${snapshot.sheddingActive}`,
      );
      this.notify({ type: 'started', snapshot });
    } else if (!active && wasActive) {
      this.logger.log(`[RetryStorm][RECOVERED] service="${service}"`);
      this.notify({ type: 'recovered', snapshot });
    }

    return snapshot;
  }

  /** Lấy ảnh chụp trạng thái Retry Storm của một dịch vụ (nếu đã từng ghi nhận). */
  public getServiceSnapshot(
    service: string,
    now = this.clock(),
  ): RetryStormServiceSnapshot | undefined {
    if (!this.states.has(service)) return undefined;
    return this.evaluateService(service, now);
  }

  /** Tổng hợp tình trạng Retry Storm trên toàn bộ các dịch vụ outbound HTTP. */
  public getOverview(now = this.clock()): RetryStormOverviewSnapshot {
    const policy = this.resolvePolicy();
    const alerts: RetryStormServiceSnapshot[] = [];
    let totalRetriesInLastMin = 0;
    let totalSheddedRetries = 0;

    for (const service of Array.from(this.states.keys()).sort()) {
      const snap = this.evaluateService(service, now);
      totalRetriesInLastMin += snap.retriesInLastMin;
      totalSheddedRetries += snap.sheddedRetriesCount;
      if (snap.active) {
        alerts.push(snap);
      }
    }

    alerts.sort((a, b) => {
      const rank = (s: RetryStormSeverity | null) => (s === 'critical' ? 0 : 1);
      return rank(a.severity) - rank(b.severity) || b.retriesInLastMin - a.retriesInLastMin;
    });

    return {
      activeStormCount: alerts.length,
      totalRetriesInLastMin,
      totalSheddedRetries,
      policy,
      alerts,
    };
  }

  private getOrCreate(service: string): ServiceStormState {
    let state = this.states.get(service);
    if (!state) {
      state = {
        requestTimestamps: [],
        retryTimestamps: [],
        sheddedRetriesCount: 0,
        active: false,
        detectedAtMs: null,
      };
      this.states.set(service, state);
    }
    return state;
  }

  private notify(event: {
    readonly type: 'started' | 'recovered';
    readonly snapshot: RetryStormServiceSnapshot;
  }): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener error
      }
    }
  }
}
