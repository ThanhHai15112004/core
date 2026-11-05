import { Controller, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  ApiDoc,
  RequireAnyPermission,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  intQueryParam,
} from '@packages/http/index.js';
import { type FeatureFlagEvaluationResult, HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import type {
  FeatureFlagHistoryRecord,
  FeatureFlagSummary,
  SyncFeatureFlagsResult,
} from '../contracts/index.js';
import {
  type CreateFeatureFlagRequest,
  type EvaluateFeatureFlagsQuery,
  type ListFeatureFlagHistoryQuery,
  type ListFeatureFlagsQuery,
  type ToggleFeatureFlagRequest,
  type UpdateFeatureFlagRequest,
  createFeatureFlagSchema,
  evaluateFeatureFlagsQuerySchema,
  listFeatureFlagHistoryQuerySchema,
  listFeatureFlagsQuerySchema,
  toggleFeatureFlagSchema,
  updateFeatureFlagSchema,
} from '../requests/feature-flags.requests.js';
import {
  evaluatedFeatureFlagResponseSchema,
  featureFlagHistoryResponseSchema,
  featureFlagResponseSchema,
  syncFeatureFlagsResultResponseSchema,
} from '../responses/feature-flags.response.js';
import { FEATURE_FLAGS_ROUTES } from '../routes/feature-flags.routes.js';
import { FeatureFlagsService } from '../services/feature-flags.service.js';

const flagKeyParamSchema = z.object({
  key: z.string().trim().min(2).max(150),
});

@Controller(FEATURE_FLAGS_ROUTES.ROOT)
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Post(FEATURE_FLAGS_ROUTES.SYNC)
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission('feature-flags.manage', 'settings.manage')
  @ApiDoc({
    summary: 'Đồng bộ Idempotent Feature Flags từ module.manifest.json vào Database và Cache',
    status: HTTP_STATUS_CODE.OK,
    response: syncFeatureFlagsResultResponseSchema,
  })
  public async syncManifests(): Promise<SyncFeatureFlagsResult> {
    return this.featureFlagsService.syncManifests();
  }

  @Get()
  @RequireAnyPermission('feature-flags.read', 'settings.read')
  @ApiDoc({
    summary: 'Danh sách Feature Flags theo module, trạng thái bật/tắt và từ khóa',
    response: z.array(featureFlagResponseSchema),
  })
  public async listFeatureFlags(
    @ValidatedQuery(listFeatureFlagsQuerySchema) query: ListFeatureFlagsQuery,
  ): Promise<FeatureFlagSummary[]> {
    return this.featureFlagsService.listFeatureFlags(query);
  }

  @Get(FEATURE_FLAGS_ROUTES.EVALUATE)
  @RequireAnyPermission('feature-flags.read', 'settings.read')
  @ApiDoc({
    summary:
      'Đánh giá trạng thái hiệu lực của Feature Flags theo người dùng, vai trò, đơn vị, tỷ lệ rollout và khung thời gian',
    response: z.array(evaluatedFeatureFlagResponseSchema),
  })
  public async evaluateFeatureFlags(
    @ValidatedQuery(evaluateFeatureFlagsQuerySchema) query: EvaluateFeatureFlagsQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FeatureFlagEvaluationResult[]> {
    return this.featureFlagsService.evaluateMany(query, actor);
  }

  @Get(FEATURE_FLAGS_ROUTES.HISTORY)
  @RequireAnyPermission('feature-flags.read', 'settings.read')
  @ApiDoc({
    summary: 'Tra cứu lịch sử thay đổi Feature Flags toàn hệ thống (Mục 5.2.8)',
    response: z.array(featureFlagHistoryResponseSchema),
  })
  public async listAllHistory(
    @ValidatedQuery(listFeatureFlagHistoryQuerySchema) query: ListFeatureFlagHistoryQuery,
  ): Promise<FeatureFlagHistoryRecord[]> {
    return this.featureFlagsService.listHistory(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireAnyPermission('feature-flags.manage', 'settings.manage')
  @ApiDoc({
    summary:
      'Tạo mới Feature Flag kèm quy tắc nhắm mục tiêu và khung thời gian thử nghiệm (Mục 5.2.1)',
    status: HTTP_STATUS_CODE.CREATED,
    response: featureFlagResponseSchema,
  })
  public async createFeatureFlag(
    @ValidatedBody(createFeatureFlagSchema) body: CreateFeatureFlagRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FeatureFlagSummary> {
    return this.featureFlagsService.createFeatureFlag(body, actor);
  }

  @Get(FEATURE_FLAGS_ROUTES.DETAIL)
  @RequireAnyPermission('feature-flags.read', 'settings.read')
  @ApiDoc({
    summary: 'Xem chi tiết cấu hình một Feature Flag theo key',
    response: featureFlagResponseSchema,
  })
  public async getFeatureFlagByKey(
    @ValidatedParams(flagKeyParamSchema) params: { key: string },
  ): Promise<FeatureFlagSummary> {
    return this.featureFlagsService.getFeatureFlagByKey(params.key);
  }

  @Put(FEATURE_FLAGS_ROUTES.DETAIL)
  @RequireAnyPermission('feature-flags.manage', 'settings.manage')
  @ApiDoc({
    summary:
      'Cập nhật quy tắc nhắm mục tiêu (người dùng, vai trò, đơn vị, tỷ lệ rollout, thời gian bắt đầu/kết thúc) của Feature Flag',
    response: featureFlagResponseSchema,
  })
  public async updateFeatureFlag(
    @ValidatedParams(flagKeyParamSchema) params: { key: string },
    @ValidatedBody(updateFeatureFlagSchema) body: UpdateFeatureFlagRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FeatureFlagSummary> {
    return this.featureFlagsService.updateFeatureFlag(params.key, body, actor);
  }

  @Patch(FEATURE_FLAGS_ROUTES.TOGGLE)
  @RequireAnyPermission('feature-flags.manage', 'settings.manage')
  @ApiDoc({
    summary: 'Bật hoặc tắt nhanh Feature Flag (kiểm tra module đã cài đặt — Mục 5.2.2)',
    response: featureFlagResponseSchema,
  })
  public async toggleFeatureFlag(
    @ValidatedParams(flagKeyParamSchema) params: { key: string },
    @ValidatedBody(toggleFeatureFlagSchema) body: ToggleFeatureFlagRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<FeatureFlagSummary> {
    return this.featureFlagsService.toggleFeatureFlag(params.key, body, actor);
  }

  @Get(FEATURE_FLAGS_ROUTES.KEY_HISTORY)
  @RequireAnyPermission('feature-flags.read', 'settings.read')
  @ApiDoc({
    summary: 'Tra cứu lịch sử thay đổi của một Feature Flag cụ thể (Mục 5.2.8)',
    response: z.array(featureFlagHistoryResponseSchema),
  })
  public async listFlagHistory(
    @ValidatedParams(flagKeyParamSchema) params: { key: string },
    @ValidatedQuery(
      z.object({
        action: z.string().trim().optional(),
        actorUserId: intQueryParam({ min: 1 }).optional(),
        limit: intQueryParam({ min: 1, max: 200 }).optional(),
      }),
    )
    query: {
      action?: string;
      actorUserId?: number;
      limit?: number;
    },
  ): Promise<FeatureFlagHistoryRecord[]> {
    return this.featureFlagsService.listHistory({
      flagKey: params.key,
      action: query.action,
      actorUserId: query.actorUserId,
      limit: query.limit,
    });
  }
}
