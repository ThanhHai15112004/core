import { randomUUID } from 'node:crypto';
import type { MessageEnvelope } from '../contracts/message-publisher.contract.js';
import type { JobMeta } from '../contracts/job-meta.types.js';

export function serializeMessage<T>(
  topic: string,
  payload: T,
  meta: { producer?: string | null; correlationId?: string | null; job?: JobMeta | null } = {},
): MessageEnvelope<T> {
  return {
    id: randomUUID(),
    topic,
    payload,
    timestamp: new Date().toISOString(),
    producer: meta.producer ?? null,
    correlationId: meta.correlationId ?? null,
    ...(meta.job ? { meta: meta.job } : {}),
  };
}

function parseMeta(raw: unknown): JobMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const src = (m['source'] ?? null) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const kinds = ['http', 'scheduler', 'job', 'manual', 'system'];
  const index: Record<string, string> = {};
  if (m['index'] && typeof m['index'] === 'object')
    for (const [k, v] of Object.entries(m['index'] as Record<string, unknown>))
      if (typeof v === 'string' || typeof v === 'number') index[k] = String(v);
  return {
    source: {
      kind: (kinds.includes(String(src?.['kind']))
        ? src!['kind']
        : 'system') as JobMeta['source']['kind'],
      id: str(src?.['id']),
      name: str(src?.['name']),
      detail: str(src?.['detail']),
    },
    requestId: str(m['requestId']),
    idempotencyKey: str(m['idempotencyKey']),
    index,
    schema: str(m['schema']),
  };
}

/** Đọc lại envelope từ dữ liệu job; sai cấu trúc → `null` (lỗi deserialize, không retry). */
export function parseEnvelope(data: unknown): MessageEnvelope | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d['id'] !== 'string' || !d['id']) return null;
  if (typeof d['topic'] !== 'string' || !d['topic']) return null;
  if (typeof d['timestamp'] !== 'string' || Number.isNaN(Date.parse(d['timestamp']))) return null;
  if (!('payload' in d)) return null;
  return {
    id: d['id'],
    topic: d['topic'],
    payload: d['payload'],
    timestamp: d['timestamp'],
    producer: typeof d['producer'] === 'string' ? d['producer'] : null,
    correlationId: typeof d['correlationId'] === 'string' ? d['correlationId'] : null,
    meta: parseMeta(d['meta']),
  };
}

/** Kích thước (bytes) của envelope khi lưu vào broker. */
export const envelopeSize = (envelope: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(envelope) ?? '', 'utf8');
  } catch {
    return 0;
  }
};
