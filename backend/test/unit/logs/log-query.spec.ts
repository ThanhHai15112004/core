import { describe, it, expect, jest } from '@jest/globals';
import {
  EMPTY_LOG_FILTER,
  LogsOpsService,
  LogsStoreService,
  decodeLogCursor,
  encodeLogCursor,
  looksLikeId,
  matchesLog,
  normalizeStoredEntry,
  olderThan,
  newerThan,
  parseLogQuery,
  type LogAuditService,
} from '@modules/logs-ops/index.js';
import type { CoreConfigService } from '@packages/config/index.js';
import { LogStreamReader, type LogEntry } from '@packages/logging/index.js';
import type { RedisService } from '@packages/redis/index.js';

const e = (over: Partial<LogEntry>): LogEntry => ({
  id: 'a-1',
  t: '2026-09-30T14:21:42.218Z',
  level: 'info',
  message: 'GET /reports 200 182ms',
  runtime: 'api',
  ...over,
});

describe('log query', () => {
  it('cú pháp key:value + cụm từ + từ khoá', () => {
    const f = parseLogQuery('level:error source:worker jobId:82920 "Storage timeout" upload');
    expect(f.levels).toEqual(['error']);
    expect(f.runtimes).toEqual(['worker']);
    expect(f.ids).toEqual({ jobId: '82920' });
    expect(f.terms).toEqual(['storage timeout', 'upload']);
  });

  it('dán một ID → tìm theo mọi field ID', () => {
    expect(parseLogQuery('0a1b2c3d-1111-2222-3333-444455556666').anyId).toBe(
      '0a1b2c3d-1111-2222-3333-444455556666',
    );
    expect(parseLogQuery('req_821').anyId).toBe('req_821');
    expect(parseLogQuery('timeout').anyId).toBeNull();
    expect(looksLikeId('hello')).toBe(false);
  });

  it('status chính xác / theo nhóm, endpoint, loại lỗi', () => {
    const f = parseLogQuery('status:5xx endpoint:/reports');
    const row = e({ metadata: { status: 503, path: '/api/v1/reports' } });
    expect(matchesLog(row, f)).toBe(true);
    expect(matchesLog(e({ metadata: { status: 404, path: '/api/v1/reports' } }), f)).toBe(false);
    expect(
      matchesLog(
        e({ errorType: 'StorageTimeoutError' }),
        parseLogQuery('errorType:storagetimeouterror'),
      ),
    ).toBe(true);
  });

  it('anyId khớp correlation / job / request / message', () => {
    const f = { ...EMPTY_LOG_FILTER, anyId: 'corr-7' };
    expect(matchesLog(e({ correlationId: 'corr-7' }), f)).toBe(true);
    expect(matchesLog(e({ jobId: 'corr-7' }), f)).toBe(true);
    expect(matchesLog(e({}), f)).toBe(false);
  });

  it('cursor mới nhất trước: older / newer theo (thời gian, id)', () => {
    const a = e({ id: 'b', t: '2026-09-30T14:00:00.000Z' });
    const c = decodeLogCursor(encodeLogCursor(a))!;
    expect(olderThan(e({ id: 'a', t: a.t }), c)).toBe(true);
    expect(newerThan(e({ id: 'c', t: a.t }), c)).toBe(true);
    expect(olderThan(e({ id: 'z', t: '2026-09-30T13:59:59.000Z' }), c)).toBe(true);
    expect(decodeLogCursor('garbage')).toBeNull();
  });

  it('log cũ (trước structured log): ID ổn định, tách stack khỏi message', () => {
    const legacy = {
      t: '2026-09-30T14:00:00.000Z',
      level: 'error',
      message: 'boom\n    at X (/a.ts:1:1)',
    } as LogEntry;
    const n1 = normalizeStoredEntry(legacy, 'worker');
    const n2 = normalizeStoredEntry(legacy, 'worker');
    expect(n1.id).toBe(n2.id);
    expect(n1.message).toBe('boom');
    expect(n1.stack).toContain('at X');
    expect(n1.runtime).toBe('worker');
  });

  it('LogStreamReader.recentAfter bỏ qua bản ghi afterId và báo contiguous chuẩn xác', async () => {
    const xrevrange = jest.fn<(...args: unknown[]) => Promise<[string, string[]][]>>();
    const redis = {
      isReady: () => true,
      key: (k: string) => k,
      client: { xrevrange },
    } as unknown as RedisService;
    const config = { app: { env: 'test' } } as unknown as CoreConfigService;
    const reader = new LogStreamReader(redis, config);

    // Khi không có log mới: Redis chỉ trả đúng bản ghi afterId
    xrevrange.mockResolvedValueOnce([
      ['1700000000000-0', ['d', JSON.stringify({ time: 1700000000000, level: 30, msg: 'old' })]],
    ]);
    const idleDelta = await reader.recentAfter('1700000000000-0', 100);
    expect(idleDelta.contiguous).toBe(true);
    expect(idleDelta.entries).toHaveLength(0);

    // Khi có 1 log mới: trả log mới và báo contiguous = true
    xrevrange.mockResolvedValueOnce([
      ['1700000001000-0', ['d', JSON.stringify({ time: 1700000001000, level: 30, msg: 'new' })]],
      ['1700000000000-0', ['d', JSON.stringify({ time: 1700000000000, level: 30, msg: 'old' })]],
    ]);
    const activeDelta = await reader.recentAfter('1700000000000-0', 100);
    expect(activeDelta.contiguous).toBe(true);
    expect(activeDelta.entries).toHaveLength(1);
    expect(activeDelta.entries[0]?.id).toBe('1700000001000-0');
  });

  it('LogsStoreService cập nhật snapshot tăng dần và LogsOpsService.tail dừng sớm theo cursor', async () => {
    const firstBatch = [
      e({ id: '1700000002000-0', t: '2026-09-30T14:00:02.000Z', message: 'second' }),
      e({ id: '1700000001000-0', t: '2026-09-30T14:00:01.000Z', message: 'first' }),
    ];
    const recent = jest.fn<() => Promise<LogEntry[]>>().mockResolvedValue(firstBatch);
    const recentAfter = jest
      .fn<() => Promise<{ entries: LogEntry[]; contiguous: boolean }>>()
      .mockResolvedValueOnce({ entries: [], contiguous: true })
      .mockResolvedValueOnce({
        entries: [e({ id: '1700000003000-0', t: '2026-09-30T14:00:03.000Z', message: 'third' })],
        contiguous: true,
      });

    const redis = { isReady: () => true, key: (k: string) => k } as unknown as RedisService;
    const stream = { isAvailable: () => true, recent, recentAfter } as unknown as LogStreamReader;
    const store = new LogsStoreService(redis, stream);

    const snap1 = await store.logs();
    expect(snap1.entries).toHaveLength(2);
    expect(recent).toHaveBeenCalledTimes(1);

    // Giả lập hết hạn TTL để kiểm tra đọc tăng dần qua recentAfter
    (store as unknown as { snapshot: { at: number } }).snapshot.at = 0;
    const snap2 = await store.logs();
    expect(recent).toHaveBeenCalledTimes(1);
    expect(recentAfter).toHaveBeenCalledTimes(1);
    expect(snap2.entries).toHaveLength(2);

    (store as unknown as { snapshot: { at: number } }).snapshot.at = 0;
    const snap3 = await store.logs();
    expect(recent).toHaveBeenCalledTimes(1);
    expect(recentAfter).toHaveBeenCalledTimes(2);
    expect(snap3.entries).toHaveLength(3);
    expect(snap3.entries[0]?.id).toBe('1700000003000-0');

    // Kiểm tra LogsOpsService.tail với cursor
    const ops = new LogsOpsService(
      {} as unknown as CoreConfigService,
      store,
      {} as unknown as LogAuditService,
    );
    const cursorAfterSecond = encodeLogCursor(firstBatch[0]!);
    const tailRes = await ops.tail(EMPTY_LOG_FILTER, cursorAfterSecond, 50);
    expect(tailRes.items).toHaveLength(1);
    expect(tailRes.items[0]?.id).toBe('1700000003000-0');

    // Gọi lại với latestCursor mới nhất → không còn bản ghi mới
    const emptyTail = await ops.tail(EMPTY_LOG_FILTER, tailRes.latestCursor, 50);
    expect(emptyTail.items).toHaveLength(0);
    expect(emptyTail.latestCursor).toBe(tailRes.latestCursor);
  });
});
