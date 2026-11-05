import type {
  NotificationCategoryCode,
  NotificationCategoryName,
  NotificationChannelCode,
  NotificationChannelName,
  NotificationDocumentFormatName,
  NotificationTemplateTypeName,
  NotificationTemplateVersionStatusName,
} from '../enum/templates.enum.js';

export interface NotificationTemplateItemView {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly category: NotificationCategoryCode;
  readonly categoryName: NotificationCategoryName;
  readonly locale: string;
  readonly templateType: NotificationTemplateTypeName;
  readonly documentFormat: NotificationDocumentFormatName | null;
  readonly version: number;
  readonly publishedVersion: number;
  readonly latestDraftVersion: number | null;
  readonly status: NotificationTemplateVersionStatusName;
  readonly publishedAt: string | null;
  readonly publishedByUserId: number | null;
  readonly subjectTemplate: string | null;
  readonly bodyTemplate: string;
  readonly htmlTemplate: string | null;
  readonly variables: readonly string[];
  readonly usedByModules: readonly string[];
  readonly usageCount: number;
  readonly availableLocales?: readonly string[];
  readonly isActive: boolean;
  readonly isSystem: boolean;
  readonly organizationUnitId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NotificationTemplateVersionItemView {
  readonly id: number;
  readonly templateId: number;
  readonly code: string;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly locale: string;
  readonly version: number;
  readonly status: NotificationTemplateVersionStatusName;
  readonly name: string;
  readonly templateType: NotificationTemplateTypeName;
  readonly documentFormat: NotificationDocumentFormatName | null;
  readonly subjectTemplate: string | null;
  readonly bodyTemplate: string;
  readonly htmlTemplate: string | null;
  readonly variables: readonly string[];
  readonly changeNote: string | null;
  readonly createdByUserId: number | null;
  readonly publishedAt: string | null;
  readonly publishedByUserId: number | null;
  readonly createdAt: string;
}

export interface NotificationTemplateUsageItemView {
  readonly id: number;
  readonly templateCode: string;
  readonly channel: NotificationChannelCode | null;
  readonly channelName: NotificationChannelName | 'ALL';
  readonly moduleName: string;
  readonly featureCode: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly createdByUserId: number | null;
  readonly createdAt: string;
}

export interface NotificationTemplatePreviewView {
  readonly code: string | null;
  readonly channel: NotificationChannelCode;
  readonly channelName: NotificationChannelName;
  readonly locale: string;
  readonly templateType?: NotificationTemplateTypeName;
  readonly documentFormat?: NotificationDocumentFormatName | null;
  readonly version?: number | null;
  readonly extractedVariables?: readonly string[];
  readonly renderedSubject: string | null;
  readonly renderedBody: string;
  readonly renderedHtml: string | null;
  readonly missingVariables: readonly string[];
  readonly smsSegmentsCount: number;
}

export interface RenderedDocumentFromTemplateView {
  readonly templateId: number | null;
  readonly templateCode: string;
  readonly locale: string;
  readonly versionUsed: number;
  readonly documentFormat: NotificationDocumentFormatName;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly renderedTitle: string;
  readonly renderedContent: string;
  readonly renderedHtml: string | null;
  readonly contentBase64: string;
  readonly missingVariables: readonly string[];
  readonly generatedAt: string;
}

export interface TemplateVersionMutationResultView {
  readonly template: NotificationTemplateItemView;
  readonly activeVersion: NotificationTemplateVersionItemView;
  readonly previousPublishedVersion: number | null;
  readonly action: 'PUBLISHED' | 'ROLLED_BACK';
  readonly auditRecorded: boolean;
}
