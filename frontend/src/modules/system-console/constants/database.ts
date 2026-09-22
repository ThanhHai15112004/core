import type { DbHealthStatus, DbMetric, DbRange, DbTab, MonitoringCapability } from '../types/database.types';
import type { StatusTone } from '../utils/status-tone';

export const DB_TABS: DbTab[] = ['overview', 'queries', 'connections', 'transactions', 'tables', 'migrations', 'errors', 'configuration'];
export const DB_RANGES: DbRange[] = ['15m', '1h', '6h', '24h'];
export const DEFAULT_DB_RANGE: DbRange = '1h';
export const DB_METRICS: DbMetric[] = ['queries', 'latency', 'connections', 'errors', 'transactions'];
/** Mốc lọc query chậm (ms). */
export const SLOW_THRESHOLDS = [0, 250, 500, 1000, 3000] as const;

/** Tab cần capability nào (driver không hỗ trợ → hiện "Không hỗ trợ"). */
export const TAB_CAPABILITY: Partial<Record<DbTab, MonitoringCapability>> = {
  connections: 'sessions',
  transactions: 'transactions',
  tables: 'tables',
};

export const HEALTH_TONE: Record<DbHealthStatus, StatusTone> = {
  healthy: 'ok',
  degraded: 'warn',
  reconnecting: 'warn',
  unavailable: 'crit',
  unknown: 'unknown',
  disabled: 'unknown',
};

export const SESSION_TONE: Record<string, StatusTone> = {
  active: 'ok',
  blocked: 'crit',
  idle_in_transaction: 'warn',
  idle: 'unknown',
  other: 'unknown',
};

export const DB_SERIES_COLORS: Record<string, string> = {
  queriesPerSec: 'var(--scp-series-1)',
  slowPerMin: 'var(--scp-warning)',
  p50: 'var(--scp-series-1)',
  p95: 'var(--scp-series-2)',
  p99: 'var(--scp-series-3)',
  poolUsed: 'var(--scp-series-1)',
  sessions: 'var(--scp-series-4)',
  poolWaiting: 'var(--scp-danger)',
  failedPerMin: 'var(--scp-danger)',
  deadlocksPerMin: 'var(--scp-series-5)',
  timeoutsPerMin: 'var(--scp-warning)',
  committedPerMin: 'var(--scp-success)',
  rolledBackPerMin: 'var(--scp-warning)',
  callsPerMin: 'var(--scp-series-1)',
  avgMs: 'var(--scp-series-2)',
};

export const DB_CONFIRM = { terminate: 'TERMINATE', migrate: 'MIGRATE' } as const;
