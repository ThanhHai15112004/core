import { Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import { type PaginatedResult, resolvePagination } from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  TEMPLATES_AUDIT_META,
  type ITemplatesPublicService,
  type NotificationChannelCode,
} from '../contracts/index.js';
import { DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES } from '../helpers/notification-template.helper.js';
import {
  enrichTemplateItemsView,
  executeCreateTemplateVersion,
  executeListTemplateUsages,
  executeListTemplateVersions,
  executePreviewTemplate,
  executePublishTemplateVersion,
  executeRegisterTemplateUsage,
  executeRenderDocumentFromTemplate,
  executeRollbackTemplateVersion,
  executeSafeDeleteTemplate,
  executeUnregisterTemplateUsage,
  executeUpsertVersionedTemplate,
} from '../helpers/notification-template-lifecycle.helper.js';
import { TemplatesMapper } from '../mappers/templates.mapper.js';
import { TemplatesRepository } from '../repositories/templates.repository.js';
import type {
  CreateNotificationTemplateVersionRequest,
  ListNotificationTemplatesQuery,
  PreviewNotificationTemplateRequest,
  PublishNotificationTemplateVersionRequest,
  RegisterNotificationTemplateUsageRequest,
  RenderDocumentFromTemplateRequest,
  RollbackNotificationTemplateVersionRequest,
  UpsertNotificationTemplateRequest,
} from '../requests/templates.requests.js';
import type {
  NotificationTemplateItemResponse,
  NotificationTemplatePreviewResponse,
  NotificationTemplateUsageItemResponse,
  NotificationTemplateVersionItemResponse,
  RenderedDocumentFromTemplateResponse,
  TemplateVersionMutationResultResponse,
} from '../responses/templates.response.js';

@Injectable()
export class TemplatesService implements ITemplatesPublicService {
  constructor(
    private readonly templatesRepo: TemplatesRepository,
    private readonly mapper: TemplatesMapper = new TemplatesMapper(),
    @Optional() private readonly auditLogService?: AuditLogService | null,
  ) {}

  public async listTemplates(
    query: ListNotificationTemplatesQuery,
  ): Promise<PaginatedResult<NotificationTemplateItemResponse>> {
    const pagination = resolvePagination(query, {
      settingPrefix: 'notifications.pagination',
    });
    const paginated = await this.templatesRepo.findPaginatedTemplates({
      ...pagination,
      search: query.search,
      channel: query.channel,
      category: query.category,
      locale: query.locale,
      templateType: query.templateType,
      isActive: query.isActive,
    });

    const items = await enrichTemplateItemsView({
      entities: paginated.items,
      channelsRepo: this.templatesRepo,
      mapper: this.mapper,
    });
    return createPaginatedResult(items, paginated.total, paginated.page, paginated.limit);
  }

