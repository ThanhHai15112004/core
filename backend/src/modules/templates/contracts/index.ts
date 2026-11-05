import { defaultCodeRegistry, type PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DOCUMENT_FORMAT,
  NOTIFICATION_TEMPLATE_TYPE,
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
  TEMPLATES_AUDIT_META,
  TEMPLATES_CODE_TYPES,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationDocumentFormatName,
  type NotificationTemplateTypeName,
  type NotificationTemplateVersionStatusName,
} from '../enum/templates.enum.js';
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
import type {
  NotificationTemplateItemView,
  NotificationTemplatePreviewView,
  NotificationTemplateUsageItemView,
  NotificationTemplateVersionItemView,
  RenderedDocumentFromTemplateView,
  TemplateVersionMutationResultView,
} from '../types/templates.types.js';

export {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DOCUMENT_FORMAT,
  NOTIFICATION_TEMPLATE_TYPE,
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
  TEMPLATES_AUDIT_META,
  TEMPLATES_CODE_TYPES,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationDocumentFormatName,
  type NotificationTemplateTypeName,
  type NotificationTemplateVersionStatusName,
  type NotificationTemplateItemView,
  type NotificationTemplatePreviewView,
  type NotificationTemplateUsageItemView,
  type NotificationTemplateVersionItemView,
  type RenderedDocumentFromTemplateView,
  type TemplateVersionMutationResultView,
};

export function parseNotificationCategory(val: unknown): NotificationCategoryCode {
  return defaultCodeRegistry.parseToNumericCode(
    TEMPLATES_CODE_TYPES.CATEGORY,
    val,
    NOTIFICATION_CATEGORY.SYSTEM,
  );
}

export function getNotificationCategoryName(code: number): NotificationCategoryName {
  return defaultCodeRegistry.getCodeName(
    TEMPLATES_CODE_TYPES.CATEGORY,
    code,
    'SYSTEM',
  ) as NotificationCategoryName;
}

export function getNotificationCategoryLabel(code: number, locale = 'vi'): string {
  return defaultCodeRegistry.getLabel(TEMPLATES_CODE_TYPES.CATEGORY, code, locale);
}

export function parseNotificationChannel(val: unknown): NotificationChannelCode {
  if (
    val === NOTIFICATION_CHANNEL.DOCUMENT ||
    val === '5' ||
    String(val ?? '')
      .trim()
      .toUpperCase() === 'DOCUMENT' ||
    String(val ?? '')
      .trim()
      .toUpperCase() === 'DOC'
  ) {
    return NOTIFICATION_CHANNEL.DOCUMENT;
  }
  const resolved = defaultCodeRegistry.parseToNumericCode(
    TEMPLATES_CODE_TYPES.CHANNEL,
    val,
    NOTIFICATION_CHANNEL.IN_APP,
  );
  if (
    resolved === NOTIFICATION_CHANNEL.IN_APP ||
    resolved === NOTIFICATION_CHANNEL.EMAIL ||
    resolved === NOTIFICATION_CHANNEL.SMS ||
    resolved === NOTIFICATION_CHANNEL.PUSH ||
    resolved === NOTIFICATION_CHANNEL.DOCUMENT
  ) {
    return resolved;
  }
  return NOTIFICATION_CHANNEL.IN_APP;
}

export function getNotificationChannelName(code: number): NotificationChannelName {
  if (code === NOTIFICATION_CHANNEL.DOCUMENT) {
    return 'DOCUMENT';
  }
  const name = defaultCodeRegistry.getCodeName(TEMPLATES_CODE_TYPES.CHANNEL, code, 'IN_APP');
  if (
    name === 'IN_APP' ||
    name === 'EMAIL' ||
    name === 'SMS' ||
    name === 'PUSH' ||
    name === 'DOCUMENT'
  ) {
    return name;
  }
  return 'IN_APP';
}

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
