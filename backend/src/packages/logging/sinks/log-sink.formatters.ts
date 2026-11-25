import { safeJsonParse } from '@packages/kernel/index.js';
import { PINO_LEVEL_LABEL } from '../constants/logging.constant.js';
import type { FormattedSinkRequest, LogSinkConfig } from './log-sink.types.js';

export interface SinkRuntimeContext {
  env: string;
  serviceName: string;
}

/** Ẩn userinfo và query string khỏi URL đích khi hiển thị ra API vận hành. */
export function maskSinkEndpoint(endpoint: string): string | null {
  const trimmed = endpoint.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '') || parsed.origin;
  } catch {
    return '[invalid-url]';
  }
}

/** Tạo header xác thực cho request gửi log sang Loki / OpenSearch / SIEM. */
export function buildSinkAuthHeader(
  config: Pick<LogSinkConfig, 'authHeader' | 'apiKey' | 'endpoint' | 'driver'>,
): Record<string, string> {
  const rawAuth = config.authHeader.trim();
  if (rawAuth) {
    return { authorization: rawAuth };
  }
  const key = config.apiKey.trim();
  if (!key) {
    return {};
  }
  if (config.driver === 'siem' && config.endpoint.includes('/services/collector')) {
    return { authorization: `Splunk ${key}` };
  }
  return { authorization: `Bearer ${key}` };
}

function levelLabelOf(raw: unknown): string {
  if (typeof raw === 'number') {
    return (PINO_LEVEL_LABEL[raw] ?? 'INFO').toLowerCase();
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim().toLowerCase();
  }
  return 'info';
}

/** Đóng gói batch log theo chuẩn Grafana Loki Push API (`/loki/api/v1/push`). */
export function formatLokiPayload(
  lines: readonly string[],
  config: LogSinkConfig,
  ctx: SinkRuntimeContext,
): FormattedSinkRequest {
  const groups = new Map<string, { stream: Record<string, string>; values: [string, string][] }>();

  for (const line of lines) {
    const parsed = safeJsonParse<Record<string, unknown> | null>(line, null);
    const service =
      typeof parsed?.service === 'string' && parsed.service ? parsed.service : ctx.serviceName;
    const runtime =
      typeof parsed?.runtime === 'string' && parsed.runtime ? parsed.runtime : 'unknown';
    const level = levelLabelOf(parsed?.level);
    const key = `${service}\u0000${ctx.env}\u0000${runtime}\u0000${level}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        stream: { service, env: ctx.env, runtime, level },
        values: [],
      };
      groups.set(key, group);
    }

    const timeMs = typeof parsed?.time === 'number' ? parsed.time : Date.now();
    const ns = `${Math.trunc(timeMs)}000000`;
    group.values.push([ns, line]);
  }

  return {
    headers: {
      'content-type': 'application/json',
      ...(config.tenantId.trim() ? { 'x-scope-orgid': config.tenantId.trim() } : {}),
      ...buildSinkAuthHeader(config),
    },
    body: JSON.stringify({ streams: [...groups.values()] }),
  };
}

/** Đóng gói batch log theo chuẩn OpenSearch Bulk API (`/_bulk` NDJSON). */
export function formatOpenSearchBulkPayload(
  lines: readonly string[],
  config: LogSinkConfig,
  now = new Date(),
): FormattedSinkRequest {
  const dateSuffix = now.toISOString().slice(0, 10).replace(/-/g, '.');
  const indexName = `${config.indexPrefix || 'app-logs'}-${dateSuffix}`;
  const actionLine = JSON.stringify({ index: { _index: indexName } });
  const chunks: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    chunks.push(actionLine, trimmed);
  }

  return {
    headers: {
      'content-type': 'application/x-ndjson',
      ...buildSinkAuthHeader(config),
    },
    body: chunks.length > 0 ? `${chunks.join('\n')}\n` : '',
  };
}

/** Đóng gói batch log gửi sang SIEM Webhook hoặc Splunk HEC (`/services/collector`). */
export function formatSiemPayload(
  lines: readonly string[],
  config: LogSinkConfig,
  ctx: SinkRuntimeContext,
): FormattedSinkRequest {
  const events = lines.map((line) => safeJsonParse<Record<string, unknown>>(line, { raw: line }));
  const isSplunkHec = config.endpoint.includes('/services/collector');

  if (isSplunkHec) {
    const ndjson = events
      .map((event) =>
        JSON.stringify({
          event,
          sourcetype: '_json',
          source: ctx.serviceName,
        }),
      )
      .join('\n');
    return {
      headers: {
        'content-type': 'application/json',
        ...buildSinkAuthHeader(config),
      },
      body: ndjson,
    };
  }

  return {
    headers: {
      'content-type': 'application/json',
      ...buildSinkAuthHeader(config),
    },
    body: JSON.stringify({
      service: ctx.serviceName,
      environment: ctx.env,
      count: events.length,
      events,
    }),
  };
}
