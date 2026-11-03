import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  CreateNotificationTemplateVersionRequest,
  ListNotificationTemplatesQuery,
  NotificationChannelCode,
  NotificationTemplateItemResponse,
  NotificationTemplatePreviewResponse,
  NotificationTemplateUsageItemResponse,
  NotificationTemplateVersionItemResponse,
  PreviewNotificationTemplateRequest,
  PublishNotificationTemplateVersionRequest,
  RegisterNotificationTemplateUsageRequest,
  RenderDocumentFromTemplateRequest,
  RenderedDocumentFromTemplateResponse,
  RollbackNotificationTemplateVersionRequest,
  TemplateVersionMutationResultResponse,
  UpsertNotificationTemplateRequest,
} from '@modules/notifications/index.js';

export interface ITemplatesPublicService {
  listTemplates(
    query: ListNotificationTemplatesQuery,
  ): Promise<PaginatedResult<NotificationTemplateItemResponse>>;
  upsertTemplate(
    input: UpsertNotificationTemplateRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateItemResponse>;
  deleteTemplate(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }>;
  previewTemplate(
    input: PreviewNotificationTemplateRequest,
  ): Promise<NotificationTemplatePreviewResponse>;
  renderDocumentFromTemplate(
    input: RenderDocumentFromTemplateRequest,
    actor?: UserIdentity,
  ): Promise<RenderedDocumentFromTemplateResponse>;
  listTemplateVersions(templateId: number): Promise<NotificationTemplateVersionItemResponse[]>;
  createTemplateVersion(
    templateId: number,
    input: CreateNotificationTemplateVersionRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateVersionItemResponse>;
  publishTemplateVersion(
    templateId: number,
    input: PublishNotificationTemplateVersionRequest,
    actor?: UserIdentity,
  ): Promise<TemplateVersionMutationResultResponse>;
  rollbackTemplateVersion(
    templateId: number,
    input: RollbackNotificationTemplateVersionRequest,
    actor?: UserIdentity,
  ): Promise<TemplateVersionMutationResultResponse>;
  listTemplateUsages(templateId: number): Promise<NotificationTemplateUsageItemResponse[]>;
  registerTemplateUsage(
    templateId: number,
    input: RegisterNotificationTemplateUsageRequest,
    actor?: UserIdentity,
  ): Promise<NotificationTemplateUsageItemResponse>;
  unregisterTemplateUsage(
    usageId: number,
    actor?: UserIdentity,
  ): Promise<{ readonly removed: true; readonly id: number }>;
  resolveTemplateByCode(
    code: string,
    channel: NotificationChannelCode,
    locale?: string,
  ): Promise<{
    readonly code: string;
    readonly subjectTemplate: string | null;
    readonly bodyTemplate: string;
    readonly htmlTemplate: string | null;
  } | null>;
}

export const TEMPLATES_PUBLIC_SERVICE = Symbol('TEMPLATES_PUBLIC_SERVICE');
