import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  RESILIENCE_SETTING_KEYS,
  SettingRegistryService,
  clampRetryCount,
  defaultSettingRegistry,
  readDynamicResilienceBoolean,
  readDynamicResilienceNumber,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import {
  DEFAULT_RETRYABLE_STATUS_CODES,
  type HttpCircuitBreakerPolicy,
  type HttpConcurrencyPolicy,
  type HttpRequestOptions,
  type HttpRetryPolicy,
  type HttpServicePolicy,
  type HttpServicePolicyInput,
} from '../contracts/http-client.contract.js';

const HARD_MAX_RETRIES_CAP = 10;

function createFallbackDefaultPolicy(): HttpServicePolicy {
  return {
    name: 'default',
    timeoutMs: 10_000,
    retry: {
      maxRetries: 2,
      maxRetriesCap: 5,
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
      halfOpenSuccessThreshold: 1,
    },
    concurrency: {
      enabled: true,
      maxConcurrent: 20,
      maxQueue: 0,
      queueTimeoutMs: 2_000,
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

/** Quản lý chính sách timeout, retry, circuit breaker và bulkhead đồng thời theo từng dịch vụ ngoài */
@Injectable()
export class HttpServiceRegistry {
  private readonly envDefaultPolicy: HttpServicePolicy;
  private readonly serviceInputs = new Map<string, HttpServicePolicyInput>();
  private readonly settingsRegistry: SettingRegistryService;

  constructor(
    @Optional() config?: CoreConfigService,
    @Optional() settingsRegistry?: SettingRegistryService,
  ) {
    this.settingsRegistry = settingsRegistry ?? defaultSettingRegistry;
    if (config?.httpClient) {
      const cfg = config.httpClient;
      this.envDefaultPolicy = {
        name: 'default',
        timeoutMs: cfg.defaultTimeoutMs,
        retry: {
          maxRetries: cfg.retry.maxRetries,
          maxRetriesCap: cfg.retry.maxRetriesCap,
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
          halfOpenSuccessThreshold: cfg.circuitBreaker.halfOpenSuccessThreshold,
        },
        concurrency: {
          enabled: cfg.concurrency.enabled,
          maxConcurrent: cfg.concurrency.maxConcurrent,
          maxQueue: cfg.concurrency.maxQueue,
          queueTimeoutMs: cfg.concurrency.queueTimeoutMs,
        },
      };
      this.loadServicesFromJson(cfg.servicesJson);
    } else {
      this.envDefaultPolicy = createFallbackDefaultPolicy();
    }
  }

  /** Đăng ký hoặc cập nhật chính sách riêng cho một dịch vụ ngoài */
  public registerService(name: string, input: HttpServicePolicyInput): HttpServicePolicy {
    const normalized = normalizeServiceName(name);
    const prev = this.serviceInputs.get(normalized);
    const mergedInput: HttpServicePolicyInput = {
      ...(prev ?? {}),
      ...input,
      ...(prev?.defaultHeaders || input.defaultHeaders
        ? {
            defaultHeaders: {
              ...(prev?.defaultHeaders ?? {}),
              ...(input.defaultHeaders ?? {}),
            },
          }
        : {}),
      ...(prev?.retry || input.retry
        ? { retry: { ...(prev?.retry ?? {}), ...(input.retry ?? {}) } }
        : {}),
      ...(prev?.circuitBreaker || input.circuitBreaker
        ? {
            circuitBreaker: {
              ...(prev?.circuitBreaker ?? {}),
              ...(input.circuitBreaker ?? {}),
            },
          }
        : {}),
      ...(prev?.concurrency || input.concurrency
        ? {
            concurrency: {
              ...(prev?.concurrency ?? {}),
              ...(input.concurrency ?? {}),
            },
          }
        : {}),
    };
    this.serviceInputs.set(normalized, mergedInput);
    return this.materializeServicePolicy(normalized, mergedInput);
  }

  /** Lấy chính sách đã đăng ký của dịch vụ (nếu có) */
  public getService(name: string): HttpServicePolicy | undefined {
    const normalized = normalizeServiceName(name);
    const input = this.serviceInputs.get(normalized);
    if (!input) return undefined;
    return this.materializeServicePolicy(normalized, input);
  }

  /** Liệt kê toàn bộ chính sách dịch vụ đã đăng ký */
  public listServices(): HttpServicePolicy[] {
    const out: HttpServicePolicy[] = [];
    for (const [name, input] of this.serviceInputs.entries()) {
      out.push(this.materializeServicePolicy(name, input));
    }
    return out;
  }

  /** Lấy chính sách mặc định toàn cục hiện hành (đã hợp nhất Settings động + `.env`) */
  public getDefaultPolicy(): HttpServicePolicy {
    const env = this.envDefaultPolicy;
    const reg = this.settingsRegistry;
    const maxRetriesCap = readDynamicResilienceNumber(
      RESILIENCE_SETTING_KEYS.HTTP_RETRY_MAX_CAP,
      env.retry.maxRetriesCap ?? 5,
      { min: 1, max: HARD_MAX_RETRIES_CAP, round: true, registry: reg },
    );
    const rawMaxRetries = readDynamicResilienceNumber(
      RESILIENCE_SETTING_KEYS.HTTP_RETRY_MAX,
      env.retry.maxRetries,
      { min: 0, max: HARD_MAX_RETRIES_CAP, round: true, registry: reg },
    );

    return {
      name: 'default',
      timeoutMs: readDynamicResilienceNumber(
        RESILIENCE_SETTING_KEYS.HTTP_TIMEOUT_MS,
        env.timeoutMs,
        { min: 100, max: 300_000, round: true, registry: reg },
      ),
      retry: {
        maxRetriesCap,
        maxRetries: clampRetryCount(rawMaxRetries, maxRetriesCap),
        baseDelayMs: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_RETRY_BASE_DELAY_MS,
          env.retry.baseDelayMs,
          { min: 10, max: 30_000, round: true, registry: reg },
        ),
        maxDelayMs: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_RETRY_MAX_DELAY_MS,
          env.retry.maxDelayMs,
          { min: 100, max: 120_000, round: true, registry: reg },
        ),
        jitter: readDynamicResilienceBoolean(
          RESILIENCE_SETTING_KEYS.HTTP_RETRY_JITTER,
          env.retry.jitter,
          { registry: reg },
        ),
        retryableStatusCodes: env.retry.retryableStatusCodes,
        retryNonIdempotent: env.retry.retryNonIdempotent,
        respectRetryAfter: env.retry.respectRetryAfter,
      },
      circuitBreaker: {
        enabled: readDynamicResilienceBoolean(
          RESILIENCE_SETTING_KEYS.HTTP_CB_ENABLED,
          env.circuitBreaker.enabled,
          { registry: reg },
        ),
        failureThreshold: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_CB_FAILURE_THRESHOLD,
          env.circuitBreaker.failureThreshold,
          { min: 1, max: 100, round: true, registry: reg },
        ),
        failureWindowMs: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_CB_FAILURE_WINDOW_MS,
          env.circuitBreaker.failureWindowMs,
          { min: 1_000, max: 600_000, round: true, registry: reg },
        ),
        resetTimeoutMs: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_CB_RESET_TIMEOUT_MS,
          env.circuitBreaker.resetTimeoutMs,
          { min: 1_000, max: 600_000, round: true, registry: reg },
        ),
        halfOpenMaxProbes: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_CB_HALF_OPEN_PROBES,
          env.circuitBreaker.halfOpenMaxProbes,
          { min: 1, max: 20, round: true, registry: reg },
        ),
        halfOpenSuccessThreshold: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_CB_HALF_OPEN_SUCCESS_THRESHOLD,
          env.circuitBreaker.halfOpenSuccessThreshold ?? 1,
          { min: 1, max: 20, round: true, registry: reg },
        ),
      },
      concurrency: {
        enabled: readDynamicResilienceBoolean(
          RESILIENCE_SETTING_KEYS.HTTP_CONCURRENCY_ENABLED,
          env.concurrency.enabled,
          { registry: reg },
        ),
        maxConcurrent: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_MAX_CONCURRENT,
          env.concurrency.maxConcurrent,
          { min: 1, max: 1_000, round: true, registry: reg },
        ),
        maxQueue: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_MAX_QUEUE,
          env.concurrency.maxQueue,
          { min: 0, max: 1_000, round: true, registry: reg },
        ),
        queueTimeoutMs: readDynamicResilienceNumber(
          RESILIENCE_SETTING_KEYS.HTTP_QUEUE_TIMEOUT_MS,
          env.concurrency.queueTimeoutMs,
          { min: 50, max: 60_000, round: true, registry: reg },
        ),
      },
    };
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

  /** Hợp nhất chính sách theo thứ tự: mặc định (Settings/.env) → dịch vụ → từng request */
  public resolvePolicy(serviceName: string, options?: HttpRequestOptions): HttpServicePolicy {
    const normalized = normalizeServiceName(serviceName);
    const serviceInput = this.serviceInputs.get(normalized);
    const base = serviceInput
      ? this.materializeServicePolicy(normalized, serviceInput)
      : { ...this.getDefaultPolicy(), name: normalized };
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

  private materializeServicePolicy(
    normalized: string,
    input: HttpServicePolicyInput,
  ): HttpServicePolicy {
    const base = this.getDefaultPolicy();
    return {
      name: normalized,
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      timeoutMs:
        input.timeoutMs !== undefined && input.timeoutMs > 0
          ? Math.floor(input.timeoutMs)
          : base.timeoutMs,
      ...(input.defaultHeaders ? { defaultHeaders: { ...input.defaultHeaders } } : {}),
      retry: this.mergeRetryPolicy(base.retry, input.retry),
      circuitBreaker: this.mergeCircuitPolicy(base.circuitBreaker, input.circuitBreaker),
      concurrency: this.mergeConcurrencyPolicy(base.concurrency, input.concurrency),
    };
  }

  private mergeRetryPolicy(
    base: HttpRetryPolicy,
    override?: Partial<HttpRetryPolicy>,
  ): HttpRetryPolicy {
    if (!override) return base;
    const cap = Math.min(
      HARD_MAX_RETRIES_CAP,
      Math.max(1, Math.floor(override.maxRetriesCap ?? base.maxRetriesCap ?? 5)),
    );
    return {
      maxRetriesCap: cap,
      maxRetries:
        override.maxRetries !== undefined
          ? clampRetryCount(override.maxRetries, cap)
          : clampRetryCount(base.maxRetries, cap),
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
      halfOpenSuccessThreshold:
        override.halfOpenSuccessThreshold !== undefined
          ? Math.max(1, Math.floor(override.halfOpenSuccessThreshold))
          : (base.halfOpenSuccessThreshold ?? 1),
    };
  }

  private mergeConcurrencyPolicy(
    base: HttpConcurrencyPolicy,
    override?: Partial<HttpConcurrencyPolicy>,
  ): HttpConcurrencyPolicy {
    if (!override) return base;
    return {
      enabled: override.enabled ?? base.enabled,
      maxConcurrent:
        override.maxConcurrent !== undefined
          ? Math.min(1_000, Math.max(1, Math.floor(override.maxConcurrent)))
          : base.maxConcurrent,
      maxQueue:
        override.maxQueue !== undefined
          ? Math.min(1_000, Math.max(0, Math.floor(override.maxQueue)))
          : base.maxQueue,
      queueTimeoutMs:
        override.queueTimeoutMs !== undefined
          ? Math.max(50, Math.floor(override.queueTimeoutMs))
          : base.queueTimeoutMs,
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
      const concurrencyRaw =
        entry['concurrency'] &&
        typeof entry['concurrency'] === 'object' &&
        !Array.isArray(entry['concurrency'])
          ? (entry['concurrency'] as Record<string, unknown>)
          : undefined;

      const baseUrl = typeof entry['baseUrl'] === 'string' ? entry['baseUrl'] : undefined;
      const timeoutMs = asPositiveNumber(entry['timeoutMs']);
      const defaultHeaders = asStringRecord(entry['defaultHeaders']);

      const retryPartial: Partial<HttpRetryPolicy> = {};
      if (retryRaw) {
        const maxRetries = asNonNegativeInt(retryRaw['maxRetries']);
        const maxRetriesCap = asPositiveNumber(retryRaw['maxRetriesCap']);
        const baseDelayMs = asPositiveNumber(retryRaw['baseDelayMs']);
        const maxDelayMs = asPositiveNumber(retryRaw['maxDelayMs']);
        const jitter = asBoolean(retryRaw['jitter']);
        const retryNonIdempotent = asBoolean(retryRaw['retryNonIdempotent']);
        const respectRetryAfter = asBoolean(retryRaw['respectRetryAfter']);
        if (maxRetries !== undefined) Object.assign(retryPartial, { maxRetries });
        if (maxRetriesCap !== undefined) Object.assign(retryPartial, { maxRetriesCap });
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
        const halfOpenSuccessThreshold = asPositiveNumber(cbRaw['halfOpenSuccessThreshold']);
        if (enabled !== undefined) Object.assign(cbPartial, { enabled });
        if (failureThreshold !== undefined) Object.assign(cbPartial, { failureThreshold });
        if (failureWindowMs !== undefined) Object.assign(cbPartial, { failureWindowMs });
        if (resetTimeoutMs !== undefined) Object.assign(cbPartial, { resetTimeoutMs });
        if (halfOpenMaxProbes !== undefined) Object.assign(cbPartial, { halfOpenMaxProbes });
        if (halfOpenSuccessThreshold !== undefined) {
          Object.assign(cbPartial, { halfOpenSuccessThreshold });
        }
      }

      const concurrencyPartial: Partial<HttpConcurrencyPolicy> = {};
      if (concurrencyRaw) {
        const enabled = asBoolean(concurrencyRaw['enabled']);
        const maxConcurrent = asPositiveNumber(concurrencyRaw['maxConcurrent']);
        const maxQueue = asNonNegativeInt(concurrencyRaw['maxQueue']);
        const queueTimeoutMs = asPositiveNumber(concurrencyRaw['queueTimeoutMs']);
        if (enabled !== undefined) Object.assign(concurrencyPartial, { enabled });
        if (maxConcurrent !== undefined) Object.assign(concurrencyPartial, { maxConcurrent });
        if (maxQueue !== undefined) Object.assign(concurrencyPartial, { maxQueue });
        if (queueTimeoutMs !== undefined) Object.assign(concurrencyPartial, { queueTimeoutMs });
      }

      this.registerService(serviceKey, {
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(defaultHeaders !== undefined ? { defaultHeaders } : {}),
        ...(Object.keys(retryPartial).length > 0 ? { retry: retryPartial } : {}),
        ...(Object.keys(cbPartial).length > 0 ? { circuitBreaker: cbPartial } : {}),
        ...(Object.keys(concurrencyPartial).length > 0 ? { concurrency: concurrencyPartial } : {}),
      });
    }
  }
}
