import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { safeJsonParseObject } from '@packages/kernel/index.js';
import {
  DEFAULT_RETRYABLE_STATUS_CODES,
  type HttpCircuitBreakerPolicy,
  type HttpRequestOptions,
  type HttpRetryPolicy,
  type HttpServicePolicy,
  type HttpServicePolicyInput,
} from '../contracts/http-client.contract.js';

function createFallbackDefaultPolicy(): HttpServicePolicy {
  return {
    name: 'default',
    timeoutMs: 10_000,
    retry: {
      maxRetries: 2,
      baseDelayMs: 250,
      maxDelayMs: 5_000,
      jitter: true,
      retryableStatusCodes: [...DEFAULT_RETRYABLE_STATUS_CODES],
      retryNonIdempotent: false,
      respectRetryAfter: true,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      failureWindowMs: 60_000,
      resetTimeoutMs: 30_000,
      halfOpenMaxProbes: 1,
    },
  };
}

function normalizeServiceName(name: string): string {
  const clean = name.trim().toLowerCase();
  return clean.length > 0 ? clean : 'default';
}

function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asNonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Quản lý chính sách timeout, retry và circuit breaker theo từng dịch vụ ngoài */
@Injectable()
export class HttpServiceRegistry {
  private readonly defaultPolicy: HttpServicePolicy;
  private readonly services = new Map<string, HttpServicePolicy>();

  constructor(@Optional() config?: CoreConfigService) {
    if (config?.httpClient) {
      const cfg = config.httpClient;
      this.defaultPolicy = {
        name: 'default',
        timeoutMs: cfg.defaultTimeoutMs,
        retry: {
          maxRetries: cfg.retry.maxRetries,
          baseDelayMs: cfg.retry.baseDelayMs,
          maxDelayMs: cfg.retry.maxDelayMs,
          jitter: cfg.retry.jitter,
          retryableStatusCodes: [...DEFAULT_RETRYABLE_STATUS_CODES],
          retryNonIdempotent: cfg.retry.retryNonIdempotent,
          respectRetryAfter: cfg.retry.respectRetryAfter,
        },
        circuitBreaker: {
          enabled: cfg.circuitBreaker.enabled,
          failureThreshold: cfg.circuitBreaker.failureThreshold,
          failureWindowMs: cfg.circuitBreaker.failureWindowMs,
          resetTimeoutMs: cfg.circuitBreaker.resetTimeoutMs,
          halfOpenMaxProbes: cfg.circuitBreaker.halfOpenMaxProbes,
        },
      };
      this.loadServicesFromJson(cfg.servicesJson);
    } else {
      this.defaultPolicy = createFallbackDefaultPolicy();
    }
  }

  /** Đăng ký hoặc cập nhật chính sách riêng cho một dịch vụ ngoài */
  public registerService(name: string, input: HttpServicePolicyInput): HttpServicePolicy {
    const normalized = normalizeServiceName(name);
    const base = this.services.get(normalized) ?? this.defaultPolicy;
    const merged: HttpServicePolicy = {
      name: normalized,
      ...(input.baseUrl !== undefined
        ? { baseUrl: input.baseUrl }
        : base.baseUrl !== undefined
          ? { baseUrl: base.baseUrl }
          : {}),
      timeoutMs:
        input.timeoutMs !== undefined && input.timeoutMs > 0
          ? Math.floor(input.timeoutMs)
          : base.timeoutMs,
      ...(base.defaultHeaders || input.defaultHeaders
        ? {
            defaultHeaders: {
              ...(base.defaultHeaders ?? {}),
              ...(input.defaultHeaders ?? {}),
            },
          }
        : {}),
      retry: this.mergeRetryPolicy(base.retry, input.retry),
      circuitBreaker: this.mergeCircuitPolicy(base.circuitBreaker, input.circuitBreaker),
    };
    this.services.set(normalized, merged);
    return merged;
  }

