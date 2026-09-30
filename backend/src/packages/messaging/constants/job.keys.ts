import type { RedisService } from '@packages/redis/index.js';

/**
 * Key Redis của Jobs (đã có REDIS_PREFIX). Job BullMQ cũng là message nên publisher / consumer của Messaging ghi các
 * key này; module Jobs chỉ đọc + thao tác. Không chứa payload.
 */
export const jobKeys = (redis: RedisService) => ({
  /** ZSET `queue|jobId` theo thời điểm tạo — chỉ mục tìm kiếm (correlation / request / idempotency / entity…). */
  index: (field: string, value: string) => redis.key('jobs', 'idx', field, value),
  /** ZSET job con (`queue|jobId`) của một job. */
  children: (jobId: string) => redis.key('jobs', 'children', jobId),
  /** Bản ghi job đã huỷ khi còn chờ (BullMQ không có trạng thái cancelled). */
  cancelled: (queue: string, jobId: string) => redis.key('jobs', 'cancelled', queue, jobId),
  /** ZSET `queue|jobId` các job đã huỷ theo thời điểm huỷ. */
  cancelledIndex: () => redis.key('jobs', 'cancelled-idx'),
  /** LIST sự kiện job (mới nhất trước). */
  events: () => redis.key('jobs', 'events'),
  /** LIST audit thao tác job. */
  operations: () => redis.key('jobs', 'ops'),
  /** Pub/sub lệnh tới worker (yêu cầu huỷ job đang chạy). */
  commandChannel: () => redis.key('jobs', 'cmd'),
  commandResult: (id: string) => redis.key('jobs', 'cmd-result', id),
  /** Đánh dấu đã ghi sự kiện một lần cho job (stalled / chạy lâu). */
  seen: (kind: string, queue: string, jobId: string) =>
    redis.key('jobs', 'seen', kind, queue, jobId),
  monitorLock: () => redis.key('jobs', 'lock', 'monitor'),
});

export const JOB_EVENT_LOG_SIZE = 1000;
export const JOB_OPERATION_LOG_SIZE = 500;
/** Số job tối đa giữ trong một chỉ mục tìm kiếm / danh sách job con. */
export const JOB_INDEX_MAX = 500;
/** Thời hạn khoá của job đang chạy (worker gia hạn định kỳ) — hết hạn mà không gia hạn = stalled. */
export const JOB_LOCK_DURATION_MS = 30_000;
export const JOB_COMMAND_TTL_SEC = 300;

/** `queue|jobId` ↔ tham chiếu. */
export const jobRef = (queue: string, id: string) => `${queue}|${id}`;
export function parseJobRef(ref: string): { queue: string; id: string } | null {
  const i = ref.indexOf('|');
  return i > 0 ? { queue: ref.slice(0, i), id: ref.slice(i + 1) } : null;
}
/** Giá trị index an toàn làm key (bỏ khoảng trắng thừa, cắt ngắn). */
export const indexValue = (v: string | number) => String(v).trim().slice(0, 200);
