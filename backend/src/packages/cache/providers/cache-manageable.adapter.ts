import { Injectable } from '@nestjs/common';
import {
  type ManageablePackage,
  type PackageActionDescriptor,
  type PackageActionResult,
  type PackageStatusReport,
  PackageStatus,
  PackageCategory,
  CorePackageId,
} from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { CacheAction } from '../constants/cache.constant.js';
import { BaseCacheProvider } from './cache.provider.js';
import { CacheConnectionService } from './cache-connection.service.js';
import { CacheMonitoringService } from '../monitoring/cache-monitoring.service.js';
import {
  CacheOperationError,
  CacheOperationsService,
} from '../operations/cache-operations.service.js';

/** Trạng thái/thao tác cơ bản cho Package Registry. Chi tiết nằm ở trang Cache (`/ops/cache/*`). */
@Injectable()
export class CacheManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.CACHE;
  public readonly category = PackageCategory.CACHE;
  public readonly icon = 'database-zap';

  constructor(
    private readonly cache: BaseCacheProvider,
    private readonly connection: CacheConnectionService,
    private readonly monitoring: CacheMonitoringService,
    private readonly operations: CacheOperationsService,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.cache.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const status = this.connection.getStatus();
    const keyspace = await this.monitoring.storedKeyspace().catch(() => null);
    const up = status.state === 'connected';
    // Hit/miss của process đang phục vụ (API) từ lúc khởi động; chi tiết toàn hệ thống ở trang Cache.
    const stats = this.cache.getStats();
    return {
      status: up
        ? PackageStatus.HEALTHY
        : status.state === 'unavailable'
          ? PackageStatus.ERROR
          : PackageStatus.WARNING,
      summary: this.i18n.t('ops.cache.summary', {
        driver: this.monitoring.driver,
        state: this.i18n.t(`cache.connection.${status.state}`),
      }),
      metrics: {
        driver: this.monitoring.driver,
        state: status.state,
        ...(keyspace ? { keys: keyspace.totalKeys } : {}),
        hits: stats.hits,
        misses: stats.misses,
        hitRatePercent: stats.hitRatePercent ?? 'n/a',
      },
    };
  }

  public getActions(): PackageActionDescriptor[] {
    return [
      {
        id: CacheAction.FLUSH_ALL,
        label: this.i18n.t('ops.cache.flush.label'),
        description: this.i18n.t('ops.cache.flush.description'),
        isDanger: true,
      },
    ];
  }

  public async executeAction(actionId: string): Promise<PackageActionResult> {
    if (actionId !== CacheAction.FLUSH_ALL)
      return {
        success: false,
        message: this.i18n.t('ops.action.unsupported', { actionId, packageId: this.packageId }),
      };
    try {
      const { record } = await this.operations.flushAll({ ip: null, actor: null });
      return {
        success: true,
        message: this.i18n.t('ops.cache.flush.success', { count: record.affected }),
      };
    } catch (err) {
      const code = err instanceof CacheOperationError ? err.code : 'FAILED';
      return { success: false, message: this.i18n.t(`cache.error.${code}`) };
    }
  }
}
