import { Injectable } from '@nestjs/common';
import {
  type ManageablePackage,
  type PackageActionDescriptor,
  type PackageStatusReport,
  PackageStatus,
  PackageCategory,
  CorePackageId,
} from '@packages/kernel/index.js';
import { CoreConfigService } from '@packages/config/index.js';
import { BaseCacheProvider } from './cache.provider.js';
import { CacheAction } from '../constants/cache.constant.js';

@Injectable()
export class CacheManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.CACHE;
  public readonly displayName = 'Bộ nhớ đệm (Redis Cache)';
  public readonly category = PackageCategory.CACHE;
  public readonly icon = 'database-zap';

  constructor(
    private readonly cacheProvider: BaseCacheProvider,
    private readonly configService: CoreConfigService,
  ) {}

  public async getStatus(): Promise<PackageStatusReport> {
    const { host, port, prefix } = this.configService.cache.redis;

    return {
      status: PackageStatus.HEALTHY,
      summary: `Kết nối Redis ${host}:${port} với tiền tố "${prefix}"`,
      metrics: {
        host,
        port,
        prefix,
        status: 'online',
      },
    };
  }

  public getActions(): PackageActionDescriptor[] {
    return [
      {
        id: CacheAction.FLUSH_ALL,
        label: 'Xoá toàn bộ Cache',
        description: 'Xoá sạch toàn bộ các key trong bộ nhớ đệm Redis',
        isDanger: true,
      },
    ];
  }

  public async executeAction(
    actionId: string,
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    if (actionId === CacheAction.FLUSH_ALL) {
      await this.cacheProvider.clear();
      return {
        success: true,
        message: 'Đã xoá sạch toàn bộ bộ nhớ đệm Cache thành công.',
      };
    }

    return {
      success: false,
      message: `Hành động "${actionId}" không được hỗ trợ bởi Cache package.`,
    };
  }
}
