import { describe, it, expect } from '@jest/globals';
import {
  EMPTY_LOG_FILTER,
  decodeLogCursor,
  encodeLogCursor,
  looksLikeId,
  matchesLog,
  normalizeStoredEntry,
  olderThan,
  newerThan,
  parseLogQuery,
} from '@modules/logs-ops/index.js';
import type { LogEntry } from '@packages/logging/index.js';

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
    expect(parseLogQuery('0a1b2c3d-1111-2222-3333-444455556666').anyId).toBe('0a1b2c3d-1111-2222-3333-444455556666');
    expect(parseLogQuery('req_821').anyId).toBe('req_821');
    expect(parseLogQuery('timeout').anyId).toBeNull();
    expect(looksLikeId('hello')).toBe(false);
  });

  it('status chính xác / theo nhóm, endpoint, loại lỗi', () => {
    const f = parseLogQuery('status:5xx endpoint:/reports');
    const row = e({ metadata: { status: 503, path: '/api/v1/reports' } });
    expect(matchesLog(row, f)).toBe(true);
    expect(matchesLog(e({ metadata: { status: 404, path: '/api/v1/reports' } }), f)).toBe(false);
    expect(matchesLog(e({ errorType: 'StorageTimeoutError' }), parseLogQuery('errorType:storagetimeouterror'))).toBe(true);
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
    const legacy = { t: '2026-09-30T14:00:00.000Z', level: 'error', message: 'boom\n    at X (/a.ts:1:1)' } as LogEntry;
    const n1 = normalizeStoredEntry(legacy, 'worker');
    const n2 = normalizeStoredEntry(legacy, 'worker');
    expect(n1.id).toBe(n2.id);
    expect(n1.message).toBe('boom');
    expect(n1.stack).toContain('at X');
    expect(n1.runtime).toBe('worker');
  });
});
