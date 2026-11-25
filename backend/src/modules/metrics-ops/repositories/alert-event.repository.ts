import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { AlertEventEntity } from '../entities/alert-event.entity.js';
import {
  ALERT_EVENT_STATUS,
  ALERT_SEVERITY,
  type AlertEventStatus,
  type AlertMetricKey,
  type AlertSeverity,
} from '../enum/metrics-ops.enum.js';

export interface ListAlertEventsFilter {
  page?: number | undefined;
  limit?: number | undefined;
  status?: AlertEventStatus | undefined;
  severity?: AlertSeverity | undefined;
  metricKey?: AlertMetricKey | undefined;
  ruleCode?: string | undefined;
  search?: string | undefined;
}

@Injectable()
export class AlertEventRepository extends BaseTypeOrmRepository<AlertEventEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(AlertEventEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<AlertEventEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async listOpenEvents(): Promise<AlertEventEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository.find({
      where: { status: In([ALERT_EVENT_STATUS.FIRING, ALERT_EVENT_STATUS.ACKNOWLEDGED]) },
      order: { firedAt: 'DESC' },
    });
  }

  public async countActiveBySeverity(): Promise<{
    total: number;
    critical: number;
    warning: number;
    info: number;
  }> {
    if (!this.isDatabaseReady()) {
      return { total: 0, critical: 0, warning: 0, info: 0 };
    }
    const rows = await this.repository
      .createQueryBuilder('evt')
      .select('evt.severity', 'severity')
      .addSelect('COUNT(*)', 'cnt')
      .where('evt.status IN (:...statuses)', {
        statuses: [ALERT_EVENT_STATUS.FIRING, ALERT_EVENT_STATUS.ACKNOWLEDGED],
      })
      .groupBy('evt.severity')
      .getRawMany<{ severity: AlertSeverity; cnt: string | number }>();

    let critical = 0;
    let warning = 0;
    let info = 0;
    for (const r of rows) {
      const n = Number(r.cnt) || 0;
      if (r.severity === ALERT_SEVERITY.CRITICAL) critical += n;
      else if (r.severity === ALERT_SEVERITY.WARNING) warning += n;
      else if (r.severity === ALERT_SEVERITY.INFO) info += n;
    }
    return {
      total: critical + warning + info,
      critical,
      warning,
      info,
    };
  }

  public async listPaginated(
    filter: ListAlertEventsFilter,
  ): Promise<PaginatedResult<AlertEventEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('evt');
    if (filter.status) {
      qb.andWhere('evt.status = :status', { status: filter.status });
    }
    if (filter.severity) {
      qb.andWhere('evt.severity = :severity', { severity: filter.severity });
    }
    if (filter.metricKey) {
      qb.andWhere('evt.metricKey = :metricKey', { metricKey: filter.metricKey });
    }
    if (filter.ruleCode?.trim()) {
      qb.andWhere('evt.ruleCode = :ruleCode', { ruleCode: filter.ruleCode.trim().toUpperCase() });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'evt.ruleCode',
        'evt.ruleName',
        'evt.summary',
        'evt.fingerprint',
      ]);
    }
    qb.orderBy('evt.firedAt', 'DESC').addOrderBy('evt.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
