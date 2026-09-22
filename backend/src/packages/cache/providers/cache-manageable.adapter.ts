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
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { BaseCacheProvider } from './cache.provider.js';
import { CacheAction } from '../constants/cache.constant.js';

@Injectable()
export class CacheManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.CACHE;
  public readonly category = PackageCategory.CACHE;
  public readonly icon = 'database-zap';

  constructor(
    private readonly cacheProvider: BaseCacheProvider,
    private readonly configService: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.cache.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const { host, port, prefix } = this.configService.cache.redis;

    return {
      status: PackageStatus.HEALTHY,
      summary: this.i18n.t('ops.cache.summary', { host, port, prefix }),
      metrics: {
        driver: 'memory',
        configuredRedis: `${host}:${port}`,
        prefix,
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
    if (actionId === CacheAction.FLUSH_ALL) {
      await this.cacheProvider.clear();
      return { success: true, message: this.i18n.t('ops.cache.flush.success') };
    }

    return {
      success: false,
      message: this.i18n.t('ops.action.unsupported', { actionId, packageId: this.packageId }),
    };
  }
}
