export const DEFAULT_CLIENT_TOKEN_TTL_SECONDS = 3600; // 1 giờ
export const MAX_USAGE_LOG_ENTRIES = 50;

export {
  SERVICE_ACCOUNT_STATUS,
  type ServiceAccountStatusCode,
  type ServiceAccountStatusName,
  getServiceAccountStatusName,
  parseServiceAccountStatus,
} from '../entities/auth-service-account.entity.js';

export {
  API_CLIENT_STATUS,
  type ApiClientStatusCode,
  type ApiClientStatusName,
  type ApiClientUsageLogItem,
  type ApiClientUsageResultType,
  getApiClientStatusName,
} from '../entities/auth-api-client.entity.js';
