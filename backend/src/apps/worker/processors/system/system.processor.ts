import { Inject, Logger, Optional } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import {
  ExportRegistryService,
  ReportRegistryService,
  defaultExportRegistry,
  defaultReportRegistry,
  type TriggeredReportScheduleItemResult,
} from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { JOB_LOCK_DURATION_MS, QUEUES, type MessageEnvelope } from '@packages/messaging/index.js';
import { JobProgressTrackerService } from '@packages/queue/index.js';
import { FILES_PUBLIC_SERVICE, type IFilesPublicService } from '@modules/files/contracts/index.js';
import { NotificationChannelsService } from '@modules/notification-delivery/index.js';
import { WorkflowsService } from '@modules/workflows/index.js';
import { CalendarService } from '@modules/calendar/index.js';
import {
  WEBHOOKS_PUBLIC_SERVICE,
  WEBHOOKS_QUEUE_TOPICS,
  type IWebhooksPublicService,
  type QueuedWebhookDeliveryJobPayload,
} from '@modules/webhooks/contracts/index.js';
import {
  INBOUND_WEBHOOKS_PUBLIC_SERVICE,
  INBOUND_WEBHOOKS_QUEUE_TOPICS,
  type IInboundWebhooksPublicService,
  type QueuedInboundWebhookJobPayload,
} from '@modules/inbound-webhooks/contracts/index.js';
import { BaseQueueProcessor } from '../base-queue.processor.js';

export interface SystemMaintenanceTickPayload {
  readonly triggeredBy?: string | undefined;
  readonly now?: string | number | Date | undefined;
  readonly module?: string | undefined;
}

/**
 * Consumer của queue `system.events` (`@nestjs/bullmq`). Mỗi job chạy trong correlation của envelope để lần theo
 * log; đếm `messages_consumed_total{queue,channel,result}` + histogram thời gian xử lý.
 */
@Processor(QUEUES.SYSTEM_EVENTS, { lockDuration: JOB_LOCK_DURATION_MS, name: 'worker' })
export class SystemProcessor extends BaseQueueProcessor {
  protected readonly logger = new Logger(SystemProcessor.name);
  public readonly queueName = QUEUES.SYSTEM_EVENTS;

  constructor(
    config: CoreConfigService,
    metrics: MetricsRegistryService,
    @Optional() progressTracker?: JobProgressTrackerService,
    @Optional()
    @Inject(FILES_PUBLIC_SERVICE)
    private readonly filesService?: IFilesPublicService,
    @Optional() private readonly notificationChannelsService?: NotificationChannelsService,
    @Optional() private readonly exportRegistry?: ExportRegistryService,
    @Optional() private readonly reportRegistry?: ReportRegistryService,
    @Optional() private readonly workflowsService?: WorkflowsService,
    @Optional() private readonly calendarService?: CalendarService,
    @Optional()
    @Inject(WEBHOOKS_PUBLIC_SERVICE)
    private readonly webhooksService?: IWebhooksPublicService,
    @Optional()
    @Inject(INBOUND_WEBHOOKS_PUBLIC_SERVICE)
    private readonly inboundWebhooksService?: IInboundWebhooksPublicService,
  ) {
    super(config, metrics, progressTracker);
  }

  public get concurrency(): number {
    return this.config.runtime.worker.eventsConcurrency;
  }

  /** Điều phối sự kiện hệ thống sang hàm xử lý chuyên biệt theo từng topic */
  protected async handle(envelope: MessageEnvelope, job: Job): Promise<unknown> {
    this.logger.log(
      `Processing message "${envelope.topic}" (${envelope.id}) from ${envelope.producer ?? 'unknown'}`,
    );

    if (envelope.topic === WEBHOOKS_QUEUE_TOPICS.DELIVERY_SEND) {
      if (!this.webhooksService) {
        this.logger.warn(
          `Received "${envelope.topic}" (${envelope.id}) but WebhooksService is not available`,
        );
        return { handled: false, skipped: true, reason: 'webhooks_service_unavailable' };
      }
      const payload = (envelope.payload ?? {}) as QueuedWebhookDeliveryJobPayload;
      return this.webhooksService.processQueuedDelivery(payload, {
        attemptNumber: (job.attemptsMade ?? 0) + 1,
        maxAttempts: job.opts?.attempts ?? 1,
        jobId: String(job.id ?? envelope.id),
      });
    }

    if (envelope.topic === INBOUND_WEBHOOKS_QUEUE_TOPICS.EVENT_PROCESS) {
      if (!this.inboundWebhooksService) {
        this.logger.warn(
          `Received "${envelope.topic}" (${envelope.id}) but InboundWebhooksService is not available`,
        );
        return { handled: false, skipped: true, reason: 'inbound_webhooks_service_unavailable' };
      }
      const payload = (envelope.payload ?? {}) as QueuedInboundWebhookJobPayload;
      return this.inboundWebhooksService.processQueuedEvent(payload, {
        attemptNumber: (job.attemptsMade ?? 0) + 1,
        maxAttempts: job.opts?.attempts ?? 1,
        jobId: String(job.id ?? envelope.id),
      });
    }

    if (
      envelope.topic === 'system.maintenance.tick' ||
      envelope.topic === 'reports.schedule.tick' ||
      envelope.topic === 'workflows.sla.tick' ||
      envelope.topic === 'calendar.reminder.tick'
    ) {
      return this.handleMaintenanceTick(envelope);
    }

    return this.handleGenericSystemEvent(envelope);
  }

