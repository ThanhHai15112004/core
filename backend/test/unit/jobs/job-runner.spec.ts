import { describe, it, expect } from '@jest/globals';
import { UnrecoverableError, type Job } from 'bullmq';
import { RequestContextService } from '@packages/logging/index.js';
import { JobError, MessageConsumerRunner, serializeMessage } from '@packages/messaging/index.js';

function fakeJob(attempts = 3): Job & { logs: string[] } {
  const logs: string[] = [];
  return {
    id: 'job-1',
    name: 'report.generate',
    queueName: 'system.events',
    data: serializeMessage('report.generate', { a: 1 }, { correlationId: 'corr-1' }),
    opts: { attempts },
    timestamp: Date.now() - 100,
    processedOn: Date.now(),
    attemptsMade: 0,
    attemptsStarted: 1,
    logs,
    log: async (row: string) => logs.push(row),
  } as unknown as Job & { logs: string[] };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('MessageConsumerRunner — jobs', () => {
  const context = new RequestContextService();

  it('handler chạy trong context có jobId + nguồn = job (job con biết cha)', async () => {
    const runner = new MessageConsumerRunner(context);
    let seen: unknown = null;
    await runner.process('P', fakeJob(), async () => {
      seen = RequestContextService.current();
    });
    expect(seen).toMatchObject({
      correlationId: 'corr-1',
      jobId: 'job-1',
      source: { kind: 'job', id: 'job-1', name: 'report.generate', detail: 'system.events' },
    });
  });

  it('lỗi không retry được (JobError retryable=false) → UnrecoverableError, vòng đời ghi loại lỗi', async () => {
    const runner = new MessageConsumerRunner(context);
    const job = fakeJob();
    const err = await runner
      .process('P', job, async () => {
        throw new JobError('ValidationError', 'bad report id', { retryable: false });
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as Error).message).toBe('ValidationError: bad report id');
    await flush();
    const failed = job.logs.map((l) => JSON.parse(l)).find((l) => l.type === 'failed');
    expect(failed).toMatchObject({ errorType: 'ValidationError', retryable: false, attempt: 1 });
    expect(job.logs.map((l) => JSON.parse(l).type)).toContain('dead_lettered');
  });

  it('lỗi retry được giữ nguyên lỗi gốc (BullMQ retry theo backoff)', async () => {
    const runner = new MessageConsumerRunner(context);
    const original = new Error('storage timed out');
    const err = await runner
      .process('P', fakeJob(), async () => Promise.reject(original))
      .catch((e: unknown) => e);
    expect(err).toBe(original);
  });

  it('bị huỷ hợp tác (signal aborted) → UnrecoverableError JobCancelled, không retry', async () => {
    const runner = new MessageConsumerRunner(context);
    const job = fakeJob();
    const ac = new AbortController();
    const err = await runner
      .process(
        'P',
        job,
        async (_env, _job, signal) => {
          ac.abort('stop by operator');
          signal?.throwIfAborted();
        },
        ac.signal,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as Error).message).toBe('JobCancelled: stop by operator');
    await flush();
    expect(job.logs.map((l) => JSON.parse(l).type)).toContain('cancelled');
  });

  it('lệnh huỷ chỉ gửi tới consumer của đúng queue và báo đã nhận khi job đang ở instance này', async () => {
    const runner = new MessageConsumerRunner(context);
    const asked: string[] = [];
    runner.register({
      consumer: 'P',
      queue: 'system.events',
      concurrency: 1,
      idempotent: true,
      cancellable: true,
      cancel: (id) => {
        asked.push(id);
        return id === 'job-1';
      },
    });
    const cmd = {
      id: 'c1',
      action: 'cancel' as const,
      queue: 'system.events',
      jobId: 'job-1',
      reason: 'x',
      requestedAt: 0,
    };
    expect(await runner.handleCommand(cmd)).toBe(true);
    expect(await runner.handleCommand({ ...cmd, jobId: 'other' })).toBe(false);
    expect(await runner.handleCommand({ ...cmd, queue: 'system.notifications' })).toBe(false);
    expect(asked).toEqual(['job-1', 'other']);
    expect(runner.registrationsOf()[0]).toMatchObject({ cancellable: true });
    await runner.onApplicationShutdown();
  });
});
