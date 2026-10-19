import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  ApiDoc,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  intQueryParam,
  printableIdParamSchema,
} from '@packages/http/index.js';
import { HTTP_STATUS_CODE, type ResolvedSettingView } from '@packages/kernel/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import type {
  SettingGroupSummary,
  SettingHistoryRecord,
  SyncSettingsResult,
  SystemSettingSummary,
} from '../contracts/index.js';
import { SETTINGS_ROUTES } from '../routes/settings.routes.js';
import { SettingsService } from '../services/settings.service.js';
import {
  type BulkUpdateSettingsRequest,
  type CreateSettingGroupRequest,
  type CreateSettingRequest,
  type DeleteSettingScopeQuery,
  type ListSettingHistoryQuery,
  type ListSettingsQuery,
  type ResolveSettingsQuery,
  type UpdateSettingValueRequest,
  bulkUpdateSettingsSchema,
  createSettingGroupSchema,
  createSettingSchema,
  deleteSettingScopeQuerySchema,
  listSettingHistoryQuerySchema,
  listSettingsQuerySchema,
  resolveSettingsQuerySchema,
  updateSettingValueSchema,
} from '../requests/settings.requests.js';
import {
  resolvedSettingResponseSchema,
  settingGroupResponseSchema,
  settingHistoryResponseSchema,
  syncSettingsResultResponseSchema,
  systemSettingResponseSchema,
} from '../responses/settings.response.js';

