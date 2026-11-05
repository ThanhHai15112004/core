import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DOCUMENT_FORMAT,
  NOTIFICATION_TEMPLATE_TYPE,
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationDocumentFormatName,
  type NotificationTemplateTypeName,
  type NotificationTemplateVersionStatusName,
} from '@modules/templates/contracts/index.js';

export {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DOCUMENT_FORMAT,
  NOTIFICATION_TEMPLATE_TYPE,
  NOTIFICATION_TEMPLATE_VERSION_STATUS,
  type NotificationCategoryCode,
  type NotificationCategoryName,
  type NotificationChannelCode,
  type NotificationChannelName,
  type NotificationDocumentFormatName,
  type NotificationTemplateTypeName,
  type NotificationTemplateVersionStatusName,
};

export const NOTIFICATION_DELIVERY_STATUS = {
  QUEUED: 1,
  SENT: 2,
  DELIVERED: 3,
  FAILED: 4,
  SUPPRESSED: 5,
} as const;

export type NotificationDeliveryStatusCode =
  (typeof NOTIFICATION_DELIVERY_STATUS)[keyof typeof NOTIFICATION_DELIVERY_STATUS];
export type NotificationDeliveryStatusName = keyof typeof NOTIFICATION_DELIVERY_STATUS;

export const NOTIFICATION_ERROR_TYPE = {
  NONE: 0,
  TRANSIENT: 1,
  PERMANENT: 2,
  RATE_LIMITED: 3,
  QUOTA_EXCEEDED: 4,
  SUPPRESSED: 5,
} as const;

export type NotificationErrorTypeCode =
  (typeof NOTIFICATION_ERROR_TYPE)[keyof typeof NOTIFICATION_ERROR_TYPE];
export type NotificationErrorTypeName = keyof typeof NOTIFICATION_ERROR_TYPE;

export const NOTIFICATION_SUPPRESSION_REASON = {
  HARD_BOUNCE: 1,
  INVALID_FORMAT: 2,
  UNREGISTERED_TOKEN: 3,
  UNSUBSCRIBED: 4,
  SPAM_COMPLAINT: 5,
  MANUAL_BLOCK: 6,
} as const;

export type NotificationSuppressionReasonCode =
  (typeof NOTIFICATION_SUPPRESSION_REASON)[keyof typeof NOTIFICATION_SUPPRESSION_REASON];
export type NotificationSuppressionReasonName = keyof typeof NOTIFICATION_SUPPRESSION_REASON;

export const NOTIFICATION_PUSH_PLATFORM = {
  WEB_PUSH: 1,
  FCM_ANDROID: 2,
  APNS_IOS: 3,
} as const;

export type NotificationPushPlatformCode =
  (typeof NOTIFICATION_PUSH_PLATFORM)[keyof typeof NOTIFICATION_PUSH_PLATFORM];
export type NotificationPushPlatformName = keyof typeof NOTIFICATION_PUSH_PLATFORM;

export const NOTIFICATION_DELIVERY_CODE_TYPES = {
  CATEGORY: 'notifications.category',
  CHANNEL: 'notifications.channel',
  DELIVERY_STATUS: 'notifications.delivery_status',
  SUPPRESSION_REASON: 'notifications.suppression_reason',
} as const;

export const NOTIFICATION_DELIVERY_SETTING_KEYS = {
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
  EMAIL_PROVIDER: 'notification.email.provider',
  EMAIL_FROM_ADDRESS: 'notification.email.from_address',
  EMAIL_FROM_NAME: 'notification.email.from_name',
  EMAIL_PROVIDER_CONFIG_JSON: 'notification.email.provider_config_json',
  SMS_PROVIDER: 'notification.sms.provider',
  SMS_SENDER_ID: 'notification.sms.sender_id',
  SMS_PROVIDER_CONFIG_JSON: 'notification.sms.provider_config_json',
  PUSH_PROVIDER: 'notification.push.provider',
  PUSH_PROVIDER_CONFIG_JSON: 'notification.push.provider_config_json',
  DISPATCH_BATCH_SIZE: 'notification.dispatch.batch_size',
  DISPATCH_RATE_LIMIT_PER_SEC: 'notification.dispatch.rate_limit_per_sec',
  RETRY_ENABLED: 'notification.retry.enabled',
  RETRY_MAX_ATTEMPTS: 'notification.retry.max_attempts',
  RETRY_BASE_DELAY_SEC: 'notification.retry.base_delay_sec',
  AUTO_SUPPRESS_ON_PERMANENT_FAILURE: 'notification.suppression.auto_suppress_on_permanent_failure',
  QUOTA_CURRENCY: 'notification.quota.currency',
  QUOTA_HARD_STOP_ON_EXCEED: 'notification.quota.hard_stop_on_exceed',
  SMS_DAILY_QUOTA: 'notification.sms.daily_quota',
  SMS_MONTHLY_BUDGET: 'notification.sms.monthly_budget',
  SMS_COST_PER_SEGMENT: 'notification.sms.cost_per_segment',
  EMAIL_DAILY_QUOTA: 'notification.email.daily_quota',
  EMAIL_COST_PER_MESSAGE: 'notification.email.cost_per_message',
  PUSH_DAILY_QUOTA: 'notification.push.daily_quota',
  PUSH_COST_PER_MESSAGE: 'notification.push.cost_per_message',
} as const;

export const NOTIFICATION_DELIVERY_FEATURE_FLAG_KEYS = {
  IN_APP_ENABLED: 'notifications.in_app_enabled',
  ORG_UNIT_BROADCAST: 'notifications.org_unit_broadcast',
  ROLE_BROADCAST: 'notifications.role_broadcast',
  USER_PREFERENCES: 'notifications.user_preferences',
  EMAIL_ENABLED: 'notifications.email_enabled',
  SMS_ENABLED: 'notifications.sms_enabled',
  PUSH_ENABLED: 'notifications.push_enabled',
} as const;

export const NOTIFICATION_DELIVERY_AUDIT_META = {
  MODULE: 'notification-delivery',
  ENTITY_DELIVERY: 'NotificationDelivery',
  ENTITY_SUPPRESSION: 'NotificationSuppression',
  ENTITY_PUSH_SUBSCRIPTION: 'NotificationPushSubscription',
} as const;
