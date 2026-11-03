import { Injectable } from '@nestjs/common';
import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import {
  type CreateNotificationTemplateVersionRequest,
  type ListNotificationTemplatesQuery,
  type NotificationChannelCode,
  NotificationChannelsService,
  type NotificationTemplateItemResponse,
  type NotificationTemplatePreviewResponse,
  type NotificationTemplateUsageItemResponse,
  type NotificationTemplateVersionItemResponse,
  type PreviewNotificationTemplateRequest,
  type PublishNotificationTemplateVersionRequest,
  type RegisterNotificationTemplateUsageRequest,
  type RenderDocumentFromTemplateRequest,
  type RenderedDocumentFromTemplateResponse,
  type RollbackNotificationTemplateVersionRequest,
  type TemplateVersionMutationResultResponse,
  type UpsertNotificationTemplateRequest,
} from '@modules/notifications/index.js';
import type { ITemplatesPublicService } from '../contracts/index.js';

@Injectable()
export class TemplatesService implements ITemplatesPublicService {
  constructor(private readonly notificationChannelsService: NotificationChannelsService) {}

  public async listTemplates(
    query: ListNotificationTemplatesQuery,
  ): Promise<PaginatedResult<NotificationTemplateItemResponse>> {
    return this.notificationChannelsService.listTemplates(query);
  }

  public async upsertTemplate(
    input: UpsertNotificationTemplateRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateItemResponse> {
    return this.notificationChannelsService.upsertTemplate(input, actor);
  }

  public async deleteTemplate(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.notificationChannelsService.deleteTemplate(id, actor);
  }

  public async previewTemplate(
    input: PreviewNotificationTemplateRequest,
  ): Promise<NotificationTemplatePreviewResponse> {
    return this.notificationChannelsService.previewTemplate(input);
  }

  public async renderDocumentFromTemplate(
    input: RenderDocumentFromTemplateRequest,
    actor?: UserIdentity,
  ): Promise<RenderedDocumentFromTemplateResponse> {
    return this.notificationChannelsService.renderDocumentFromTemplate(input, actor);
  }

  public async listTemplateVersions(
    templateId: number,
  ): Promise<NotificationTemplateVersionItemResponse[]> {
    return this.notificationChannelsService.listTemplateVersions(templateId);
  }

  public async createTemplateVersion(
    templateId: number,
    input: CreateNotificationTemplateVersionRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateVersionItemResponse> {
    return this.notificationChannelsService.createTemplateVersion(templateId, input, actor);
  }

  public async publishTemplateVersion(
    templateId: number,
    input: PublishNotificationTemplateVersionRequest,
    actor?: UserIdentity,
  ): Promise<TemplateVersionMutationResultResponse> {
    return this.notificationChannelsService.publishTemplateVersion(templateId, input, actor);
  }

  public async rollbackTemplateVersion(
    templateId: number,
    input: RollbackNotificationTemplateVersionRequest,
    actor?: UserIdentity,
  ): Promise<TemplateVersionMutationResultResponse> {
    return this.notificationChannelsService.rollbackTemplateVersion(templateId, input, actor);
  }

  public async listTemplateUsages(
    templateId: number,
  ): Promise<NotificationTemplateUsageItemResponse[]> {
    return this.notificationChannelsService.listTemplateUsages(templateId);
  }

  public async registerTemplateUsage(
    templateId: number,
    input: RegisterNotificationTemplateUsageRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateUsageItemResponse> {
    return this.notificationChannelsService.registerTemplateUsage(templateId, input, actor);
  }

  public async unregisterTemplateUsage(
    usageId: number,
    actor?: UserIdentity,
  ): Promise<{ readonly removed: true; readonly id: number }> {
    return this.notificationChannelsService.unregisterTemplateUsage(usageId, actor);
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
    return this.notificationChannelsService.resolveTemplateByCode(code, channel, locale);
  }
}