  public async upsertTemplate(
    input: UpsertNotificationTemplateRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateItemResponse> {
    return executeUpsertVersionedTemplate({
      input,
      actor,
      channelsRepo: this.templatesRepo,
      mapper: this.mapper,
      recordAudit: this.recordAudit.bind(this),
    });
  }

  public async deleteTemplate(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return executeSafeDeleteTemplate({
      id,
      actor,
      channelsRepo: this.templatesRepo,
      recordAudit: this.recordAudit.bind(this),
    });
  }

  public async previewTemplate(
    input: PreviewNotificationTemplateRequest,
  ): Promise<NotificationTemplatePreviewResponse> {
    return executePreviewTemplate({
      input,
      channelsRepo: this.templatesRepo,
      resolveTemplateByCode: this.resolveTemplateByCode.bind(this),
    });
  }

  public async renderDocumentFromTemplate(
    input: RenderDocumentFromTemplateRequest,
    actor?: UserIdentity,
  ): Promise<RenderedDocumentFromTemplateResponse> {
    return executeRenderDocumentFromTemplate({
      input,
      actor,
      channelsRepo: this.templatesRepo,
      recordAudit: this.recordAudit.bind(this),
    });
  }

  public async listTemplateVersions(
    templateId: number,
  ): Promise<NotificationTemplateVersionItemResponse[]> {
    return executeListTemplateVersions({
      templateId,
      channelsRepo: this.templatesRepo,
      mapper: this.mapper,
    });
  }

  public async createTemplateVersion(
    templateId: number,
    input: CreateNotificationTemplateVersionRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateVersionItemResponse> {
    return executeCreateTemplateVersion({
      templateId,
      input,
      actor,
      channelsRepo: this.templatesRepo,
      mapper: this.mapper,
      recordAudit: this.recordAudit.bind(this),
    });
  }

  public async publishTemplateVersion(
    templateId: number,
    input: PublishNotificationTemplateVersionRequest,
    actor?: UserIdentity,
  ): Promise<TemplateVersionMutationResultResponse> {
    return executePublishTemplateVersion({
      templateId,
      input,
      actor,
      channelsRepo: this.templatesRepo,
      mapper: this.mapper,
      recordAudit: this.recordAudit.bind(this),
    });
  }

  public async rollbackTemplateVersion(
    templateId: number,
    input: RollbackNotificationTemplateVersionRequest,
    actor?: UserIdentity,
  ): Promise<TemplateVersionMutationResultResponse> {
    return executeRollbackTemplateVersion({
      templateId,
      input,
      actor,
      channelsRepo: this.templatesRepo,
      mapper: this.mapper,
      recordAudit: this.recordAudit.bind(this),
    });
  }

  public async listTemplateUsages(
    templateId: number,
  ): Promise<NotificationTemplateUsageItemResponse[]> {
    return executeListTemplateUsages({
      templateId,
      channelsRepo: this.templatesRepo,
      mapper: this.mapper,
    });
  }

  public async registerTemplateUsage(
    templateId: number,
    input: RegisterNotificationTemplateUsageRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateUsageItemResponse> {
    return executeRegisterTemplateUsage({
      templateId,
      input,
      actor,
      channelsRepo: this.templatesRepo,
      mapper: this.mapper,
      recordAudit: this.recordAudit.bind(this),
    });
  }

  public async unregisterTemplateUsage(
    usageId: number,
    actor?: UserIdentity,
  ): Promise<{ readonly removed: true; readonly id: number }> {
    return executeUnregisterTemplateUsage({
      usageId,
      actor,
      channelsRepo: this.templatesRepo,
      recordAudit: this.recordAudit.bind(this),
    });
  }

  public async resolveTemplateByCode(
    code: string,
    channel: NotificationChannelCode,
    locale = 'vi',
  ): Promise<{
    readonly code: string;
    readonly subjectTemplate: string | null;
    readonly bodyTemplate: string;
    readonly htmlTemplate: string | null;
  } | null> {
    const cleanCode = code.trim().toUpperCase();
    const cleanLocale = locale.trim().toLowerCase() || 'vi';
    const dbTemplate = await this.templatesRepo.findTemplateByCodeChannelLocale(
      cleanCode,
      channel,
      cleanLocale,
    );
    if (dbTemplate) {
      return {
        code: dbTemplate.code,
        subjectTemplate: dbTemplate.subjectTemplate ?? null,
        bodyTemplate: dbTemplate.bodyTemplate,
        htmlTemplate: dbTemplate.htmlTemplate ?? null,
      };
    }

    const fallback =
      DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES.find(
        (t) => t.code === cleanCode && t.channel === channel && t.locale === cleanLocale,
      ) ??
      DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES.find(
        (t) => t.code === cleanCode && t.channel === channel,
      ) ??
      DEFAULT_SYSTEM_NOTIFICATION_TEMPLATES.find((t) => t.code === cleanCode);

    if (fallback) {
      return {
        code: fallback.code,
        subjectTemplate: fallback.subjectTemplate,
        bodyTemplate: fallback.bodyTemplate,
        htmlTemplate: fallback.htmlTemplate,
      };
    }
    return null;
  }

  private async recordAudit(
    actor: UserIdentity | undefined,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeData: Record<string, unknown> | null,
    afterData: Record<string, unknown> | null,
  ): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService
      .record({
        actor: actor ?? null,
        actorUserId: actor?.id ?? null,
        actorIdentifier: actor?.email ?? actor?.username ?? 'system',
        module: TEMPLATES_AUDIT_META.MODULE,
        feature: 'content_templates',
        action,
        resourceType,
        resourceId,
        beforeData,
        afterData,
      })
      .catch(() => undefined);
  }
}
