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
import { MessagingConnectionService } from './messaging-connection.service.js';
import { MessagingMonitoringService } from '../monitoring/messaging-monitoring.service.js';
import { MessagingOperationsService } from '../operations/messaging-operations.service.js';

export const MESSAGING_TEST_ACTION = 'test_broker';

/** Trạng thái/thao tác cơ bản cho Package Registry. Chi tiết ở trang Messaging (`/ops/messaging/*`). */
@Injectable()
export class MessagingManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.MESSAGING;
  public readonly category = PackageCategory.QUEUE;
  public readonly icon = 'radio';

  constructor(
    private readonly connection: MessagingConnectionService,
    private readonly monitoring: MessagingMonitoringService,
    private readonly operations: MessagingOperationsService,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.messaging.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const status = this.connection.getStatus();
    const info = this.monitoring.provider.info();
    const queues = this.monitoring.usable()
      ? await this.monitoring.queues().catch(() => null)
      : null;
    const sum = (k: 'waiting' | 'failed' | 'active') =>
      queues?.reduce((s, q) => s + q.counts[k] + (k === 'waiting' ? q.counts.prioritized : 0), 0);
    const consumers = queues?.reduce((s, q) => s + (q.workers?.length ?? 0), 0);
    return {
      status:
        status.state === 'connected'
          ? PackageStatus.HEALTHY
          : status.state === 'unavailable'
            ? PackageStatus.ERROR
            : PackageStatus.WARNING,
      summary: this.i18n.t('ops.messaging.summary', {
        product: `${info.product} (${info.broker})`,
        state: this.i18n.t(`messaging.connection.${status.state}`),
      }),
      metrics: {
        driver: info.driver,
        product: info.product,
        state: status.state,
        ...(queues
          ? {
              backlog: sum('waiting') ?? 0,
              deadLetter: sum('failed') ?? 0,
              consumers: consumers ?? 0,
            }
          : {}),
      },
    };
  }

  public getActions(): PackageActionDescriptor[] {
    return [
      {
        id: MESSAGING_TEST_ACTION,
        label: this.i18n.t('ops.messaging.test.label'),
        description: this.i18n.t('ops.messaging.test.description'),
        isDanger: false,
      },
    ];
  }

  public async executeAction(actionId: string): Promise<PackageActionResult> {
    if (actionId !== MESSAGING_TEST_ACTION)
      return {
        success: false,
        message: this.i18n.t('ops.action.unsupported', { actionId, packageId: this.packageId }),
      };
    const result = await this.operations.test({ ip: null, actor: null });
    return {
      success: result.ok,
      message: result.ok
        ? this.i18n.t('ops.messaging.test.ok', { ms: result.roundTripMs ?? result.totalMs })
        : this.i18n.t('ops.messaging.test.failed', { step: result.failedStep ?? '' }),
    };
  }
}
