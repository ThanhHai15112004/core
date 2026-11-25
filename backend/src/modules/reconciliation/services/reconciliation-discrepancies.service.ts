import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  ConflictAppException,
  NotFoundAppException,
  buildCsvContent,
  parseNumericUserId,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  NOTIFICATIONS_PUBLIC_SERVICE,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
  type INotificationsPublicService,
} from '@modules/notifications/contracts/index.js';
import {
  RECONCILIATION_AUDIT_META,
  RECONCILIATION_DISCREPANCY_STATUS,
  RECONCILIATION_EVENTS,
  RECONCILIATION_SEVERITY,
  getReconciliationDiscrepancyStatusName,
  getReconciliationDiscrepancyTypeName,
  getReconciliationSeverityName,
  type ReconciliationDiscrepancyTypeName,
  type ReconciliationSeverityName,
} from '../enum/reconciliation.enum.js';
import { ReconciliationDiscrepancyRepository } from '../repositories/reconciliation-discrepancy.repository.js';
import type {
  AssignDiscrepancyRequest,
  DiscrepancyReportQuery,
  ListDiscrepanciesQuery,
  UpdateDiscrepancyStatusRequest,
} from '../requests/reconciliation.requests.js';
import { ReconciliationResponseMapper } from '../responses/reconciliation.response.js';
import type {
  ReconciliationDiscrepancyReportView,
  ReconciliationDiscrepancyView,
} from '../types/reconciliation.types.js';

@Injectable()
export class ReconciliationDiscrepanciesService {
  private readonly logger = new Logger(ReconciliationDiscrepanciesService.name);

  constructor(
    private readonly discrepancyRepo: ReconciliationDiscrepancyRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsService: INotificationsPublicService | null = null,
  ) {}

