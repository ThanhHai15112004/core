import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { IncidentEntity } from '../entities/incident.entity.js';
import {
  INCIDENT_STATUS,
  type IncidentSeverity,
  type IncidentSource,
  type IncidentStatus,
} from '../enum/incidents-ops.enum.js';

export interface ListIncidentsFilter {
  page?: number | undefined;
  limit?: number | undefined;
  severity?: IncidentSeverity | undefined;
  status?: IncidentStatus | undefined;
  source?: IncidentSource | undefined;
  ownerUserId?: number | undefined;
  isRepeated?: boolean | undefined;
  slaBreached?: boolean | undefined;
  search?: string | undefined;
}

const ACTIVE_INCIDENT_STATUSES: readonly IncidentStatus[] = [
  INCIDENT_STATUS.OPEN,
  INCIDENT_STATUS.ACKNOWLEDGED,
  INCIDENT_STATUS.MITIGATED,
];

@Injectable()
export class IncidentRepository extends BaseTypeOrmRepository<IncidentEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(IncidentEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<IncidentEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findActiveByFingerprint(
    fingerprint: string,
    since: Date,
  ): Promise<IncidentEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository
      .createQueryBuilder('inc')
      .where('inc.fingerprint = :fingerprint', { fingerprint })
      .andWhere('inc.status IN (:...statuses)', { statuses: ACTIVE_INCIDENT_STATUSES })
      .andWhere('inc.lastSeenAt >= :since', { since })
      .orderBy('inc.id', 'DESC')
      .getOne();
  }

  public async listOpenIncidents(): Promise<IncidentEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository.find({
      where: { status: In([...ACTIVE_INCIDENT_STATUSES]) },
      order: { lastSeenAt: 'DESC' },
    });
  }

  public async listRepeatedTop(limit = 20): Promise<IncidentEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository
      .createQueryBuilder('inc')
      .where('inc.isRepeated = :repeated', { repeated: true })
      .orderBy('inc.occurrenceCount', 'DESC')
      .addOrderBy('inc.lastSeenAt', 'DESC')
      .limit(Math.max(1, Math.min(100, limit)))
      .getMany();
  }

  public async getStatsSnapshot(): Promise<{
    openTotal: number;
    openBySeverity: Record<IncidentSeverity, number>;
    slaBreachedCount: number;
    repeatedIncidentsCount: number;
    totalSuppressedAlerts: number;
    avgRecoverySeconds: number | null;
  }> {
    if (!this.isDatabaseReady()) {
      return {
        openTotal: 0,
        openBySeverity: { P1: 0, P2: 0, P3: 0, P4: 0 },
        slaBreachedCount: 0,
        repeatedIncidentsCount: 0,
        totalSuppressedAlerts: 0,
        avgRecoverySeconds: null,
      };
    }

    const openRows = await this.listOpenIncidents();
    const openBySeverity: Record<IncidentSeverity, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
    const nowMs = Date.now();
    let slaBreachedCount = 0;

    for (const row of openRows) {
      openBySeverity[row.severity] = (openBySeverity[row.severity] ?? 0) + 1;
      const breached =
        row.slaBreached || (row.slaDueAt ? new Date(row.slaDueAt).getTime() < nowMs : false);
      if (breached) slaBreachedCount++;
    }

    const agg = (await this.repository
      .createQueryBuilder('inc')
      .select('SUM(CASE WHEN inc.isRepeated = TRUE THEN 1 ELSE 0 END)', 'repeatedIncidentsCount')
      .addSelect('COALESCE(SUM(inc.suppressedCount), 0)', 'totalSuppressedAlerts')
      .addSelect('AVG(inc.recoverySeconds)', 'avgRecoverySeconds')
      .getRawOne()) as
      | {
          repeatedIncidentsCount?: string | number | null;
          totalSuppressedAlerts?: string | number | null;
          avgRecoverySeconds?: string | number | null;
        }
      | undefined;

    const rawAvg = agg?.avgRecoverySeconds;
    const avgRecoverySeconds =
      rawAvg !== null && rawAvg !== undefined && !Number.isNaN(Number(rawAvg))
        ? Math.round(Number(rawAvg))
        : null;

    return {
      openTotal: openRows.length,
      openBySeverity,
      slaBreachedCount,
      repeatedIncidentsCount: Number(agg?.repeatedIncidentsCount ?? 0),
      totalSuppressedAlerts: Number(agg?.totalSuppressedAlerts ?? 0),
      avgRecoverySeconds,
    };
  }

  public async listPaginated(
    filter: ListIncidentsFilter,
  ): Promise<PaginatedResult<IncidentEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('inc');
    if (filter.severity) {
      qb.andWhere('inc.severity = :severity', { severity: filter.severity });
    }
    if (filter.status) {
      qb.andWhere('inc.status = :status', { status: filter.status });
    }
    if (filter.source) {
      qb.andWhere('inc.source = :source', { source: filter.source });
    }
    if (filter.ownerUserId !== undefined) {
      qb.andWhere('inc.ownerUserId = :ownerUserId', { ownerUserId: filter.ownerUserId });
    }
    if (filter.isRepeated !== undefined) {
      qb.andWhere('inc.isRepeated = :isRepeated', { isRepeated: filter.isRepeated });
    }
    if (filter.slaBreached !== undefined) {
      qb.andWhere('inc.slaBreached = :slaBreached', { slaBreached: filter.slaBreached });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'inc.incidentCode',
        'inc.title',
        'inc.alertCode',
        'inc.fingerprint',
      ]);
    }
    qb.orderBy('inc.lastSeenAt', 'DESC').addOrderBy('inc.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}
