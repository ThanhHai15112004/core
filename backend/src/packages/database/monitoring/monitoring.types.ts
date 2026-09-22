/** Các nhóm số liệu mà provider của driver hiện tại hỗ trợ — UI chỉ hiện phần được hỗ trợ. */
export type MonitoringCapability =
  | 'serverInfo'
  | 'sessions'
  | 'digestStats'
  | 'explain'
  | 'transactions'
  | 'locks'
  | 'tables'
  | 'indexUsage'
  | 'tableIo'
  | 'storage'
  | 'cancel'
  | 'terminate';

/** Chạy SQL trên CÙNG một connection (để các câu trong một lần đọc nhất quán). */
export type SqlRunner = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

export interface MonitoringContext {
  run: SqlRunner;
  /** Tên database của app — mọi truy vấn chỉ nhìn phạm vi này. */
  database: string;
  /** User DB của app — session/KILL chỉ trong phạm vi user này. */
  user: string;
}

export interface DbServerInfo {
  product: string;
  version: string;
  uptimeSec: number | null;
  maxConnections: number | null;
}

export type SessionState = 'active' | 'idle' | 'idle_in_transaction' | 'blocked' | 'other';

export interface DbSession {
  id: string;
  user: string | null;
  /** Host client (đã bỏ port). */
  client: string | null;
  /** `program_name` / `application_name`, vd. `core-worker`. */
  program: string | null;
  /** Runtime suy ra từ program (`api`, `worker`…); `null` = client ngoài Core. */
  runtime: string | null;
  database: string | null;
  state: SessionState;
  command: string | null;
  /** Thời gian đã kết nối; `null` khi driver không cung cấp. */
  connectedSec: number | null;
  /** Thời gian chạy của query hiện tại / thời gian ở trạng thái hiện tại. */
  queryMs: number | null;
  /** SQL hiện tại đã chuẩn hoá (bỏ literal). */
  query: string | null;
  transactionSec: number | null;
  /** Session đang chặn session này. */
  blockedBy: string[];
  /** Connection đang dùng để đọc số liệu (không cho kill). */
  isSelf: boolean;
}

export interface DbDigestStat {
  id: string;
  /** SQL đã chuẩn hoá bởi database (không có literal). */
  sql: string;
  calls: number;
  /** `null` khi bộ đếm thời gian của database không đáng tin (xem `timingReliable`). */
  totalMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
  /** `false` khi bộ đếm timer của database bị tràn (vd. MySQL trên VM có đồng hồ lệch) — không hiện số sai. */
  timingReliable: boolean;
  rowsExamined: number | null;
  rowsReturned: number | null;
  errors: number;
  /** Số lần chạy không dùng index (full scan). */
  noIndexUsed: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Có thể xem execution plan (câu SELECT/WITH, có mẫu đầy đủ). */
  explainable: boolean;
}

export interface DbTransaction {
  id: string;
  sessionId: string | null;
  runtime: string | null;
  state: string;
  ageSec: number;
  isolation: string | null;
  /** Số lock đang giữ. */
  locksHeld: number | null;
  query: string | null;
}

export interface DbLockWait {
  waitingSession: string;
  waitingQuery: string | null;
  waitingRuntime: string | null;
  blockingSession: string;
  blockingQuery: string | null;
  blockingRuntime: string | null;
  object: string | null;
  lockMode: string | null;
  waitMs: number | null;
}

export interface DbTable {
  name: string;
  /** Ước lượng của database (có thể lệch với COUNT(*)). */
  rows: number | null;
  dataBytes: number | null;
  indexBytes: number | null;
  totalBytes: number | null;
  engine: string | null;
  /** Số lần đọc/ghi cộng dồn kể từ khi database khởi động. */
  reads: number | null;
  writes: number | null;
}

export interface DbIndex {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  /** Số lần index được dùng kể từ khi database khởi động; `null` = không có số liệu. */
  scans: number | null;
  sizeBytes: number | null;
}

export interface DbTableDetail extends DbTable {
  columns: { name: string; type: string; nullable: boolean }[];
  indexes: DbIndex[];
}

export interface DbStorage {
  totalBytes: number | null;
  dataBytes: number | null;
  indexBytes: number | null;
  tables: number;
}

export type ExplainFlag = 'full_scan' | 'high_rows' | 'filesort' | 'temporary' | 'no_index';

export interface ExplainStep {
  depth: number;
  operation: string;
  table: string | null;
  accessType: string | null;
  key: string | null;
  possibleKeys: string[];
  rows: number | null;
  filteredPercent: number | null;
  cost: number | null;
  condition: string | null;
  flags: ExplainFlag[];
}

export interface ExplainResult {
  steps: ExplainStep[];
  totalCost: number | null;
}

/** Provider theo driver — mỗi hàm chỉ gọi khi có capability tương ứng. */
export interface DatabaseMonitoringProvider {
  readonly driver: string;
  readonly capabilities: ReadonlySet<MonitoringCapability>;
  /** Chuẩn bị session đọc số liệu (vd. tắt cache thống kê); tuỳ chọn. */
  prepare?(ctx: MonitoringContext): Promise<void>;
  serverInfo(ctx: MonitoringContext): Promise<DbServerInfo>;
  sessions(ctx: MonitoringContext): Promise<DbSession[]>;
  digestStats(ctx: MonitoringContext, limit: number): Promise<DbDigestStat[]>;
  explain(ctx: MonitoringContext, digestId: string): Promise<ExplainResult | null>;
  transactions(ctx: MonitoringContext): Promise<DbTransaction[]>;
  lockWaits(ctx: MonitoringContext): Promise<DbLockWait[]>;
  tables(ctx: MonitoringContext): Promise<DbTable[]>;
  tableDetail(ctx: MonitoringContext, name: string): Promise<DbTableDetail | null>;
  storage(ctx: MonitoringContext): Promise<DbStorage>;
  cancel(ctx: MonitoringContext, sessionId: string): Promise<void>;
  terminate(ctx: MonitoringContext, sessionId: string): Promise<void>;
}

/** `core-worker` → `worker`; client ngoài Core → `null`. */
export function runtimeOfProgram(program: string | null | undefined): string | null {
  const match = /^core-([a-z0-9-]+)$/i.exec(program ?? '');
  return match ? match[1]!.toLowerCase() : null;
}

export const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
