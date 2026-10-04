import { Injectable } from '@nestjs/common';
import {
  CorePackageId,
  PackageCategory,
  PackageStatus,
  type ManageablePackage,
  type PackageStatusReport,
} from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { MetricsRegistryService } from './metrics-registry.service.js';
import { PrometheusQueryClient } from './prometheus-query.client.js';

@Injectable()
export class MetricsManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.METRICS;
  public readonly category = PackageCategory.CUSTOM;
  public readonly icon = 'activity';

  constructor(
    private readonly registry: MetricsRegistryService,
    private readonly prometheus: PrometheusQueryClient,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.metrics.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const prom = await this.prometheus.status();
    const state = !prom.configured ? 'disabled' : prom.up ? 'up' : 'down';
    return {
      status: !prom.configured
        ? PackageStatus.IDLE
        : prom.up
          ? PackageStatus.HEALTHY
          : PackageStatus.WARNING,
      summary: this.i18n.t('ops.metrics.summary', { state }),
      metrics: {
        runtime: this.registry.runtime,
        metricFamilies: this.registry.metricCount(),
        prometheus: state,
        prometheusUrl: prom.url ?? '',
        ...(prom.error ? { prometheusError: prom.error } : {}),
      },
    };
  }
}
