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
import { StorageConnectionService } from './storage-connection.service.js';
import { StorageMonitoringService } from '../monitoring/storage-monitoring.service.js';
import { StorageOperationsService } from '../operations/storage-operations.service.js';

export const STORAGE_TEST_ACTION = 'test_storage';

/** Trạng thái/thao tác cơ bản cho Package Registry. Chi tiết ở trang Storage (`/ops/storage/*`). */
@Injectable()
export class StorageManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.STORAGE;
  public readonly category = PackageCategory.STORAGE;
  public readonly icon = 'hard-drive';

  constructor(
    private readonly connection: StorageConnectionService,
    private readonly monitoring: StorageMonitoringService,
    private readonly operations: StorageOperationsService,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.storage.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const status = this.connection.getStatus();
    const info = this.monitoring.provider.info();
    const usage = await this.monitoring.storedUsage().catch(() => null);
    return {
      status:
        status.state === 'connected'
          ? PackageStatus.HEALTHY
          : status.state === 'unavailable'
            ? PackageStatus.ERROR
            : PackageStatus.WARNING,
      summary: this.i18n.t('ops.storage.summary', {
        product: info.product,
        state: this.i18n.t(`storage.connection.${status.state}`),
      }),
      metrics: {
        driver: info.driver,
        product: info.product,
        state: status.state,
        ...(usage ? { objects: usage.totalObjects, bytes: usage.totalBytes } : {}),
      },
    };
  }

  public getActions(): PackageActionDescriptor[] {
    return [
      {
        id: STORAGE_TEST_ACTION,
        label: this.i18n.t('ops.storage.test.label'),
        description: this.i18n.t('ops.storage.test.description'),
        isDanger: false,
      },
    ];
  }

  public async executeAction(actionId: string): Promise<PackageActionResult> {
    if (actionId !== STORAGE_TEST_ACTION)
      return {
        success: false,
        message: this.i18n.t('ops.action.unsupported', { actionId, packageId: this.packageId }),
      };
    const result = await this.operations.test({ ip: null, actor: null });
    return {
      success: result.ok,
      message: result.ok
        ? this.i18n.t('ops.storage.test.ok', { ms: result.totalMs })
        : this.i18n.t('ops.storage.test.failed', { step: result.failedStep ?? '' }),
    };
  }
}
