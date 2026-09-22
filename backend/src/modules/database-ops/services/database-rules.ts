import type { DatabaseConfig, RuleLevel } from '@packages/config/index.js';
import type { ConnectionState } from '@packages/database/index.js';
import type { DbSeverity } from '../responses/database-ops.response.js';

export type DbRule =
  | 'DB_UNAVAILABLE'
  | 'POOL_PRESSURE'
  | 'POOL_WAITING'
  | 'QUERY_LATENCY'
  | 'ERROR_RATE'
  | 'SLOW_QUERIES'
  | 'LONG_TRANSACTION'
  | 'LOCK_WAITS'
  | 'STORAGE';

/** Tab của trang Database để xử lý từng loại cảnh báo. */
export const RULE_TAB: Record<DbRule, string> = {
  DB_UNAVAILABLE: 'overview',
  POOL_PRESSURE: 'connections',
  POOL_WAITING: 'connections',
  QUERY_LATENCY: 'queries',
  ERROR_RATE: 'errors',
  SLOW_QUERIES: 'queries',
  LONG_TRANSACTION: 'transactions',
  LOCK_WAITS: 'transactions',
  STORAGE: 'tables',
};

export interface DbRuleInput {
  connection: ConnectionState;
  pool: { used: number | null; limit: number; waiting: number | null };
  queries: number;
  p95Ms: number | null;
  errorRatePercent: number | null;
  slowQueries15m: number;
  longestTransactionSec: number | null;
  lockWaits: { count: number; maxWaitMs: number } | null;
  storage: { bytes: number | null; limitBytes: number | null };
}

export interface DbRuleConfig {
  db: Pick<DatabaseConfig, 'slowQueryAlertCount' | 'longTransactionSec' | 'storageWarnPercent'>;
  dbP95Ms: RuleLevel;
  dbPoolPercent: RuleLevel;
  errorRatePercent: RuleLevel;
  minQueries: number;
}

export interface DbViolation {
  id: DbRule;
  severity: DbSeverity;
  value: number;
  threshold: number;
  unit: string;
}

/** Mức cảnh báo ≥ this lock wait (ms) thì nghiêm trọng. */
const LOCK_WAIT_CRIT_MS = 30_000;
/** Transaction dài gấp chừng này ngưỡng thì nghiêm trọng. */
const LONG_TX_CRIT_FACTOR = 6;

const level = (value: number | null, l: RuleLevel): DbSeverity | null =>
  value === null ? null : value >= l.crit ? 'critical' : value >= l.warn ? 'warning' : null;

/** Rule cảnh báo database theo ngưỡng cấu hình. Không đủ mẫu → không kết luận. */
export function evaluateDbRules(input: DbRuleInput, cfg: DbRuleConfig): DbViolation[] {
  const out: DbViolation[] = [];
  const add = (
    id: DbRule,
    severity: DbSeverity | null,
    value: number | null,
    threshold: number,
    unit: string,
  ) => {
    if (severity && value !== null)
      out.push({ id, severity, value: Number(value.toFixed(2)), threshold, unit });
  };

  if (input.connection === 'unavailable' || input.connection === 'reconnecting') {
    out.push({ id: 'DB_UNAVAILABLE', severity: 'critical', value: 0, threshold: 0, unit: '' });
    return out;
  }

  const poolPercent =
    input.pool.used !== null && input.pool.limit > 0
      ? (input.pool.used / input.pool.limit) * 100
      : null;
  const poolSeverity = level(poolPercent, cfg.dbPoolPercent);
  add(
    'POOL_PRESSURE',
    poolSeverity,
    poolPercent,
    poolSeverity === 'critical' ? cfg.dbPoolPercent.crit : cfg.dbPoolPercent.warn,
    '%',
  );
  if ((input.pool.waiting ?? 0) > 0) add('POOL_WAITING', 'warning', input.pool.waiting, 0, '');

  if (input.queries >= cfg.minQueries) {
    const s = level(input.p95Ms, cfg.dbP95Ms);
    add(
      'QUERY_LATENCY',
      s,
      input.p95Ms,
      s === 'critical' ? cfg.dbP95Ms.crit : cfg.dbP95Ms.warn,
      'ms',
    );
    const e = level(input.errorRatePercent, cfg.errorRatePercent);
    add(
      'ERROR_RATE',
      e,
      input.errorRatePercent,
      e === 'critical' ? cfg.errorRatePercent.crit : cfg.errorRatePercent.warn,
      '%',
    );
  }

  if (input.slowQueries15m >= cfg.db.slowQueryAlertCount)
    add('SLOW_QUERIES', 'warning', input.slowQueries15m, cfg.db.slowQueryAlertCount, '');

  const tx = input.longestTransactionSec;
  if (tx !== null && tx >= cfg.db.longTransactionSec) {
    const crit = tx >= cfg.db.longTransactionSec * LONG_TX_CRIT_FACTOR;
    add(
      'LONG_TRANSACTION',
      crit ? 'critical' : 'warning',
      tx,
      crit ? cfg.db.longTransactionSec * LONG_TX_CRIT_FACTOR : cfg.db.longTransactionSec,
      's',
    );
  }

  if (input.lockWaits && input.lockWaits.count > 0)
    add(
      'LOCK_WAITS',
      input.lockWaits.maxWaitMs >= LOCK_WAIT_CRIT_MS ? 'critical' : 'warning',
      input.lockWaits.count,
      0,
      '',
    );

  const { bytes, limitBytes } = input.storage;
  if (bytes !== null && limitBytes) {
    const percent = (bytes / limitBytes) * 100;
    if (percent >= 95) add('STORAGE', 'critical', percent, 95, '%');
    else if (percent >= cfg.db.storageWarnPercent)
      add('STORAGE', 'warning', percent, cfg.db.storageWarnPercent, '%');
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
}

export interface StoredAlert {
  since: number;
  severity: DbSeverity;
  value: number;
  threshold: number;
  unit: string;
}

/** So với cảnh báo đang lưu → bắt đầu / hồi phục; mọi cảnh báo đang có được ghi lại với giá trị mới nhất. */
export function diffAlerts(
  violations: readonly DbViolation[],
  active: ReadonlyMap<string, { since: number }>,
  now: number,
) {
  const started = violations.filter((v) => !active.has(v.id));
  const set = new Map<string, StoredAlert>(
    violations.map((v) => [
      v.id,
      {
        since: active.get(v.id)?.since ?? now,
        severity: v.severity,
        value: v.value,
        threshold: v.threshold,
        unit: v.unit,
      },
    ]),
  );
  const recovered = [...active.entries()]
    .filter(([id]) => !violations.some((v) => v.id === id))
    .map(([id, s]) => ({ id: id as DbRule, durationMs: now - s.since }));
  return { started, set, recovered };
}
