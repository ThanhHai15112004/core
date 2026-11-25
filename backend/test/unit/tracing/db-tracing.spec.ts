import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { DataSource, QueryRunner } from 'typeorm';
import {
  extractSqlOperation,
  instrumentDataSourceTracing,
  runWithoutDbTracing,
} from '@packages/database/utils/db-tracing.helper.js';
import { SpanBufferProcessor } from '@packages/tracing/processors/span-buffer.processor.js';

describe('Database Query Tracing Unit Tests', () => {
  let buffer: SpanBufferProcessor;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    buffer = new SpanBufferProcessor({
      maxSize: 100,
      runtime: 'api',
      serviceName: 'core-test',
    });
    provider = new NodeTracerProvider({ spanProcessors: [buffer] });
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    trace.disable();
  });

  it('creates DB span with normalized SQL and never records sensitive parameters', async () => {
    const fakeRunner = {
      query: async (_sql: string, _params?: unknown[]) => [{ id: 1 }],
    } as unknown as QueryRunner;
    const fakeDs = {
      createQueryRunner: () => fakeRunner,
      query: async (sql: string, params?: unknown[]) => fakeRunner.query(sql, params),
    } as unknown as DataSource;

    instrumentDataSourceTracing(fakeDs, 'mysql', 'core_db');

    await fakeDs.query(
      "SELECT id, email FROM users WHERE email = 'secret@example.com' AND pin = 9999 AND token = ?",
      ['super-secret-password-value', 'tok_123'],
    );

    const traces = await buffer.getRecentTraces(10);
    expect(traces).toHaveLength(1);
    const spans = await buffer.getSpansByTraceId(traces[0]!.traceId);
    // DataSource.query gọi runner.query -> không tạo 2 span trùng lặp
    expect(spans).toHaveLength(1);

    const span = spans[0]!;
    expect(span.name).toBe('db.select');
    expect(span.category).toBe('db');
    expect(span.kind).toBe('client');
    expect(span.status).toBe('ok');
    expect(span.attributes['db.system']).toBe('mysql');
    expect(span.attributes['db.operation.name']).toBe('SELECT');
    expect(span.attributes['db.namespace']).toBe('core_db');
    expect(span.attributes['db.statement']).toBe(
      'SELECT id, email FROM users WHERE email = ? AND pin = ? AND token = ?',
    );

    const serialized = JSON.stringify(span);
    expect(serialized).not.toContain('secret@example.com');
    expect(serialized).not.toContain('9999');
    expect(serialized).not.toContain('super-secret-password-value');
    expect(serialized).not.toContain('tok_123');
  });

  it('suppresses tracing for internal ping queries and marks failed queries as error', async () => {
    const fakeRunner = {
      query: async (sql: string) => {
        if (sql.includes('BROKEN')) {
          throw new Error('Syntax error near password=123');
        }
        return [{ ok: 1 }];
      },
    } as unknown as QueryRunner;
    const fakeDs = {
      createQueryRunner: () => fakeRunner,
      query: async (sql: string) => fakeRunner.query(sql),
    } as unknown as DataSource;

    instrumentDataSourceTracing(fakeDs, 'postgres', 'app_db');

    await runWithoutDbTracing(() => fakeDs.query('SELECT 1'));
    expect(buffer.bufferedCount).toBe(0);

    await expect(fakeDs.query('UPDATE BROKEN SET x = 1')).rejects.toThrow();
    const traces = await buffer.getRecentTraces(10);
    expect(traces).toHaveLength(1);
    expect(traces[0]!.status).toBe('error');
    expect(extractSqlOperation('/* comment */ insert into users values (1)')).toBe('INSERT');
  });
});
