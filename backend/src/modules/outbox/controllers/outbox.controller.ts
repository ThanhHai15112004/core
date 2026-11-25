import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiDoc,
  ApiGroup,
  intIdParamSchema,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
} from '@packages/http/index.js';
import type { OutboxMetricsSnapshot, PaginatedResult } from '@packages/kernel/index.js';
import { AuthGuard, CurrentUser, type UserIdentity } from '@packages/security/index.js';
import {
  ListOutboxEventsQuerySchema,
  PurgeOutboxRequestSchema,
  ReplayOutboxBatchRequestSchema,
  ReplayOutboxEventRequestSchema,
  type ListOutboxEventsQuery,
  type PurgeOutboxRequest,
  type ReplayOutboxBatchRequest,
  type ReplayOutboxEventRequest,
} from '../requests/outbox.requests.js';
import { OUTBOX_ROUTES } from '../routes/outbox.routes.js';
import { OutboxService } from '../services/outbox.service.js';
import type {
  OutboxDispatchBatchResult,
  OutboxEventDetailView,
  OutboxEventView,
  OutboxPurgeResult,
  OutboxReplayBatchResult,
} from '../types/outbox.types.js';

@ApiGroup(
  'Transactional Outbox',
  'Quản trị Transactional Outbox (11.2): Theo dõi trạng thái Pending/Processing/Published/Failed/Dead Letter, độ trễ tồn đọng, phát lại có quyền + Audit và dọn event cũ theo chính sách',
)
@Controller(OUTBOX_ROUTES.PREFIX)
@UseGuards(AuthGuard)
export class OutboxController {
  constructor(private readonly outboxService: OutboxService) {}

  @Get(OUTBOX_ROUTES.METRICS)
  @RequirePermissions('outbox.read')
  @ApiDoc({ summary: 'Thống kê tồn đọng, độ trễ và trạng thái cảnh báo của bảng Outbox' })
  public async getMetrics(): Promise<OutboxMetricsSnapshot> {
    return this.outboxService.getMetrics();
  }

  @Get(OUTBOX_ROUTES.EVENTS)
  @RequirePermissions('outbox.read')
  @ApiDoc({ summary: 'Danh sách Outbox Events (phân trang, lọc theo trạng thái/module/event/correlation)' })
  public async listEvents(
    @ValidatedQuery(ListOutboxEventsQuerySchema) query: ListOutboxEventsQuery,
  ): Promise<PaginatedResult<OutboxEventView>> {
    return this.outboxService.listEvents(query);
  }

  @Get(OUTBOX_ROUTES.EVENT_BY_ID)
  @RequirePermissions('outbox.read')
  @ApiDoc({ summary: 'Chi tiết một Outbox Event gồm payload, metadata, headers và thông tin lỗi' })
  public async getEventById(
    @ValidatedParams(intIdParamSchema) params: { id: number },
  ): Promise<OutboxEventDetailView> {
    return this.outboxService.getEventById(params.id);
  }

  @Post(OUTBOX_ROUTES.EVENT_REPLAY)
  @RequirePermissions('outbox.replay')
  @ApiDoc({ summary: 'Phát lại thủ công một sự kiện Outbox (có kiểm tra quyền & ghi Audit Log)' })
  public async replayEvent(
    @ValidatedParams(intIdParamSchema) params: { id: number },
    @ValidatedBody(ReplayOutboxEventRequestSchema) body: ReplayOutboxEventRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<OutboxEventDetailView> {
    return this.outboxService.replayEvent(params.id, body, actor);
  }

  @Post(OUTBOX_ROUTES.EVENTS_REPLAY_BATCH)
  @RequirePermissions('outbox.replay')
  @ApiDoc({ summary: 'Phát lại hàng loạt tối đa 100 sự kiện Outbox (có kiểm tra quyền & Audit Log)' })
  public async replayBatch(
    @ValidatedBody(ReplayOutboxBatchRequestSchema) body: ReplayOutboxBatchRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<OutboxReplayBatchResult> {
    return this.outboxService.replayBatch(body, actor);
  }

  @Post(OUTBOX_ROUTES.CLEANUP)
  @RequirePermissions('outbox.manage')
  @ApiDoc({ summary: 'Chạy dọn thủ công các sự kiện PUBLISHED / DEAD_LETTER quá hạn lưu trữ' })
  public async cleanup(
    @ValidatedBody(PurgeOutboxRequestSchema) body: PurgeOutboxRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<OutboxPurgeResult> {
    return this.outboxService.purgeExpiredEvents(body, actor);
  }

  @Post(OUTBOX_ROUTES.PROCESS_NOW)
  @RequirePermissions('outbox.manage')
  @ApiDoc({ summary: 'Kích hoạt xử lý ngay một lô sự kiện Outbox đang chờ gửi' })
  public async processNow(): Promise<OutboxDispatchBatchResult> {
    return this.outboxService.processPendingBatch({ workerId: 'manual-trigger' });
  }
}
