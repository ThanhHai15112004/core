import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  type ManageablePackage,
  type PackageStatusReport,
  type PackageActionDescriptor,
  type PackageActionResult,
  NotFoundAppException,
  PackageStatus,
} from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { CacheManageableAdapter } from '@packages/cache/index.js';
import { LoggingManageableAdapter } from '@packages/logging/index.js';
import { DatabaseManageableAdapter } from '@packages/database/index.js';
import { SecurityManageableAdapter } from '@packages/security/index.js';
import { StorageManageableAdapter } from '@packages/storage/index.js';
import { OpsEventService } from './ops-event.service.js';

export interface PackageSummaryDto {
  packageId: string;
  displayName: string;
  category: string;
  icon: string;
  statusReport: PackageStatusReport;
  actions: PackageActionDescriptor[];
}

@Injectable()
export class PackageRegistryService implements OnModuleInit {
  private readonly packages = new Map<string, ManageablePackage>();

  constructor(
    private readonly cacheAdapter: CacheManageableAdapter,
    private readonly loggingAdapter: LoggingManageableAdapter,
    private readonly databaseAdapter: DatabaseManageableAdapter,
    private readonly securityAdapter: SecurityManageableAdapter,
    private readonly storageAdapter: StorageManageableAdapter,
    private readonly i18n: CoreI18nService,
    private readonly events: OpsEventService,
  ) {}

  public onModuleInit(): void {
    this.register(this.cacheAdapter);
    this.register(this.loggingAdapter);
    this.register(this.databaseAdapter);
    this.register(this.securityAdapter);
    this.register(this.storageAdapter);
  }

  public register(pkg: ManageablePackage): void {
    this.packages.set(pkg.packageId, pkg);
  }

  public unregister(packageId: string): void {
    this.packages.delete(packageId);
  }

  public getPackage(packageId: string): ManageablePackage | undefined {
    return this.packages.get(packageId);
  }

  /** Lấy package hoặc ném 404 nếu chưa được đăng ký. */
  public getPackageOrFail(packageId: string): ManageablePackage {
    const pkg = this.packages.get(packageId);
    if (!pkg) {
      throw new NotFoundAppException('ops.package.notFound', { packageId });
    }
    return pkg;
  }

  public async getAllSummaries(): Promise<PackageSummaryDto[]> {
    return Promise.all([...this.packages.values()].map((pkg) => this.toSummary(pkg)));
  }

  public async getSummary(packageId: string): Promise<PackageSummaryDto> {
    return this.toSummary(this.getPackageOrFail(packageId));
  }

  public async executeAction(
    packageId: string,
    actionId: string,
    params?: unknown,
  ): Promise<PackageActionResult> {
    const pkg = this.getPackage(packageId);
    if (!pkg) {
      return { success: false, message: this.i18n.t('ops.package.notFound', { packageId }) };
    }

    if (!pkg.executeAction) {
      return { success: false, message: this.i18n.t('ops.package.noActions', { packageId }) };
    }

    const result = await pkg.executeAction(actionId, params);
    this.events.record(
      result.success ? 'success' : 'warn',
      pkg.displayName,
      result.success ? 'ops.event.actionSucceeded' : 'ops.event.actionFailed',
      { actionId, message: result.message },
    );
    return result;
  }

  /** Package lỗi khi lấy status vẫn được trả về với trạng thái ERROR thay vì bị ẩn đi. */
  private async toSummary(pkg: ManageablePackage): Promise<PackageSummaryDto> {
    let statusReport: PackageStatusReport;
    try {
      statusReport = await pkg.getStatus();
    } catch (error) {
      statusReport = {
        status: PackageStatus.ERROR,
        summary: error instanceof Error ? error.message : String(error),
        metrics: {},
      };
    }

    this.events.trackStatus(pkg.packageId, pkg.displayName, statusReport.status);

    return {
      packageId: pkg.packageId,
      displayName: pkg.displayName,
      category: pkg.category,
      icon: pkg.icon,
      statusReport,
      actions: pkg.getActions?.() ?? [],
    };
  }
}
