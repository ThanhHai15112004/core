import { Controller, Get, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  ApiDoc,
  Public,
  RequirePermissions,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
} from '@packages/http/index.js';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import type {
  I18nLocaleSummary,
  I18nTimezoneSummary,
  I18nTranslationSummary,
  SyncI18nResult,
} from '../contracts/index.js';
import { I18N_ROUTES } from '../routes/settings.routes.js';
import { I18nManagementService } from '../services/i18n-management.service.js';
import {
  type CreateI18nLocaleRequest,
  type CreateI18nTimezoneRequest,
  type ListI18nLocalesQuery,
  type ListI18nTimezonesQuery,
  type ListI18nTranslationsQuery,
  type UpdateI18nLocaleRequest,
  type UpdateI18nTimezoneRequest,
  type UpsertI18nTranslationRequest,
  createI18nLocaleSchema,
  createI18nTimezoneSchema,
  listI18nLocalesQuerySchema,
  listI18nTimezonesQuerySchema,
  listI18nTranslationsQuerySchema,
  updateI18nLocaleSchema,
  updateI18nTimezoneSchema,
  upsertI18nTranslationSchema,
} from '../requests/i18n.requests.js';
import {
  i18nLocaleResponseSchema,
  i18nTimezoneResponseSchema,
  i18nTranslationResponseSchema,
  syncI18nResultResponseSchema,
} from '../responses/i18n.response.js';

const localeCodeParamSchema = z.object({
  code: z.string().trim().min(2).max(16),
});

const timezoneCodeParamSchema = z.object({
  code: z.string().trim().min(2).max(64),
});

@Controller(I18N_ROUTES.ROOT)
export class I18nController {
  constructor(private readonly i18nManagementService: I18nManagementService) {}

