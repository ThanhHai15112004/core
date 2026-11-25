import { Injectable } from '@nestjs/common';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  CorePackageId,
  PackageCategory,
  PackageStatus,
  type ManageablePackage,
  type PackageActionDescriptor,
  type PackageActionResult,
  type PackageStatusReport,
} from '@packages/kernel/index.js';
import { TracingSdkService } from './tracing-sdk.service.js';

@Injectable()
export class TracingManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.TRACING;
  public readonly category = PackageCategory.LOGGING;
  public readonly icon = 'activity';

  constructor(
    private readonly sdk: TracingSdkService,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.tracing.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const stats = this.sdk.getStats();
    const state = stats.enabled ? 'enabled' : 'disabled';
    return {
      status: stats.enabled ? PackageStatus.HEALTHY : PackageStatus.IDLE,
      summary: this.i18n.t('ops.tracing.summary', {
        state,
        exporter: stats.exporter,
        ratio: Math.round(stats.samplingRatio * 100),
      }),
      metrics: {
        enabled: stats.enabled,
        serviceName: stats.serviceName,
        exporter: stats.exporter,
        sampler: stats.sampler,
        samplingRatio: stats.samplingRatio,
        bufferedSpans: stats.bufferedSpans,
        exportedSpans: stats.exportedSpans,
        droppedSpans: stats.droppedSpans,
      },
    };
  }

  public getActions(): PackageActionDescriptor[] {
    return [];
  }

  public async executeAction(actionId: string): Promise<PackageActionResult> {
    return {
      success: false,
      message: this.i18n.t('ops.action.unsupported', {
        actionId,
        packageId: this.packageId,
      }),
    };
  }
}
