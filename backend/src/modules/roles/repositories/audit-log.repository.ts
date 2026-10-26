import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  applyDateRangeToQueryBuilder,
  applyKeywordSearchToQueryBuilder,
  applySortToQueryBuilder,
  buildSafeLikePattern,
  paginateSelectQueryBuilder,
} from '@packages/database/index.js';
import {
  ForbiddenAppException,
  SettingRegistryService,
  defaultSettingRegistry,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  type AuditLogQueryFilter,
  type AuditLogRecord,
  type IAuditLogPersistencePort,
  getAuditActorTypeName,
  parseAuditActorType,
} from '@packages/security/index.js';
import { AuditLogEntity } from '../entities/audit-log.entity.js';

const AUDIT_LOG_SORT_COLUMN_MAP: Readonly<Record<string, string>> = {
  id: 'al.id',
  createdAt: 'al.created_at',
  module: 'al.module',
  action: 'al.action',
};

@Injectable()
export class AuditLogRepository implements IAuditLogPersistencePort {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repository: Repository<AuditLogEntity>,
    @Optional()
    auditLogService?: AuditLogService,
    @Optional()
    settingRegistry?: SettingRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    auditLogService?.registerPersistencePort(this);
  }

  private toRecord(entity: AuditLogEntity): AuditLogRecord {
    const actorType = parseAuditActorType(entity.actorType);
    return {
      id: Number(entity.id),
      actorType,
      actorTypeName: getAuditActorTypeName(actorType),
      actorUserId:
        entity.actorUserId !== undefined && entity.actorUserId !== null
          ? Number(entity.actorUserId)
          : null,
      actorServiceAccountId:
        entity.actorServiceAccountId !== undefined && entity.actorServiceAccountId !== null
          ? Number(entity.actorServiceAccountId)
          : null,
      actorApiClientId:
        entity.actorApiClientId !== undefined && entity.actorApiClientId !== null
          ? Number(entity.actorApiClientId)
          : null,
      actorIdentifier: entity.actorIdentifier ?? null,
      module: entity.module,
      feature: entity.feature,
      action: entity.action,
      resourceType: entity.resourceType ?? null,
      resourceId: entity.resourceId ?? null,
      beforeData: safeJsonParseObject(entity.beforeDataJson, null),
      afterData: safeJsonParseObject(entity.afterDataJson, null),
      reason: entity.reason ?? null,
      ipAddress: entity.ipAddress ?? null,
      userAgent: entity.userAgent ?? null,
      requestId: entity.requestId ?? null,
      correlationId: entity.correlationId ?? null,
      createdAt:
        entity.createdAt instanceof Date
          ? entity.createdAt.toISOString()
          : String(entity.createdAt ?? new Date().toISOString()),
    };
  }

  /** Lưu bản ghi Audit Log mới (Append-Only) */
  public async saveRecord(
    payload: Omit<AuditLogRecord, 'id' | 'createdAt'>,
  ): Promise<AuditLogRecord> {
    const entity = this.repository.create({
      actorType: payload.actorType,
      actorUserId: payload.actorUserId,
      actorServiceAccountId: payload.actorServiceAccountId,
      actorApiClientId: payload.actorApiClientId,
      actorIdentifier: payload.actorIdentifier,
      module: payload.module,
      feature: payload.feature,
      action: payload.action,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      beforeDataJson: payload.beforeData ? JSON.stringify(payload.beforeData) : null,
      afterDataJson: payload.afterData ? JSON.stringify(payload.afterData) : null,
      reason: payload.reason,
      ipAddress: payload.ipAddress,
      userAgent: payload.userAgent,
      requestId: payload.requestId,
      correlationId: payload.correlationId,
    });
    const saved = await this.repository.save(entity);
    return this.toRecord(saved);
  }

  /** Tìm một bản ghi Audit Log theo ID */
  public async findById(id: number): Promise<AuditLogRecord | null> {
    const found = await this.repository.findOne({
      where: { id: Number(id) },
    });
    return found ? this.toRecord(found) : null;
  }

  /** Tra cứu và lọc phân trang Audit Log theo người dùng, Service Account, module, thời gian, hành động (Mục 4.4.7) */
  public async searchPaginated(filter: AuditLogQueryFilter): Promise<{
    items: AuditLogRecord[];
    total: number;
  }> {
    const qb = this.repository.createQueryBuilder('al');

    if (filter.actorType !== undefined) {
      qb.andWhere('al.actor_type = :actorType', { actorType: Number(filter.actorType) });
    }
    if (filter.actorUserId !== undefined) {
      qb.andWhere('al.actor_user_id = :actorUserId', { actorUserId: Number(filter.actorUserId) });
    }
    if (filter.actorServiceAccountId !== undefined) {
      qb.andWhere('al.actor_service_account_id = :actorServiceAccountId', {
        actorServiceAccountId: Number(filter.actorServiceAccountId),
      });
    }
    if (filter.module?.trim()) {
      qb.andWhere('LOWER(al.module) = :module', {
        module: filter.module.trim().toLowerCase(),
      });
    }
    if (filter.feature?.trim()) {
      qb.andWhere('LOWER(al.feature) = :feature', {
        feature: filter.feature.trim().toLowerCase(),
      });
    }
    if (filter.action?.trim()) {
      qb.andWhere("UPPER(al.action) LIKE :action ESCAPE '\\\\'", {
        action: buildSafeLikePattern(filter.action.trim(), 'contains', 'upper'),
      });
    }
    if (filter.resourceType?.trim()) {
      qb.andWhere('LOWER(al.resource_type) = :resourceType', {
        resourceType: filter.resourceType.trim().toLowerCase(),
      });
    }
    if (filter.resourceId?.trim()) {
      qb.andWhere('al.resource_id = :resourceId', {
        resourceId: filter.resourceId.trim(),
      });
    }
    if (filter.requestId?.trim()) {
      qb.andWhere("LOWER(al.request_id) LIKE :requestId ESCAPE '\\\\'", {
        requestId: buildSafeLikePattern(filter.requestId.trim(), 'contains', 'lower'),
      });
    }
    if (filter.correlationId?.trim()) {
      qb.andWhere("LOWER(al.correlation_id) LIKE :correlationId ESCAPE '\\\\'", {
        correlationId: buildSafeLikePattern(filter.correlationId.trim(), 'contains', 'lower'),
      });
    }
    if (filter.ipAddress?.trim()) {
      qb.andWhere("LOWER(al.ip_address) LIKE :ipAddress ESCAPE '\\\\'", {
        ipAddress: buildSafeLikePattern(filter.ipAddress.trim(), 'contains', 'lower'),
      });
    }

    applyDateRangeToQueryBuilder(qb, 'al.created_at', {
      from: filter.fromDate,
      to: filter.toDate,
      paramPrefix: 'auditDate',
      fromFieldName: 'fromDate',
      toFieldName: 'toDate',
    });

    applyKeywordSearchToQueryBuilder(
      qb,
      filter.q ?? filter.search,
      [
        'al.module',
        'al.feature',
        'al.action',
        "COALESCE(al.actor_identifier, '')",
        "COALESCE(al.reason, '')",
        "COALESCE(al.resource_id, '')",
        "COALESCE(al.request_id, '')",
        "COALESCE(al.correlation_id, '')",
      ],
      { paramPrefix: 'auditKw' },
    );

    applySortToQueryBuilder(
      qb,
      {
        sortBy: filter.sortBy,
        sortOrder: filter.sortOrder,
        sort: filter.sort,
      },
      AUDIT_LOG_SORT_COLUMN_MAP,
      {
        defaultSortBy: 'id',
        defaultSortOrder: 'DESC',
        tieBreakerField: 'id',
      },
    );

    const { items: entities, total } = await paginateSelectQueryBuilder(qb, filter, {
      settingPrefix: 'roles.audit_log',
      defaultLimit: 20,
      maxLimit: 200,
      registry: this.settingRegistry,
    });
    return {
      items: entities.map((e) => this.toRecord(e)),
      total,
    };
  }

  /** Chặn sửa Audit Log ở tầng Repository (Mục 4.4.8) */
  public async updateRecord(id: number): Promise<never> {
    throw new ForbiddenAppException('security.auditLogImmutable', [{ id, operation: 'UPDATE' }]);
  }

  /** Chặn xóa Audit Log ở tầng Repository (Mục 4.4.8) */
  public async deleteRecord(id: number): Promise<never> {
    throw new ForbiddenAppException('security.auditLogImmutable', [{ id, operation: 'DELETE' }]);
  }
}
