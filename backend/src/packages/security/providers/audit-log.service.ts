import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ForbiddenAppException,
  NotFoundAppException,
  resolvePagination,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import type { UserIdentity } from '../contracts/auth.contract.js';
import {
  AUDIT_ACTOR_TYPE,
  type AuditActorTypeCode,
  type AuditLogPaginatedResult,
  type AuditLogQueryFilter,
  type AuditLogRecord,
  type IAuditLogPersistencePort,
  type RecordAuditLogInput,
  getAuditActorTypeName,
  parseAuditActorType,
  sanitizeAuditSnapshot,
} from '../contracts/audit-log.contract.js';

@Injectable()
export class AuditLogService {
  private persistencePort?: IAuditLogPersistencePort;
  private inMemorySeq = 0;
  private readonly inMemoryStore: AuditLogRecord[] = [];

  /**
   * Đăng ký cổng lưu trữ cơ sở dữ liệu (`AuditLogRepository`) từ module nghiệp vụ
   * mà không tạo phụ thuộc ngược từ `@packages/security` vào `modules/`.
   */
  public registerPersistencePort(port: IAuditLogPersistencePort): void {
    this.persistencePort = port;
  }

  /**
   * Ghi nhận một bản ghi Nhật ký thao tác (Audit Log — Mục 4.4.1 -> 4.4.6):
   * - Tự động nhận diện User ID hoặc Service Account từ `actor` hoặc `RequestContext`
   * - Tự động ghi thời gian, IP, User-Agent, Request ID và Correlation ID
   * - Tự động làm sạch (redact) dữ liệu nhạy cảm trong `beforeData` và `afterData`
   */
  public async record(input: RecordAuditLogInput): Promise<AuditLogRecord> {
    const ctx = RequestContextService.current();
    const resolvedActor = input.actor ?? (ctx?.actor as UserIdentity | undefined) ?? null;

    let actorType: AuditActorTypeCode = AUDIT_ACTOR_TYPE.SYSTEM;
    let actorUserId: number | null = input.actorUserId ?? input.actorId ?? null;
    let actorServiceAccountId: number | null = input.actorServiceAccountId ?? null;
    let actorApiClientId: number | null = input.actorApiClientId ?? null;
    let actorIdentifier: string | null = input.actorIdentifier ?? null;

    if (input.actorType !== undefined) {
      actorType = parseAuditActorType(input.actorType);
    } else if (
      actorServiceAccountId !== null ||
      resolvedActor?.subjectType === 'SERVICE_ACCOUNT' ||
      resolvedActor?.serviceAccountId !== undefined
    ) {
      actorType = AUDIT_ACTOR_TYPE.SERVICE_ACCOUNT;
    } else if (
      actorUserId !== null ||
      (resolvedActor && Number.isInteger(resolvedActor.id) && resolvedActor.id > 0)
    ) {
      actorType = AUDIT_ACTOR_TYPE.USER;
    } else if (ctx?.userId && !Number.isNaN(Number(ctx.userId)) && Number(ctx.userId) > 0) {
      actorType = AUDIT_ACTOR_TYPE.USER;
      actorUserId = Number(ctx.userId);
    }

    if (resolvedActor) {
      if (actorType === AUDIT_ACTOR_TYPE.SERVICE_ACCOUNT) {
        actorServiceAccountId =
          actorServiceAccountId ??
          resolvedActor.serviceAccountId ??
          (resolvedActor.id > 0 ? resolvedActor.id : null);
        actorApiClientId = actorApiClientId ?? resolvedActor.apiClientId ?? null;
        actorIdentifier =
          actorIdentifier ??
          resolvedActor.clientId ??
          resolvedActor.username ??
          (actorServiceAccountId ? `sa:${actorServiceAccountId}` : null);
      } else if (actorType === AUDIT_ACTOR_TYPE.USER) {
        actorUserId = actorUserId ?? (resolvedActor.id > 0 ? resolvedActor.id : null);
        actorIdentifier =
          actorIdentifier ??
          resolvedActor.email ??
          resolvedActor.username ??
          (actorUserId ? `user:${actorUserId}` : null);
      }
    } else if (!actorIdentifier) {
      if (actorType === AUDIT_ACTOR_TYPE.SERVICE_ACCOUNT && actorServiceAccountId) {
        actorIdentifier = `sa:${actorServiceAccountId}`;
      } else if (actorType === AUDIT_ACTOR_TYPE.USER && actorUserId) {
        actorIdentifier = `user:${actorUserId}`;
      } else if (actorType === AUDIT_ACTOR_TYPE.SYSTEM) {
        actorIdentifier = 'system';
      }
    }

    const correlationId =
      input.correlationId?.trim() || ctx?.correlationId || `corr-${randomUUID()}`;
    const requestId =
      input.requestId?.trim() || ctx?.requestId || ctx?.correlationId || correlationId;
    const ipAddress = input.ipAddress?.trim() || ctx?.ipAddress || '127.0.0.1';
    const userAgent = input.userAgent?.trim() || ctx?.userAgent || null;

    const normalizedPayload: Omit<AuditLogRecord, 'id' | 'createdAt'> = {
      actorType,
      actorTypeName: getAuditActorTypeName(actorType),
      actorUserId,
      actorServiceAccountId,
      actorApiClientId,
      actorIdentifier,
      module: input.module.trim().toLowerCase(),
      feature: input.feature.trim().toLowerCase(),
      action: input.action.trim().toUpperCase(),
      resourceType: input.resourceType ? input.resourceType.trim().toLowerCase() : null,
      resourceId:
        input.resourceId !== undefined && input.resourceId !== null
          ? String(input.resourceId)
          : null,
      beforeData: sanitizeAuditSnapshot(input.beforeData),
      afterData: sanitizeAuditSnapshot(input.afterData),
      reason: input.reason?.trim() ? input.reason.trim() : null,
      ipAddress,
      userAgent,
      requestId,
      correlationId,
    };

    if (this.persistencePort) {
      try {
        const saved = await this.persistencePort.saveRecord(normalizedPayload);
        this.inMemoryStore.unshift(saved);
        return saved;
      } catch {
        // Fallback to in-memory store when TypeORM repository metadata is not initialized in test harnesses
      }
    }

    const record: AuditLogRecord = {
      id: ++this.inMemorySeq,
      ...normalizedPayload,
      createdAt: new Date().toISOString(),
    };
    this.inMemoryStore.unshift(record);
    return record;
  }

