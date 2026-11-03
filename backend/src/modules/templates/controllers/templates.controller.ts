import { Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { HTTP_STATUS_CODE, type PaginatedResult } from '@packages/kernel/index.js';
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
import { TEMPLATES_ROUTES } from '../routes/templates.routes.js';
import { TemplatesService } from '../services/templates.service.js';
import {
  type CreateTemplateVersionRequest,
  type ListTemplatesQuery,
  type PreviewTemplateRequest,
  type PublishTemplateVersionRequest,
  type RegisterTemplateUsageRequest,
  type RenderDocumentFromTemplateRequest,
  type RollbackTemplateVersionRequest,
  type UpsertTemplateRequest,
  createTemplateVersionSchema,
  listTemplatesQuerySchema,
  previewTemplateSchema,
  publishTemplateVersionSchema,
  registerTemplateUsageSchema,
  renderDocumentFromTemplateSchema,
  rollbackTemplateVersionSchema,
  upsertTemplateSchema,
} from '../requests/templates.requests.js';
import type {
  RenderedDocumentFromTemplateResponse,
  TemplateItemResponse,
  TemplatePreviewResponse,
  TemplateUsageItemResponse,
  TemplateVersionItemResponse,
  TemplateVersionMutationResultResponse,
} from '../responses/templates.response.js';

@ApiGroup(
  'Content Templates (Email, Notification & Document)',
  'Quản lý mẫu nội dung Email, Thông báo (In-App, SMS, Push) và Tài liệu; đa phiên bản, đa ngôn ngữ và theo dõi module sử dụng (Mục 9.6)',
)
@Controller(TEMPLATES_ROUTES.PREFIX)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  /** Danh sách mẫu nội dung Email, Thông báo và Tài liệu (Mục 9.6.1–9.6.6) */
  @Get()
  @RequirePermissions('templates.read')
  @ApiDoc({
    summary: 'Danh sách mẫu nội dung Email, Thông báo (In-App, SMS, Push) và Tài liệu (Mục 9.6)',
    pagination: 'offset',
  })
  public async listTemplates(
    @ValidatedQuery(listTemplatesQuerySchema) query: ListTemplatesQuery,
  ): Promise<PaginatedResult<TemplateItemResponse>> {
    return this.templatesService.listTemplates(query);
  }

  /** Tạo mới hoặc cập nhật mẫu nội dung (Mục 9.6.1–9.6.6) */
  @Post()
  @RequirePermissions('templates.manage')
  @ApiDoc({
    summary: 'Tạo hoặc cập nhật mẫu Email, Thông báo hoặc Tài liệu đa ngôn ngữ (Mục 9.6.1–9.6.6)',
    status: HTTP_STATUS_CODE.CREATED,
  })
  public async upsertTemplate(
    @ValidatedBody(upsertTemplateSchema) body: UpsertTemplateRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<TemplateItemResponse> {
    return this.templatesService.upsertTemplate(body, actor);
  }

  /** Xóa mẫu nội dung có kiểm tra module đang sử dụng (Mục 9.6.8) */
  @Delete(TEMPLATES_ROUTES.BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('templates.manage')
  @ApiDoc({
    summary: 'Xóa mẫu nội dung (chặn xóa nếu đang có module sử dụng — Mục 9.6.8)',
  })
  public async deleteTemplate(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.templatesService.deleteTemplate(id, actor);
  }

  /** Xem trước mẫu với dữ liệu thử và phát hiện biến bị thiếu (Mục 9.6.4) */
  @Post(TEMPLATES_ROUTES.PREVIEW)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('templates.render')
  @ApiDoc({
    summary: 'Xem trước mẫu với dữ liệu thử và phát hiện biến bị thiếu (Mục 9.6.4)',
  })
  public async previewTemplate(
    @ValidatedBody(previewTemplateSchema) body: PreviewTemplateRequest,
  ): Promise<TemplatePreviewResponse> {
    return this.templatesService.previewTemplate(body);
  }

  /** Kết xuất tài liệu từ mẫu nội dung (Mục 9.6.3) */
  @Post(TEMPLATES_ROUTES.RENDER_DOCUMENT)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('templates.render')
  @ApiDoc({
    summary: 'Kết xuất nội dung tài liệu từ mẫu DOCUMENT (Mục 9.6.3)',
  })
  public async renderDocument(
    @ValidatedBody(renderDocumentFromTemplateSchema) body: RenderDocumentFromTemplateRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<RenderedDocumentFromTemplateResponse> {
    return this.templatesService.renderDocumentFromTemplate(body, actor);
  }

  /** Danh sách các phiên bản của một mẫu (Mục 9.6.5) */
  @Get(TEMPLATES_ROUTES.VERSIONS)
  @RequirePermissions('templates.read')
  @ApiDoc({
    summary: 'Danh sách các phiên bản của mẫu nội dung (Mục 9.6.5)',
  })
  public async listVersions(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<TemplateVersionItemResponse[]> {
    return this.templatesService.listTemplateVersions(id);
  }

  /** Tạo phiên bản mới (Draft hoặc Publish) không sửa trực tiếp bản đang dùng (Mục 9.6.5) */
  @Post(TEMPLATES_ROUTES.VERSIONS)
  @RequirePermissions('templates.manage')
  @ApiDoc({
    summary: 'Tạo phiên bản mẫu mới không sửa trực tiếp bản đang dùng (Mục 9.6.5)',
    status: HTTP_STATUS_CODE.CREATED,
  })
  public async createVersion(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(createTemplateVersionSchema) body: CreateTemplateVersionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<TemplateVersionItemResponse> {
    return this.templatesService.createTemplateVersion(id, body, actor);
  }

  /** Phát hành phiên bản mẫu kèm ghi nhật ký Audit (Mục 9.6.7) */
  @Post(TEMPLATES_ROUTES.VERSION_PUBLISH)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('templates.publish')
  @ApiDoc({
    summary: 'Phát hành phiên bản mẫu nội dung kèm Audit (Mục 9.6.7)',
  })
  public async publishVersion(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(publishTemplateVersionSchema) body: PublishTemplateVersionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<TemplateVersionMutationResultResponse> {
    return this.templatesService.publishTemplateVersion(id, body, actor);
  }

  /** Quay lại phiên bản cũ (Rollback) kèm ghi nhật ký Audit (Mục 9.6.7) */
  @Post(TEMPLATES_ROUTES.VERSION_ROLLBACK)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('templates.publish')
  @ApiDoc({
    summary: 'Quay lại phiên bản mẫu cũ (Rollback) kèm Audit (Mục 9.6.7)',
  })
  public async rollbackVersion(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(rollbackTemplateVersionSchema) body: RollbackTemplateVersionRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<TemplateVersionMutationResultResponse> {
    return this.templatesService.rollbackTemplateVersion(id, body, actor);
  }

  /** Danh sách module đang sử dụng mẫu (Mục 9.6.8) */
  @Get(TEMPLATES_ROUTES.USAGES)
  @RequirePermissions('templates.read')
  @ApiDoc({
    summary: 'Theo dõi danh sách module đang sử dụng mẫu nội dung (Mục 9.6.8)',
  })
  public async listUsages(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<TemplateUsageItemResponse[]> {
    return this.templatesService.listTemplateUsages(id);
  }

  /** Đăng ký module sử dụng mẫu để tránh xóa nhầm (Mục 9.6.8) */
  @Post(TEMPLATES_ROUTES.USAGES)
  @RequirePermissions('templates.manage')
  @ApiDoc({
    summary: 'Đăng ký module sử dụng mẫu nội dung (Mục 9.6.8)',
    status: HTTP_STATUS_CODE.CREATED,
  })
  public async registerUsage(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(registerTemplateUsageSchema) body: RegisterTemplateUsageRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<TemplateUsageItemResponse> {
    return this.templatesService.registerTemplateUsage(id, body, actor);
  }

  /** Gỡ đăng ký module sử dụng mẫu (Mục 9.6.8) */
  @Delete(TEMPLATES_ROUTES.USAGE_BY_ID)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('templates.manage')
  @ApiDoc({
    summary: 'Gỡ đăng ký liên kết sử dụng mẫu nội dung (Mục 9.6.8)',
  })
  public async unregisterUsage(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @CurrentUser() actor?: UserIdentity,
  ) {
    return this.templatesService.unregisterTemplateUsage(id, actor);
  }
}
