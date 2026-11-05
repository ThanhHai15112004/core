export const NOTIFICATION_CATEGORY = {
  SYSTEM: 1,
  WORK: 2,
  SECURITY: 3,
  ANNOUNCEMENT: 4,
} as const;

export type NotificationCategoryCode =
  (typeof NOTIFICATION_CATEGORY)[keyof typeof NOTIFICATION_CATEGORY] | number;
export type NotificationCategoryName = keyof typeof NOTIFICATION_CATEGORY | (string & {});

export const NOTIFICATION_CHANNEL = {
  IN_APP: 1,
  EMAIL: 2,
  SMS: 3,
  PUSH: 4,
  DOCUMENT: 5,
} as const;

export type NotificationChannelCode =
  (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];
export type NotificationChannelName = keyof typeof NOTIFICATION_CHANNEL;

export const NOTIFICATION_TEMPLATE_TYPE = {
  NOTIFICATION: 'NOTIFICATION',
  EMAIL: 'EMAIL',
  DOCUMENT: 'DOCUMENT',
} as const;

export type NotificationTemplateTypeName =
  (typeof NOTIFICATION_TEMPLATE_TYPE)[keyof typeof NOTIFICATION_TEMPLATE_TYPE];

export const NOTIFICATION_TEMPLATE_VERSION_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type NotificationTemplateVersionStatusName =
  (typeof NOTIFICATION_TEMPLATE_VERSION_STATUS)[keyof typeof NOTIFICATION_TEMPLATE_VERSION_STATUS];

export const NOTIFICATION_DOCUMENT_FORMAT = {
  HTML: 'HTML',
  TXT: 'TXT',
  MARKDOWN: 'MARKDOWN',
  PDF: 'PDF',
} as const;

export type NotificationDocumentFormatName =
  (typeof NOTIFICATION_DOCUMENT_FORMAT)[keyof typeof NOTIFICATION_DOCUMENT_FORMAT];

export const TEMPLATES_CODE_TYPES = {
  CATEGORY: 'notifications.category',
  CHANNEL: 'notifications.channel',
} as const;

export const TEMPLATES_AUDIT_META = {
  MODULE: 'templates',
  ENTITY_TEMPLATE: 'NotificationTemplate',
  ENTITY_TEMPLATE_VERSION: 'NotificationTemplateVersion',
  ENTITY_TEMPLATE_USAGE: 'NotificationTemplateUsage',
} as const;