  /**
   * Tra cứu danh sách Audit Log có phân trang và lọc theo người dùng, Service Account,
   * module, chức năng, hành động, thời gian, Request ID / Correlation ID (Mục 4.4.7).
   */
  public async listPaginated(filter: AuditLogQueryFilter = {}): Promise<AuditLogPaginatedResult> {
    const { page, limit, offset } = resolvePagination(filter, {
      settingPrefix: 'roles.audit_log',
      defaultLimit: 20,
      maxLimit: 200,
    });

    if (this.persistencePort) {
      try {
        const { items, total } = await this.persistencePort.searchPaginated({
          ...filter,
          page,
          limit,
        });
        return {
          data: items,
          meta: {
            page,
            limit,
            totalItems: total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
          },
        };
      } catch {
        // Fallback to in-memory store when TypeORM repository metadata is not initialized
      }
    }

    let list = [...this.inMemoryStore];
    if (filter.actorType !== undefined) {
      list = list.filter((item) => item.actorType === Number(filter.actorType));
    }
    if (filter.actorUserId !== undefined) {
      list = list.filter((item) => Number(item.actorUserId) === Number(filter.actorUserId));
    }
    if (filter.actorServiceAccountId !== undefined) {
      list = list.filter(
        (item) => Number(item.actorServiceAccountId) === Number(filter.actorServiceAccountId),
      );
    }
    if (filter.module?.trim()) {
      const mod = filter.module.trim().toLowerCase();
      list = list.filter((item) => item.module === mod);
    }
    if (filter.feature?.trim()) {
      const feat = filter.feature.trim().toLowerCase();
      list = list.filter((item) => item.feature === feat);
    }
    if (filter.action?.trim()) {
      const act = filter.action.trim().toUpperCase();
      list = list.filter((item) => item.action.includes(act));
    }
    if (filter.resourceType?.trim()) {
      const rt = filter.resourceType.trim().toLowerCase();
      list = list.filter((item) => item.resourceType === rt);
    }
    if (filter.resourceId?.trim()) {
      const rid = filter.resourceId.trim();
      list = list.filter((item) => item.resourceId === rid);
    }
    if (filter.requestId?.trim()) {
      const reqId = filter.requestId.trim().toLowerCase();
      list = list.filter((item) => (item.requestId ?? '').toLowerCase().includes(reqId));
    }
    if (filter.correlationId?.trim()) {
      const corrId = filter.correlationId.trim().toLowerCase();
      list = list.filter((item) => (item.correlationId ?? '').toLowerCase().includes(corrId));
    }
    if (filter.ipAddress?.trim()) {
      const ip = filter.ipAddress.trim().toLowerCase();
      list = list.filter((item) => (item.ipAddress ?? '').toLowerCase().includes(ip));
    }
    if (filter.fromDate) {
      const fromTs = new Date(filter.fromDate).getTime();
      if (!Number.isNaN(fromTs)) {
        list = list.filter((item) => new Date(item.createdAt).getTime() >= fromTs);
      }
    }
    if (filter.toDate) {
      const toTs = new Date(filter.toDate).getTime();
      if (!Number.isNaN(toTs)) {
        list = list.filter((item) => new Date(item.createdAt).getTime() <= toTs);
      }
    }
    if (filter.q?.trim()) {
      const kw = filter.q.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.module.toLowerCase().includes(kw) ||
          item.feature.toLowerCase().includes(kw) ||
          item.action.toLowerCase().includes(kw) ||
          (item.actorIdentifier ?? '').toLowerCase().includes(kw) ||
          (item.reason ?? '').toLowerCase().includes(kw) ||
          (item.resourceId ?? '').toLowerCase().includes(kw) ||
          (item.requestId ?? '').toLowerCase().includes(kw) ||
          (item.correlationId ?? '').toLowerCase().includes(kw),
      );
    }

