import { Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  ApiDoc,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
} from '@packages/http/index.js';
import {
  HTTP_STATUS_CODE,
  type SequenceGeneratedResult,
  type SequencePreviewResult,
} from '@packages/kernel/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import type {
  SequenceRuleHistoryRecord,
  SequenceRuleSummary,
  SyncSequencesResult,
} from '../contracts/index.js';
import { SEQUENCES_ROUTES } from '../routes/settings.routes.js';
import { SequencesService } from '../services/sequences.service.js';
import {
  type CreateSequenceRuleRequest,
  type GenerateSequenceNextRequest,
  type ListSequenceHistoryQuery,
  type ListSequenceRulesQuery,
  type PreviewSequenceRequest,
  type UpdateSequenceRuleRequest,
  createSequenceRuleSchema,
  generateSequenceNextSchema,
  listSequenceHistoryQuerySchema,
  listSequenceRulesQuerySchema,
  previewSequenceSchema,
  updateSequenceRuleSchema,
} from '../requests/settings.requests.js';
import {
  sequenceGeneratedResponseSchema,
  sequencePreviewResponseSchema,
  sequenceRuleHistoryResponseSchema,
  sequenceRuleResponseSchema,
  syncSequencesResultResponseSchema,
} from '../responses/settings.response.js';

const sequenceKeyParamSchema = z.object({
  key: z.string().trim().min(2).max(150),
});

@Controller(SEQUENCES_ROUTES.ROOT)
export class SequencesController {
  constructor(private readonly sequencesService: SequencesService) {}

