import { randomUUID } from 'node:crypto';
import type { MessageEnvelope } from '../contracts/message-publisher.contract.js';

export function serializeMessage<T>(
  topic: string,
  payload: T,
  meta: { producer?: string | null; correlationId?: string | null } = {},
): MessageEnvelope<T> {
  return {
    id: randomUUID(),
    topic,
    payload,
    timestamp: new Date().toISOString(),
    producer: meta.producer ?? null,
    correlationId: meta.correlationId ?? null,
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
