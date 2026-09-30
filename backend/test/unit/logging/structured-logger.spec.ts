import { describe, it, expect, jest, afterEach } from '@jest/globals';
import {
  CoreLoggerService,
  LogLevel,
  RequestContextService,
  fingerprintOf,
  normalizeMessage,
  redactMetadata,
  redactText,
  topFrame,
  type LogEntry,
  type LogSink,
} from '@packages/logging/index.js';

class MemorySink implements LogSink {
  public entries: LogEntry[] = [];
  public write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

function logger() {
  const sink = new MemorySink();
  return { sink, log: new CoreLoggerService(sink) };
}

const STACK = `StorageTimeoutError: upload timed out after 4800ms
    at StorageService.put (/app/src/packages/storage/storage.service.ts:120:11)
    at async ReportProcessor.handle (/app/src/apps/worker/report.processor.ts:44:5)
    at async /app/node_modules/bullmq/dist/worker.js:10:1`;

describe('CoreLoggerService — structured logs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tách message / metadata / ngữ cảnh job từ AsyncLocalStorage', () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { sink, log } = logger();
    new RequestContextService().run(
      {
        correlationId: 'corr-1',
        jobId: '82920',
        messageId: '82920',
        source: { kind: 'job', id: '82920', name: 'report.generate', detail: 'reports' },
      },
      () =>
        log.log(
          { message: 'Report generated', reportId: 'rpt_821', durationMs: 4802 },
          'ReportProcessor',
        ),
    );
    const e = sink.entries[0]!;
    expect(e).toMatchObject({
      level: 'info',
      message: 'Report generated',
      context: 'ReportProcessor',
      correlationId: 'corr-1',
      jobId: '82920',
      messageId: '82920',
      jobType: 'report.generate',
      durationMs: 4802,
      metadata: { reportId: 'rpt_821', durationMs: 4802 },
    });
    expect(e.id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    expect(e.fingerprint).toBeUndefined();
  });

  it('error: loại lỗi + stack tách khỏi message, có fingerprint; ID trong metadata được nâng lên field', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { sink, log } = logger();
    log.error(
      { message: 'Storage upload timed out', jobId: 'j1', requestId: 'req_9', attempt: 3 },
      STACK,
      'ReportProcessor',
    );
    const e = sink.entries[0]!;
    expect(e.message).toBe('Storage upload timed out');
    expect(e.errorType).toBe('StorageTimeoutError');
    expect(e.stack).toContain('StorageService.put');
    expect(e.jobId).toBe('j1');
    expect(e.requestId).toBe('req_9');
    expect(e.metadata).toEqual({ attempt: 3 });
    expect(e.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('Error object: name / stack / code', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { sink, log } = logger();
    const err = Object.assign(new TypeError('Cannot read x'), { code: 'E_X' });
    log.error(err, 'Svc');
    expect(sink.entries[0]).toMatchObject({
      message: 'Cannot read x',
      errorType: 'TypeError',
      errorCode: 'E_X',
      context: 'Svc',
    });
  });

  it('redact trước khi ghi console và sink (không chỉ ở frontend)', () => {
    const out: string[] = [];
    jest.spyOn(console, 'warn').mockImplementation((l: string) => void out.push(l));
    const { sink, log } = logger();
    log.warn(
      {
        message: 'login failed token=abc123 with Authorization: Bearer eyJhbGciOi.xxx',
        password: 'hunter2',
        user: { apiKey: 'k' },
      },
      'Auth',
    );
    const e = sink.entries[0]!;
    expect(e.message).not.toContain('abc123');
    expect(e.message).toContain('Bearer [REDACTED]');
    expect(e.metadata).toEqual({ password: '[REDACTED]', user: { apiKey: '[REDACTED]' } });
    expect(out.join('\n')).not.toMatch(/abc123|hunter2/);
    expect(log.getStats().redacted).toBeGreaterThanOrEqual(3);
  });

  it('level tạm thời: DEBUG cho cả runtime hoặc chỉ module, tự hết hạn', () => {
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    const { sink, log } = logger();
    log.debug('hidden', 'A');
    expect(sink.entries).toHaveLength(0);
    expect(log.getStats().suppressed).toBe(1);

    log.setOverride({
      level: LogLevel.DEBUG,
      until: Date.now() + 60_000,
      modules: ['PaymentService'],
    });
    log.debug('scoped', 'PaymentService');
    log.debug('other', 'A');
    expect(sink.entries.map((e) => e.message)).toEqual(['scoped']);
    expect(log.getLogLevel()).toBe(LogLevel.INFO);

    log.setOverride({ level: LogLevel.DEBUG, until: Date.now() - 1, modules: [] });
    log.debug('expired', 'A');
    expect(sink.entries).toHaveLength(1);
    expect(log.getOverride()).toBeNull();

    log.setOverride({ level: LogLevel.DEBUG, until: null, modules: [] });
    log.debug('all', 'A');
    expect(log.getLogLevel()).toBe(LogLevel.DEBUG);
    expect(sink.entries.map((e) => e.message)).toEqual(['scoped', 'all']);
  });

  it('không bao giờ ném lỗi (metadata vòng lặp)', () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { sink, log } = logger();
    const a: Record<string, unknown> = { message: 'cyclic' };
    a.self = a;
    expect(() => log.log(a)).not.toThrow();
    expect(sink.entries[0]!.metadata).toEqual({ self: { message: 'cyclic', self: '[Circular]' } });
  });
});

describe('redaction / fingerprint', () => {
  it('redactText: bearer, jwt, mật khẩu trong URL, key=value, JSON', () => {
    const r = redactText(
      'Authorization: Bearer abc.def mysql://core:s3cr3t@db:3306/x password=p1 "api_key": "zzz" eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2Q',
    );
    expect(r.text).not.toMatch(/abc\.def|s3cr3t|p1\b|zzz|SflKxw/);
    expect(r.count).toBe(5);
  });

  it('redactMetadata: che theo tên field, giới hạn độ sâu, Date / Error / bigint', () => {
    const { value, count } = redactMetadata({
      cookie: 'c',
      when: new Date('2026-01-01T00:00:00Z'),
      err: new Error('x token=abc'),
      big: 10n,
    });
    expect(value).toEqual({
      cookie: '[REDACTED]',
      when: '2026-01-01T00:00:00.000Z',
      err: { name: 'Error', message: 'x token=[REDACTED]' },
      big: '10',
    });
    expect(count).toBe(2);
  });

  it('normalizeMessage gom ID / số / email / UUID', () => {
    expect(normalizeMessage('User 821 not found')).toBe(normalizeMessage('User 822 not found'));
    expect(normalizeMessage('Order 0a1b2c3d-1111-2222-3333-444455556666 for a@b.io failed')).toBe(
      'Order {uuid} for {email} failed',
    );
  });

  it('fingerprint: cùng loại + module + message chuẩn hoá + khung stack; bỏ số dòng / node_modules', () => {
    expect(topFrame(STACK)).toBe('StorageService.put (storage.service.ts)');
    const a = fingerprintOf({
      errorType: 'X',
      context: 'M',
      message: 'User 1 not found',
      stack: STACK,
    });
    const b = fingerprintOf({
      errorType: 'X',
      context: 'M',
      message: 'User 2 not found',
      stack: STACK.replace(':120:11', ':130:2'),
    });
    const c = fingerprintOf({
      errorType: 'Y',
      context: 'M',
      message: 'User 1 not found',
      stack: STACK,
    });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
});
