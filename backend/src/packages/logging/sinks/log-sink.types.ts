import type { LogSinkDriver } from '@packages/config/index.js';

export type LogSinkDriverType = LogSinkDriver;

export interface LogSinkConfig {
  enabled: boolean;
  driver: LogSinkDriverType;
  endpoint: string;
  authHeader: string;
  apiKey: string;
  tenantId: string;
  indexPrefix: string;
  batchSize: number;
  flushMs: number;
  timeoutMs: number;
  maxBuffer: number;
}

export interface LogSinkStats {
  enabled: boolean;
  driver: LogSinkDriverType;
  endpoint: string | null;
  batchSize: number;
  flushMs: number;
  indexPrefix: string;
  sent: number;
  dropped: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export interface FormattedSinkRequest {
  headers: Record<string, string>;
  body: string;
}
