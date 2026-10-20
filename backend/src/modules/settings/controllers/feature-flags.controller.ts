import { Controller, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  ApiDoc,
  RequirePermissions,
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
import { FEATURE_FLAGS_ROUTES } from '../routes/settings.routes.js';
import { FeatureFlagsService } from '../services/feature-flags.service.js';
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
} from '../requests/settings.requests.js';
import {
  evaluatedFeatureFlagResponseSchema,
  featureFlagHistoryResponseSchema,
  featureFlagResponseSchema,
  syncFeatureFlagsResultResponseSchema,
} from '../responses/settings.response.js';

const flagKeyParamSchema = z.object({
  key: z.string().trim().min(2).max(150),
});

@Controller(FEATURE_FLAGS_ROUTES.ROOT)
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  /** Đồng bộ danh mục Feature Flag mặc định từ `module.manifest.json` (Mục 5.2.1 & 5.2.2) */
  @Post(FEATURE_FLAGS_ROUTES.SYNC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Đồng bộ Idempotent Feature Flags từ module.manifest.json vào Database và Cache',
    status: HTTP_STATUS_CODE.OK,
    response: syncFeatureFlagsResultResponseSchema,
  })
  public async syncManifests(): Promise<SyncFeatureFlagsResult> {
    return this.featureFlagsService.syncManifests();
  }

  /** Liệt kê danh sách Feature Flags (Mục 5.2.1 -> 5.2.7) */
  @Get()
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Danh sách Feature Flags theo module, trạng thái bật/tắt và từ khóa',
    response: z.array(featureFlagResponseSchema),
  })
  public async listFeatureFlags(
    @ValidatedQuery(listFeatureFlagsQuerySchema) query: ListFeatureFlagsQuery,
  ): Promise<FeatureFlagSummary[]> {
    return this.featureFlagsService.listFeatureFlags(query);
  }

  /** Đánh giá hiệu lực của 1 hoặc nhiều Feature Flag theo ngữ cảnh User/Role/OrgUnit/Rollout/Time (Mục 5.2.2 -> 5.2.7) */
  @Get(FEATURE_FLAGS_ROUTES.EVALUATE)
  @RequirePermissions('settings.read')
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

  /** Tra cứu lịch sử thay đổi Feature Flag toàn cục (Mục 5.2.8) */
  @Get(FEATURE_FLAGS_ROUTES.HISTORY)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Tra cứu lịch sử thay đổi Feature Flags toàn hệ thống (Mục 5.2.8)',
    response: z.array(featureFlagHistoryResponseSchema),
  })
  public async listAllHistory(
    @ValidatedQuery(listFeatureFlagHistoryQuerySchema) query: ListFeatureFlagHistoryQuery,
  ): Promise<FeatureFlagHistoryRecord[]> {
    return this.featureFlagsService.listHistory(query);
  }

  /** Tạo mới một Feature Flag với key và mô tả rõ ràng (Mục 5.2.1) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('settings.manage')
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

  /** Chi tiết một Feature Flag theo key */
  @Get(FEATURE_FLAGS_ROUTES.DETAIL)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Xem chi tiết cấu hình một Feature Flag theo key',
    response: featureFlagResponseSchema,
  })
  public async getFeatureFlagByKey(
    @ValidatedParams(flagKeyParamSchema) params: { key: string },
  ): Promise<FeatureFlagSummary> {
    return this.featureFlagsService.getFeatureFlagByKey(params.key);
  }

  /** Cập nhật cấu hình targeting, tỷ lệ rollout và thời gian bắt đầu/kết thúc của Feature Flag (Mục 5.2.2 -> 5.2.7) */
  @Put(FEATURE_FLAGS_ROUTES.DETAIL)
  @RequirePermissions('settings.manage')
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

  /** Bật hoặc tắt nhanh một Feature Flag của module đã được cài đặt (Mục 5.2.2) */
  @Patch(FEATURE_FLAGS_ROUTES.TOGGLE)
  @RequirePermissions('settings.manage')
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

  /** Lịch sử thay đổi của một Feature Flag cụ thể (Mục 5.2.8) */
  @Get(FEATURE_FLAGS_ROUTES.KEY_HISTORY)
  @RequirePermissions('settings.read')
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