  /** Lấy chính sách đã đăng ký của dịch vụ (nếu có) */
  public getService(name: string): HttpServicePolicy | undefined {
    return this.services.get(normalizeServiceName(name));
  }

  /** Liệt kê toàn bộ chính sách dịch vụ đã đăng ký */
  public listServices(): HttpServicePolicy[] {
    return Array.from(this.services.values());
  }

  /** Lấy chính sách mặc định toàn cục của HTTP Client */
  public getDefaultPolicy(): HttpServicePolicy {
    return this.defaultPolicy;
  }

  /** Suy ra tên dịch vụ từ options.service hoặc hostname của URL */
  public resolveServiceName(explicitService: string | undefined, rawUrl: string): string {
    if (explicitService && explicitService.trim().length > 0) {
      return normalizeServiceName(explicitService);
    }
    try {
      const parsed = new URL(rawUrl);
      if (parsed.hostname) return parsed.hostname.toLowerCase();
    } catch {
      // Relative URL without explicit service falls back to default
    }
    return 'default';
  }

  /** Hợp nhất chính sách theo thứ tự: mặc định → dịch vụ → từng request */
  public resolvePolicy(serviceName: string, options?: HttpRequestOptions): HttpServicePolicy {
    const normalized = normalizeServiceName(serviceName);
    const servicePolicy = this.services.get(normalized);
    const base = servicePolicy ?? { ...this.defaultPolicy, name: normalized };
    const timeoutMs =
      options?.timeoutMs !== undefined && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : base.timeoutMs;
    return {
      ...base,
      name: normalized,
      timeoutMs,
      retry: this.mergeRetryPolicy(base.retry, options?.retry),
    };
  }

