import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PackageRegistryService } from '@modules/system-ops/services/package-registry.service.js';
import {
  type ManageablePackage,
  PackageStatus,
  PackageCategory,
  CorePackageId,
} from '@packages/kernel/index.js';
import { type CacheManageableAdapter, CacheAction } from '@packages/cache/index.js';
import type { LoggingManageableAdapter } from '@packages/logging/index.js';
import type { DatabaseManageableAdapter } from '@packages/database/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { OpsEventService } from '@modules/system-ops/services/ops-event.service.js';
import type { SecurityManageableAdapter } from '@packages/security/index.js';

describe('PackageRegistryService Unit Tests', () => {
  let mockCacheAdapter: jest.Mocked<CacheManageableAdapter>;
  let mockLoggingAdapter: jest.Mocked<LoggingManageableAdapter>;
  let mockDatabaseAdapter: jest.Mocked<DatabaseManageableAdapter>;
  let mockSecurityAdapter: jest.Mocked<SecurityManageableAdapter>;
  let service: PackageRegistryService;

  beforeEach(() => {
    mockCacheAdapter = {
      packageId: CorePackageId.CACHE,
      displayName: 'Redis Cache',
      category: PackageCategory.CACHE,
      icon: 'database-zap',
      getStatus: jest.fn().mockImplementation(async () => ({
        status: PackageStatus.HEALTHY,
        summary: 'Connected',
        metrics: { keys: 100 },
      })),
      getActions: jest
        .fn()
        .mockReturnValue([{ id: CacheAction.FLUSH_ALL, label: 'Flush Cache', isDanger: true }]),
      executeAction: jest.fn().mockImplementation(async () => ({
        success: true,
        message: 'Cache cleared',
      })),
    } as unknown as jest.Mocked<CacheManageableAdapter>;

    mockLoggingAdapter = {
      packageId: CorePackageId.LOGGING,
      displayName: 'Structured Logging',
      category: PackageCategory.LOGGING,
      icon: 'scroll-text',
      getStatus: jest.fn().mockImplementation(async () => ({
        status: PackageStatus.HEALTHY,
        summary: 'Level INFO',
        metrics: { currentLevel: 'INFO' },
      })),
      getActions: jest.fn().mockReturnValue([]),
      executeAction: jest.fn().mockImplementation(async () => ({
        success: true,
        message: 'Level changed',
      })),
    } as unknown as jest.Mocked<LoggingManageableAdapter>;

    mockDatabaseAdapter = {
      packageId: CorePackageId.DATABASE,
      displayName: 'Relational Database',
      category: PackageCategory.DATABASE,
      icon: 'database',
      getStatus: jest.fn().mockImplementation(async () => ({
        status: PackageStatus.HEALTHY,
        summary: 'Connected MySQL',
        metrics: { driver: 'MYSQL' },
      })),
      getActions: jest.fn().mockReturnValue([]),
      executeAction: jest.fn().mockImplementation(async () => ({
        success: true,
        message: 'Ping OK',
      })),
    } as unknown as jest.Mocked<DatabaseManageableAdapter>;

    mockSecurityAdapter = {
      packageId: CorePackageId.SECURITY,
      displayName: 'Security & Auth',
      category: PackageCategory.CUSTOM,
      icon: 'shield-check',
      getStatus: jest.fn().mockImplementation(async () => ({
        status: PackageStatus.WARNING,
        summary: 'Skeleton verifier',
        metrics: {},
      })),
    } as unknown as jest.Mocked<SecurityManageableAdapter>;

    const i18n = new CoreI18nService();
    service = new PackageRegistryService(
      mockCacheAdapter,
      mockLoggingAdapter,
      mockDatabaseAdapter,
      mockSecurityAdapter,
      i18n,
      new OpsEventService(i18n),
    );
    service.onModuleInit();
  });

  it('should auto-register default adapters on module init', async () => {
    const summaries = await service.getAllSummaries();
    expect(summaries).toHaveLength(4);

    const cacheSummary = summaries.find((s) => s.packageId === CorePackageId.CACHE);
    expect(cacheSummary).toBeDefined();
    expect(cacheSummary?.statusReport.status).toBe(PackageStatus.HEALTHY);
    expect(cacheSummary?.actions).toHaveLength(1);

    const dbSummary = summaries.find((s) => s.packageId === CorePackageId.DATABASE);
    expect(dbSummary).toBeDefined();
    expect(dbSummary?.category).toBe(PackageCategory.DATABASE);
  });

  it('should dynamically register a new package and include it in summaries', async () => {
    const newElasticSearchPackage: ManageablePackage = {
      packageId: 'elasticsearch',
      displayName: 'Elasticsearch Cluster',
      category: PackageCategory.CUSTOM,
      icon: 'search',
      getStatus: async () => ({
        status: PackageStatus.WARNING,
        summary: 'High memory usage',
        metrics: { indices: 12, memoryMb: 512 },
      }),
      getActions: () => [{ id: 'reindex', label: 'Reindex All', isDanger: false }],
      executeAction: async (actionId) => ({
        success: true,
        message: `Action ${actionId} executed`,
      }),
    };

    service.register(newElasticSearchPackage);

    const summaries = await service.getAllSummaries();
    expect(summaries).toHaveLength(5);

    const searchSummary = summaries.find((s) => s.packageId === 'elasticsearch');
    expect(searchSummary).toBeDefined();
    expect(searchSummary?.displayName).toBe('Elasticsearch Cluster');
    expect(searchSummary?.statusReport.status).toBe(PackageStatus.WARNING);
  });

  it('should execute package actions successfully', async () => {
    const result = await service.executeAction(CorePackageId.CACHE, CacheAction.FLUSH_ALL);
    expect(result.success).toBe(true);
    expect(mockCacheAdapter.executeAction).toHaveBeenCalledWith(CacheAction.FLUSH_ALL, undefined);
  });

  it('should return error when executing action on non-existent package', async () => {
    const result = await service.executeAction('non_existent', 'test_action');
    expect(result.success).toBe(false);
    expect(result.message).toContain('không tồn tại');
  });

  it('should unregister package correctly', async () => {
    service.unregister(CorePackageId.CACHE);
    expect(service.getPackage(CorePackageId.CACHE)).toBeUndefined();

    const summaries = await service.getAllSummaries();
    expect(summaries).toHaveLength(3);
    expect(summaries.some((s) => s.packageId === CorePackageId.LOGGING)).toBe(true);
    expect(summaries.some((s) => s.packageId === CorePackageId.DATABASE)).toBe(true);
  });

  it('should keep a package in the list with ERROR status when getStatus throws', async () => {
    mockCacheAdapter.getStatus.mockRejectedValueOnce(new Error('Redis down'));

    const summaries = await service.getAllSummaries();
    const cacheSummary = summaries.find((s) => s.packageId === CorePackageId.CACHE);

    expect(summaries).toHaveLength(4);
    expect(cacheSummary?.statusReport.status).toBe(PackageStatus.ERROR);
    expect(cacheSummary?.statusReport.summary).toBe('Redis down');
  });

  it('should throw NOT_FOUND when requesting summary of an unknown package', async () => {
    await expect(service.getSummary('unknown_pkg')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });
});
