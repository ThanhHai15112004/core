import { Injectable, Optional } from '@nestjs/common';
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
  totalTrips: number;
  policy: HttpCircuitBreakerPolicy;
}

const DEFAULT_POLICY: HttpCircuitBreakerPolicy = {
  enabled: true,
  failureThreshold: 5,
  failureWindowMs: 60_000,
  resetTimeoutMs: 30_000,
  halfOpenMaxProbes: 1,
};

/**
 * Bộ ngắt mạch (Circuit Breaker) độc lập theo từng dịch vụ ngoài:
 * CLOSED → OPEN (khi lỗi tạm thời đạt ngưỡng) → HALF_OPEN (sau thời gian chờ) → CLOSED.
 */
@Injectable()
export class CircuitBreakerRegistry {
  private readonly circuits = new Map<string, CircuitInternalState>();
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
        entry.state = 'HALF_OPEN';
        entry.halfOpenInFlight = 1;
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

  /** Ghi nhận lời gọi thành công — đóng lại mạch nếu đang ở HALF_OPEN hoặc có lỗi trước đó */
  public onSuccess(service: string): CircuitBreakerState {
    const entry = this.circuits.get(service);
    if (!entry) return 'CLOSED';
    entry.state = 'CLOSED';
    entry.consecutiveFailures = 0;
    entry.failureTimestamps = [];
    entry.openedAtMs = null;
    entry.nextAttemptAtMs = null;
    entry.lastFailureReason = null;
    entry.halfOpenInFlight = 0;
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
      this.tripOpen(entry, policy, now);
      return entry.state;
    }

    const windowStart = now - policy.failureWindowMs;
    entry.failureTimestamps = entry.failureTimestamps.filter((ts) => ts >= windowStart);
    entry.failureTimestamps.push(now);
    entry.consecutiveFailures += 1;

    if (entry.failureTimestamps.length >= policy.failureThreshold) {
      this.tripOpen(entry, policy, now);
    }

    return entry.state;
  }

  /** Đặt lại mạch của một dịch vụ về trạng thái CLOSED */
  public reset(service: string): boolean {
    const entry = this.circuits.get(service);
    if (!entry) return false;
    entry.state = 'CLOSED';
    entry.consecutiveFailures = 0;
    entry.failureTimestamps = [];
    entry.openedAtMs = null;
    entry.nextAttemptAtMs = null;
    entry.lastFailureReason = null;
    entry.halfOpenInFlight = 0;
    return true;
  }

  /** Đặt lại toàn bộ các mạch đang theo dõi về CLOSED và trả về số mạch đã đặt lại */
  public resetAll(): number {
    let count = 0;
    for (const entry of this.circuits.values()) {
      if (
        entry.state !== 'CLOSED' ||
        entry.consecutiveFailures > 0 ||
        entry.failureTimestamps.length > 0
      ) {
        count += 1;
      }
      entry.state = 'CLOSED';
      entry.consecutiveFailures = 0;
      entry.failureTimestamps = [];
      entry.openedAtMs = null;
      entry.nextAttemptAtMs = null;
      entry.lastFailureReason = null;
      entry.halfOpenInFlight = 0;
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
        totalTrips: 0,
        policy: policy ?? DEFAULT_POLICY,
      };
      this.circuits.set(service, entry);
    }
    return entry;
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
    entry.totalTrips += 1;
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
      totalTrips: entry.totalTrips,
    };
  }
}
