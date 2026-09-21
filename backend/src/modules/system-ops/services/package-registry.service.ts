import { Injectable, OnModuleInit } from '@nestjs/common';
import type {
  ManageablePackage,
  PackageStatusReport,
  PackageActionDescriptor,
} from '@packages/kernel/index.js';
import { CacheManageableAdapter } from '@packages/cache/index.js';
import { LoggingManageableAdapter } from '@packages/logging/index.js';

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
  ) {}

  public onModuleInit(): void {
    // Đăng ký các adapter cốt lõi đã có
    this.register(this.cacheAdapter);
    this.register(this.loggingAdapter);
  }

  /**
   * Đăng ký thêm một package vào hệ thống quản trị
   */
  public register(pkg: ManageablePackage): void {
    this.packages.set(pkg.packageId, pkg);
  }

  /**
   * Hủy đăng ký package
   */
  public unregister(packageId: string): void {
    this.packages.delete(packageId);
  }

  /**
   * Lấy package theo định danh
   */
  public getPackage(packageId: string): ManageablePackage | undefined {
    return this.packages.get(packageId);
  }

  /**
   * Lấy danh sách tóm tắt toàn bộ package đã đăng ký kèm status và actions
   */
  public async getAllSummaries(): Promise<PackageSummaryDto[]> {
    const summaries: PackageSummaryDto[] = [];

    for (const pkg of this.packages.values()) {
      try {
        const statusReport = await pkg.getStatus();
        const actions = pkg.getActions ? pkg.getActions() : [];

        summaries.push({
          packageId: pkg.packageId,
          displayName: pkg.displayName,
          category: pkg.category,
          icon: pkg.icon,
          statusReport,
          actions,
        });
      } catch {
        continue;
      }
    }

    return summaries;
  }

  /**
   * Thực thi hành động trên một package cụ thể
   */
  public async executeAction(
    packageId: string,
    actionId: string,
    params?: unknown,
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    const pkg = this.getPackage(packageId);
    if (!pkg) {
      return {
        success: false,
        message: `Package [${packageId}] không tồn tại trong hệ thống quản trị.`,
      };
    }

    if (!pkg.executeAction) {
      return {
        success: false,
        message: `Package [${packageId}] không hỗ trợ bất kỳ hành động điều khiển nào.`,
      };
    }

    return pkg.executeAction(actionId, params);
  }
}
