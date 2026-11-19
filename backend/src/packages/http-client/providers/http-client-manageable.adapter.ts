import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
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
import { HttpServiceRegistry } from '../config/http-service-registry.js';
import { HttpClientMetricsService } from '../monitoring/http-client-metrics.service.js';
import { CircuitBreakerRegistry } from '../resilience/circuit-breaker.registry.js';

const ACTION_RESET_ALL_CIRCUITS = 'reset-all-circuits';

/** Adapter để System Console (`/ops/packages`) giám sát và điều khiển HTTP Client dùng chung */
@Injectable()
export class HttpClientManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.HTTP_CLIENT;
  public readonly category = PackageCategory.CUSTOM;
  public readonly icon = 'globe';

  constructor(
    private readonly registry: HttpServiceRegistry,
    private readonly circuitBreaker: CircuitBreakerRegistry,
    private readonly metrics: HttpClientMetricsService,
    @Optional() private readonly config?: CoreConfigService,
    @Optional() private readonly i18n?: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.t('ops.httpClient.displayName', {}, 'Outbound HTTP Client');
  }

  /** Tổng hợp trạng thái các mạch Circuit Breaker, số lượng dịch vụ và tỷ lệ lỗi outbound */
  public async getStatus(): Promise<PackageStatusReport> {
    const circuits = this.circuitBreaker.listSnapshots();
    const openCircuits = circuits.filter((c) => c.state === 'OPEN').length;
    const halfOpenCircuits = circuits.filter((c) => c.state === 'HALF_OPEN').length;
    const totals = this.metrics.getTotals();
    const serviceNames = new Set<string>([
      ...this.registry.listServices().map((s) => s.name),
      ...this.metrics.listServiceMetrics().map((m) => m.service),
      ...circuits.map((c) => c.service),
    ]);

    let status = PackageStatus.HEALTHY;
    if (openCircuits > 0) {
      status = PackageStatus.ERROR;
    } else if (halfOpenCircuits > 0 || (totals.totalRequests > 0 && totals.errorRatePercent >= 5)) {
      status = PackageStatus.WARNING;
    } else if (totals.totalRequests === 0 && serviceNames.size === 0) {
      status = PackageStatus.IDLE;
    }

    return {
      status,
      summary: this.t(
        'ops.httpClient.summary',
        {
          services: serviceNames.size,
          openCircuits,
          requests: totals.totalRequests,
        },
        `${serviceNames.size} services, ${openCircuits} open circuits, ${totals.totalRequests} requests.`,
      ),
      metrics: {
        services: serviceNames.size,
        openCircuits,
        halfOpenCircuits,
        totalRequests: totals.totalRequests,
        errorRatePercent: totals.errorRatePercent,
        avgDurationMs: totals.avgDurationMs,
        p95DurationMs: totals.p95DurationMs,
      },
    };
  }

  /** Danh sách hành động điều khiển trên System Console Packages */
  public getActions(): PackageActionDescriptor[] {
    if (this.config?.httpClient?.opsResetEnabled === false) {
      return [];
    }
    return [
      {
        id: ACTION_RESET_ALL_CIRCUITS,
        label: this.t('ops.httpClient.resetCircuits.label', {}, 'Reset all Circuit Breakers'),
        description: this.t(
          'ops.httpClient.resetCircuits.description',
          {},
          'Close all open circuits to resume calling external providers.',
        ),
        isDanger: false,
      },
    ];
  }

  /** Thực thi hành động reset toàn bộ Circuit Breaker */
  public async executeAction(actionId: string): Promise<PackageActionResult> {
    if (actionId !== ACTION_RESET_ALL_CIRCUITS) {
      return {
        success: false,
        message: this.t(
          'ops.action.unsupported',
          { actionId, packageId: this.packageId },
          `Action [${actionId}] is not supported.`,
        ),
      };
    }

    if (this.config?.httpClient?.opsResetEnabled === false) {
      return {
        success: false,
        message: this.t(
          'ops.httpClient.error.resetDisabled',
          {},
          'Resetting circuit breakers is disabled by configuration.',
        ),
      };
    }

    const snapshots = this.circuitBreaker.listSnapshots();
    const count = this.circuitBreaker.resetAll();
    for (const s of snapshots) {
      this.metrics.recordCircuitState(s.service, 'CLOSED');
    }

    return {
      success: true,
      message: this.t(
        'ops.httpClient.resetCircuits.success',
        { count },
        `Reset ${count} circuit breaker(s).`,
      ),
      data: { resetCount: count },
    };
  }

  private t(key: string, params: Record<string, string | number>, fallback: string): string {
    if (!this.i18n) return fallback;
    const translated = this.i18n.t(key, params);
    return translated === key ? fallback : translated;
  }
}
