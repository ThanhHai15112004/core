import { describe, it, expect, jest } from '@jest/globals';
import {
  ExternalLogSinkDestination,
  type SinkFetch,
} from '@packages/logging/sinks/external-log-sink.destination.js';
import {
  buildSinkAuthHeader,
  formatLokiPayload,
  formatOpenSearchBulkPayload,
  formatSiemPayload,
  maskSinkEndpoint,
} from '@packages/logging/sinks/log-sink.formatters.js';
import type { LogSinkConfig } from '@packages/logging/sinks/log-sink.types.js';

function makeConfig(overrides: Partial<LogSinkConfig> = {}): LogSinkConfig {
  return {
    enabled: true,
    driver: 'loki',
    endpoint: 'https://logs.example.com/loki/api/v1/push',
    authHeader: '',
    apiKey: 'secret-api-key',
    tenantId: 'tenant-a',
    indexPrefix: 'core-logs',
    batchSize: 2,
    flushMs: 2000,
    timeoutMs: 3000,
    maxBuffer: 3,
    ...overrides,
  };
}

describe('ExternalLogSink Unit Tests', () => {
  it('masks credentials and query string in endpoint URLs', () => {
    expect(maskSinkEndpoint('https://user:pass@loki.example.com/loki/api/v1/push?token=abc')).toBe(
      'https://loki.example.com/loki/api/v1/push',
    );
    expect(maskSinkEndpoint('not a url')).toBe('[invalid-url]');
    expect(maskSinkEndpoint('')).toBeNull();
  });

  it('builds auth headers for Bearer, custom authHeader, and Splunk HEC', () => {
    expect(buildSinkAuthHeader(makeConfig({ authHeader: 'ApiKey custom-val' }))).toEqual({
      authorization: 'ApiKey custom-val',
    });
    expect(
      buildSinkAuthHeader(
        makeConfig({ driver: 'siem', endpoint: 'https://splunk.local/services/collector/event' }),
      ),
    ).toEqual({
      authorization: 'Splunk secret-api-key',
    });
  });

  it('formats Loki Push API, OpenSearch Bulk NDJSON, and SIEM payloads', () => {
    const line1 = JSON.stringify({ time: 1700000000000, level: 30, runtime: 'api', msg: 'hello' });
    const line2 = JSON.stringify({
      time: 1700000001000,
      level: 50,
      runtime: 'worker',
      msg: 'boom',
    });

    const loki = formatLokiPayload([line1, line2], makeConfig(), {
      env: 'production',
      serviceName: 'core-api',
    });
    expect(loki.headers['x-scope-orgid']).toBe('tenant-a');
    const lokiParsed = JSON.parse(loki.body) as {
      streams: { stream: Record<string, string>; values: [string, string][] }[];
    };
    expect(lokiParsed.streams).toHaveLength(2);
    expect(lokiParsed.streams[0]?.stream.service).toBe('core-api');
    expect(lokiParsed.streams[0]?.values[0]?.[0]).toBe('1700000000000000000');

    const os = formatOpenSearchBulkPayload(
      [line1],
      makeConfig({ driver: 'opensearch' }),
      new Date('2026-11-25T10:00:00.000Z'),
    );
    expect(os.headers['content-type']).toBe('application/x-ndjson');
    expect(os.body).toContain('{"index":{"_index":"core-logs-2026.11.25"}}');
    expect(os.body.endsWith('\n')).toBe(true);

    const siem = formatSiemPayload(
      [line1],
      makeConfig({ driver: 'siem', endpoint: 'https://siem.example.com/ingest' }),
      { env: 'production', serviceName: 'core-api' },
    );
    const siemParsed = JSON.parse(siem.body) as { count: number; events: unknown[] };
    expect(siemParsed.count).toBe(1);
    expect(siemParsed.events).toHaveLength(1);
  });

  it('is a no-op when disabled and flushes/handles errors safely without throwing', async () => {
    const fetchMock = jest.fn<SinkFetch>().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
    });
    const sink = new ExternalLogSinkDestination(fetchMock);

    sink.configure(makeConfig({ enabled: false }), 'development', 'core-api');
    sink.write(JSON.stringify({ msg: 'ignored' }));
    await sink.flush();
    expect(fetchMock).not.toHaveBeenCalled();

    sink.configure(makeConfig({ enabled: true, batchSize: 10 }), 'production', 'core-api');
    sink.write(JSON.stringify({ time: 1700000000000, level: 30, msg: 'one' }));
    sink.write(JSON.stringify({ time: 1700000000001, level: 30, msg: 'two' }));
    sink.write(JSON.stringify({ time: 1700000000002, level: 30, msg: 'three' }));
    sink.write(JSON.stringify({ time: 1700000000003, level: 30, msg: 'overflow' }));

    expect(sink.dropped).toBe(1);
    await sink.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sink.sent).toBe(3);

    fetchMock.mockRejectedValueOnce(new Error('network timeout'));
    sink.write(JSON.stringify({ time: 1700000000004, level: 50, msg: 'fail' }));
    await sink.flush();
    expect(sink.dropped).toBe(2);
    expect(sink.lastError).toBe('network timeout');
    expect(sink.getStats().endpoint).toBe('https://logs.example.com/loki/api/v1/push');
  });
});