  /** Tạo URL hoàn chỉnh từ baseUrl (nếu là relative path) và query params */
  public buildUrl(
    rawUrl: string,
    baseUrl: string | undefined,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const isAbsolute = /^https?:\/\//i.test(rawUrl);
    let finalUrl = rawUrl;
    if (!isAbsolute && baseUrl) {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const cleanPath = rawUrl.replace(/^\/+/, '');
      finalUrl = cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
    }

    if (!params) return finalUrl;

    const search = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) {
        search.append(key, String(val));
      }
    }
    const qs = search.toString();
    if (!qs) return finalUrl;
    const separator = finalUrl.includes('?') ? '&' : '?';
    return `${finalUrl}${separator}${qs}`;
  }

  private mergeRetryPolicy(
    base: HttpRetryPolicy,
    override?: Partial<HttpRetryPolicy>,
  ): HttpRetryPolicy {
    if (!override) return base;
    return {
      maxRetries:
        override.maxRetries !== undefined
          ? Math.max(0, Math.floor(override.maxRetries))
          : base.maxRetries,
      baseDelayMs:
        override.baseDelayMs !== undefined
          ? Math.max(10, Math.floor(override.baseDelayMs))
          : base.baseDelayMs,
      maxDelayMs:
        override.maxDelayMs !== undefined
          ? Math.max(50, Math.floor(override.maxDelayMs))
          : base.maxDelayMs,
      jitter: override.jitter ?? base.jitter,
      retryableStatusCodes: override.retryableStatusCodes ?? base.retryableStatusCodes,
      retryNonIdempotent: override.retryNonIdempotent ?? base.retryNonIdempotent,
      respectRetryAfter: override.respectRetryAfter ?? base.respectRetryAfter,
    };
  }

  private mergeCircuitPolicy(
    base: HttpCircuitBreakerPolicy,
    override?: Partial<HttpCircuitBreakerPolicy>,
  ): HttpCircuitBreakerPolicy {
    if (!override) return base;
    return {
      enabled: override.enabled ?? base.enabled,
      failureThreshold:
        override.failureThreshold !== undefined
          ? Math.max(1, Math.floor(override.failureThreshold))
          : base.failureThreshold,
      failureWindowMs:
        override.failureWindowMs !== undefined
          ? Math.max(1_000, Math.floor(override.failureWindowMs))
          : base.failureWindowMs,
      resetTimeoutMs:
        override.resetTimeoutMs !== undefined
          ? Math.max(1_000, Math.floor(override.resetTimeoutMs))
          : base.resetTimeoutMs,
      halfOpenMaxProbes:
        override.halfOpenMaxProbes !== undefined
          ? Math.max(1, Math.floor(override.halfOpenMaxProbes))
          : base.halfOpenMaxProbes,
    };
  }

  private loadServicesFromJson(rawJson: string): void {
    if (!rawJson.trim()) return;
    const parsed = safeJsonParseObject<Record<string, unknown>>(rawJson, {});
    for (const [serviceKey, rawEntry] of Object.entries(parsed)) {
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
      const entry = rawEntry as Record<string, unknown>;
      const retryRaw =
        entry['retry'] && typeof entry['retry'] === 'object' && !Array.isArray(entry['retry'])
          ? (entry['retry'] as Record<string, unknown>)
          : undefined;
      const cbRaw =
        entry['circuitBreaker'] &&
        typeof entry['circuitBreaker'] === 'object' &&
        !Array.isArray(entry['circuitBreaker'])
          ? (entry['circuitBreaker'] as Record<string, unknown>)
          : undefined;

      const baseUrl = typeof entry['baseUrl'] === 'string' ? entry['baseUrl'] : undefined;
      const timeoutMs = asPositiveNumber(entry['timeoutMs']);
      const defaultHeaders = asStringRecord(entry['defaultHeaders']);

      const retryPartial: Partial<HttpRetryPolicy> = {};
      if (retryRaw) {
        const maxRetries = asNonNegativeInt(retryRaw['maxRetries']);
        const baseDelayMs = asPositiveNumber(retryRaw['baseDelayMs']);
        const maxDelayMs = asPositiveNumber(retryRaw['maxDelayMs']);
        const jitter = asBoolean(retryRaw['jitter']);
        const retryNonIdempotent = asBoolean(retryRaw['retryNonIdempotent']);
        const respectRetryAfter = asBoolean(retryRaw['respectRetryAfter']);
        if (maxRetries !== undefined) Object.assign(retryPartial, { maxRetries });
        if (baseDelayMs !== undefined) Object.assign(retryPartial, { baseDelayMs });
        if (maxDelayMs !== undefined) Object.assign(retryPartial, { maxDelayMs });
        if (jitter !== undefined) Object.assign(retryPartial, { jitter });
        if (retryNonIdempotent !== undefined) Object.assign(retryPartial, { retryNonIdempotent });
        if (respectRetryAfter !== undefined) Object.assign(retryPartial, { respectRetryAfter });
      }

      const cbPartial: Partial<HttpCircuitBreakerPolicy> = {};
      if (cbRaw) {
        const enabled = asBoolean(cbRaw['enabled']);
        const failureThreshold = asPositiveNumber(cbRaw['failureThreshold']);
        const failureWindowMs = asPositiveNumber(cbRaw['failureWindowMs']);
        const resetTimeoutMs = asPositiveNumber(cbRaw['resetTimeoutMs']);
        const halfOpenMaxProbes = asPositiveNumber(cbRaw['halfOpenMaxProbes']);
        if (enabled !== undefined) Object.assign(cbPartial, { enabled });
        if (failureThreshold !== undefined) Object.assign(cbPartial, { failureThreshold });
        if (failureWindowMs !== undefined) Object.assign(cbPartial, { failureWindowMs });
        if (resetTimeoutMs !== undefined) Object.assign(cbPartial, { resetTimeoutMs });
        if (halfOpenMaxProbes !== undefined) Object.assign(cbPartial, { halfOpenMaxProbes });
      }

      this.registerService(serviceKey, {
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(defaultHeaders !== undefined ? { defaultHeaders } : {}),
        ...(Object.keys(retryPartial).length > 0 ? { retry: retryPartial } : {}),
        ...(Object.keys(cbPartial).length > 0 ? { circuitBreaker: cbPartial } : {}),
      });
    }
  }
}
