import { Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiDoc,
  ApiGroup,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  intIdParamSchema,
} from '@packages/http/index.js';
import type { IdempotencyMetricsSnapshot, PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import {
  IdempotencyMetricsQuerySchema,
  ListIdempotencyRecordsQuerySchema,
  PurgeIdempotencyRequestSchema,
  RevokeIdempotencyQuerySchema,
  type IdempotencyMetricsQuery,
  type ListIdempotencyRecordsQuery,
  type PurgeIdempotencyRequest,
  type RevokeIdempotencyQuery,
} from '../requests/idempotency.requests.js';
import { IDEMPOTENCY_ROUTES } from '../routes/idempotency.routes.js';
import { IdempotencyService } from '../services/idempotency.service.js';
import type {
  IdempotencyPurgeResult,
  IdempotencyRecordDetailView,
  IdempotencyRecordView,
  IdempotencyRevokeResult,
} from '../types/idempotency.types.js';

@ApiGroup(
  'Idempotency & Deduplication',
  'Quản trị & giám sát chống xử lý trùng tập trung (11.3): API Idempotency Key, Job business key, Webhook Event ID, Event Inbox, TTL theo luồng và tỷ lệ gửi lặp',
)
@Controller(IDEMPOTENCY_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class IdempotencyController {
  constructor(private readonly idempotencyService: IdempotencyService) {}

  @Get(IDEMPOTENCY_ROUTES.METRICS)
  @RequirePermissions('idempotency.read')
  @ApiDoc({
    summary:
      'Thống kê tỷ lệ request/event bị trùng theo 4 luồng và danh sách client/nguồn gửi lặp bất thường',
  })
  public async getMetrics(
    @ValidatedQuery(IdempotencyMetricsQuerySchema) query: IdempotencyMetricsQuery,
  ): Promise<IdempotencyMetricsSnapshot> {
    return this.idempotencyService.getMetrics(query.windowHours);
  }

  @Get(IDEMPOTENCY_ROUTES.RECORDS)
  @RequirePermissions('idempotency.read')
  @ApiDoc({
    summary:
      'Danh sách bản ghi khóa chống xử lý trùng (phân trang, lọc theo luồng API/JOB/WEBHOOK/EVENT, trạng thái, lượt trùng/xung đột)',
  })
  public async listRecords(
    @ValidatedQuery(ListIdempotencyRecordsQuerySchema) query: ListIdempotencyRecordsQuery,
  ): Promise<PaginatedResult<IdempotencyRecordView>> {
    return this.idempotencyService.listRecords(query);
  }

  @Get(IDEMPOTENCY_ROUTES.RECORD_BY_ID)
  @RequirePermissions('idempotency.read')
  @ApiDoc({
    summary: 'Chi tiết một bản ghi khóa Idempotency gồm fingerprint, TTL, phản hồi replay và lượt trùng',
  })
  public async getRecordById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<IdempotencyRecordDetailView> {
    return this.idempotencyService.getRecordById(params.id);
  }

  @Delete(IDEMPOTENCY_ROUTES.RECORD_BY_ID)
  @RequirePermissions('idempotency.manage')
  @ApiDoc({
    summary: 'Thu hồi/xóa thủ công một khóa chống xử lý trùng (có ghi Audit Log)',
  })
  public async revokeRecord(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedQuery(RevokeIdempotencyQuerySchema) query: RevokeIdempotencyQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<IdempotencyRevokeResult> {
    return this.idempotencyService.revokeRecord(params.id, query.reason, actor);
  }

  @Post(IDEMPOTENCY_ROUTES.PURGE_EXPIRED)
  @RequirePermissions('idempotency.manage')
  @ApiDoc({
    summary: 'Dọn dẹp thủ công các bản ghi khóa chống xử lý trùng đã hết hạn TTL',
  })
  public async purgeExpired(
    @ValidatedBody(PurgeIdempotencyRequestSchema) body: PurgeIdempotencyRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<IdempotencyPurgeResult> {
    return this.idempotencyService.purgeExpiredRecords(body, actor);
  }
}
