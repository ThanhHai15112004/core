import { Injectable } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ALERT_EVENT_STATUS } from '../enum/metrics-ops.enum.js';
import { AlertEventNotFoundException } from '../exceptions/metrics-ops.exceptions.js';
import {
  AlertEventRepository,
  type ListAlertEventsFilter,
} from '../repositories/alert-event.repository.js';
import { MetricsOpsResponseMapper } from '../responses/metrics-ops.response.js';
import type { AlertEventView } from '../types/metrics-ops.types.js';

@Injectable()
export class AlertEventsService {
  constructor(
    private readonly eventRepo: AlertEventRepository,
    private readonly txManager: TransactionManager,
  ) {}

  public async listPaginated(
    filter: ListAlertEventsFilter,
  ): Promise<PaginatedResult<AlertEventView>> {
    const page = await this.eventRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => MetricsOpsResponseMapper.toEventView(item)),
    };
  }

  public async listOpenViews(): Promise<AlertEventView[]> {
    const open = await this.eventRepo.listOpenEvents();
    return open.map((item) => MetricsOpsResponseMapper.toEventView(item));
  }

  public async countActiveBySeverity(): Promise<{
    total: number;
    critical: number;
    warning: number;
    info: number;
  }> {
    return this.eventRepo.countActiveBySeverity();
  }

  public async acknowledge(
    id: number,
    input?: { note?: string | undefined; actorUserId?: number | undefined },
  ): Promise<AlertEventView> {
    const entity = await this.eventRepo.findByIdSafe(id);
    if (!entity) throw new AlertEventNotFoundException(id);
    if (entity.status === ALERT_EVENT_STATUS.RESOLVED) {
      return MetricsOpsResponseMapper.toEventView(entity);
    }

    entity.status = ALERT_EVENT_STATUS.ACKNOWLEDGED;
    entity.acknowledgedAt = new Date();
    entity.acknowledgedBy = input?.actorUserId ?? null;
    if (input?.note?.trim()) {
      entity.acknowledgeNote = input.note.trim();
    }

    const saved = await this.txManager.runInTransaction(() => this.eventRepo.saveEntity(entity));
    return MetricsOpsResponseMapper.toEventView(saved);
  }

  public async resolve(
    id: number,
    input?: { note?: string | undefined; actorUserId?: number | undefined },
  ): Promise<AlertEventView> {
    const entity = await this.eventRepo.findByIdSafe(id);
    if (!entity) throw new AlertEventNotFoundException(id);
    if (entity.status === ALERT_EVENT_STATUS.RESOLVED) {
      return MetricsOpsResponseMapper.toEventView(entity);
    }

    entity.status = ALERT_EVENT_STATUS.RESOLVED;
    entity.resolvedAt = new Date();
    entity.resolvedBy = input?.actorUserId ?? null;
    if (input?.note?.trim() && !entity.acknowledgeNote) {
      entity.acknowledgeNote = input.note.trim();
    }

    const saved = await this.txManager.runInTransaction(() => this.eventRepo.saveEntity(entity));
    return MetricsOpsResponseMapper.toEventView(saved);
  }
}
