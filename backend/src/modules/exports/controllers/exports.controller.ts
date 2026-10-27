import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { EXPORTS_ROUTES } from '../routes/exports.routes.js';
import { ExportsService } from '../services/exports.service.js';
import {
  type ExecuteExportQuery,
  type ListExportHistoriesQuery,
  type UpdateExportHistoryRequest,
  executeExportQuerySchema,
  listExportHistoriesQuerySchema,
  updateExportHistoryRequestSchema,
} from '../requests/exports.requests.js';
import {
  type ExecuteExportResponse,
  executeExportResponseSchema,
  exportHistoryItemResponseSchema,
  exportJobProgressResponseSchema,
  exportTemporaryDownloadResponseSchema,
} from '../responses/exports.response.js';

const profileCodeParamSchema = z.string().trim().min(1).max(64);
const tokenParamSchema = z.string().trim().min(1).max(128);
const jobIdParamSchema = z.string().trim().min(1).max(128);

@ApiGroup(
  'Data Export Engine',
  'Quản lý Xuất dữ liệu & Tệp tạm thời dùng chung cho các module (Mục 8.3)',
)
@Controller(EXPORTS_ROUTES.PREFIX)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /** Xem danh sách lịch sử Export từ bảng `export_histories` (Người thực hiện, bộ lọc và số dòng — Mục 8.3.7) */
  @Get(EXPORTS_ROUTES.HISTORIES)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Xem danh sách lịch sử Export (Người thực hiện, bộ lọc và số dòng)',
    response: z.array(exportHistoryItemResponseSchema),
  })
  public async listExportHistories(
    @ValidatedQuery(listExportHistoriesQuerySchema) query: ListExportHistoriesQuery,
  ) {
    return this.exportsService.listHistories(query);
  }

  /** Xem chi tiết một bản ghi lịch sử Export theo ID (Mục 8.3.7) */
  @Get(EXPORTS_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Xem chi tiết bản ghi lịch sử Export theo ID',
    response: exportHistoryItemResponseSchema,
  })
  public async getExportHistoryById(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.exportsService.getHistoryById(historyId);
  }

  /** Cập nhật bản ghi lịch sử Export theo ID */
  @Patch(EXPORTS_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Cập nhật trạng thái hoặc thông tin bản ghi lịch sử Export theo ID',
    response: exportHistoryItemResponseSchema,
  })
  public async updateExportHistory(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
    @ValidatedBody(updateExportHistoryRequestSchema) body: UpdateExportHistoryRequest,
  ) {
    return this.exportsService.updateHistory(historyId, body);
  }

  /** Xóa bản ghi lịch sử Export và thu hồi tệp tạm liên quan theo ID */
  @Delete(EXPORTS_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Xóa bản ghi lịch sử Export theo ID',
  })
  public async deleteExportHistory(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.exportsService.deleteHistory(historyId);
  }

  /** Theo dõi tiến độ công việc Export chạy nền qua Queue (Mục 8.3.4) */
  @Get(EXPORTS_ROUTES.JOB_PROGRESS)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Xem tiến độ công việc Export chạy nền qua Queue',
    response: exportJobProgressResponseSchema,
  })
  public getExportJobProgress(@ValidatedParams(jobIdParamSchema, 'jobId') jobId: string) {
    return this.exportsService.getJobProgress(jobId);
  }

  /** Tải xuống file Export qua đường dẫn tạm thời (tự động chặn khi file đã hết hạn — Mục 8.3.5 & 8.3.8) */
  @Get(EXPORTS_ROUTES.DOWNLOAD_BY_TOKEN)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Tải file Export tạm thời theo token (tự động hết hạn theo TTL cấu hình)',
    response: exportTemporaryDownloadResponseSchema,
  })
  public async downloadTemporaryExport(@ValidatedParams(tokenParamSchema, 'token') token: string) {
    return this.exportsService.downloadTemporaryExport(token);
  }

  /** Dọn dẹp các file Export tạm thời đã hết hạn (Mục 8.3.8) */
  @Post(EXPORTS_ROUTES.PURGE_EXPIRED)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary: 'Thu hồi & xóa toàn bộ các file Export tạm thời đã hết hạn',
  })
  public async purgeExpiredExports() {
    return this.exportsService.purgeExpiredExports();
  }

  /** Xuất danh sách dữ liệu theo `profileCode` ra Excel (.xlsx), CSV (.csv) hoặc PDF (.pdf) giữ đúng bộ lọc & Data Scope (Mục 8.3) */
  @Get(EXPORTS_ROUTES.EXECUTE_BY_PROFILE)
  @RequirePermissions('users.export')
  @ApiDoc({
    summary:
      'Xuất danh sách dữ liệu theo profileCode ra định dạng Excel (.xlsx), CSV (.csv) hoặc PDF (.pdf) theo bộ lọc & Data Scope',
    response: executeExportResponseSchema,
  })
  public async executeExport(
    @ValidatedParams(profileCodeParamSchema, 'profileCode') profileCode: string,
    @ValidatedQuery(executeExportQuerySchema) query: ExecuteExportQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ExecuteExportResponse> {
    return this.exportsService.executeExport(profileCode, query, actor);
  }
}
