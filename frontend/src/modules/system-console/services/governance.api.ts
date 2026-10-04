import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';

export interface SecretItem {
  key: string;
  driver: 'env' | 'file';
  present: boolean;
  length?: number;
  lastReadAt?: string;
}

export interface ConfigItem {
  domain: string;
  key: string;
  value: unknown;
  source: 'env' | 'default';
  sensitive: boolean;
}

export function fetchSecrets(): Promise<SecretItem[]> {
  return fetchApi<SecretItem[]>(API_ROUTES.OPS.SECRETS);
}

export function fetchConfiguration(domain?: string): Promise<ConfigItem[]> {
  return fetchApi<ConfigItem[]>(API_ROUTES.OPS.CONFIGURATION(domain));
}
