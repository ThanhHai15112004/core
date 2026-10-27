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
import { REPORTS_ROUTES } from '../routes/reports.routes.js';
import { ReportsService } from '../services/reports.service.js';
import {
  type CreateReportScheduleRequest,
  type ListReportHistoriesQuery,
  type ListReportSchedulesQuery,
  type ListReportsQuery,
  type RunReportRequest,
  type UpdateReportScheduleRequest,
  createReportScheduleRequestSchema,
  listReportHistoriesQuerySchema,
  listReportSchedulesQuerySchema,
  listReportsQuerySchema,
  runReportRequestSchema,
  updateReportScheduleRequestSchema,
} from '../requests/reports.requests.js';
import {
  type ReportExecutionResponse,
  registeredReportDefinitionResponseSchema,
  reportExecutionResponseSchema,
  reportHistoryItemResponseSchema,
  reportScheduleItemResponseSchema,
  reportTemporaryDownloadResponseSchema,
} from '../responses/reports.response.js';

const tokenParamSchema = z.string().trim().min(1).max(128);

@ApiGroup('Reporting & Dashboard Engine', 'Quản lý Báo cáo, Dashboard & Lịch gửi định kỳ (Mục 8.4)')
@Controller(REPORTS_ROUTES.PREFIX)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /** Danh sách các báo cáo & dashboard đã đăng ký theo module (Mục 8.4.1 & 8.4.3 — dùng quyền riêng `*.report`) */
  @Get(REPORTS_ROUTES.ROOT)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary:
      'Lấy danh sách các báo cáo & dashboard đã đăng ký của các module (phân quyền riêng *.report)',
    response: z.array(registeredReportDefinitionResponseSchema),
  })
  public listAvailableReports(@ValidatedQuery(listReportsQuerySchema) query: ListReportsQuery) {
    return this.reportsService.listAvailableReports(query);
  }

  /** Thực thi báo cáo / dashboard (Mục 8.4.2, 8.4.3, 8.4.4, 8.4.6, 8.4.7, 8.4.8, 8.4.9) */
  @Post(REPORTS_ROUTES.RUN)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary:
      'Chạy báo cáo / dashboard (hỗ trợ lọc khoảng ngày/trạng thái/đơn vị, Queue cho báo cáo nặng, Read Replica, Cache & file tạm)',
    response: reportExecutionResponseSchema,
  })
  public async runReport(
    @ValidatedBody(runReportRequestSchema) body: RunReportRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ReportExecutionResponse> {
    return this.reportsService.runReport(body, actor);
  }

  /** Lên lịch gửi báo cáo định kỳ theo ngày, tuần hoặc tháng (Mục 8.4.5 & 8.4.6) */
  @Post(REPORTS_ROUTES.SCHEDULES)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Lên lịch gửi báo cáo định kỳ theo ngày (DAILY), tuần (WEEKLY) hoặc tháng (MONTHLY)',
    response: reportScheduleItemResponseSchema,
  })
  public async createReportSchedule(
    @ValidatedBody(createReportScheduleRequestSchema) body: CreateReportScheduleRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.reportsService.createReportSchedule(body, actor);
  }

  /** Xem danh sách lịch gửi báo cáo định kỳ từ bảng `report_schedules` (Mục 8.4.5) */
  @Get(REPORTS_ROUTES.SCHEDULES)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Xem danh sách lịch gửi báo cáo định kỳ (DAILY / WEEKLY / MONTHLY)',
    response: z.array(reportScheduleItemResponseSchema),
  })
  public async listReportSchedules(
    @ValidatedQuery(listReportSchedulesQuerySchema) query: ListReportSchedulesQuery,
  ) {
    return this.reportsService.listReportSchedules(query);
  }

  /** Xem chi tiết một lịch gửi báo cáo định kỳ theo ID (Mục 8.4.5) */
  @Get(REPORTS_ROUTES.SCHEDULE_BY_ID)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Xem chi tiết lịch gửi báo cáo định kỳ theo ID',
    response: reportScheduleItemResponseSchema,
  })
  public async getReportScheduleById(
    @ValidatedParams(positiveIntParamSchema, 'scheduleId') scheduleId: number,
  ) {
    return this.reportsService.getReportScheduleById(scheduleId);
  }

  /** Cập nhật lịch gửi báo cáo định kỳ theo ID (Mục 8.4.5) */
  @Patch(REPORTS_ROUTES.SCHEDULE_BY_ID)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Cập nhật lịch gửi báo cáo định kỳ (tần suất, giờ chạy, người nhận, trạng thái...)',
    response: reportScheduleItemResponseSchema,
  })
  public async updateReportSchedule(
    @ValidatedParams(positiveIntParamSchema, 'scheduleId') scheduleId: number,
    @ValidatedBody(updateReportScheduleRequestSchema) body: UpdateReportScheduleRequest,
  ) {
    return this.reportsService.updateReportSchedule(scheduleId, body);
  }

  /** Xóa lịch gửi báo cáo định kỳ theo ID (Mục 8.4.5) */
  @Delete(REPORTS_ROUTES.SCHEDULE_BY_ID)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Xóa lịch gửi báo cáo định kỳ theo ID',
  })
  public async deleteReportSchedule(
    @ValidatedParams(positiveIntParamSchema, 'scheduleId') scheduleId: number,
  ) {
    return this.reportsService.deleteReportSchedule(scheduleId);
  }

  /** Kích hoạt chạy các lịch gửi báo cáo đã đến hạn (Mục 8.4.5 & 8.4.6) */
  @Post(REPORTS_ROUTES.SCHEDULES_TRIGGER_DUE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary:
      'Kích hoạt thực thi các lịch báo cáo đã đến hạn kèm gửi Email / thông báo chứa file tạm',
  })
  public async triggerDueReportSchedules() {
    return this.reportsService.triggerDueReportSchedules();
  }

  /** Xem danh sách lịch sử chạy báo cáo từ bảng `report_histories` (Thời gian, người chạy và kết quả — Mục 8.4.7) */
  @Get(REPORTS_ROUTES.HISTORIES)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Xem danh sách lịch sử chạy báo cáo (Thời gian, người chạy, nguồn đọc và kết quả)',
    response: z.array(reportHistoryItemResponseSchema),
  })
  public async listReportHistories(
    @ValidatedQuery(listReportHistoriesQuerySchema) query: ListReportHistoriesQuery,
  ) {
    return this.reportsService.listReportHistories(query);
  }

  /** Xem chi tiết một bản ghi lịch sử chạy báo cáo theo ID (Mục 8.4.7) */
  @Get(REPORTS_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Xem chi tiết bản ghi lịch sử chạy báo cáo theo ID',
    response: reportHistoryItemResponseSchema,
  })
  public async getReportHistoryById(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.reportsService.getReportHistoryById(historyId);
  }

  /** Xóa một bản ghi lịch sử chạy báo cáo theo ID (Mục 8.4.7) */
  @Delete(REPORTS_ROUTES.HISTORY_BY_ID)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Xóa bản ghi lịch sử chạy báo cáo theo ID',
  })
  public async deleteReportHistory(
    @ValidatedParams(positiveIntParamSchema, 'historyId') historyId: number,
  ) {
    return this.reportsService.deleteReportHistory(historyId);
  }

  /** Tải xuống file báo cáo tạm thời qua token (tự động chặn khi file đã hết hạn — Mục 8.4.6) */
  @Get(REPORTS_ROUTES.DOWNLOAD_BY_TOKEN)
  @RequirePermissions('users.report')
  @ApiDoc({
    summary: 'Tải file báo cáo tạm thời theo token (tự động hết hạn theo TTL cấu hình)',
    response: reportTemporaryDownloadResponseSchema,
  })
  public downloadTemporaryReport(@ValidatedParams(tokenParamSchema, 'token') token: string) {
    return this.reportsService.downloadTemporaryReport(token);
  }
}
