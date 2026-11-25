import { Injectable, Logger, Optional } from '@nestjs/common';
import type {
  CircuitBreakerSnapshot,
  CircuitBreakerState,
  HttpCircuitBreakerPolicy,
  HttpMethod,
} from '../contracts/http-client.contract.js';
import { CircuitBreakerOpenError } from '../errors/http-client.errors.js';

interface CircuitInternalState {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  failureTimestamps: number[];
  openedAtMs: number | null;
  nextAttemptAtMs: number | null;
  lastFailureReason: string | null;
  halfOpenInFlight: number;
  halfOpenSuccesses: number;
  totalTrips: number;
  policy: HttpCircuitBreakerPolicy;
}

export interface CircuitStateChangeEvent {
  readonly service: string;
  readonly from: CircuitBreakerState;
  readonly to: CircuitBreakerState;
  readonly reason: string | null;
  readonly at: string;
}

export type CircuitStateChangeListener = (event: CircuitStateChangeEvent) => void;

const DEFAULT_POLICY: HttpCircuitBreakerPolicy = {
  enabled: true,
  failureThreshold: 5,
  failureWindowMs: 60_000,
  resetTimeoutMs: 30_000,
  halfOpenMaxProbes: 1,
  halfOpenSuccessThreshold: 1,
};

/**
 * Bộ ngắt mạch (Circuit Breaker) độc lập theo từng dịch vụ ngoài:
 * CLOSED → OPEN (khi lỗi tạm thời đạt ngưỡng) → HALF_OPEN (sau thời gian chờ) → CLOSED (đủ lượt thăm dò thành công).
 */
@Injectable()
export class CircuitBreakerRegistry {
  private readonly logger = new Logger(CircuitBreakerRegistry.name);
  private readonly circuits = new Map<string, CircuitInternalState>();
  private readonly listeners = new Set<CircuitStateChangeListener>();
  private clock: () => number = () => Date.now();

  constructor(@Optional() clock?: () => number) {
    if (clock) {
      this.clock = clock;
    }
  }

  /** Cho phép test thay thế đồng hồ để kiểm thử chuyển trạng thái OPEN → HALF_OPEN xác định */
  public setClock(clock: () => number): void {
    this.clock = clock;
  }

