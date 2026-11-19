import {
  ALL_PROVIDER_TYPES,
  PROVIDER_HEALTH_STATUS,
  PROVIDER_ROLE,
  PROVIDER_STATUS,
  PROVIDER_TYPE,
  getProviderHealthStatusName,
  getProviderStatusName,
  type ProviderTypeName,
} from '@packages/kernel/index.js';

export {
  ALL_PROVIDER_TYPES,
  PROVIDER_HEALTH_STATUS,
  PROVIDER_ROLE,
  PROVIDER_STATUS,
  PROVIDER_TYPE,
  getProviderHealthStatusName,
  getProviderStatusName,
};

export const PROVIDER_HISTORY_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  SET_PRIMARY: 'SET_PRIMARY',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  DELETE: 'DELETE',
  UNIT_ASSIGN: 'UNIT_ASSIGN',
  UNIT_UNASSIGN: 'UNIT_UNASSIGN',
} as const;

export type ProviderHistoryAction =
  (typeof PROVIDER_HISTORY_ACTION)[keyof typeof PROVIDER_HISTORY_ACTION];

export const PROVIDER_CHECK_SOURCE = {
  MANUAL: 'MANUAL',
  SCHEDULED: 'SCHEDULED',
  PASSIVE: 'PASSIVE',
} as const;

export type ProviderCheckSource =
  (typeof PROVIDER_CHECK_SOURCE)[keyof typeof PROVIDER_CHECK_SOURCE];

export const PROVIDER_REGISTRY_SETTING_KEYS = {
  FALLBACK_ENABLED: 'provider_registry.fallback_enabled',
  FALLBACK_ALLOWED_TYPES: 'provider_registry.fallback_allowed_types',
  FALLBACK_ON_PAUSED: 'provider_registry.fallback_on_paused',
  FALLBACK_ON_DOWN: 'provider_registry.fallback_on_down',
  FALLBACK_ON_DEGRADED: 'provider_registry.fallback_on_degraded',
  UNIT_ROUTING_ENABLED: 'provider_registry.unit_routing_enabled',
  HEALTH_CHECK_TIMEOUT_MS: 'provider_registry.health_check_timeout_ms',
  DEGRADED_LATENCY_MS: 'provider_registry.degraded_latency_ms',
  DEGRADED_ERROR_RATE_PCT: 'provider_registry.degraded_error_rate_pct',
  DOWN_ERROR_RATE_PCT: 'provider_registry.down_error_rate_pct',
  CONSECUTIVE_FAILURES_FOR_DOWN: 'provider_registry.consecutive_failures_for_down',
  ALLOW_PRIVATE_HEALTH_URLS: 'provider_registry.allow_private_health_urls',
  TELEMETRY_WINDOW_MINUTES: 'provider_registry.telemetry_window_minutes',
} as const;

export const PROVIDER_REGISTRY_DEFAULTS = {
  FALLBACK_ENABLED: false,
  FALLBACK_ALLOWED_TYPES: [...ALL_PROVIDER_TYPES] as ProviderTypeName[],
  FALLBACK_ON_PAUSED: true,
  FALLBACK_ON_DOWN: true,
  FALLBACK_ON_DEGRADED: false,
  UNIT_ROUTING_ENABLED: true,
  HEALTH_CHECK_TIMEOUT_MS: 5000,
  DEGRADED_LATENCY_MS: 1500,
  DEGRADED_ERROR_RATE_PCT: 5,
  DOWN_ERROR_RATE_PCT: 50,
  CONSECUTIVE_FAILURES_FOR_DOWN: 3,
  ALLOW_PRIVATE_HEALTH_URLS: false,
  TELEMETRY_WINDOW_MINUTES: 60,
} as const;

export const PROVIDER_REGISTRY_AUDIT_META = {
  MODULE: 'provider-registry',
  FEATURES: {
    ENTRIES: 'entries',
    UNIT_ASSIGNMENTS: 'unit_assignments',
    HEALTH_CHECKS: 'health_checks',
  },
} as const;

