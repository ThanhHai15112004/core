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
import { IMPORTS_ROUTES } from '../routes/imports.routes.js';
import { ImportsService } from '../services/imports.service.js';
import {
  type ExecuteImportRequest,
  type ImportTemplateQuery,
  type ListImportHistoriesQuery,
  type PreviewImportRequest,
  type UpdateImportHistoryRequest,
  executeImportRequestSchema,
  importTemplateQuerySchema,
  listImportHistoriesQuerySchema,
  previewImportRequestSchema,
  updateImportHistoryRequestSchema,
} from '../requests/imports.requests.js';
import {
  type ExecuteImportResultResponse,
  executeImportResultResponseSchema,
  importHistoryItemResponseSchema,
  importJobProgressResponseSchema,
  importPreviewResponseSchema,
  importTemplateFileResponseSchema,
} from '../responses/imports.response.js';

const profileCodeParamSchema = z.string().trim().min(1).max(64);
const jobIdParamSchema = z.string().trim().min(1).max(128);

@ApiGroup(
  'Data Import Engine',
  'Quản lý Nhập dữ liệu hàng loạt dùng chung cho các module (Mục 8.2)',
)
@Controller(IMPORTS_ROUTES.PREFIX)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  /** Danh sách các cấu hình Import (`profileCode`) đã đăng ký trong hệ thống */
  @Get(IMPORTS_ROUTES.PROFILES)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Lấy danh sách các cấu hình Import đã đăng ký của các module',
  })
  public listProfiles() {
    return this.importsService.listProfiles();
  }

  /** Xem danh sách lịch sử Import từ bảng `import_histories` (File, người thực hiện và kết quả — Mục 8.2.9) */
  @Get(IMPORTS_ROUTES.HISTORIES)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Xem danh sách lịch sử Import (File, người thực hiện và kết quả)',
    response: z.array(importHistoryItemResponseSchema),
  })
  public async listImportHistories(
    @ValidatedQuery(listImportHistoriesQuerySchema) query: ListImportHistoriesQuery,
  ) {
    return this.importsService.listHistories(query);
  }

  /** Xem chi tiết một bản ghi lịch sử Import theo ID (Mục 8.2.9) */
  @Get(IMPORTS_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Xem chi tiết bản ghi lịch sử Import theo ID',
    response: importHistoryItemResponseSchema,
  })
  public async getImportHistoryById(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.importsService.getHistoryById(historyId);
  }

  /** Cập nhật bản ghi lịch sử Import theo ID */
  @Patch(IMPORTS_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Cập nhật trạng thái hoặc thông tin bản ghi lịch sử Import theo ID',
    response: importHistoryItemResponseSchema,
  })
  public async updateImportHistory(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
    @ValidatedBody(updateImportHistoryRequestSchema) body: UpdateImportHistoryRequest,
  ) {
    return this.importsService.updateHistory(historyId, body);
  }

  /** Xóa một bản ghi lịch sử Import theo ID */
  @Delete(IMPORTS_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Xóa bản ghi lịch sử Import theo ID',
  })
  public async deleteImportHistory(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.importsService.deleteHistory(historyId);
  }

  /** Theo dõi tiến độ công việc Import chạy nền qua Queue (Số dòng thành công, lỗi và còn lại — Mục 8.2.7 & 8.2.8) */
  @Get(IMPORTS_ROUTES.JOB_PROGRESS)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Xem tiến độ công việc Import chạy nền qua Queue (số dòng thành công, lỗi và còn lại)',
    response: importJobProgressResponseSchema,
  })
  public getImportJobProgress(@ValidatedParams(jobIdParamSchema, 'jobId') jobId: string) {
    return this.importsService.getJobProgress(jobId);
  }

  /** Tải file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) theo `profileCode` (Mục 8.2.1 & 8.2.2) */
  @Get(IMPORTS_ROUTES.TEMPLATE_BY_PROFILE)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Tải file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) theo profileCode',
    response: importTemplateFileResponseSchema,
  })
  public exportImportTemplate(
    @ValidatedParams(profileCodeParamSchema, 'profileCode') profileCode: string,
    @ValidatedQuery(importTemplateQuerySchema) query: ImportTemplateQuery,
  ) {
    return this.importsService.exportImportTemplate(
      profileCode,
      query.format === 'csv' ? 'csv' : 'xlsx',
    );
  }

  /** Xem trước dữ liệu trước khi nhập (Preview / Dry-run): ánh xạ cột, dòng mẫu và lỗi từng dòng/cột (Mục 8.2.3, 8.2.4, 8.2.5) */
  @Post(IMPORTS_ROUTES.PREVIEW_BY_PROFILE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary:
      'Xem trước dữ liệu trước khi nhập (Preview / Dry-run): ánh xạ cột, dòng mẫu và kiểm tra lỗi theo dòng/cột',
    response: importPreviewResponseSchema,
  })
  public async previewImport(
    @ValidatedParams(profileCodeParamSchema, 'profileCode') profileCode: string,
    @ValidatedBody(previewImportRequestSchema) body: PreviewImportRequest,
  ) {
    return this.importsService.previewImport(profileCode, body);
  }

  /** Nhập dữ liệu hàng loạt từ file Excel (.xlsx), CSV hoặc JSON theo `profileCode` (Mục 8.2) */
  @Post(IMPORTS_ROUTES.EXECUTE_BY_PROFILE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.import')
  @ApiDoc({
    summary: 'Nhập dữ liệu hàng loạt từ file Excel (.xlsx base64), CSV hoặc JSON theo profileCode',
    response: executeImportResultResponseSchema,
  })
  public async executeImport(
    @ValidatedParams(profileCodeParamSchema, 'profileCode') profileCode: string,
    @ValidatedBody(executeImportRequestSchema) body: ExecuteImportRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ExecuteImportResultResponse> {
    return this.importsService.executeImport(profileCode, body, actor?.id);
  }
}