  /** Đồng bộ danh mục Ngôn ngữ, Múi giờ và Từ điển dịch vào Database (Mục 5.3) */
  @Post(I18N_ROUTES.SYNC)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary:
      'Đồng bộ Idempotent danh mục Ngôn ngữ (i18n_locales), Múi giờ (i18n_timezones) và Từ điển (i18n_translations)',
    status: HTTP_STATUS_CODE.OK,
    response: syncI18nResultResponseSchema,
  })
  public async syncCatalog(): Promise<SyncI18nResult> {
    return this.i18nManagementService.syncDatabaseCatalog();
  }

  /** Liệt kê danh sách ngôn ngữ được lưu trong Database (Mục 5.3.1, 5.3.2 & 5.3.6) */
  @Public()
  @Get(I18N_ROUTES.LOCALES)
  @ApiDoc({
    summary: 'Danh sách ngôn ngữ hỗ trợ trong Database kèm định dạng ngày, số và tiền tệ',
    response: z.array(i18nLocaleResponseSchema),
  })
  public async listLocales(
    @ValidatedQuery(listI18nLocalesQuerySchema) query: ListI18nLocalesQuery,
  ): Promise<I18nLocaleSummary[]> {
    return this.i18nManagementService.listLocales(query);
  }

  /** Thêm ngôn ngữ mới vào Database (`i18n_locales`) */
  @Post(I18N_ROUTES.LOCALES)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Thêm ngôn ngữ mới vào Database kèm cấu hình định dạng ngày, số, tiền tệ (Mục 5.3)',
    status: HTTP_STATUS_CODE.CREATED,
    response: i18nLocaleResponseSchema,
  })
  public async createLocale(
    @ValidatedBody(createI18nLocaleSchema) body: CreateI18nLocaleRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<I18nLocaleSummary> {
    return this.i18nManagementService.createLocale(body, actor);
  }

  /** Cập nhật ngôn ngữ trong Database (`i18n_locales`), đổi định dạng hoặc đặt làm mặc định */
  @Patch(I18N_ROUTES.LOCALE_DETAIL)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary:
      'Cập nhật thông tin ngôn ngữ, định dạng ngày/số/tiền tệ, bật/tắt hoặc đặt làm ngôn ngữ mặc định',
    response: i18nLocaleResponseSchema,
  })
  public async updateLocale(
    @ValidatedParams(localeCodeParamSchema) params: { code: string },
    @ValidatedBody(updateI18nLocaleSchema) body: UpdateI18nLocaleRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<I18nLocaleSummary> {
    return this.i18nManagementService.updateLocale(params.code, body, actor);
  }

  /** Liệt kê danh sách khung giờ / múi giờ trong Database (`i18n_timezones` — Mục 5.3.4 & 5.3.5) */
  @Public()
  @Get(I18N_ROUTES.TIMEZONES)
  @ApiDoc({
    summary:
      'Danh sách khung giờ / múi giờ lưu trong Database phục vụ chọn múi giờ, lịch và báo cáo',
    response: z.array(i18nTimezoneResponseSchema),
  })
  public async listTimezones(
    @ValidatedQuery(listI18nTimezonesQuerySchema) query: ListI18nTimezonesQuery,
  ): Promise<I18nTimezoneSummary[]> {
    return this.i18nManagementService.listTimezones(query);
  }

  /** Thêm mới khung giờ / múi giờ IANA vào Database (`i18n_timezones`) */
  @Post(I18N_ROUTES.TIMEZONES)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Thêm mới khung giờ / múi giờ IANA vào Database (Mục 5.3.4 & 5.3.5)',
    status: HTTP_STATUS_CODE.CREATED,
    response: i18nTimezoneResponseSchema,
  })
  public async createTimezone(
    @ValidatedBody(createI18nTimezoneSchema) body: CreateI18nTimezoneRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<I18nTimezoneSummary> {
    return this.i18nManagementService.createTimezone(body, actor);
  }

  /** Cập nhật khung giờ / múi giờ hoặc đặt làm múi giờ mặc định của hệ thống */
  @Patch(I18N_ROUTES.TIMEZONE_DETAIL)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary: 'Cập nhật khung giờ / múi giờ trong Database hoặc đặt làm múi giờ mặc định',
    response: i18nTimezoneResponseSchema,
  })
  public async updateTimezone(
    @ValidatedParams(timezoneCodeParamSchema) params: { code: string },
    @ValidatedBody(updateI18nTimezoneSchema) body: UpdateI18nTimezoneRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<I18nTimezoneSummary> {
    return this.i18nManagementService.updateTimezone(params.code, body, actor);
  }

  /** Tra cứu danh sách bản dịch & thông báo lỗi đa ngôn ngữ trong Database (`i18n_translations` — Mục 5.3.3) */
  @Get(I18N_ROUTES.TRANSLATIONS)
  @RequirePermissions('settings.read')
  @ApiDoc({
    summary: 'Tra cứu từ điển bản dịch & thông báo lỗi đa ngôn ngữ trong Database (Mục 5.3.3)',
    response: z.array(i18nTranslationResponseSchema),
  })
  public async listTranslations(
    @ValidatedQuery(listI18nTranslationsQuerySchema) query: ListI18nTranslationsQuery,
  ): Promise<I18nTranslationSummary[]> {
    return this.i18nManagementService.listTranslations(query);
  }

  /** Thêm mới hoặc cập nhật (Upsert) bản dịch đa ngôn ngữ trong Database (`i18n_translations`) */
  @Put(I18N_ROUTES.TRANSLATIONS)
  @RequirePermissions('settings.manage')
  @ApiDoc({
    summary:
      'Thêm mới hoặc cập nhật câu thông báo đa ngôn ngữ trong Database và làm mới tức thì bộ dịch API',
    response: i18nTranslationResponseSchema,
  })
  public async upsertTranslation(
    @ValidatedBody(upsertI18nTranslationSchema) body: UpsertI18nTranslationRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<I18nTranslationSummary> {
    return this.i18nManagementService.upsertTranslation(body, actor);
  }
}
