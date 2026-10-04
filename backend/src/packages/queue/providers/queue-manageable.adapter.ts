import { Injectable } from '@nestjs/common';
import {
  CorePackageId,
  PackageCategory,
  PackageStatus,
  type ManageablePackage,
  type PackageStatusReport,
} from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { QueueMonitoringService } from '../monitoring/queue-monitoring.service.js';
import type { QueueCounts } from '../contracts/queue-monitoring.types.js';

/** Trạng thái tổng của queue BullMQ cho Package Registry. Chi tiết ở trang Worker & Queue / Jobs. */
@Injectable()
export class QueueManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.QUEUE;
  public readonly category = PackageCategory.QUEUE;
  public readonly icon = 'list-checks';

  constructor(
    private readonly queues: QueueMonitoringService,
    private readonly i18n: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n.t('ops.queue.displayName');
  }

  public async getStatus(): Promise<PackageStatusReport> {
    const state = this.queues.status().state;
    const list = this.queues.usable() ? await this.queues.queues().catch(() => null) : null;
    const sum = (pick: (c: QueueCounts) => number) =>
      (list ?? []).reduce((s, q) => s + pick(q.counts), 0);
    const workers = (list ?? []).reduce((s, q) => s + (q.workers?.length ?? 0), 0);
    return {
      status:
        state === 'connected'
          ? PackageStatus.HEALTHY
          : state === 'unavailable'
            ? PackageStatus.ERROR
            : PackageStatus.WARNING,
      summary: this.i18n.t('ops.queue.summary', { count: list?.length ?? 0, state }),
      metrics: {
        state,
        ...(list
          ? {
              queues: list.length,
              waiting: sum((c) => c.waiting + c.prioritized),
              active: sum((c) => c.active),
              failed: sum((c) => c.failed),
              workers,
            }
          : {}),
      },
    };
  }
}
