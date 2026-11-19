import { afterEach, describe, expect, it } from '@jest/globals';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  PROVIDER_HEALTH_STATUS,
  PROVIDER_STATUS,
  PROVIDER_TYPE,
  ProviderRegistryService as KernelProviderRegistryService,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import type { HttpClientContract, HttpRawResponse } from '@packages/http-client/index.js';
import { HttpStatusError } from '@packages/http-client/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  SecretService,
} from '@packages/security/index.js';
import type { IOrganizationsPublicService } from '../../../src/modules/organizations/contracts/index.js';
import { ProviderConfigHistoryEntity } from '../../../src/modules/provider-registry/entities/provider-config-history.entity.js';
import { ProviderHealthCheckEntity } from '../../../src/modules/provider-registry/entities/provider-health-check.entity.js';
import { ProviderMetricBucketEntity } from '../../../src/modules/provider-registry/entities/provider-metric-bucket.entity.js';
import { ProviderRegistryEntryEntity } from '../../../src/modules/provider-registry/entities/provider-registry-entry.entity.js';
import { ProviderUnitAssignmentEntity } from '../../../src/modules/provider-registry/entities/provider-unit-assignment.entity.js';
import { PROVIDER_REGISTRY_SETTING_KEYS } from '../../../src/modules/provider-registry/enum/provider-registry.enum.js';
import type { ProviderConfigHistoryRepository } from '../../../src/modules/provider-registry/repositories/provider-config-history.repository.js';
import type { ProviderHealthCheckRepository } from '../../../src/modules/provider-registry/repositories/provider-health-check.repository.js';
import type { ProviderMetricBucketRepository } from '../../../src/modules/provider-registry/repositories/provider-metric-bucket.repository.js';
import type { ProviderRegistryEntryRepository } from '../../../src/modules/provider-registry/repositories/provider-registry-entry.repository.js';
import type { ProviderUnitAssignmentRepository } from '../../../src/modules/provider-registry/repositories/provider-unit-assignment.repository.js';
import { ProviderEntriesService } from '../../../src/modules/provider-registry/services/provider-entries.service.js';
import { ProviderHealthTelemetryService } from '../../../src/modules/provider-registry/services/provider-health-telemetry.service.js';
import { ProviderHistoryService } from '../../../src/modules/provider-registry/services/provider-history.service.js';
import { ProviderRegistryService } from '../../../src/modules/provider-registry/services/provider-registry.service.js';
import { ProviderUnitAssignmentsService } from '../../../src/modules/provider-registry/services/provider-unit-assignments.service.js';

