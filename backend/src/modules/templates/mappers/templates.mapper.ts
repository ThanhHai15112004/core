import { Injectable } from '@nestjs/common';
import { safeJsonParseStringArray } from '@packages/kernel/index.js';
import {
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
  getNotificationCategoryName,
  getNotificationChannelName,
  parseNotificationCategory,
  parseNotificationChannel,
  type NotificationDocumentFormatName,
  type NotificationTemplateVersionStatusName,
} from '../contracts/index.js';
import type { NotificationTemplateUsageEntity } from '../entities/notification-template-usage.entity.js';
import type { NotificationTemplateVersionEntity } from '../entities/notification-template-version.entity.js';
import type { NotificationTemplateEntity } from '../entities/notification-template.entity.js';
import {
  extractTemplateVariables,
  resolveTemplateTypeAndFormat,
} from '../helpers/notification-template.helper.js';
import type {
  NotificationTemplateItemView,
  NotificationTemplateUsageItemView,
  NotificationTemplateVersionItemView,
} from '../types/templates.types.js';

@Injectable()
export class TemplatesMapper {
  public toTemplateItemView(
    entity: NotificationTemplateEntity,
    extra?: {
      readonly latestDraftVersion?: number | null;
      readonly usedByModules?: readonly string[];
      readonly usageCount?: number;
      readonly availableLocales?: readonly string[];
    },
  ): NotificationTemplateItemView {
    const rawChannel = parseNotificationChannel(entity.channel);
    const { channel, templateType, documentFormat } = resolveTemplateTypeAndFormat({
      channel: rawChannel,
      templateType: entity.templateType,
      documentFormat: entity.documentFormat,
    });
    const category = parseNotificationCategory(entity.category);
    const declaredVars = entity.variablesJson ? safeJsonParseStringArray(entity.variablesJson) : [];
    const extractedVars = [
      ...new Set([
        ...declaredVars,
        ...extractTemplateVariables(entity.subjectTemplate),
        ...extractTemplateVariables(entity.bodyTemplate),
        ...extractTemplateVariables(entity.htmlTemplate),
      ]),
    ];

    const version = Number(entity.version ?? 1);
    const publishedVersion = Number(entity.publishedVersion ?? version);
    const rawStatus = (entity.status || NOTIFICATION_TEMPLATE_VERSION_STATUS.PUBLISHED)
      .trim()
      .toUpperCase() as NotificationTemplateVersionStatusName;
    const usedByModules = extra?.usedByModules ?? [];
    const usageCount = extra?.usageCount ?? usedByModules.length;

    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      channel,
      channelName: getNotificationChannelName(channel),
      category,
      categoryName: getNotificationCategoryName(category),
      locale: entity.locale || 'vi',
      templateType,
      documentFormat: (documentFormat ?? null) as NotificationDocumentFormatName | null,
      version,
      publishedVersion,
      latestDraftVersion: extra?.latestDraftVersion ?? null,
      status: rawStatus,
      publishedAt: entity.publishedAt ? entity.publishedAt.toISOString() : null,
      publishedByUserId:
        entity.publishedByUserId !== undefined && entity.publishedByUserId !== null
          ? Number(entity.publishedByUserId)
          : null,
      subjectTemplate: entity.subjectTemplate ?? null,
      bodyTemplate: entity.bodyTemplate,
      htmlTemplate: entity.htmlTemplate ?? null,
      variables: extractedVars,
      usedByModules,
      usageCount,
      ...(extra?.availableLocales ? { availableLocales: extra.availableLocales } : {}),
      isActive: Boolean(entity.isActive),
      isSystem: Boolean(entity.isSystem),
      organizationUnitId:
        entity.organizationUnitId !== undefined && entity.organizationUnitId !== null
          ? Number(entity.organizationUnitId)
          : null,
      createdAt: (entity.createdAt ?? new Date()).toISOString(),
      updatedAt: (entity.updatedAt ?? entity.createdAt ?? new Date()).toISOString(),
    };
  }

  public toTemplateVersionItemView(
    entity: NotificationTemplateVersionEntity,
  ): NotificationTemplateVersionItemView {
    const rawChannel = parseNotificationChannel(entity.channel);
    const { channel, templateType, documentFormat } = resolveTemplateTypeAndFormat({
      channel: rawChannel,
      templateType: entity.templateType,
      documentFormat: entity.documentFormat,
    });
    const declaredVars = entity.variablesJson ? safeJsonParseStringArray(entity.variablesJson) : [];
    const extractedVars = [
      ...new Set([
        ...declaredVars,
        ...extractTemplateVariables(entity.subjectTemplate),
        ...extractTemplateVariables(entity.bodyTemplate),
        ...extractTemplateVariables(entity.htmlTemplate),
      ]),
    ];

    return {
      id: Number(entity.id),
      templateId: Number(entity.templateId),
      code: entity.code,
      channel,
      channelName: getNotificationChannelName(channel),
      locale: entity.locale || 'vi',
      version: Number(entity.version ?? 1),
      status: (entity.status || NOTIFICATION_TEMPLATE_VERSION_STATUS.DRAFT)
        .trim()
        .toUpperCase() as NotificationTemplateVersionStatusName,
      name: entity.name,
      templateType,
      documentFormat: (documentFormat ?? null) as NotificationDocumentFormatName | null,
      subjectTemplate: entity.subjectTemplate ?? null,
      bodyTemplate: entity.bodyTemplate,
      htmlTemplate: entity.htmlTemplate ?? null,
      variables: extractedVars,
      changeNote: entity.changeNote ?? null,
      createdByUserId:
        entity.createdByUserId !== undefined && entity.createdByUserId !== null
          ? Number(entity.createdByUserId)
          : null,
      publishedAt: entity.publishedAt ? entity.publishedAt.toISOString() : null,
      publishedByUserId:
        entity.publishedByUserId !== undefined && entity.publishedByUserId !== null
          ? Number(entity.publishedByUserId)
          : null,
      createdAt: (entity.createdAt ?? new Date()).toISOString(),
    };
  }

  public toTemplateUsageItemView(
    entity: NotificationTemplateUsageEntity,
  ): NotificationTemplateUsageItemView {
    const hasChannel =
      entity.channel !== undefined && entity.channel !== null && Number(entity.channel) > 0;
    const channel = hasChannel ? parseNotificationChannel(entity.channel) : null;

    return {
      id: Number(entity.id),
      templateCode: entity.templateCode,
      channel,
      channelName: channel ? getNotificationChannelName(channel) : 'ALL',
      moduleName: entity.moduleName,
      featureCode: entity.featureCode,
      entityType: entity.entityType ?? null,
      entityId: entity.entityId ?? null,
      description: entity.description ?? null,
      isActive: Boolean(entity.isActive),
      createdByUserId:
        entity.createdByUserId !== undefined && entity.createdByUserId !== null
          ? Number(entity.createdByUserId)
          : null,
      createdAt: (entity.createdAt ?? new Date()).toISOString(),
    };
  }
}