  public async listDiscrepancies(
    query: ListDiscrepanciesQuery,
  ): Promise<PaginatedResult<ReconciliationDiscrepancyView>> {
    const paged = await this.discrepancyRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((entity) => ReconciliationResponseMapper.toDiscrepancyView(entity)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getDiscrepancyById(id: number): Promise<ReconciliationDiscrepancyView> {
    const entity = await this.discrepancyRepo.findByIdSafe(id);
    if (!entity) {
      throw new NotFoundAppException('reconciliation.discrepancyNotFound', { id });
    }
    return ReconciliationResponseMapper.toDiscrepancyView(entity);
  }

  /** Báo cáo tổng hợp sai lệch theo mức độ (severity), loại sai lệch, trạng thái và người phụ trách */
  public async getDiscrepancyReport(
    query: DiscrepancyReportQuery,
  ): Promise<ReconciliationDiscrepancyReportView> {
    const items = await this.discrepancyRepo.listForReport(query);

    const byType: Record<ReconciliationDiscrepancyTypeName, number> = {
      MISSING_INTERNAL: 0,
      MISSING_EXTERNAL: 0,
      DUPLICATE_INTERNAL: 0,
      DUPLICATE_EXTERNAL: 0,
      STATUS_MISMATCH: 0,
      AMOUNT_MISMATCH: 0,
      DATA_MISMATCH: 0,
    };
    const bySeverity: Record<ReconciliationSeverityName, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    };
    const assigneeMap = new Map<
      number | null,
      { total: number; openOrAssigned: number; highOrCritical: number }
    >();

    let openCount = 0;
    let assignedCount = 0;
    let inRepairCount = 0;
    let resolvedCount = 0;
    let compensatedCount = 0;
    let ignoredCount = 0;
    let totalAbsAmountDiff = 0;

    for (const item of items) {
      const typeName = getReconciliationDiscrepancyTypeName(item.discrepancyType);
      const sevName = getReconciliationSeverityName(item.severity);
      byType[typeName] = (byType[typeName] ?? 0) + 1;
      bySeverity[sevName] = (bySeverity[sevName] ?? 0) + 1;

      if (item.amountDiff !== null && item.amountDiff !== undefined) {
        totalAbsAmountDiff += Math.abs(Number(item.amountDiff));
      }

      switch (item.status) {
        case RECONCILIATION_DISCREPANCY_STATUS.OPEN:
          openCount++;
          break;
        case RECONCILIATION_DISCREPANCY_STATUS.ASSIGNED:
          assignedCount++;
          break;
        case RECONCILIATION_DISCREPANCY_STATUS.IN_REPAIR:
          inRepairCount++;
          break;
        case RECONCILIATION_DISCREPANCY_STATUS.RESOLVED:
          resolvedCount++;
          break;
        case RECONCILIATION_DISCREPANCY_STATUS.COMPENSATED:
          compensatedCount++;
          break;
        case RECONCILIATION_DISCREPANCY_STATUS.IGNORED:
          ignoredCount++;
          break;
      }

      const ownerKey = item.assigneeUserId ?? null;
      const bucket = assigneeMap.get(ownerKey) ?? {
        total: 0,
        openOrAssigned: 0,
        highOrCritical: 0,
      };
      bucket.total++;
      if (
        item.status === RECONCILIATION_DISCREPANCY_STATUS.OPEN ||
        item.status === RECONCILIATION_DISCREPANCY_STATUS.ASSIGNED
      ) {
        bucket.openOrAssigned++;
      }
      if (item.severity >= RECONCILIATION_SEVERITY.HIGH) {
        bucket.highOrCritical++;
      }
      assigneeMap.set(ownerKey, bucket);
    }

    const byAssignee = Array.from(assigneeMap.entries())
      .map(([assigneeUserId, stats]) => ({
        assigneeUserId,
        total: stats.total,
        openOrAssigned: stats.openOrAssigned,
        highOrCritical: stats.highOrCritical,
      }))
      .sort((a, b) => b.highOrCritical - a.highOrCritical || b.total - a.total);

    return {
      totalDiscrepancies: items.length,
      openCount,
      assignedCount,
      inRepairCount,
      resolvedCount,
      compensatedCount,
      ignoredCount,
      totalAbsAmountDiff,
      byType,
      bySeverity,
      byAssignee,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Xuất báo cáo sai lệch ra file CSV dùng tiện ích chuẩn `@packages/kernel` */
  public async exportDiscrepanciesCsv(
    query: Partial<ListDiscrepanciesQuery>,
    actor?: UserIdentity,
  ): Promise<{ readonly fileName: string; readonly buffer: Buffer; readonly totalRows: number }> {
    const items = await this.discrepancyRepo.listForExport(query, 5000);
    const headers = [
      'discrepancyCode',
      'runId',
      'jobId',
      'targetModule',
      'recordKey',
      'discrepancyType',
      'severity',
      'status',
      'assigneeUserId',
      'internalStatus',
      'externalStatus',
      'internalAmount',
      'externalAmount',
      'amountDiff',
      'currency',
      'resolutionNote',
      'createdAt',
    ];
    const rows = items.map((d) => [
      d.discrepancyCode,
      d.runId,
      d.jobId,
      d.targetModule,
      d.recordKey,
      getReconciliationDiscrepancyTypeName(d.discrepancyType),
      getReconciliationSeverityName(d.severity),
      getReconciliationDiscrepancyStatusName(d.status),
      d.assigneeUserId ?? '',
      d.internalStatus ?? '',
      d.externalStatus ?? '',
      d.internalAmount ?? '',
      d.externalAmount ?? '',
      d.amountDiff ?? '',
      d.currency ?? '',
      d.resolutionNote ?? '',
      d.createdAt ? new Date(d.createdAt).toISOString() : '',
    ]);

    const buffer = Buffer.from(buildCsvContent(headers, rows), 'utf8');
    const fileName = `reconciliation-discrepancies-${new Date().toISOString().slice(0, 10)}.csv`;
    const actorUserId = parseNumericUserId(actor?.id);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: RECONCILIATION_AUDIT_META.MODULE,
      feature: RECONCILIATION_AUDIT_META.FEATURES.DISCREPANCIES,
      action: 'EXPORT_DISCREPANCIES_CSV',
      resourceType: 'reconciliation_discrepancy_report',
      resourceId: fileName,
      beforeData: null,
      afterData: { totalRows: items.length, filters: query },
      reason: `Exported ${items.length} reconciliation discrepancies to CSV`,
    });

    return { fileName, buffer, totalRows: items.length };
  }

  /** Phân công người phụ trách xử lý sai lệch + gửi thông báo + ghi Audit Log */
  public async assignDiscrepancy(
    id: number,
    input: AssignDiscrepancyRequest,
    actor?: UserIdentity,
  ): Promise<ReconciliationDiscrepancyView> {
    const entity = await this.discrepancyRepo.findByIdSafe(id);
    if (!entity) {
      throw new NotFoundAppException('reconciliation.discrepancyNotFound', { id });
    }
    if (
      entity.status === RECONCILIATION_DISCREPANCY_STATUS.RESOLVED ||
      entity.status === RECONCILIATION_DISCREPANCY_STATUS.COMPENSATED
    ) {
      throw new ConflictAppException('reconciliation.discrepancyAlreadyClosed', [{ id }]);
    }

    const beforeView = ReconciliationResponseMapper.toDiscrepancyView(entity);
    const actorUserId = parseNumericUserId(actor?.id);

    entity.assigneeUserId = input.assigneeUserId;
    if (entity.status === RECONCILIATION_DISCREPANCY_STATUS.OPEN) {
      entity.status = RECONCILIATION_DISCREPANCY_STATUS.ASSIGNED;
    }
    if (input.note?.trim()) {
      entity.resolutionNote = input.note.trim();
    }

    const saved = await this.discrepancyRepo.saveEntity(entity);
    const afterView = ReconciliationResponseMapper.toDiscrepancyView(saved);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: RECONCILIATION_AUDIT_META.MODULE,
      feature: RECONCILIATION_AUDIT_META.FEATURES.DISCREPANCIES,
      action: 'ASSIGN_DISCREPANCY',
      resourceType: 'reconciliation_discrepancy',
      resourceId: String(afterView.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: afterView as unknown as Record<string, unknown>,
      reason:
        input.note?.trim() ||
        `Assigned discrepancy ${afterView.discrepancyCode} to user #${input.assigneeUserId}`,
    });

    if (this.notificationsService) {
      await this.notificationsService
        .dispatch({
          title: `Bạn được phân công xử lý sai lệch đối soát ${afterView.discrepancyCode}`,
          content: `Bản ghi "${afterView.recordKey}" (${afterView.discrepancyTypeName} - mức độ ${afterView.severityName}) đã được giao cho bạn phụ trách.`,
          category: NOTIFICATION_CATEGORY.WORK,
          priority:
            afterView.severity >= RECONCILIATION_SEVERITY.HIGH
              ? NOTIFICATION_PRIORITY.HIGH
              : NOTIFICATION_PRIORITY.NORMAL,
          targetType: NOTIFICATION_TARGET_TYPE.SINGLE_USER,
          userId: input.assigneeUserId,
          referenceModule: 'reconciliation',
          referenceType: 'reconciliation_discrepancy',
          referenceId: String(afterView.id),
          actionUrl: '/reconciliation',
        })
        .catch(() => undefined);
    }

    await this.publishEventSafe(RECONCILIATION_EVENTS.DISCREPANCY_ASSIGNED, {
      discrepancyId: afterView.id,
      discrepancyCode: afterView.discrepancyCode,
      assigneeUserId: input.assigneeUserId,
      severity: afterView.severityName,
    });

    return afterView;
  }

