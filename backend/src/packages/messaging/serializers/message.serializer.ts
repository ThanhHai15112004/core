import { randomUUID } from 'node:crypto';
import type { MessageEnvelope } from '../contracts/message-publisher.contract.js';
import type { JobMeta } from '../contracts/job-meta.types.js';

/** Tuần tự hóa nội dung tin nhắn thành chuỗi JSON chuẩn */
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

/** Phân tích cú pháp chuỗi metadata thành đối tượng dữ liệu */
function parseMeta(raw: unknown): JobMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const src = (m['source'] ?? null) as Record<string, unknown> | null;
  /** Chuyển đổi giá trị sang kiểu chuỗi an toàn */
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

/** Prefix jobId của lần chạy thủ công (Run Now) từ System Console. */
export const MANUAL_RUN_PREFIX = 'manual:';
/** Prefix jobId của lần chạy bù (Catch-up) khi phát hiện công việc bị bỏ lỡ. */
export const CATCHUP_RUN_PREFIX = 'catchup:';

/** Trích xuất mã `taskId` từ một job được tạo bởi BullMQ Job Scheduler, Run Now hoặc Catch-up. */
export function resolveScheduledTaskId(job: {
  id?: string | undefined;
  repeatJobKey?: string | undefined;
}): string | null {
  if (job.repeatJobKey) return job.repeatJobKey;
  const id = job.id ?? '';
  for (const prefix of [MANUAL_RUN_PREFIX, CATCHUP_RUN_PREFIX]) {
    if (id.startsWith(prefix)) {
      const rest = id.slice(prefix.length);
      const idx = rest.lastIndexOf(':');
      return idx > 0 ? rest.slice(0, idx) : rest || null;
    }
  }
  return null;
}

/**
 * Job do BullMQ Job Scheduler (có `repeatJobKey`), Run Now (`manual:<task>:<ts>`) hoặc Catch-up (`catchup:<task>:<ts>`)
 * tạo không mang envelope — dựng envelope từ chính job: id = job id (mỗi lần chạy khác nhau), topic = tên job, payload = data.
 */
export function scheduledEnvelope(job: {
  id?: string | undefined;
  name: string;
  data: unknown;
  timestamp: number;
  repeatJobKey?: string | undefined;
}): MessageEnvelope | null {
  const id = job.id ?? '';
  const taskId = resolveScheduledTaskId(job);
  if (!id || !taskId) return null;
  return {
    id,
    topic: job.name,
    payload: job.data ?? {},
    timestamp: new Date(job.timestamp).toISOString(),
    producer: 'scheduler',
    correlationId: id,
    meta: {
      source: {
        kind: id.startsWith(MANUAL_RUN_PREFIX) ? 'manual' : 'scheduler',
        id: taskId,
        name: job.name,
        detail: id.startsWith(CATCHUP_RUN_PREFIX) ? 'catchup' : null,
      },
      requestId: null,
      idempotencyKey: null,
      index: { taskId },
      schema: null,
    },
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