  /** Đăng ký listener lắng nghe mọi sự kiện chuyển trạng thái mạch (CLOSED ↔ OPEN ↔ HALF_OPEN) */
  public onStateChange(listener: CircuitStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Kiểm tra và cho phép hoặc chặn nhanh request trước khi gọi dịch vụ ngoài */
  public beforeRequest(
    service: string,
    policy: HttpCircuitBreakerPolicy,
    method: HttpMethod,
    redactedUrl: string,
  ): CircuitBreakerState {
    const entry = this.getOrCreate(service, policy);
    entry.policy = policy;

    if (!policy.enabled) {
      return entry.state;
    }

    const now = this.clock();

    if (entry.state === 'OPEN') {
      if (entry.nextAttemptAtMs !== null && now >= entry.nextAttemptAtMs) {
        const previous = entry.state;
        entry.state = 'HALF_OPEN';
        entry.halfOpenInFlight = 1;
        entry.halfOpenSuccesses = 0;
        this.emitStateChange(service, previous, 'HALF_OPEN', 'reset_timeout_elapsed', now);
        return entry.state;
      }
      throw new CircuitBreakerOpenError({
        service,
        method,
        url: redactedUrl,
        nextAttemptAt: entry.nextAttemptAtMs ? new Date(entry.nextAttemptAtMs).toISOString() : null,
      });
    }

    if (entry.state === 'HALF_OPEN') {
      if (entry.halfOpenInFlight < policy.halfOpenMaxProbes) {
        entry.halfOpenInFlight += 1;
        return entry.state;
      }
      throw new CircuitBreakerOpenError({
        service,
        method,
        url: redactedUrl,
        nextAttemptAt: entry.nextAttemptAtMs ? new Date(entry.nextAttemptAtMs).toISOString() : null,
      });
    }

    return entry.state;
  }

  /** Ghi nhận lời gọi thành công — đóng lại mạch khi đạt `halfOpenSuccessThreshold` hoặc reset bộ đếm lỗi */
  public onSuccess(service: string): CircuitBreakerState {
    const entry = this.circuits.get(service);
    if (!entry) return 'CLOSED';

    if (entry.halfOpenInFlight > 0) {
      entry.halfOpenInFlight -= 1;
    }

    if (entry.state === 'HALF_OPEN') {
      entry.halfOpenSuccesses += 1;
      const requiredSuccesses = Math.max(1, entry.policy.halfOpenSuccessThreshold ?? 1);
      if (entry.halfOpenSuccesses < requiredSuccesses) {
        return entry.state;
      }
      const previous = entry.state;
      this.closeCircuit(entry);
      this.emitStateChange(service, previous, 'CLOSED', 'probe_succeeded', this.clock());
      return entry.state;
    }

    this.closeCircuit(entry);
    return entry.state;
  }

  /**
   * Ghi nhận thất bại. Lỗi nghiệp vụ 4xx (`countsTowardCircuit = false`) sẽ KHÔNG làm nhảy mạch.
   */
  public onFailure(
    service: string,
    policy: HttpCircuitBreakerPolicy,
    reason: string,
    countsTowardCircuit: boolean,
  ): CircuitBreakerState {
    const entry = this.getOrCreate(service, policy);
    entry.policy = policy;
    if (entry.halfOpenInFlight > 0) {
      entry.halfOpenInFlight -= 1;
    }

    if (!policy.enabled || !countsTowardCircuit) {
      return entry.state;
    }

    const now = this.clock();
    entry.lastFailureReason = reason;

    if (entry.state === 'HALF_OPEN') {
      const previous = entry.state;
      this.tripOpen(entry, policy, now);
      this.emitStateChange(service, previous, 'OPEN', reason, now);
      return entry.state;
    }

    const windowStart = now - policy.failureWindowMs;
    entry.failureTimestamps = entry.failureTimestamps.filter((ts) => ts >= windowStart);
    entry.failureTimestamps.push(now);
    entry.consecutiveFailures += 1;

    if (entry.failureTimestamps.length >= policy.failureThreshold) {
      const previous = entry.state;
      this.tripOpen(entry, policy, now);
      this.emitStateChange(service, previous, 'OPEN', reason, now);
    }

    return entry.state;
  }

  /** Đặt lại mạch của một dịch vụ về trạng thái CLOSED */
  public reset(service: string): boolean {
    const entry = this.circuits.get(service);
    if (!entry) return false;
    const previous = entry.state;
    this.closeCircuit(entry);
    if (previous !== 'CLOSED') {
      this.emitStateChange(service, previous, 'CLOSED', 'manual_reset', this.clock());
    }
    return true;
  }

  /** Đặt lại toàn bộ các mạch đang theo dõi về CLOSED và trả về số mạch đã đặt lại */
  public resetAll(): number {
    let count = 0;
    const now = this.clock();
    for (const [service, entry] of this.circuits.entries()) {
      const previous = entry.state;
      if (
        entry.state !== 'CLOSED' ||
        entry.consecutiveFailures > 0 ||
        entry.failureTimestamps.length > 0
      ) {
        count += 1;
      }
      this.closeCircuit(entry);
      if (previous !== 'CLOSED') {
        this.emitStateChange(service, previous, 'CLOSED', 'manual_reset_all', now);
      }
    }
    return count;
  }

  /** Lấy ảnh chụp trạng thái hiện tại của một dịch vụ */
  public getSnapshot(
    service: string,
    policy?: HttpCircuitBreakerPolicy,
  ): CircuitBreakerSnapshot | undefined {
    const entry = this.circuits.get(service);
    if (!entry) return undefined;
    return this.toSnapshot(service, entry, policy ?? entry.policy);
  }

  /** Liệt kê ảnh chụp trạng thái của toàn bộ các mạch đang theo dõi */
  public listSnapshots(): CircuitBreakerSnapshot[] {
    const now = this.clock();
    const list: CircuitBreakerSnapshot[] = [];
    for (const [service, entry] of this.circuits.entries()) {
      list.push(this.toSnapshot(service, entry, entry.policy, now));
    }
    return list;
  }

  private getOrCreate(service: string, policy: HttpCircuitBreakerPolicy): CircuitInternalState {
    let entry = this.circuits.get(service);
    if (!entry) {
      entry = {
        state: 'CLOSED',
        consecutiveFailures: 0,
        failureTimestamps: [],
        openedAtMs: null,
        nextAttemptAtMs: null,
        lastFailureReason: null,
        halfOpenInFlight: 0,
        halfOpenSuccesses: 0,
        totalTrips: 0,
        policy: policy ?? DEFAULT_POLICY,
      };
      this.circuits.set(service, entry);
    }
    return entry;
  }

  private closeCircuit(entry: CircuitInternalState): void {
    entry.state = 'CLOSED';
    entry.consecutiveFailures = 0;
    entry.failureTimestamps = [];
    entry.openedAtMs = null;
    entry.nextAttemptAtMs = null;
    entry.lastFailureReason = null;
    entry.halfOpenInFlight = 0;
    entry.halfOpenSuccesses = 0;
  }

  private tripOpen(
    entry: CircuitInternalState,
    policy: HttpCircuitBreakerPolicy,
    now: number,
  ): void {
    entry.state = 'OPEN';
    entry.openedAtMs = now;
    entry.nextAttemptAtMs = now + policy.resetTimeoutMs;
    entry.halfOpenInFlight = 0;
    entry.halfOpenSuccesses = 0;
    entry.totalTrips += 1;
  }

  private emitStateChange(
    service: string,
    from: CircuitBreakerState,
    to: CircuitBreakerState,
    reason: string | null,
    now: number,
  ): void {
    if (to === 'OPEN') {
      this.logger.warn(
        `[CircuitBreaker] Service "${service}" transitioned ${from} -> OPEN (reason=${reason ?? 'threshold'})`,
      );
    } else if (to === 'CLOSED') {
      this.logger.log(
        `[CircuitBreaker] Service "${service}" recovered ${from} -> CLOSED (reason=${reason ?? 'ok'})`,
      );
    } else {
      this.logger.log(`[CircuitBreaker] Service "${service}" transitioned ${from} -> HALF_OPEN`);
    }
    const event: CircuitStateChangeEvent = {
      service,
      from,
      to,
      reason,
      at: new Date(now).toISOString(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener error
      }
    }
  }

  private toSnapshot(
    service: string,
    entry: CircuitInternalState,
    policy: HttpCircuitBreakerPolicy,
    now = this.clock(),
  ): CircuitBreakerSnapshot {
    const windowStart = now - policy.failureWindowMs;
    const failuresInWindow = entry.failureTimestamps.filter((ts) => ts >= windowStart).length;
    return {
      service,
      state: entry.state,
      consecutiveFailures: entry.consecutiveFailures,
      failuresInWindow,
      failureThreshold: policy.failureThreshold,
      failureWindowMs: policy.failureWindowMs,
      resetTimeoutMs: policy.resetTimeoutMs,
      openedAt: entry.openedAtMs !== null ? new Date(entry.openedAtMs).toISOString() : null,
      nextAttemptAt:
        entry.nextAttemptAtMs !== null ? new Date(entry.nextAttemptAtMs).toISOString() : null,
      lastFailureReason: entry.lastFailureReason,
      halfOpenInFlight: entry.halfOpenInFlight,
      halfOpenSuccesses: entry.halfOpenSuccesses,
      halfOpenSuccessThreshold: Math.max(1, policy.halfOpenSuccessThreshold ?? 1),
      totalTrips: entry.totalTrips,
    };
  }
}
