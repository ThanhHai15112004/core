import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
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
import { COMMENTS_ROUTES } from '../routes/comments.routes.js';
import { CommentsService } from '../services/comments.service.js';
import {
  type CreateRecordCommentRequest,
  type GetRecordActivityTimelineQuery,
  type ListRecordCommentsQuery,
  type UpdateRecordCommentRequest,
  createRecordCommentSchema,
  getRecordActivityTimelineQuerySchema,
  listRecordCommentsQuerySchema,
  updateRecordCommentSchema,
} from '../requests/comments.requests.js';
import {
  recordActivityTimelineResponseSchema,
  recordCommentItemResponseSchema,
} from '../responses/comments.response.js';

@ApiGroup(
  'Comments, Internal Notes & Activity Timeline',
  'Quản lý bình luận bản ghi, ghi chú nội bộ, trả lời theo chuỗi, nhắc tên @mention, đính kèm tệp và dòng thời gian hoạt động (Mục 9.5)',
)
@Controller(COMMENTS_ROUTES.PREFIX)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  /** Danh sách bình luận và ghi chú nội bộ của bản ghi theo cấu trúc cây (Mục 9.5.1–9.5.5) */
  @Get()
  @RequirePermissions('comments.read')
  @ApiDoc({
    summary: 'Danh sách bình luận và ghi chú nội bộ của bản ghi theo chuỗi (Mục 9.5)',
    response: z.array(recordCommentItemResponseSchema),
  })
  public async listComments(
    @ValidatedQuery(listRecordCommentsQuerySchema) query: ListRecordCommentsQuery,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.commentsService.listComments(query, actor);
  }

  /** Thêm bình luận, ghi chú nội bộ, trả lời, nhắc tên @mention và đính kèm tệp (Mục 9.5.1–9.5.5) */
  @Post()
  @RequirePermissions('comments.create')
  @ApiDoc({
    summary:
      'Thêm bình luận hoặc ghi chú nội bộ kèm trả lời, @mention và đính kèm tệp (Mục 9.5.1–9.5.5)',
    status: HTTP_STATUS_CODE.CREATED,
    response: recordCommentItemResponseSchema,
  })
  public async createComment(
    @ValidatedBody(createRecordCommentSchema) body: CreateRecordCommentRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.commentsService.createComment(body, actor);
  }

  /** Chỉnh sửa bình luận theo thời hạn/quyền và lưu lịch sử chỉnh sửa (Mục 9.5.6 & 9.5.7) */
  @Patch(COMMENTS_ROUTES.BY_ID)
  @RequirePermissions('comments.update')
  @ApiDoc({
    summary: 'Chỉnh sửa bình luận và lưu lịch sử nội dung cũ (Mục 9.5.6 & 9.5.7)',
    response: recordCommentItemResponseSchema,
  })
  public async updateComment(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateRecordCommentSchema) body: UpdateRecordCommentRequest,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.commentsService.updateComment(id, body, actor);
  }

  /** Xóa bình luận theo thời hạn và quyền (Mục 9.5.6) */
  @Delete(COMMENTS_ROUTES.BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('comments.delete')
  @ApiDoc({
    summary: 'Xóa bình luận theo thời hạn và quyền (Mục 9.5.6)',
  })
  public async deleteComment(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.commentsService.deleteComment(id, actor);
  }

  /** Hiển thị dòng thời gian hoạt động hợp nhất: Comment + Workflow + Audit (Mục 9.5.8) */
  @Get(COMMENTS_ROUTES.TIMELINE)
  @RequirePermissions('comments.read')
  @ApiDoc({
    summary: 'Hiển thị dòng thời gian hoạt động hợp nhất (Comment, Workflow, Audit — Mục 9.5.8)',
    response: recordActivityTimelineResponseSchema,
  })
  public async getRecordTimeline(
    @ValidatedQuery(getRecordActivityTimelineQuerySchema) query: GetRecordActivityTimelineQuery,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.commentsService.getRecordTimeline(query, actor);
  }
}
