export const NOTIFICATION_CATEGORY = {
  SYSTEM: 1,
  WORK: 2,
  SECURITY: 3,
  ANNOUNCEMENT: 4,
} as const;

export type NotificationCategoryCode =
  (typeof NOTIFICATION_CATEGORY)[keyof typeof NOTIFICATION_CATEGORY] | number;
export type NotificationCategoryName = keyof typeof NOTIFICATION_CATEGORY | (string & {});

export const NOTIFICATION_PRIORITY = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  URGENT: 4,
} as const;

export type NotificationPriorityCode =
  (typeof NOTIFICATION_PRIORITY)[keyof typeof NOTIFICATION_PRIORITY];
export type NotificationPriorityName = keyof typeof NOTIFICATION_PRIORITY;

export const NOTIFICATION_TARGET_TYPE = {
  SINGLE_USER: 1,
  USER_GROUP: 2,
  ROLE: 3,
  ORG_UNIT: 4,
} as const;

export type NotificationTargetTypeCode =
  (typeof NOTIFICATION_TARGET_TYPE)[keyof typeof NOTIFICATION_TARGET_TYPE];
export type NotificationTargetTypeName = keyof typeof NOTIFICATION_TARGET_TYPE;

export const NOTIFICATION_CHANNEL = {
  IN_APP: 1,
  EMAIL: 2,
  SMS: 3,
  PUSH: 4,
} as const;

export type NotificationChannelCode =
  (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];
export type NotificationChannelName = keyof typeof NOTIFICATION_CHANNEL;

export const NOTIFICATION_INBOX_STATUS = {
  ACTIVE: 1,
  ARCHIVED: 2,
  DELETED: 3,
} as const;

export type NotificationInboxStatusCode =
  (typeof NOTIFICATION_INBOX_STATUS)[keyof typeof NOTIFICATION_INBOX_STATUS];
export type NotificationInboxStatusName = keyof typeof NOTIFICATION_INBOX_STATUS;

export const NOTIFICATION_DISPATCH_STATUS = {
  SENT: 1,
  PARTIAL: 2,
  CANCELLED: 3,
} as const;

export type NotificationDispatchStatusCode =
  (typeof NOTIFICATION_DISPATCH_STATUS)[keyof typeof NOTIFICATION_DISPATCH_STATUS];
export type NotificationDispatchStatusName = keyof typeof NOTIFICATION_DISPATCH_STATUS;

export const NOTIFICATIONS_CODE_TYPES = {
  CATEGORY: 'notifications.category',
  PRIORITY: 'notifications.priority',
  TARGET_TYPE: 'notifications.target_type',
  CHANNEL: 'notifications.channel',
  INBOX_STATUS: 'notifications.inbox_status',
} as const;

export const NOTIFICATIONS_SETTING_KEYS = {
  ENABLED: 'notification.enabled',
  CHANNELS_ENABLED: 'notification.channels.enabled',
  CHANNELS_DEFAULT: 'notification.channels.default',
  ORG_UNIT_TARGETING_ENABLED: 'notification.org_unit_targeting.enabled',
  ORG_UNIT_INCLUDE_SUB_UNITS_DEFAULT: 'notification.org_unit_targeting.include_sub_units_default',
  ROLE_TARGETING_ENABLED: 'notification.role_targeting.enabled',
  MAX_RECIPIENTS_PER_BATCH: 'notification.dispatch.max_recipients_per_batch',
  MAX_TITLE_LENGTH: 'notification.content.max_title_length',
  MAX_BODY_LENGTH: 'notification.content.max_body_length',
  ALLOW_USER_CUSTOMIZATION: 'notification.preferences.allow_user_customization',
  LOCK_SECURITY_IN_APP: 'notification.preferences.lock_security_in_app',
  DEFAULT_PREFERENCE_MATRIX: 'notification.preferences.default_matrix',
  AUTO_READ_ON_OPEN: 'notification.inbox.auto_read_on_open',
  RETENTION_DAYS: 'notification.inbox.retention_days',
  POLLING_INTERVAL_SEC: 'notification.inbox.polling_interval_sec',
  PAGINATION_DEFAULT_PAGE_SIZE: 'notifications.pagination.default_page_size',
  PAGINATION_MAX_PAGE_SIZE: 'notifications.pagination.max_page_size',
} as const;

export const NOTIFICATIONS_FEATURE_FLAG_KEYS = {
  IN_APP_ENABLED: 'notifications.in_app_enabled',
  ORG_UNIT_BROADCAST: 'notifications.org_unit_broadcast',
  ROLE_BROADCAST: 'notifications.role_broadcast',
  USER_PREFERENCES: 'notifications.user_preferences',
} as const;

export const NOTIFICATIONS_SEQUENCE_KEYS = {
  NOTIFICATION_CODE: 'notifications.notification_code',
} as const;

export const NOTIFICATIONS_AUDIT_META = {
  MODULE: 'notifications',
  ENTITY_NOTIFICATION: 'Notification',
  ENTITY_PREFERENCE: 'NotificationPreference',
  ENTITY_CONFIG: 'NotificationConfig',
} as const;