function createRegistryHarness(options?: {
  readonly activeOrgUnitIds?: readonly number[];
  readonly secretsMap?: Record<string, string>;
  readonly httpHandler?: (url: string) => Promise<HttpRawResponse<unknown>>;
}) {
  const settingRegistry = new SettingRegistryService();
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ENABLED, false);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ALLOWED_TYPES, [
    'EMAIL',
    'SMS',
    'PAYMENT',
    'STORAGE',
    'IDENTITY',
  ]);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ON_PAUSED, true);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ON_DOWN, true);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ON_DEGRADED, false);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.UNIT_ROUTING_ENABLED, true);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.HEALTH_CHECK_TIMEOUT_MS, 2000);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.DEGRADED_LATENCY_MS, 500);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.DEGRADED_ERROR_RATE_PCT, 10);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.DOWN_ERROR_RATE_PCT, 50);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.CONSECUTIVE_FAILURES_FOR_DOWN, 2);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.ALLOW_PRIVATE_HEALTH_URLS, false);
  settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.TELEMETRY_WINDOW_MINUTES, 60);

  const kernelRegistry = new KernelProviderRegistryService();
  const encryptionService = new FieldEncryptionService();
  const auditLogService = new AuditLogService();
  const activeOrgUnits = new Set(options?.activeOrgUnitIds ?? [10, 20]);
  const secretsStore = options?.secretsMap ?? {
    EMAIL_SENDGRID_SECRET: 'sg-live-secret-9999',
  };

  let entrySeq = 1;
  let assignSeq = 1;
  let healthSeq = 1;
  let bucketSeq = 1;
  let historySeq = 1;

  const entries = new Map<number, ProviderRegistryEntryEntity>();
  const assignments = new Map<number, ProviderUnitAssignmentEntity>();
  const healthChecks = new Map<number, ProviderHealthCheckEntity>();
  const buckets = new Map<number, ProviderMetricBucketEntity>();
  const histories = new Map<number, ProviderConfigHistoryEntity>();

  const entryRepo = {
    findByIdSafe: async (id: number) => {
      const item = entries.get(Number(id));
      return item && !item.deletedAt ? item : null;
    },
    findByTypeAndCode: async (type: string, code: string, withDeleted = false) => {
      const clean = code.trim().toLowerCase();
      return (
        [...entries.values()].find(
          (e) =>
            (withDeleted || !e.deletedAt) && e.providerType === type && e.providerCode === clean,
        ) ?? null
      );
    },
    listAll: async () =>
      [...entries.values()]
        .filter((e) => !e.deletedAt)
        .sort(
          (a, b) =>
            a.providerType.localeCompare(b.providerType) ||
            Number(b.isPrimary) - Number(a.isPrimary) ||
            a.priority - b.priority ||
            Number(a.id) - Number(b.id),
        ),
    clearPrimaryFlagExcept: async (type: string, excludeId: number) => {
      for (const item of entries.values()) {
        if (
          !item.deletedAt &&
          item.providerType === type &&
          Number(item.id) !== Number(excludeId)
        ) {
          item.isPrimary = false;
        }
      }
    },
    listPaginated: async (filter: {
      page?: number;
      limit?: number;
      providerType?: string;
      status?: number;
      healthStatus?: number;
      isPrimary?: boolean;
      search?: string;
    }) => {
      let list = [...entries.values()].filter((e) => !e.deletedAt);
      if (filter.providerType) list = list.filter((e) => e.providerType === filter.providerType);
      if (filter.status !== undefined) list = list.filter((e) => e.status === filter.status);
      if (filter.healthStatus !== undefined) {
        list = list.filter((e) => e.healthStatus === filter.healthStatus);
      }
      if (filter.isPrimary !== undefined)
        list = list.filter((e) => e.isPrimary === filter.isPrimary);
      if (filter.search?.trim()) {
        const kw = filter.search.trim().toLowerCase();
        list = list.filter(
          (e) =>
            e.providerCode.includes(kw) ||
            e.displayName.toLowerCase().includes(kw) ||
            e.driverCode.includes(kw),
        );
      }
      const page = filter.page ?? 1;
      const limit = filter.limit ?? 20;
      const start = (page - 1) * limit;
      return {
        data: list.slice(start, start + limit),
        meta: {
          page,
          limit,
          total: list.length,
          totalPages: Math.max(1, Math.ceil(list.length / limit)),
          hasNext: start + limit < list.length,
          hasPrev: page > 1,
        },
      };
    },
    saveEntity: async (partial: Partial<ProviderRegistryEntryEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : entrySeq++;
      const existing = entries.get(id);
      const entity = Object.assign(new ProviderRegistryEntryEntity(), existing ?? {}, partial, {
        id,
        healthStatus:
          partial.healthStatus ?? existing?.healthStatus ?? PROVIDER_HEALTH_STATUS.UNKNOWN,
        consecutiveFailures: partial.consecutiveFailures ?? existing?.consecutiveFailures ?? 0,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt:
          partial.deletedAt !== undefined ? partial.deletedAt : (existing?.deletedAt ?? null),
      });
      entries.set(id, entity);
      return entity;
    },
    repository: {
      softDelete: async (criteria: { id: number }) => {
        const item = entries.get(Number(criteria.id));
        if (item) item.deletedAt = new Date();
      },
    },
  } as unknown as ProviderRegistryEntryRepository;

  const unitRepo = {
    findByIdSafe: async (id: number) => {
      const item = assignments.get(Number(id));
      return item && !item.deletedAt ? item : null;
    },
    findByTypeAndOrgUnit: async (type: string, orgUnitId: number, withDeleted = false) =>
      [...assignments.values()].find(
        (a) =>
          (withDeleted || !a.deletedAt) &&
          a.providerType === type &&
          Number(a.organizationUnitId) === Number(orgUnitId),
      ) ?? null,
    listAll: async () => [...assignments.values()].filter((a) => !a.deletedAt),
    clearReferencesToProvider: async (providerId: number) => {
      for (const a of assignments.values()) {
        if (Number(a.fallbackProviderId) === Number(providerId)) {
          a.fallbackProviderId = null;
        }
      }
    },
    listPaginated: async (filter: {
      page?: number;
      limit?: number;
      providerType?: string;
      organizationUnitId?: number;
    }) => {
      let list = [...assignments.values()].filter((a) => !a.deletedAt);
      if (filter.providerType) list = list.filter((a) => a.providerType === filter.providerType);
      if (filter.organizationUnitId !== undefined) {
        list = list.filter(
          (a) => Number(a.organizationUnitId) === Number(filter.organizationUnitId),
        );
      }
      const page = filter.page ?? 1;
      const limit = filter.limit ?? 20;
      const start = (page - 1) * limit;
      return {
        data: list.slice(start, start + limit),
        meta: {
          page,
          limit,
          total: list.length,
          totalPages: Math.max(1, Math.ceil(list.length / limit)),
          hasNext: start + limit < list.length,
          hasPrev: page > 1,
        },
      };
    },
    saveEntity: async (partial: Partial<ProviderUnitAssignmentEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : assignSeq++;
      const existing = assignments.get(id);
      const entity = Object.assign(new ProviderUnitAssignmentEntity(), existing ?? {}, partial, {
        id,
        version: (existing?.version ?? 0) + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        deletedAt:
          partial.deletedAt !== undefined ? partial.deletedAt : (existing?.deletedAt ?? null),
      });
      assignments.set(id, entity);
      return entity;
    },
    repository: {
      softDelete: async (criteria: { id: number }) => {
        const item = assignments.get(Number(criteria.id));
        if (item) item.deletedAt = new Date();
      },
    },
  } as unknown as ProviderUnitAssignmentRepository;

  const healthCheckRepo = {
    listPaginated: async (filter: { providerId: number; page?: number; limit?: number }) => {
      const list = [...healthChecks.values()]
        .filter((h) => Number(h.providerId) === Number(filter.providerId))
        .sort((a, b) => Number(b.id) - Number(a.id));
      const page = filter.page ?? 1;
      const limit = filter.limit ?? 20;
      const start = (page - 1) * limit;
      return {
        data: list.slice(start, start + limit),
        meta: {
          page,
          limit,
          total: list.length,
          totalPages: Math.max(1, Math.ceil(list.length / limit)),
          hasNext: start + limit < list.length,
          hasPrev: page > 1,
        },
      };
    },
    saveEntity: async (partial: Partial<ProviderHealthCheckEntity>) => {
      const id = partial.id ? Number(partial.id) : healthSeq++;
      const now = new Date();
      const entity = Object.assign(new ProviderHealthCheckEntity(), partial, {
        id,
        checkedAt: partial.checkedAt ?? now,
        createdAt: now,
        updatedAt: now,
      });
      healthChecks.set(id, entity);
      return entity;
    },
  } as unknown as ProviderHealthCheckRepository;

  const metricBucketRepo = {
    findBucket: async (providerId: number, bucketStart: Date) =>
      [...buckets.values()].find(
        (b) =>
          Number(b.providerId) === Number(providerId) &&
          b.bucketStart.getTime() === bucketStart.getTime(),
      ) ?? null,
    listBucketsSince: async (params: { since: Date; providerId?: number; providerType?: string }) =>
      [...buckets.values()].filter(
        (b) =>
          b.bucketStart.getTime() >= params.since.getTime() &&
          (params.providerId === undefined || Number(b.providerId) === Number(params.providerId)) &&
          (!params.providerType || b.providerType === params.providerType),
      ),
    saveEntity: async (partial: Partial<ProviderMetricBucketEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : bucketSeq++;
      const existing = buckets.get(id);
      const entity = Object.assign(new ProviderMetricBucketEntity(), existing ?? {}, partial, {
        id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      buckets.set(id, entity);
      return entity;
    },
  } as unknown as ProviderMetricBucketRepository;

  const historyRepo = {
    listPaginated: async (filter: {
      page?: number;
      limit?: number;
      providerId?: number;
      providerType?: string;
      action?: string;
    }) => {
      let list = [...histories.values()].sort((a, b) => Number(b.id) - Number(a.id));
      if (filter.providerId !== undefined) {
        list = list.filter((h) => Number(h.providerId) === Number(filter.providerId));
      }
      if (filter.providerType) {
        list = list.filter((h) => h.providerType === filter.providerType);
      }
      if (filter.action) {
        list = list.filter((h) => h.action === filter.action);
      }
      const page = filter.page ?? 1;
      const limit = filter.limit ?? 20;
      const start = (page - 1) * limit;
      return {
        data: list.slice(start, start + limit),
        meta: {
          page,
          limit,
          total: list.length,
          totalPages: Math.max(1, Math.ceil(list.length / limit)),
          hasNext: start + limit < list.length,
          hasPrev: page > 1,
        },
      };
    },
    saveEntity: async (partial: Partial<ProviderConfigHistoryEntity>) => {
      const now = new Date();
      const id = partial.id ? Number(partial.id) : historySeq++;
      const entity = Object.assign(new ProviderConfigHistoryEntity(), partial, {
        id,
        createdAt: now,
        updatedAt: now,
      });
      histories.set(id, entity);
      return entity;
    },
  } as unknown as ProviderConfigHistoryRepository;

  const organizationsService = {
    ensureActiveUnitsExist: async (ids: readonly number[]) =>
      ids
        .filter((id) => activeOrgUnits.has(Number(id)))
        .map((id) => ({
          id: Number(id),
          code: `UNIT-${id}`,
          name: `Unit ${id}`,
          type: 2,
          typeName: 'BRANCH',
          parentId: null,
          status: 1,
          statusName: 'ACTIVE' as const,
        })),
  } as unknown as IOrganizationsPublicService;

  const secretService = new SecretService({
    getSecret: async (key: string) => secretsStore[key] ?? null,
  });

  const httpClient = {
    requestRaw: async (_method: string, url: string) => {
      if (options?.httpHandler) {
        return options.httpHandler(url);
      }
      return {
        status: 200,
        headers: {},
        data: undefined,
        durationMs: 25,
        attempts: 1,
        service: 'provider-health-check',
        url,
      };
    },
  } as unknown as HttpClientContract;

  const historyService = new ProviderHistoryService(historyRepo, auditLogService);
  const entriesService = new ProviderEntriesService(
    entryRepo,
    unitRepo,
    historyService,
    kernelRegistry,
    settingRegistry,
    encryptionService,
  );
  const unitAssignmentsService = new ProviderUnitAssignmentsService(
    unitRepo,
    entryRepo,
    entriesService,
    historyService,
    organizationsService,
    settingRegistry,
  );
  const healthTelemetryService = new ProviderHealthTelemetryService(
    entryRepo,
    unitRepo,
    healthCheckRepo,
    metricBucketRepo,
    entriesService,
    kernelRegistry,
    settingRegistry,
    httpClient,
    undefined,
    secretService,
  );
  healthTelemetryService.onModuleInit();

  const service = new ProviderRegistryService(
    entriesService,
    unitAssignmentsService,
    healthTelemetryService,
    historyService,
    kernelRegistry,
  );

  const actor = {
    id: 1,
    username: 'admin',
    email: 'admin@core.local',
    roles: ['ADMIN'],
    permissions: ['*'],
  };

  return {
    service,
    kernelRegistry,
    settingRegistry,
    auditLogService,
    entries,
    actor,
    cleanup: () => {
      healthTelemetryService.onModuleDestroy();
      kernelRegistry.clear();
    },
  };
}

describe('Provider Registry (10.6) — Core Behavior', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it('registers all 5 provider types, rejects duplicate codes, and redacts secrets & secretRef safely', async () => {
    const h = createRegistryHarness();
    cleanups.push(h.cleanup);

    const createdTypes = await Promise.all([
      h.service.createProvider(
        {
          providerType: PROVIDER_TYPE.EMAIL,
          providerCode: 'sendgrid-main',
          driverCode: 'sendgrid',
          displayName: 'SendGrid Main',
          isPrimary: true,
          fallbackAllowed: false,
          priority: 10,
          status: PROVIDER_STATUS.ACTIVE,
          secretRef: 'EMAIL_SENDGRID_SECRET',
          secrets: { apiKey: 'SG.plaintext_super_secret_1234' },
          config: { fromAddress: 'noreply@core.local', apiSecret: 'inline-secret-value' },
        },
        h.actor,
      ),
      h.service.createProvider(
        {
          providerType: PROVIDER_TYPE.SMS,
          providerCode: 'twilio-main',
          driverCode: 'twilio',
          displayName: 'Twilio SMS',
          isPrimary: true,
          fallbackAllowed: false,
          priority: 10,
          status: PROVIDER_STATUS.ACTIVE,
          config: {},
        },
        h.actor,
      ),
      h.service.createProvider(
        {
          providerType: PROVIDER_TYPE.PAYMENT,
          providerCode: 'vnpay-main',
          driverCode: 'vnpay',
          displayName: 'VNPay Gateway',
          isPrimary: true,
          fallbackAllowed: false,
          priority: 10,
          status: PROVIDER_STATUS.ACTIVE,
          config: {},
        },
        h.actor,
      ),
      h.service.createProvider(
        {
          providerType: PROVIDER_TYPE.STORAGE,
          providerCode: 's3-main',
          driverCode: 's3',
          displayName: 'MinIO S3',
          isPrimary: true,
          fallbackAllowed: false,
          priority: 10,
          status: PROVIDER_STATUS.ACTIVE,
          config: {},
        },
        h.actor,
      ),
      h.service.createProvider(
        {
          providerType: PROVIDER_TYPE.IDENTITY,
          providerCode: 'google-oidc',
          driverCode: 'google',
          displayName: 'Google OAuth',
          isPrimary: true,
          fallbackAllowed: false,
          priority: 10,
          status: PROVIDER_STATUS.ACTIVE,
          config: {},
        },
        h.actor,
      ),
    ]);

    expect(createdTypes).toHaveLength(5);
    const emailView = createdTypes[0];
    expect(emailView.secretRef).toBe('EMAIL_SENDGRID_SECRET');
    expect(emailView.hasEncryptedSecrets).toBe(true);
    expect(emailView.configuredSecretKeys).toEqual(['apiKey']);
    expect(JSON.stringify(emailView)).not.toContain('SG.plaintext_super_secret_1234');
    expect(JSON.stringify(emailView)).not.toContain('inline-secret-value');

    await expect(
      h.service.createProvider(
        {
          providerType: PROVIDER_TYPE.EMAIL,
          providerCode: 'sendgrid-main',
          driverCode: 'sendgrid',
          displayName: 'Duplicate',
          isPrimary: false,
          fallbackAllowed: false,
          priority: 100,
          status: PROVIDER_STATUS.ACTIVE,
          config: {},
        },
        h.actor,
      ),
    ).rejects.toThrow(ConflictAppException);
  });

  it('switches global primary atomically per type and blocks inactive provider promotion', async () => {
    const h = createRegistryHarness();
    cleanups.push(h.cleanup);

    const p1 = await h.service.createProvider(
      {
        providerType: PROVIDER_TYPE.EMAIL,
        providerCode: 'smtp-primary',
        driverCode: 'smtp',
        displayName: 'SMTP Primary',
        isPrimary: true,
        fallbackAllowed: false,
        priority: 10,
        status: PROVIDER_STATUS.ACTIVE,
        config: {},
      },
      h.actor,
    );
    const p2 = await h.service.createProvider(
      {
        providerType: PROVIDER_TYPE.EMAIL,
        providerCode: 'ses-backup',
        driverCode: 'ses',
        displayName: 'SES Backup',
        isPrimary: false,
        fallbackAllowed: true,
        priority: 20,
        status: PROVIDER_STATUS.ACTIVE,
        config: {},
      },
      h.actor,
    );
    const p3 = await h.service.createProvider(
      {
        providerType: PROVIDER_TYPE.EMAIL,
        providerCode: 'paused-mailer',
        driverCode: 'console',
        displayName: 'Paused Mailer',
        isPrimary: false,
        fallbackAllowed: false,
        priority: 30,
        status: PROVIDER_STATUS.PAUSED,
        config: {},
      },
      h.actor,
    );

    await expect(h.service.setPrimary(p3.id, {}, h.actor)).rejects.toThrow(BadRequestAppException);

    const promoted = await h.service.setPrimary(p2.id, { reason: 'Promote SES' }, h.actor);
    expect(promoted.isPrimary).toBe(true);
    expect((await h.service.getProviderById(p1.id)).isPrimary).toBe(false);

    const preview = await h.service.resolveProviderPreview({ providerType: PROVIDER_TYPE.EMAIL });
    expect(preview.resolved).toBe(true);
    expect(preview.provider?.providerCode).toBe('ses-backup');
    expect(preview.resolutionSource).toBe('GLOBAL_PRIMARY');
  });

  it('enforces fallback policy strictly (only falls back when policy permits)', async () => {
    const h = createRegistryHarness();
    cleanups.push(h.cleanup);

    const primary = await h.service.createProvider(
      {
        providerType: PROVIDER_TYPE.SMS,
        providerCode: 'viettel-main',
        driverCode: 'viettel',
        displayName: 'Viettel Main',
        isPrimary: true,
        fallbackAllowed: false,
        priority: 10,
        status: PROVIDER_STATUS.ACTIVE,
        config: {},
      },
      h.actor,
    );
    await h.service.createProvider(
      {
        providerType: PROVIDER_TYPE.SMS,
        providerCode: 'twilio-fb',
        driverCode: 'twilio',
        displayName: 'Twilio Fallback',
        isPrimary: false,
        fallbackAllowed: true,
        priority: 20,
        status: PROVIDER_STATUS.ACTIVE,
        config: {},
      },
      h.actor,
    );

    // Pause primary while fallback_enabled = false -> must block!
    await h.service.pauseProvider(primary.id, { reason: 'Maintenance window' }, h.actor);
    const blocked = await h.service.resolveProviderPreview({ providerType: PROVIDER_TYPE.SMS });
    expect(blocked.resolved).toBe(false);
    expect(blocked.blockedByPolicy).toBe(true);
    expect(blocked.usedFallback).toBe(false);
    expect(blocked.reason).toBe('PRIMARY_PAUSED_FALLBACK_DISALLOWED');

    // Enable fallback policy -> now routes to twilio-fb
    h.settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.FALLBACK_ENABLED, true);
    const failedOver = await h.service.resolveProviderPreview({ providerType: PROVIDER_TYPE.SMS });
    expect(failedOver.resolved).toBe(true);
    expect(failedOver.usedFallback).toBe(true);
    expect(failedOver.resolutionSource).toBe('GLOBAL_FALLBACK');
    expect(failedOver.provider?.providerCode).toBe('twilio-fb');

    // Resume primary -> switches back to primary immediately without code changes
    await h.service.resumeProvider(primary.id, 'Maintenance finished', h.actor);
    const restored = await h.service.resolveProviderPreview({ providerType: PROVIDER_TYPE.SMS });
    expect(restored.resolved).toBe(true);
    expect(restored.usedFallback).toBe(false);
    expect(restored.provider?.providerCode).toBe('viettel-main');
  });

  it('supports unit-level provider selection, validation, and unit_routing_enabled toggle', async () => {
    const h = createRegistryHarness({ activeOrgUnitIds: [10] });
    cleanups.push(h.cleanup);

    const globalPrimary = await h.service.createProvider(
      {
        providerType: PROVIDER_TYPE.PAYMENT,
        providerCode: 'vnpay-hq',
        driverCode: 'vnpay',
        displayName: 'VNPay HQ',
        isPrimary: true,
        fallbackAllowed: false,
        priority: 10,
        status: PROVIDER_STATUS.ACTIVE,
        config: {},
      },
      h.actor,
    );
    const branchProvider = await h.service.createProvider(
      {
        providerType: PROVIDER_TYPE.PAYMENT,
        providerCode: 'momo-branch10',
        driverCode: 'momo',
        displayName: 'MoMo Branch 10',
        isPrimary: false,
        fallbackAllowed: true,
        priority: 20,
        status: PROVIDER_STATUS.ACTIVE,
        config: {},
      },
      h.actor,
    );
    const branchFallback = await h.service.createProvider(
      {
        providerType: PROVIDER_TYPE.PAYMENT,
        providerCode: 'stripe-branch10-fb',
        driverCode: 'stripe',
        displayName: 'Stripe Fallback',
        isPrimary: false,
        fallbackAllowed: true,
        priority: 30,
        status: PROVIDER_STATUS.ACTIVE,
        config: {},
      },
      h.actor,
    );

    // Non-existent unit -> throws NotFoundAppException
    await expect(
      h.service.upsertUnitAssignment(
        {
          providerType: PROVIDER_TYPE.PAYMENT,
          organizationUnitId: 999,
          primaryProviderId: branchProvider.id,
          isEnabled: true,
        },
        h.actor,
      ),
    ).rejects.toThrow(NotFoundAppException);

    // Same primary & fallback -> throws BadRequestAppException
    await expect(
      h.service.upsertUnitAssignment(
        {
          providerType: PROVIDER_TYPE.PAYMENT,
          organizationUnitId: 10,
          primaryProviderId: branchProvider.id,
          fallbackProviderId: branchProvider.id,
          isEnabled: true,
        },
        h.actor,
      ),
    ).rejects.toThrow(BadRequestAppException);

    // Assign branch 10 -> momo-branch10 primary, stripe-branch10-fb fallback with unit fallback override = true
    const assignment = await h.service.upsertUnitAssignment(
      {
        providerType: PROVIDER_TYPE.PAYMENT,
        organizationUnitId: 10,
        primaryProviderId: branchProvider.id,
        fallbackProviderId: branchFallback.id,
        allowFallbackOverride: true,
        isEnabled: true,
      },
      h.actor,
    );
    expect(assignment.primaryProviderCode).toBe('momo-branch10');

    // Global resolves to vnpay-hq; unit 10 resolves to momo-branch10
    const globalRes = await h.service.resolveProviderPreview({
      providerType: PROVIDER_TYPE.PAYMENT,
    });
    expect(globalRes.provider?.providerCode).toBe(globalPrimary.providerCode);
    expect(globalRes.resolutionSource).toBe('GLOBAL_PRIMARY');

    const unitRes = await h.service.resolveProviderPreview({
      providerType: PROVIDER_TYPE.PAYMENT,
      organizationUnitId: 10,
    });
    expect(unitRes.provider?.providerCode).toBe('momo-branch10');
    expect(unitRes.resolutionSource).toBe('UNIT_PRIMARY');

    // Pause unit primary -> unit allowFallbackOverride=true fails over even though global fallback_enabled=false!
    await h.service.pauseProvider(branchProvider.id, { reason: 'MoMo outage' }, h.actor);
    const unitFallbackRes = await h.service.resolveProviderPreview({
      providerType: PROVIDER_TYPE.PAYMENT,
      organizationUnitId: 10,
    });
    expect(unitFallbackRes.resolved).toBe(true);
    expect(unitFallbackRes.usedFallback).toBe(true);
    expect(unitFallbackRes.resolutionSource).toBe('UNIT_FALLBACK');
    expect(unitFallbackRes.provider?.providerCode).toBe('stripe-branch10-fb');

    // Disable unit routing -> reverts to global primary
    h.settingRegistry.setGlobalValue(PROVIDER_REGISTRY_SETTING_KEYS.UNIT_ROUTING_ENABLED, false);
    const disabledRoutingRes = await h.service.resolveProviderPreview({
      providerType: PROVIDER_TYPE.PAYMENT,
      organizationUnitId: 10,
    });
    expect(disabledRoutingRes.provider?.providerCode).toBe('vnpay-hq');
    expect(disabledRoutingRes.resolutionSource).toBe('GLOBAL_PRIMARY');
  });

  it('tracks health checks (Healthy/Degraded/Down/Unknown), blocks SSRF URLs, tracks latency/error rate, and writes audit histories', async () => {
    let httpBehavior: 'ok' | 'slow' | 'error503' = 'ok';
    const h = createRegistryHarness({
      httpHandler: async (url) => {
        if (httpBehavior === 'error503') {
          throw new HttpStatusError({
            service: 'provider-health-check',
            method: 'GET',
            url,
            status: 503,
            retryable: true,
            responseSnippet: 'Service Unavailable',
            attempts: 1,
            durationMs: 42,
          });
        }
        return {
          status: 200,
          headers: {},
          data: undefined,
          durationMs: httpBehavior === 'slow' ? 750 : 35,
          attempts: 1,
          service: 'provider-health-check',
          url,
        };
      },
    });
    cleanups.push(h.cleanup);

    // SSRF rejection for private/metadata URLs
    await expect(
      h.service.createProvider(
        {
          providerType: PROVIDER_TYPE.EMAIL,
          providerCode: 'ssrf-test',
          driverCode: 'sendgrid',
          displayName: 'SSRF Test',
          isPrimary: false,
          fallbackAllowed: false,
          priority: 50,
          status: PROVIDER_STATUS.ACTIVE,
          config: { healthCheckUrl: 'http://169.254.169.254/latest/meta-data' },
        },
        h.actor,
      ),
    ).rejects.toThrow(BadRequestAppException);

    const provider = await h.service.createProvider(
      {
        providerType: PROVIDER_TYPE.EMAIL,
        providerCode: 'sendgrid-monitored',
        driverCode: 'sendgrid',
        displayName: 'SendGrid Monitored',
        isPrimary: true,
        fallbackAllowed: false,
        priority: 10,
        status: PROVIDER_STATUS.ACTIVE,
        secretRef: 'EMAIL_SENDGRID_SECRET',
        config: { healthCheckUrl: 'https://api.sendgrid.example.com/health' },
      },
      h.actor,
    );

    // Before first check: UNKNOWN and honest null telemetry
    expect(provider.healthStatusName).toBe('UNKNOWN');
    const initialDash = await h.service.getDashboard({ providerType: PROVIDER_TYPE.EMAIL });
    expect(initialDash.totals.unknownCount).toBe(1);
    expect(initialDash.totals.overallAvgLatencyMs).toBeNull();
    expect(initialDash.totals.overallErrorRatePercent).toBeNull();
    expect(initialDash.providers[0]?.telemetry.available).toBe(false);

    // Healthy probe
    httpBehavior = 'ok';
    const hcHealthy = await h.service.checkProviderHealth(provider.id, h.actor);
    expect(hcHealthy.healthStatusName).toBe('HEALTHY');
    expect(hcHealthy.latencyMs).toBe(35);

    // Slow latency (>= 500ms threshold) -> DEGRADED
    httpBehavior = 'slow';
    const hcDegraded = await h.service.checkProviderHealth(provider.id, h.actor);
    expect(hcDegraded.healthStatusName).toBe('DEGRADED');
    expect(hcDegraded.errorCode).toBe('HIGH_LATENCY');

    // HTTP 503 error -> DOWN
    httpBehavior = 'error503';
    const hcDown = await h.service.checkProviderHealth(provider.id, h.actor);
    expect(hcDown.healthStatusName).toBe('DOWN');
    expect(hcDown.httpStatus).toBe(503);

    // Record runtime observations -> verify latency avg, p95, error rate & passive dashboard metrics
    await h.service.recordManualObservation(provider.id, { success: true, latencyMs: 100 });
    await h.service.recordManualObservation(provider.id, { success: true, latencyMs: 200 });
    await h.service.recordManualObservation(provider.id, {
      success: false,
      latencyMs: 300,
      errorCode: 'SMTP_TIMEOUT',
    });

    const dash = await h.service.getDashboard({ providerType: PROVIDER_TYPE.EMAIL });
    expect(dash.totals.totalObservations).toBe(3);
    expect(dash.totals.totalErrors).toBe(1);
    expect(dash.totals.overallAvgLatencyMs).toBe(200);
    expect(dash.totals.overallErrorRatePercent).toBe(33.33);
    expect(dash.providers[0]?.telemetry.p95LatencyMs).toBe(300);

    // Verify Pause + Update + Audit history & AuditLogService records
    await h.service.updateProvider(
      provider.id,
      { displayName: 'SendGrid Renamed', reason: 'Update display label' },
      h.actor,
    );
    await h.service.pauseProvider(provider.id, { reason: 'Manual pause drill' }, h.actor);
    await h.service.resumeProvider(provider.id, 'Resolved incident', h.actor);

    const histories = await h.service.listHistories({ providerId: provider.id });
    const actions = histories.data.map((item) => item.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
    expect(actions).toContain('PAUSE');
    expect(actions).toContain('RESUME');

    const auditLogs = await h.auditLogService.listPaginated({ module: 'provider-registry' });
    expect(auditLogs.data.length).toBeGreaterThanOrEqual(4);
  });
});
