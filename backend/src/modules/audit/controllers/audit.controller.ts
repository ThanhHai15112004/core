import { Body, Controller, Delete, Get, Patch, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  RequireAnyPermission,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import type {
  AuditLogPaginatedResult,
  AuditLogRecord,
  SecurityAnomalyAlert,
  SecurityEventRecord,
} from '@packages/security/index.js';
import { AUDIT_ROUTES } from '../routes/audit.routes.js';
import { type ListAuditLogsQuery, listAuditLogsQuerySchema } from '../requests/audit.requests.js';
import { AuditService } from '../services/audit.service.js';

@Controller(AUDIT_ROUTES.PREFIX)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /** Tra cứu và lọc danh sách Nhật ký thao tác (Audit Log — Mục 4.4.7) */
  @Get()
  @RequireAnyPermission('audit.read', 'roles.read')
  public async listRootAuditLogs(
    @ValidatedQuery(listAuditLogsQuerySchema)
    query: ListAuditLogsQuery,
  ): Promise<AuditLogPaginatedResult> {
    return this.auditService.listAuditLogs(query);
  }

  /** Tra cứu và lọc danh sách Nhật ký thao tác qua đường dẫn /audit/logs (Mục 4.4.7) */
  @Get(AUDIT_ROUTES.LOGS)
  @RequireAnyPermission('audit.read', 'roles.read')
  public async listAuditLogs(
    @ValidatedQuery(listAuditLogsQuerySchema)
    query: ListAuditLogsQuery,
  ): Promise<AuditLogPaginatedResult> {
    return this.auditService.listAuditLogs(query);
  }

  /** Tra cứu danh sách Sự kiện bảo mật (Security Events — Mục 4.5.7) */
  @Get(AUDIT_ROUTES.SECURITY_EVENTS)
  @RequireAnyPermission('audit.read', 'roles.read')
  public listSecurityEvents(
    @ValidatedQuery(
      z.object({
        eventType: z.string().trim().optional(),
        actorId: z.coerce.number().int().min(1).optional(),
        actorUserId: z.coerce.number().int().min(1).optional(),
        targetUserId: z.coerce.number().int().min(1).optional(),
        module: z.string().trim().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    )
    query: {
      eventType?: string;
      actorId?: number;
      actorUserId?: number;
      targetUserId?: number;
      module?: string;
      limit?: number;
    },
  ): SecurityEventRecord[] {
    return this.auditService.listSecurityEvents(query);
  }

  /** Tra cứu danh sách Cảnh báo thao tác bất thường (SIEM Anomaly Alerts — Mục 4.5.8) */
  @Get(AUDIT_ROUTES.SECURITY_ALERTS)
  @RequireAnyPermission('audit.read', 'roles.read')
  public listSecurityAlerts(
    @ValidatedQuery(
      z.object({
        anomalyType: z.string().trim().optional(),
        severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'WARNING', 'HIGH', 'CRITICAL']).optional(),
        actorId: z.coerce.number().int().min(1).optional(),
        actorUserId: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    )
    query: {
      anomalyType?: string;
      severity?: 'INFO' | 'LOW' | 'MEDIUM' | 'WARNING' | 'HIGH' | 'CRITICAL';
      actorId?: number;
      actorUserId?: number;
      limit?: number;
    },
  ): SecurityAnomalyAlert[] {
    return this.auditService.listSecurityAlerts(query);
  }

  /** Xem chi tiết một bản ghi Audit Log theo ID qua /audit/logs/:id (Mục 4.4.7) */
  @Get(AUDIT_ROUTES.LOG_BY_ID)
  @RequireAnyPermission('audit.read', 'roles.read')
  public async getAuditLogById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<AuditLogRecord> {
    return this.auditService.getAuditLogById(id);
  }

  /** Chặn sửa Audit Log bằng PUT /audit/logs/:id (Mục 4.4.8 — Bảo vệ tính toàn vẹn) */
  @Put(AUDIT_ROUTES.LOG_BY_ID)
  @RequireAnyPermission('audit.manage', 'roles.manage')
  public async updateAuditLogPut(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @Body() body?: unknown,
  ): Promise<never> {
    return this.auditService.updateAuditLog(id, body);
  }

  /** Chặn sửa Audit Log bằng PATCH /audit/logs/:id (Mục 4.4.8 — Bảo vệ tính toàn vẹn) */
  @Patch(AUDIT_ROUTES.LOG_BY_ID)
  @RequireAnyPermission('audit.manage', 'roles.manage')
  public async updateAuditLogPatch(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @Body() body?: unknown,
  ): Promise<never> {
    return this.auditService.updateAuditLog(id, body);
  }

  /** Chặn xóa Audit Log bằng DELETE /audit/logs/:id (Mục 4.4.8 — Bảo vệ tính toàn vẹn) */
  @Delete(AUDIT_ROUTES.LOG_BY_ID)
  @RequireAnyPermission('audit.manage', 'roles.manage')
  public async deleteAuditLog(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<never> {
    return this.auditService.deleteAuditLog(id);
  }

  /** Xem chi tiết một bản ghi Audit Log theo ID qua /audit/:id (Mục 4.4.7) */
  @Get(AUDIT_ROUTES.BY_ID)
  @RequireAnyPermission('audit.read', 'roles.read')
  public async getRootAuditLogById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<AuditLogRecord> {
    return this.auditService.getAuditLogById(id);
  }

  /** Chặn sửa Audit Log bằng PUT /audit/:id (Mục 4.4.8) */
  @Put(AUDIT_ROUTES.BY_ID)
  @RequireAnyPermission('audit.manage', 'roles.manage')
  public async updateRootAuditLogPut(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @Body() body?: unknown,
  ): Promise<never> {
    return this.auditService.updateAuditLog(id, body);
  }

  /** Chặn sửa Audit Log bằng PATCH /audit/:id (Mục 4.4.8) */
  @Patch(AUDIT_ROUTES.BY_ID)
  @RequireAnyPermission('audit.manage', 'roles.manage')
  public async updateRootAuditLogPatch(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @Body() body?: unknown,
  ): Promise<never> {
    return this.auditService.updateAuditLog(id, body);
  }

  /** Chặn xóa Audit Log bằng DELETE /audit/:id (Mục 4.4.8) */
  @Delete(AUDIT_ROUTES.BY_ID)
  @RequireAnyPermission('audit.manage', 'roles.manage')
  public async deleteRootAuditLog(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<never> {
    return this.auditService.deleteAuditLog(id);
  }
}