export const PROVIDER_REGISTRY_EVENTS = {
  PROVIDER_CREATED: 'provider-registry.provider.created',
  PROVIDER_UPDATED: 'provider-registry.provider.updated',
  PROVIDER_PRIMARY_CHANGED: 'provider-registry.provider.primary_changed',
  PROVIDER_PAUSED: 'provider-registry.provider.paused',
  PROVIDER_RESUMED: 'provider-registry.provider.resumed',
  UNIT_ASSIGNMENT_UPDATED: 'provider-registry.unit_assignment.updated',
  HEALTH_CHANGED: 'provider-registry.health.changed',
} as const;

export interface ProviderDriverCatalogItem {
  readonly driverCode: string;
  readonly displayName: string;
  readonly description: string;
  readonly defaultDomainRefCode: string | null;
  readonly suggestedSecretKeys: readonly string[];
  readonly suggestedConfigKeys: readonly string[];
}

export const PROVIDER_DRIVER_CATALOG: Record<
  ProviderTypeName,
  readonly ProviderDriverCatalogItem[]
> = {
  EMAIL: [
    {
      driverCode: 'smtp',
      displayName: 'SMTP Relay',
      description: 'Máy chủ SMTP chuẩn (TLS/STARTTLS) gửi email hệ thống.',
      defaultDomainRefCode: 'SMTP',
      suggestedSecretKeys: ['username', 'password'],
      suggestedConfigKeys: ['host', 'port', 'fromAddress', 'healthCheckUrl'],
    },
    {
      driverCode: 'sendgrid',
      displayName: 'SendGrid API',
      description: 'Dịch vụ gửi email qua REST API SendGrid.',
      defaultDomainRefCode: 'SENDGRID',
      suggestedSecretKeys: ['apiKey'],
      suggestedConfigKeys: ['fromAddress', 'sandboxMode', 'healthCheckUrl'],
    },
    {
      driverCode: 'ses',
      displayName: 'Amazon SES',
      description: 'AWS Simple Email Service theo region.',
      defaultDomainRefCode: 'SES',
      suggestedSecretKeys: ['accessKeyId', 'secretAccessKey'],
      suggestedConfigKeys: ['region', 'fromAddress'],
    },
    {
      driverCode: 'console',
      displayName: 'Console / Sandbox Email',
      description: 'Adapter giả lập phục vụ môi trường phát triển và kiểm thử.',
      defaultDomainRefCode: 'CONSOLE',
      suggestedSecretKeys: [],
      suggestedConfigKeys: ['fromAddress'],
    },
  ],
  SMS: [
    {
      driverCode: 'twilio',
      displayName: 'Twilio SMS',
      description: 'Cổng SMS quốc tế qua Twilio Programmable Messaging.',
      defaultDomainRefCode: 'TWILIO',
      suggestedSecretKeys: ['accountSid', 'authToken'],
      suggestedConfigKeys: ['senderId', 'healthCheckUrl'],
    },
    {
      driverCode: 'viettel',
      displayName: 'Viettel Brandname SMS',
      description: 'Cổng SMS Brandname nội địa Viettel.',
      defaultDomainRefCode: 'VIETTEL',
      suggestedSecretKeys: ['username', 'password', 'cpCode'],
      suggestedConfigKeys: ['senderId', 'endpoint', 'healthCheckUrl'],
    },
    {
      driverCode: 'fpt',
      displayName: 'FPT SMS Gateway',
      description: 'Cổng SMS Brandname FPT Telecom.',
      defaultDomainRefCode: 'FPT',
      suggestedSecretKeys: ['clientId', 'clientSecret'],
      suggestedConfigKeys: ['senderId', 'endpoint', 'healthCheckUrl'],
    },
    {
      driverCode: 'console',
      displayName: 'Console / Sandbox SMS',
      description: 'Adapter giả lập gửi SMS cho môi trường dev/test.',
      defaultDomainRefCode: 'CONSOLE',
      suggestedSecretKeys: [],
      suggestedConfigKeys: ['senderId'],
    },
  ],
  PAYMENT: [
    {
      driverCode: 'sandbox',
      displayName: 'Sandbox Payment Gateway',
      description: 'Cổng thanh toán thử nghiệm nội bộ có ký HMAC.',
      defaultDomainRefCode: 'sandbox-default',
      suggestedSecretKeys: ['hmacSecret'],
      suggestedConfigKeys: ['merchantCode', 'healthCheckUrl'],
    },
    {
      driverCode: 'vnpay',
      displayName: 'VNPay Gateway',
      description: 'Cổng thanh toán VNPay QR / ATM / Thẻ quốc tế.',
      defaultDomainRefCode: 'vnpay-main',
      suggestedSecretKeys: ['tmnCode', 'hashSecret'],
      suggestedConfigKeys: ['apiUrl', 'healthCheckUrl'],
    },
    {
      driverCode: 'momo',
      displayName: 'MoMo E-Wallet',
      description: 'Cổng thanh toán ví điện tử MoMo.',
      defaultDomainRefCode: 'momo-main',
      suggestedSecretKeys: ['accessKey', 'secretKey'],
      suggestedConfigKeys: ['partnerCode', 'endpoint', 'healthCheckUrl'],
    },
    {
      driverCode: 'stripe',
      displayName: 'Stripe Checkout',
      description: 'Cổng thanh toán thẻ quốc tế Stripe.',
      defaultDomainRefCode: 'stripe-main',
      suggestedSecretKeys: ['secretKey', 'webhookSecret'],
      suggestedConfigKeys: ['publishableKey', 'healthCheckUrl'],
    },
  ],
  STORAGE: [
    {
      driverCode: 'local',
      displayName: 'Local Filesystem Storage',
      description: 'Lưu trữ tệp tin trên đĩa cục bộ hoặc volume gắn kết.',
      defaultDomainRefCode: 'local',
      suggestedSecretKeys: [],
      suggestedConfigKeys: ['rootPath', 'cdnUrl'],
    },
    {
      driverCode: 's3',
      displayName: 'S3-Compatible Object Storage',
      description: 'Amazon S3, MinIO, Cloudflare R2 hoặc DigitalOcean Spaces.',
      defaultDomainRefCode: 's3',
      suggestedSecretKeys: ['accessKeyId', 'secretAccessKey'],
      suggestedConfigKeys: ['bucket', 'region', 'endpoint', 'healthCheckUrl'],
    },
  ],
  IDENTITY: [
    {
      driverCode: 'google',
      displayName: 'Google OAuth / OIDC',
      description: 'Đăng nhập liên kết tài khoản Google Workspace & Gmail.',
      defaultDomainRefCode: 'google',
      suggestedSecretKeys: ['clientSecret'],
      suggestedConfigKeys: ['clientId', 'issuerUrl', 'healthCheckUrl'],
    },
    {
      driverCode: 'microsoft',
      displayName: 'Microsoft Entra ID',
      description: 'Đăng nhập Microsoft / Azure AD / Office 365.',
      defaultDomainRefCode: 'microsoft',
      suggestedSecretKeys: ['clientSecret'],
      suggestedConfigKeys: ['clientId', 'tenantId', 'healthCheckUrl'],
    },
    {
      driverCode: 'oidc',
      displayName: 'Generic Enterprise OIDC',
      description: 'Nhà cung cấp định danh OIDC chuẩn doanh nghiệp (Keycloak, Okta...).',
      defaultDomainRefCode: 'oidc',
      suggestedSecretKeys: ['clientSecret'],
      suggestedConfigKeys: ['clientId', 'issuerUrl', 'jwksUri', 'healthCheckUrl'],
    },
  ],
};
