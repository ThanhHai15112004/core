export type RedisHaMode = 'standalone' | 'sentinel' | 'cluster';

export interface RedisHaTimeouts {
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  maxRetriesPerRequest: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

export interface RedisClusterNodesSummary {
  total: number;
  masters: number;
  readyMasters: number;
}

export interface RedisHaStatus {
  mode: RedisHaMode;
  state: string;
  ready: boolean;
  endpoints: string[];
  currentPrimary: string | null;
  masterName: string | null;
  reconnectCount: number;
  failoverCount: number;
  lastFailoverAt: string | null;
  lastSwitchReason: string | null;
  lastError: string | null;
  timeouts: RedisHaTimeouts;
  clusterNodes?: RedisClusterNodesSummary;
}

export interface RedisFailoverEvent {
  mode: RedisHaMode;
  reason: string;
  previousPrimary: string | null;
  currentPrimary: string | null;
  at: number;
}

export type RedisFailoverListener = (event: RedisFailoverEvent) => void;
