import { env } from './env.js';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

export type MessagingBackoff = 'exponential' | 'fixed';

export const messagingConfig = () => ({
  /** Số lần xử lý tối đa của một message (lần đầu + retry). Hết lượt → Dead Letter (failed set của BullMQ). */
  maxAttempts: Math.max(1, numberOr('MESSAGING_MAX_ATTEMPTS', 3)),
  backoff: (env('MESSAGING_BACKOFF', false) === 'fixed'
    ? 'fixed'
    : 'exponential') as MessagingBackoff,
  /** Độ trễ retry đầu tiên (ms); exponential: delay × 2^(attempt-1). */
  backoffDelayMs: Math.max(0, numberOr('MESSAGING_BACKOFF_DELAY_MS', 1000)),
  /** Số message đã xử lý xong giữ lại để tra cứu (Messages explorer). */
  keepCompleted: Math.max(0, numberOr('MESSAGING_KEEP_COMPLETED', 1000)),
  /** Số message trong Dead Letter giữ lại (cũ hơn bị BullMQ xoá). */
  keepDeadLetter: Math.max(1, numberOr('MESSAGING_KEEP_DEAD_LETTER', 1000)),
  /** Số dòng lifecycle (nhận/lỗi/retry…) giữ cho mỗi message. */
  keepLifecycle: Math.max(10, numberOr('MESSAGING_KEEP_LIFECYCLE', 50)),
  /** Timeout thao tác publish/đọc broker (ms) — BullMQ tự đợi vô hạn khi Redis sập. */
  timeoutMs: Math.max(200, numberOr('MESSAGING_TIMEOUT_MS', 2000)),
  /** Payload lớn hơn chừng này (KB) được đánh dấu "message lớn". */
  largeMessageKb: numberOr('MESSAGING_LARGE_MESSAGE_KB', 256),
  /** Số message waiting tối đa lấy mẫu khi tính backlog theo channel. */
  backlogSample: Math.max(100, numberOr('MESSAGING_BACKLOG_SAMPLE', 2000)),
  rules: {
    lagWarn: numberOr('MESSAGING_LAG_WARN', 1000),
    lagCrit: numberOr('MESSAGING_LAG_CRIT', 10_000),
    /** Lag tăng ít nhất chừng này trong 15 phút (và gấp đôi) → "consumer tụt lại". */
    lagGrowthMin: numberOr('MESSAGING_LAG_GROWTH_MIN', 100),
    failureRatePercent: numberOr('MESSAGING_FAILURE_RATE_PERCENT', 5),
    minOps: numberOr('MESSAGING_RULE_MIN_OPS', 20),
    processingP95Ms: numberOr('MESSAGING_PROCESSING_P95_MS', 5000),
    deadLetterWarn: numberOr('MESSAGING_DLQ_WARN', 100),
    /** Message chờ lâu hơn chừng này (phút) khi không có consumer → cảnh báo. */
    oldestWaitingMin: numberOr('MESSAGING_OLDEST_WAITING_MIN', 10),
  },
  retry: booleanOr('OPS_MESSAGING_RETRY_ENABLED', true),
  replay: booleanOr('OPS_MESSAGING_REPLAY_ENABLED', true),
  discard: booleanOr('OPS_MESSAGING_DISCARD_ENABLED', true),
  /** Xem payload (đã che field nhạy cảm) — quyền riêng, mỗi lần xem được ghi audit. */
  payload: booleanOr('OPS_MESSAGING_PAYLOAD_ENABLED', true),
});

export type MessagingConfig = ReturnType<typeof messagingConfig>;