@Controller(SETTINGS_ROUTES.ROOT)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** Đồng bộ danh mục nhóm cấu hình và cấu hình mặc định từ `module.manifest.json` (Mục 5.1.1 & 5.1.2) */
  @Post(SETTINGS_ROUTES.SYNC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Đồng bộ Idempotent cấu hình hệ thống từ module.manifest.json vào Database và Cache',
    status: HTTP_STATUS_CODE.OK,
    response: syncSettingsResultResponseSchema,
  })
  public async syncManifests(): Promise<SyncSettingsResult> {
    return this.settingsService.syncManifests();
  }

  /** Liệt kê danh sách các nhóm cấu hình hệ thống (`email`, `file`, `security`, `ui`, `system` — Mục 5.1.1) */
  @Get(SETTINGS_ROUTES.GROUPS)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Danh sách nhóm cấu hình hệ thống kèm số lượng cấu hình (Mục 5.1.1)',
    response: z.array(settingGroupResponseSchema),
  })
  public async listGroups(
    @ValidatedQuery(
      z.object({
        module: z.string().trim().optional(),
        q: z.string().trim().optional(),
      }),
    )
    query: {
      module?: string;
      q?: string;
    },
  ): Promise<SettingGroupSummary[]> {
    return this.settingsService.listGroups(query);
  }

  /** Tạo mới một nhóm cấu hình hệ thống (Mục 5.1.1) */
  @Post(SETTINGS_ROUTES.GROUPS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Tạo mới nhóm cấu hình hệ thống (Mục 5.1.1)',
    status: HTTP_STATUS_CODE.CREATED,
    response: settingGroupResponseSchema,
  })
  public async createGroup(
    @ValidatedBody(createSettingGroupSchema) body: CreateSettingGroupRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SettingGroupSummary> {
    return this.settingsService.createGroup(body, actor);
  }

  /** Liệt kê danh sách cấu hình theo nhóm, module, namespace, môi trường và đơn vị (Mục 5.1.1 -> 5.1.6) */
  @Get()
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Danh sách cấu hình hệ thống theo nhóm, module, namespace, môi trường và đơn vị',
    response: z.array(systemSettingResponseSchema),
  })
  public async listSettings(
    @ValidatedQuery(listSettingsQuerySchema) query: ListSettingsQuery,
  ): Promise<SystemSettingSummary[]> {
    return this.settingsService.listSettings(query);
  }

  /** Phân giải nhanh giá trị hiệu lực của 1 hoặc nhiều cấu hình có sử dụng Cache L1/L2 (Mục 5.1.4, 5.1.5 & 5.1.8) */
  @Get(SETTINGS_ROUTES.RESOLVE)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary:
      'Phân giải giá trị cấu hình hiệu lực theo thứ tự Đơn vị -> Môi trường -> Toàn cục -> Mặc định (có Cache)',
    response: z.array(resolvedSettingResponseSchema),
  })
  public async resolveSettings(
    @ValidatedQuery(resolveSettingsQuerySchema) query: ResolveSettingsQuery,
  ): Promise<ResolvedSettingView<unknown>[]> {
    return this.settingsService.resolveMany(query);
  }

  /** Tạo mới một định nghĩa cấu hình theo module / namespace (Mục 5.1.2 & 5.1.3) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Tạo mới cấu hình theo module/namespace với kiểm tra kiểu TEXT/NUMBER/BOOLEAN/JSON',
    status: HTTP_STATUS_CODE.CREATED,
    response: systemSettingResponseSchema,
  })
  public async createSetting(
    @ValidatedBody(createSettingSchema) body: CreateSettingRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SystemSettingSummary> {
    return this.settingsService.createSetting(body, actor);
  }

  /** Cập nhật hàng loạt nhiều cấu hình trong một lần lưu */
  @Put(SETTINGS_ROUTES.BULK)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Cập nhật hàng loạt giá trị cấu hình hệ thống',
    response: z.array(systemSettingResponseSchema),
  })
  public async bulkUpdateSettings(
    @ValidatedBody(bulkUpdateSettingsSchema) body: BulkUpdateSettingsRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SystemSettingSummary[]> {
    return this.settingsService.bulkUpdateSettings(body, actor);
  }

  /** Tra cứu lịch sử thay đổi cấu hình toàn hệ thống (Mục 5.1.7) */
  @Get(SETTINGS_ROUTES.HISTORY)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Tra cứu lịch sử thay đổi cấu hình hệ thống (biết ai đã thay đổi — Mục 5.1.7)',
    response: z.array(settingHistoryResponseSchema),
  })
  public async listHistory(
    @ValidatedQuery(listSettingHistoryQuerySchema) query: ListSettingHistoryQuery,
  ): Promise<SettingHistoryRecord[]> {
    return this.settingsService.listHistory(query);
  }

  /** Xem chi tiết một cấu hình theo `key` kèm các bản ghi override theo môi trường / đơn vị */
  @Get(SETTINGS_ROUTES.DETAIL)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Xem chi tiết cấu hình theo key kèm danh sách phạm vi ghi đè',
    response: systemSettingResponseSchema,
  })
  public async getSettingByKey(
    @ValidatedParams(printableIdParamSchema, 'key') key: string,
    @ValidatedQuery(
      z.object({
        environment: z.string().trim().optional(),
        organizationUnitId: intQueryParam({ min: 1 }).optional(),
      }),
    )
    query: { environment?: string; organizationUnitId?: number },
  ): Promise<SystemSettingSummary> {
    return this.settingsService.getSettingByKey(key, query);
  }

  /** Cập nhật giá trị cấu hình (Toàn cục, theo Môi trường, hoặc theo Đơn vị — Mục 5.1.3 -> 5.1.8) */
  @Put(SETTINGS_ROUTES.DETAIL)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary:
      'Cập nhật giá trị cấu hình (toàn cục, theo môi trường hoặc theo đơn vị) và tự động xóa Cache',
    response: systemSettingResponseSchema,
  })
  public async updateSettingValue(
    @ValidatedParams(printableIdParamSchema, 'key') key: string,
    @ValidatedBody(updateSettingValueSchema) body: UpdateSettingValueRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SystemSettingSummary> {
    return this.settingsService.updateSettingValue(key, body, actor);
  }

  /** Xóa bản ghi cấu hình ghi đè theo môi trường / đơn vị để kế thừa giá trị cấp trên */
  @Delete(SETTINGS_ROUTES.KEY_SCOPES)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Xóa bản ghi cấu hình ghi đè theo môi trường hoặc đơn vị',
    response: systemSettingResponseSchema,
  })
  public async removeScopeOverride(
    @ValidatedParams(printableIdParamSchema, 'key') key: string,
    @ValidatedQuery(deleteSettingScopeQuerySchema) query: DeleteSettingScopeQuery,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<SystemSettingSummary> {
    return this.settingsService.removeScopeOverride(key, query, actor);
  }

  /** Xem lịch sử thay đổi của riêng một khóa cấu hình `:key` (Mục 5.1.7) */
  @Get(SETTINGS_ROUTES.KEY_HISTORY)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Xem lịch sử thay đổi của riêng một khóa cấu hình (Mục 5.1.7)',
    response: z.array(settingHistoryResponseSchema),
  })
  public async listHistoryByKey(
    @ValidatedParams(printableIdParamSchema, 'key') key: string,
    @ValidatedQuery(listSettingHistoryQuerySchema) query: ListSettingHistoryQuery,
  ): Promise<SettingHistoryRecord[]> {
    return this.settingsService.listHistory({
      ...query,
      settingKey: key,
    });
  }
}