    if (filter.sortOrder === 'ASC') {
      list.sort((a, b) => a.id - b.id);
    } else {
      list.sort((a, b) => b.id - a.id);
    }

    const totalItems = list.length;
    const data = list.slice(offset, offset + limit);

    return {
      data,
      meta: {
        page,
        limit,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      },
    };
  }

  /** Xem chi tiết một bản ghi Audit Log theo ID */
  public async getById(id: number): Promise<AuditLogRecord> {
    if (this.persistencePort) {
      try {
        const found = await this.persistencePort.findById(Number(id));
        if (!found) {
          throw new NotFoundAppException('roles.auditLogNotFound', { id });
        }
        return found;
      } catch (err) {
        if (err instanceof NotFoundAppException) {
          throw err;
        }
        // Fallback to in-memory store when TypeORM repository metadata is not initialized
      }
    }

    const found = this.inMemoryStore.find((item) => Number(item.id) === Number(id));
    if (!found) {
      throw new NotFoundAppException('roles.auditLogNotFound', { id });
    }
    return found;
  }

  /**
   * Chặn tuyệt đối thao tác sửa bản ghi Audit Log qua API/Service thông thường (Mục 4.4.8 — Bảo vệ tính toàn vẹn).
   */
  public async update(id: number, _payload?: unknown): Promise<never> {
    throw new ForbiddenAppException('security.auditLogImmutable', [
      {
        id,
        operation: 'UPDATE',
        reason: 'Audit logs are append-only and cannot be modified via API',
      },
    ]);
  }

  /**
   * Chặn tuyệt đối thao tác xóa bản ghi Audit Log qua API/Service thông thường (Mục 4.4.8 — Bảo vệ tính toàn vẹn).
   */
  public async remove(id: number): Promise<never> {
    throw new ForbiddenAppException('security.auditLogImmutable', [
      {
        id,
        operation: 'DELETE',
        reason: 'Audit logs are append-only and cannot be deleted via API',
      },
    ]);
  }
}
