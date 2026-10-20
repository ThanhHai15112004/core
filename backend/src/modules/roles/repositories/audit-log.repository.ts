import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ForbiddenAppException, safeJsonParseObject } from '@packages/kernel/index.js';
import {
  AuditLogService,
  type AuditLogQueryFilter,
  type AuditLogRecord,
  type IAuditLogPersistencePort,
  getAuditActorTypeName,
  parseAuditActorType,
} from '@packages/security/index.js';
import { AuditLogEntity } from '../entities/audit-log.entity.js';

@Injectable()
export class AuditLogRepository implements IAuditLogPersistencePort {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repository: Repository<AuditLogEntity>,
    @Optional()
    auditLogService?: AuditLogService,
  ) {
    auditLogService?.registerPersistencePort(this);
  }

  private parseJsonObject(raw?: string | null): Record<string, unknown> | null {
    return safeJsonParseObject(raw, null);
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
      beforeData: this.parseJsonObject(entity.beforeDataJson),
      afterData: this.parseJsonObject(entity.afterDataJson),
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
    const page = Math.max(1, Number(filter.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(filter.limit ?? 20)));
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
      qb.andWhere('UPPER(al.action) LIKE :action', {
        action: `%${filter.action.trim().toUpperCase()}%`,
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
      qb.andWhere('LOWER(al.request_id) LIKE :requestId', {
        requestId: `%${filter.requestId.trim().toLowerCase()}%`,
      });
    }
    if (filter.correlationId?.trim()) {
      qb.andWhere('LOWER(al.correlation_id) LIKE :correlationId', {
        correlationId: `%${filter.correlationId.trim().toLowerCase()}%`,
      });
    }
    if (filter.ipAddress?.trim()) {
      qb.andWhere('LOWER(al.ip_address) LIKE :ipAddress', {
        ipAddress: `%${filter.ipAddress.trim().toLowerCase()}%`,
      });
    }
    if (filter.fromDate) {
      const fromDate = new Date(filter.fromDate);
      if (!Number.isNaN(fromDate.getTime())) {
        qb.andWhere('al.created_at >= :fromDate', { fromDate });
      }
    }
    if (filter.toDate) {
      const toDate = new Date(filter.toDate);
      if (!Number.isNaN(toDate.getTime())) {
        qb.andWhere('al.created_at <= :toDate', { toDate });
      }
    }
    if (filter.q?.trim()) {
      const kw = `%${filter.q.trim().toLowerCase()}%`;
      qb.andWhere(
        "(LOWER(al.module) LIKE :kw OR LOWER(al.feature) LIKE :kw OR LOWER(al.action) LIKE :kw OR LOWER(COALESCE(al.actor_identifier, '')) LIKE :kw OR LOWER(COALESCE(al.reason, '')) LIKE :kw OR LOWER(COALESCE(al.resource_id, '')) LIKE :kw OR LOWER(COALESCE(al.request_id, '')) LIKE :kw OR LOWER(COALESCE(al.correlation_id, '')) LIKE :kw)",
        { kw },
      );
    }

    const sortOrder = filter.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    qb.orderBy('al.id', sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [entities, total] = await qb.getManyAndCount();
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