  /** Đồng bộ danh mục quy tắc sinh mã mặc định từ `module.manifest.json` (Mục 5.5) */
  @Post(SEQUENCES_ROUTES.SYNC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Đồng bộ Idempotent quy tắc sinh mã từ module.manifest.json vào Database và Registry',
    status: HTTP_STATUS_CODE.OK,
    response: syncSequencesResultResponseSchema,
  })
  public async syncManifests(): Promise<SyncSequencesResult> {
    return this.sequencesService.syncManifests();
  }

  /** Xem trước mẫu mã trước khi áp dụng — tránh cấu hình sai và không tăng bộ đếm (Mục 5.5.7) */
  @Post(SEQUENCES_ROUTES.PREVIEW)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary:
      'Xem trước mẫu mã nghiệp vụ (kèm 3 mã liên tiếp) trước khi áp dụng mà không làm tăng số thứ tự thật',
    status: HTTP_STATUS_CODE.OK,
    response: sequencePreviewResponseSchema,
  })
  public previewSequence(
    @ValidatedBody(previewSequenceSchema) body: PreviewSequenceRequest,
  ): SequencePreviewResult {
    return this.sequencesService.preview(body);
  }

  /** Liệt kê danh sách các quy tắc sinh mã nghiệp vụ (Mục 5.5.1 -> 5.5.6) */
  @Get()
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary:
      'Danh sách các quy tắc sinh mã theo module, chính sách reset, phạm vi đơn vị và từ khóa',
    response: z.array(sequenceRuleResponseSchema),
  })
  public async listSequences(
    @ValidatedQuery(listSequenceRulesQuerySchema) query: ListSequenceRulesQuery,
  ): Promise<SequenceRuleSummary[]> {
    return this.sequencesService.listSequences(query);
  }

  /** Tra cứu lịch sử thay đổi cấu hình quy tắc sinh mã toàn hệ thống (Mục 5.5.8) */
  @Get(SEQUENCES_ROUTES.HISTORY)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Tra cứu lịch sử thay đổi cấu hình mã nghiệp vụ toàn hệ thống (Mục 5.5.8)',
    response: z.array(sequenceRuleHistoryResponseSchema),
  })
  public async listAllHistory(
    @ValidatedQuery(listSequenceHistoryQuerySchema) query: ListSequenceHistoryQuery,
  ): Promise<SequenceRuleHistoryRecord[]> {
    return this.sequencesService.listHistory(query);
  }

  /** Tạo mẫu sinh mã nghiệp vụ mới (Mục 5.5.1 -> 5.5.6) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary:
      'Tạo mới quy tắc sinh mã nghiệp vụ với cấu hình tiền tố, hậu tố, ngày/tháng/năm, kỳ reset và đơn vị',
    status: HTTP_STATUS_CODE.CREATED,
    response: sequenceRuleResponseSchema,
  })
  public async createSequenceRule(
    @ValidatedBody(createSequenceRuleSchema) body: CreateSequenceRuleRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SequenceRuleSummary> {
    return this.sequencesService.createSequenceRule(body, actor);
  }

  /** Xem chi tiết cấu hình một quy tắc sinh mã theo key */
  @Get(SEQUENCES_ROUTES.DETAIL)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Xem chi tiết cấu hình một quy tắc sinh mã nghiệp vụ và trạng thái bộ đếm',
    response: sequenceRuleResponseSchema,
  })
  public async getSequenceByKey(
    @ValidatedParams(sequenceKeyParamSchema) params: { key: string },
  ): Promise<SequenceRuleSummary> {
    return this.sequencesService.getSequenceByKey(params.key);
  }

  /** Cập nhật cấu hình quy tắc sinh mã — không làm ảnh hưởng các mã đã cấp (Mục 5.5.2 -> 5.5.8) */
  @Put(SEQUENCES_ROUTES.DETAIL)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary:
      'Cập nhật tiền tố, hậu tố, định dạng ngày tháng, kỳ reset và phạm vi đơn vị (không ảnh hưởng mã đã cấp)',
    response: sequenceRuleResponseSchema,
  })
  public async updateSequenceRule(
    @ValidatedParams(sequenceKeyParamSchema) params: { key: string },
    @ValidatedBody(updateSequenceRuleSchema) body: UpdateSequenceRuleRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SequenceRuleSummary> {
    return this.sequencesService.updateSequenceRule(params.key, body, actor);
  }

  /** Sinh số thứ tự / mã nghiệp vụ tiếp theo an toàn khi nhiều request cùng lúc (Mục 5.5.4 -> 5.5.6) */
  @Post(SEQUENCES_ROUTES.NEXT)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary:
      'Sinh 1 hoặc nhiều mã nghiệp vụ tiếp theo an toàn đồng thời (Concurrency-safe, hỗ trợ theo đơn vị & kỳ reset)',
    status: HTTP_STATUS_CODE.OK,
    response: z.union([sequenceGeneratedResponseSchema, z.array(sequenceGeneratedResponseSchema)]),
  })
  public async generateNext(
    @ValidatedParams(sequenceKeyParamSchema) params: { key: string },
    @ValidatedBody(generateSequenceNextSchema) body: GenerateSequenceNextRequest,
  ): Promise<SequenceGeneratedResult | SequenceGeneratedResult[]> {
    const count = body?.count ?? 1;
    if (count > 1) {
      return this.sequencesService.nextBatch(params.key, count, {
        organizationUnitId: body?.organizationUnitId,
        unitCode: body?.unitCode,
        at: body?.at,
        timezone: body?.timezone,
      });
    }
    return this.sequencesService.nextCode(params.key, {
      organizationUnitId: body?.organizationUnitId,
      unitCode: body?.unitCode,
      at: body?.at,
      timezone: body?.timezone,
    });
  }

  /** Lịch sử thay đổi cấu hình của một quy tắc sinh mã cụ thể (Mục 5.5.8) */
  @Get(SEQUENCES_ROUTES.KEY_HISTORY)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Tra cứu lịch sử thay đổi cấu hình của một quy tắc sinh mã cụ thể (Mục 5.5.8)',
    response: z.array(sequenceRuleHistoryResponseSchema),
  })
  public async listKeyHistory(
    @ValidatedParams(sequenceKeyParamSchema) params: { key: string },
    @ValidatedQuery(listSequenceHistoryQuerySchema.omit({ sequenceKey: true }))
    query: Omit<ListSequenceHistoryQuery, 'sequenceKey'>,
  ): Promise<SequenceRuleHistoryRecord[]> {
    return this.sequencesService.listHistory({
      sequenceKey: params.key,
      action: query.action,
      actorUserId: query.actorUserId,
      limit: query.limit,
    });
  }
}