  /**
   * 1. Xử lý topic `system.maintenance.tick` / `reports.schedule.tick`:
   * - Dọn thùng rác quá hạn (`FilesService.purgeExpiredTrash`)
   * - Retry các thông báo gửi lỗi đến hạn (`NotificationChannelsService.retryDueDeliveries`)
   * - Tự động thu hồi file Export & Report tạm đã hết hạn (`8.3.8` & `8.4.6`)
   * - Tự động kích hoạt các Lịch gửi báo cáo định kỳ đến hạn (`DAILY` / `WEEKLY` / `MONTHLY` — `8.4.5` & `8.4.6`)
   */
  private async handleMaintenanceTick(envelope: MessageEnvelope): Promise<unknown> {
    const payload = (envelope.payload ?? {}) as SystemMaintenanceTickPayload;
    const effectiveNow =
      payload.now instanceof Date
        ? payload.now
        : typeof payload.now === 'string' || typeof payload.now === 'number'
          ? new Date(payload.now)
          : new Date();
    const nowDate = Number.isNaN(effectiveNow.getTime()) ? new Date() : effectiveNow;

    let purgedTrashCount = 0;
    let retriedDeliveriesCount = 0;

    if (this.filesService) {
      const trashRes = await this.filesService.purgeExpiredTrash(undefined, {
        skipQueuePublish: true,
      });
      purgedTrashCount = trashRes.purgedCount;
    }

    if (this.notificationChannelsService) {
      const retryRes = await this.notificationChannelsService.retryDueDeliveries();
      retriedDeliveriesCount = retryRes.retriedCount;
    }

    const activeExportRegistry = this.exportRegistry ?? defaultExportRegistry;
    const activeReportRegistry = this.reportRegistry ?? defaultReportRegistry;

    const purgedExports = activeExportRegistry.purgeExpiredArtifacts(nowDate);
    const purgedReports = activeReportRegistry.purgeExpiredReportArtifacts(nowDate);

    let triggeredReportSchedulesCount = 0;
    let triggeredReportSchedules: readonly TriggeredReportScheduleItemResult[] = [];
    let workflowSlaWarningsCount = 0;
    let workflowSlaOverdueCount = 0;
    let calendarRemindersDispatchedCount = 0;

    if (this.workflowsService) {
      const slaRes = await this.workflowsService.scanSlaAndNotifyOverdue(nowDate);
      workflowSlaWarningsCount = slaRes.warningsTriggeredCount;
      workflowSlaOverdueCount = slaRes.overdueMarkedCount;
    }

    if (this.calendarService) {
      const calRes = await this.calendarService.scanAndDispatchReminders(nowDate);
      calendarRemindersDispatchedCount = calRes.dispatchedCount;
    }

    const dueScheduleResult = await activeReportRegistry.triggerDueSchedules(
      nowDate,
      payload.module ? { module: payload.module } : undefined,
    );
    triggeredReportSchedulesCount = dueScheduleResult.triggeredCount;
    triggeredReportSchedules = dueScheduleResult.results;

    return {
      handled: true,
      topic: envelope.topic,
      id: envelope.id,
      purgedTrashCount,
      retriedDeliveriesCount,
      purgedExportArtifactsCount: purgedExports.purgedCount,
      purgedReportArtifactsCount: purgedReports.purgedCount,
      triggeredReportSchedulesCount,
      triggeredReportSchedules,
      workflowSlaWarningsCount,
      workflowSlaOverdueCount,
      calendarRemindersDispatchedCount,
    };
  }

  /** 2. Xử lý các sự kiện nội bộ mặc định trên hàng đợi `system.events` */
  private handleGenericSystemEvent(envelope: MessageEnvelope): unknown {
    return {
      handled: true,
      topic: envelope.topic,
      id: envelope.id,
    };
  }
}
