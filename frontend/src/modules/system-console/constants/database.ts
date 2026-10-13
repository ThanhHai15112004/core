import type { Tone } from '@core/theme';
import type { ChartColor } from '@core/ui/charts';
import type { DbAlert, DbErrorRecord, DbEvent, DbHealthStatus, DbMetric, DbRange, DbSession, DbTab, MonitoringCapability } from '../types/database.types';
import type { TabAlias } from '../shell/useSectionRoute';

/** Tab của trang Database (tối đa 4). */
export const DB_TABS = ['overview', 'queries', 'tables', 'activity'] as const;
export type DbPageTab = (typeof DB_TABS)[number];

/** Segment trong tab Queries & Sessions (`?view=`) — mặc định là phần tử đầu. */
export const DB_QUERY_VIEWS = ['queries', 'connections', 'transactions'] as const;
export type DbQueryView = (typeof DB_QUERY_VIEWS)[number];

/** Segment trong tab Tables (`?view=`). */
export const DB_TABLE_VIEWS = ['tables', 'migrations'] as const;
export type DbTableView = (typeof DB_TABLE_VIEWS)[number];

/** Khoảng thời gian API database hỗ trợ. */
export const DB_RANGES = ['15m', '1h', '6h', '24h'] as const satisfies readonly DbRange[];

export const DB_METRICS: DbMetric[] = ['queries', 'latency', 'connections', 'errors'];

/** Mốc lọc query chậm (ms). */
export const SLOW_THRESHOLDS = [0, 250, 500, 1000, 3000] as const;

/** Bộ lọc trạng thái query đang chạy (`?state=`). */
export const LIVE_STATE_FILTERS = ['all', 'running', 'slow', 'blocked'] as const;
export type LiveStateFilter = (typeof LIVE_STATE_FILTERS)[number];

/** Loại lỗi query (thứ tự hiển thị). */
export const ERROR_KINDS: DbErrorRecord['kind'][] = ['query', 'timeout', 'connection', 'deadlock', 'lock_timeout', 'cancelled'];

/** Segment cần capability nào (driver không hỗ trợ → nói rõ). */
export const VIEW_CAPABILITY: Partial<Record<DbQueryView | DbTableView, MonitoringCapability>> = {
  connections: 'sessions',
  transactions: 'transactions',
  tables: 'tables',
};

/** Đích của tab cũ (`database/<tab>`) và của `tab` trong cảnh báo / sự kiện do backend trả về. */
export const LEGACY_TAB_TARGET: Record<DbTab, TabAlias<DbPageTab>> = {
  overview: { tab: 'overview' },
  queries: { tab: 'queries' },
  connections: { tab: 'queries', query: { view: 'connections' } },
  transactions: { tab: 'queries', query: { view: 'transactions' } },
  tables: { tab: 'tables' },
  migrations: { tab: 'tables', query: { view: 'migrations' } },
  errors: { tab: 'activity' },
  configuration: { tab: 'overview', query: { settings: '1' } },
};

/** Alias link cũ cho `useSectionRoute` (tab mới trùng tên không cần alias). */
export const DB_TAB_ALIASES: Partial<Record<string, TabAlias<DbPageTab>>> = {
  connections: LEGACY_TAB_TARGET.connections,
  transactions: LEGACY_TAB_TARGET.transactions,
  migrations: LEGACY_TAB_TARGET.migrations,
  errors: LEGACY_TAB_TARGET.errors,
  configuration: LEGACY_TAB_TARGET.configuration,
};

export const HEALTH_TONE: Record<DbHealthStatus, Tone> = {
  healthy: 'ok',
  degraded: 'warn',
  reconnecting: 'warn',
  unavailable: 'crit',
  unknown: 'unknown',
  disabled: 'unknown',
};

export const SESSION_TONE: Record<DbSession['state'], Tone> = {
  active: 'ok',
  blocked: 'crit',
  idle_in_transaction: 'warn',
  idle: 'unknown',
  other: 'unknown',
};

export const ALERT_TONE: Record<DbAlert['severity'], Tone> = { warning: 'warn', critical: 'crit' };

export const EVENT_TONE: Record<DbEvent['severity'], Tone> = { info: 'info', warning: 'warn', critical: 'crit', success: 'ok' };

/** Màu series biểu đồ theo id backend; id lạ → màu theo thứ tự. */
export const DB_SERIES_COLOR: Record<string, ChartColor> = {
  queriesPerSec: 'series-1',
  avgMs: 'series-2',
  poolUsed: 'series-1',
  sessions: 'series-4',
  poolWaiting: 'crit',
  failedPerMin: 'crit',
};

/** Chuỗi phải gõ để xác nhận (backend kiểm tra lại). */
export const DB_CONFIRM = { terminate: 'TERMINATE', migrate: 'MIGRATE' } as const;

/** Ngưỡng tô màu thanh mức dùng (%). */
export const POOL_USAGE_THRESHOLDS = { warn: 70, crit: 85 } as const;
export const STORAGE_USAGE_THRESHOLDS = { warn: 80, crit: 90 } as const;

/** Chiều cao vùng cuộn của bảng / danh sách (px). */
export const DB_TABLE_MAX_HEIGHT_PX = 560;
export const DB_PREVIEW_MAX_HEIGHT_PX = 320;
export const DB_FEED_MAX_HEIGHT_PX = 640;
export const DB_SQL_MAX_HEIGHT_PX = 280;

/** Số dòng xem trước trên trang Tổng quan. */
export const DB_OVERVIEW_EVENTS = 8;

/** Độ dài SQL xem trước trong dòng hoạt động (ký tự). */
export const SQL_PREVIEW_CHARS = 160;

/** Thụt lề mỗi cấp của execution plan / chuỗi chặn (px). */
export const PLAN_INDENT_PX = 18;

/** Module log của TypeORM — mở log liên quan tới query. */
export const DB_LOG_MODULE = 'TypeORM';
