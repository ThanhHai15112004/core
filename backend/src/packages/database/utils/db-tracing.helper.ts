import { AsyncLocalStorage } from 'node:async_hooks';
import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { DataSource, QueryRunner } from 'typeorm';
import { sanitizeDbMessage } from './error-classify.js';
import { normalizeSql } from './sql-normalize.js';

const TRACED_DATA_SOURCES = new WeakSet<object>();
const TRACED_RUNNERS = new WeakSet<object>();
const DB_TRACING_SUPPRESSED = new AsyncLocalStorage<boolean>();
const DB_IN_QUERY_SPAN = new AsyncLocalStorage<boolean>();

/** Bỏ qua tạo DB span cho truy vấn nội bộ (vd. health ping `SELECT 1`). */
export function runWithoutDbTracing<T>(fn: () => T): T {
  return DB_TRACING_SUPPRESSED.run(true, fn);
}

/** Tách loại câu lệnh SQL (`SELECT`, `INSERT`, `UPDATE`, `DELETE`...) mà không đọc parameter. */
export function extractSqlOperation(sql: string): string {
  const cleaned = sql.replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*|--[^\n]*\n\s*)*/, '').trim();
  const first = cleaned.split(/\s+/, 1)[0]?.toUpperCase() ?? '';
  return first && /^[A-Z_]+$/.test(first) ? first : 'QUERY';
}

function wrapQueryMethod<TArgs extends unknown[], TResult>(
  originalQuery: (...args: TArgs) => Promise<TResult>,
  thisArg: unknown,
  dbSystem: string,
  dbName?: string,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    if (DB_TRACING_SUPPRESSED.getStore() || DB_IN_QUERY_SPAN.getStore()) {
      return originalQuery.apply(thisArg, args);
    }

    const rawSql = typeof args[0] === 'string' ? args[0] : '';
    const operation = rawSql ? extractSqlOperation(rawSql) : 'QUERY';
    const statement = rawSql ? normalizeSql(rawSql) : '';
    const tracer = trace.getTracer('core-framework');

    return tracer.startActiveSpan(
      `db.${operation.toLowerCase()}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'core.span.category': 'db',
          'db.system': dbSystem,
          'db.operation.name': operation,
          ...(dbName ? { 'db.namespace': dbName } : {}),
          ...(statement ? { 'db.statement': statement } : {}),
        },
      },
      context.active(),
      async (span) => {
        try {
          const result = await DB_IN_QUERY_SPAN.run(true, () => originalQuery.apply(thisArg, args));
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err) {
          const safeMsg = sanitizeDbMessage(err);
          span.recordException(err instanceof Error ? err : new Error(safeMsg));
          span.setStatus({ code: SpanStatusCode.ERROR, message: safeMsg });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  };
}

function instrumentQueryRunner(
  runner: QueryRunner,
  dbSystem: string,
  dbName?: string,
): QueryRunner {
  if (!runner || typeof runner !== 'object' || TRACED_RUNNERS.has(runner)) {
    return runner;
  }
  TRACED_RUNNERS.add(runner);
  if (typeof runner.query === 'function') {
    const originalRunnerQuery = runner.query.bind(runner) as (
      query: string,
      parameters?: unknown[],
      useStructuredResult?: boolean,
    ) => Promise<unknown>;
    runner.query = wrapQueryMethod(
      originalRunnerQuery,
      runner,
      dbSystem,
      dbName,
    ) as typeof runner.query;
  }
  return runner;
}

/**
 * Gắn OpenTelemetry DB span lên `DataSource` (qua `createQueryRunner` và `query` có chống lặp span).
 * Câu SQL luôn được chuẩn hóa qua `normalizeSql()` và tuyệt đối không ghi parameter nhạy cảm.
 */
export function instrumentDataSourceTracing(
  ds: DataSource,
  dbSystem: string,
  dbName?: string,
): void {
  if (!ds || typeof ds !== 'object' || TRACED_DATA_SOURCES.has(ds)) return;
  TRACED_DATA_SOURCES.add(ds);

  if (typeof ds.createQueryRunner === 'function') {
    const origCreateRunner = ds.createQueryRunner.bind(ds);
    ds.createQueryRunner = ((mode?: 'master' | 'slave') => {
      const runner = origCreateRunner(mode);
      return instrumentQueryRunner(runner, dbSystem, dbName);
    }) as typeof ds.createQueryRunner;
  }

  if (typeof ds.query === 'function') {
    const origDataSourceQuery = ds.query.bind(ds) as (
      query: string,
      parameters?: unknown[],
      queryRunner?: QueryRunner,
    ) => Promise<unknown>;
    ds.query = wrapQueryMethod(origDataSourceQuery, ds, dbSystem, dbName) as typeof ds.query;
  }
}
