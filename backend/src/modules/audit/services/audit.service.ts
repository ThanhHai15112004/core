import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ForbiddenAppException,
  NotFoundAppException,
  SettingRegistryService,
  defaultSettingRegistry,
  resolvePagination,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  type AuditLogPaginatedResult,
  type AuditLogQueryFilter,
  type AuditLogRecord,
  PlatformSecurityService,
  type SecurityAnomalyAlert,
  type SecurityEventRecord,
} from '@packages/security/index.js';
import {
  AUDIT_SETTING_KEYS,
  type IAuditPublicService,
  type SecurityAlertsQueryFilter,
  type SecurityEventsQueryFilter,
} from '../contracts/index.js';
import { AuditLogRepository } from '../repositories/audit-log.repository.js';
import type { ListAuditLogsQuery } from '../requests/audit.requests.js';

@Injectable()
export class AuditService implements IAuditPublicService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    @Optional()
    @Inject(AuditLogRepository)
    private readonly auditLogRepository: AuditLogRepository | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
    @Optional()
    @Inject(PlatformSecurityService)
    private readonly platformSecurityService: PlatformSecurityService | null = null,
    @Optional()
    settingRegistry?: SettingRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    if (this.auditLogRepository && this.auditLogService) {
      this.auditLogService.registerPersistencePort(this.auditLogRepository);
    }
  }

  /**
   * Tra cứu danh sách Nhật ký thao tác (Audit Log — Mục 4.4.7):
   * Hỗ trợ lọc theo người dùng, Service Account, module, chức năng, hành động, khoảng thời gian, Request ID & Correlation ID.
   */
  public async listAuditLogs(query: ListAuditLogsQuery = {}): Promise<AuditLogPaginatedResult> {
    if (!this.auditLogService) {
      const { page, limit } = resolvePagination(query, {
        settingPrefix: AUDIT_SETTING_KEYS.AUDIT_LOG_PREFIX,
        defaultLimit: 20,
        maxLimit: 200,
        registry: this.settingRegistry,
      });
      return {
        data: [],
        meta: { page, limit, totalItems: 0, totalPages: 1 },
      };
    }
    return this.auditLogService.listPaginated(query as AuditLogQueryFilter);
  }

  /** Xem chi tiết một bản ghi Audit Log theo ID (Mục 4.4.7) */
  public async getAuditLogById(id: number): Promise<AuditLogRecord> {
    if (!this.auditLogService) {
      throw new NotFoundAppException('roles.auditLogNotFound', { id });
    }
    return this.auditLogService.getById(id);
  }

  /** Chặn sửa bản ghi Audit Log qua API thường để bảo vệ tính toàn vẹn (Mục 4.4.8) */
  public async updateAuditLog(id: number, payload?: unknown): Promise<never> {
    if (this.auditLogService) {
      return this.auditLogService.update(id, payload);
    }
    throw new ForbiddenAppException('security.auditLogImmutable', [{ id, operation: 'UPDATE' }]);
  }

  /** Chặn xóa bản ghi Audit Log qua API thường để bảo vệ tính toàn vẹn (Mục 4.4.8) */
  public async deleteAuditLog(id: number): Promise<never> {
    if (this.auditLogService) {
      return this.auditLogService.remove(id);
    }
    throw new ForbiddenAppException('security.auditLogImmutable', [{ id, operation: 'DELETE' }]);
  }

  /** Tra cứu danh sách Sự kiện bảo mật (Security Events — Mục 4.5.7) */
  public listSecurityEvents(filter?: SecurityEventsQueryFilter): SecurityEventRecord[] {
    return this.platformSecurityService?.listSecurityEvents(filter) ?? [];
  }

  /** Tra cứu danh sách Cảnh báo thao tác bất thường (SIEM Anomaly Alerts — Mục 4.5.8) */
  public listSecurityAlerts(filter?: SecurityAlertsQueryFilter): SecurityAnomalyAlert[] {
    return this.platformSecurityService?.listAnomalyAlerts(filter) ?? [];
  }
}
