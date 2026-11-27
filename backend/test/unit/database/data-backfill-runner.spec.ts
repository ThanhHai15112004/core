import { describe, it, expect, beforeEach } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import {
  DataBackfillRunnerService,
  type DataBackfillContract,
  type DatabaseConnectionService,
  type TransactionManager,
} from '@packages/database/index.js';

describe('DataBackfillRunnerService', () => {
  let runner: DataBackfillRunnerService;

  beforeEach(() => {
    const fakeConn = {
      connected: () => ({ manager: {} as EntityManager }),
      getStatus: () => ({ state: 'connected' }),
    } as unknown as DatabaseConnectionService;

    const fakeTx = {
      runInTransaction: async <T>(fn: (m: EntityManager) => Promise<T>) => fn({} as EntityManager),
    } as unknown as TransactionManager;

    runner = new DataBackfillRunnerService(fakeConn, fakeTx);
  });

  it('processes batches with cursor checkpointing and reports progress', async () => {
    const progressPercents: number[] = [];
    const script: DataBackfillContract = {
      name: 'users-slug-backfill',
      description: 'Populate user slug in batches',
      defaultBatchSize: 2,
      defaultThrottleMs: 0,
      estimateTotal: async () => 5,
      processBatch: async (_m, ctx) => {
        const start = Number(ctx.cursor ?? '0');
        const remaining = Math.max(0, 5 - start);
        const count = Math.min(ctx.batchSize, remaining);
        const next = start + count;
        return {
          processedCount: count,
          updatedCount: count,
          nextCursor: next >= 5 ? null : String(next),
          done: next >= 5,
        };
      },
    };
    runner.register(script);

    const res = await runner.run('users-slug-backfill', {
      onProgress: (snap) => {
        progressPercents.push(snap.percent);
      },
    });

    expect(res.status).toBe('COMPLETED');
    expect(res.processedRows).toBe(5);
    expect(res.updatedRows).toBe(5);
    expect(res.batchesExecuted).toBe(3);
    expect(res.percent).toBe(100);
    expect(progressPercents).toEqual([40, 80, 100]);
  });

  it('supports dry-run mode and cooperative cancellation', async () => {
    const script: DataBackfillContract = {
      name: 'cancelable-backfill',
      description: 'Test cancel & dryRun',
      defaultBatchSize: 10,
      defaultThrottleMs: 0,
      estimateTotal: async () => 100,
      processBatch: async (_m, ctx) => ({
        processedCount: 10,
        updatedCount: ctx.dryRun ? 0 : 10,
        nextCursor: '10',
        done: false,
      }),
    };
    runner.register(script);

    let batchCalls = 0;
    const cancelledRes = await runner.run('cancelable-backfill', {
      shouldCancel: () => batchCalls++ >= 1,
    });
    expect(cancelledRes.status).toBe('CANCELLED');
    expect(cancelledRes.batchesExecuted).toBe(1);

    const dryRes = await runner.run('cancelable-backfill', {
      dryRun: true,
      maxBatches: 1,
    });
    expect(dryRes.status).toBe('DRY_RUN_COMPLETED');
    expect(dryRes.updatedRows).toBe(0);
  });
});
