import { Injectable } from '@nestjs/common';
import {
  CorePackageId,
  PackageCategory,
  PackageStatus,
  type ManageablePackage,
  type PackageStatusReport,
} from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { RedisService } from '@packages/redis/index.js';
import { runtimeKeys } from '../constants/runtime.keys.js';
import { LONG_RUNNING_RUNTIMES } from '../contracts/runtime.types.js';

@Injectable()
export class RuntimeManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.RUNTIME;
  public readonly category = PackageCategory.CUSTOM;
  public readonly icon = 'cpu';

  constructor(
    private readonly redis: RedisService,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.runtime.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    if (!this.redis.isReady()) {
      return {
        status: PackageStatus.WARNING,
        summary: 'Redis unavailable for runtime heartbeat',
        metrics: { aliveCount: 0 },
      };
    }

    const keys = runtimeKeys(this.redis);
    const rawList = await this.redis.client.mget(
      ...LONG_RUNNING_RUNTIMES.map((id) => keys.heartbeat(id)),
    );
    const aliveCount = rawList.filter(Boolean).length;

    return {
      status: aliveCount > 0 ? PackageStatus.HEALTHY : PackageStatus.WARNING,
      summary: `Active runtimes: ${aliveCount}/${LONG_RUNNING_RUNTIMES.length}`,
      metrics: {
        aliveCount,
        total: LONG_RUNNING_RUNTIMES.length,
      },
    };
  }
}