  /** Cập nhật thủ công trạng thái sai lệch (RESOLVED / IGNORED / mở lại OPEN) có Audit */
  public async updateDiscrepancyStatus(
    id: number,
    input: UpdateDiscrepancyStatusRequest,
    actor?: UserIdentity,
  ): Promise<ReconciliationDiscrepancyView> {
    const entity = await this.discrepancyRepo.findByIdSafe(id);
    if (!entity) {
      throw new NotFoundAppException('reconciliation.discrepancyNotFound', { id });
    }

    const beforeView = ReconciliationResponseMapper.toDiscrepancyView(entity);
    const actorUserId = parseNumericUserId(actor?.id);

    entity.status = input.status;
    entity.resolutionNote = input.note.trim();
    if (
      input.status === RECONCILIATION_DISCREPANCY_STATUS.RESOLVED ||
      input.status === RECONCILIATION_DISCREPANCY_STATUS.IGNORED
    ) {
      entity.resolvedBy = actorUserId;
      entity.resolvedAt = new Date();
    } else {
      entity.resolvedBy = null;
      entity.resolvedAt = null;
    }

    const saved = await this.discrepancyRepo.saveEntity(entity);
    const afterView = ReconciliationResponseMapper.toDiscrepancyView(saved);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: RECONCILIATION_AUDIT_META.MODULE,
      feature: RECONCILIATION_AUDIT_META.FEATURES.DISCREPANCIES,
      action: `SET_STATUS_${afterView.statusName}`,
      resourceType: 'reconciliation_discrepancy',
      resourceId: String(afterView.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: afterView as unknown as Record<string, unknown>,
      reason: input.note.trim(),
    });

    return afterView;
  }

  private async publishEventSafe(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.messagePublisher) return;
    try {
      await this.messagePublisher.publish(topic, payload, QUEUES.SYSTEM_EVENTS);
    } catch (err) {
      this.logger.warn(
        `Failed to publish event ${topic}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
