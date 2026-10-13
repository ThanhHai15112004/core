import type { Tone } from '@core/theme';
import type { ChartColor } from '@core/ui/charts';
import type {
  ChannelStatus,
  ConsumerStatus,
  LifecycleType,
  MessageStatus,
  MessagingCapability,
  MessagingErrorKind,
  MessagingHealthStatus,
  MessagingMetric,
  MessagingRange,
} from '../types/messaging.types';

/** Tab hiển thị. Cấu hình mở dạng sheet (⚙); retry / dead letter là chip lọc trong Messages. */
export const MESSAGING_TABS = ['overview', 'channels', 'messages', 'activity'] as const;
export type MessagingPageTab = (typeof MESSAGING_TABS)[number];

/** Link cũ → tab mới (kèm query lọc). */
export const MESSAGING_TAB_ALIASES: Partial<Record<string, { tab: MessagingPageTab; query?: Record<string, string> }>> = {
  consumers: { tab: 'channels', query: { view: 'consumers' } },
  retries: { tab: 'messages', query: { state: 'retry' } },
  'dead-letter': { tab: 'messages', query: { state: 'dead-letter' } },
  errors: { tab: 'activity' },
  operations: { tab: 'activity' },
  configuration: { tab: 'overview', query: { settings: '1' } },
};

export const MESSAGING_RANGES = ['15m', '1h', '6h', '24h'] as const satisfies readonly MessagingRange[];
export const MESSAGING_METRICS: MessagingMetric[] = ['throughput', 'lag', 'failures', 'processing'];
export const MESSAGE_STATUSES: MessageStatus[] = ['queued', 'scheduled', 'processing', 'retrying', 'delivered', 'dead_letter'];
export const MESSAGING_ERROR_KINDS: MessagingErrorKind[] = ['processing', 'timeout', 'deserialize', 'connection', 'stalled'];

/** Chip trạng thái của tab Messages (`?state=`). */
export const MESSAGE_STATES = ['all', 'retry', 'dead-letter'] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

/** Hai bảng của tab Channels & Consumers (`?view=`). */
export const FLOW_VIEWS = ['channels', 'consumers'] as const;
export type FlowView = (typeof FLOW_VIEWS)[number];

/** Phần cần capability nào (broker không hỗ trợ → nói rõ, không có số giả). */
export const VIEW_CAPABILITY: Partial<Record<FlowView | MessageState | 'browse', MessagingCapability>> = {
  consumers: 'consumers',
  browse: 'browse',
  retry: 'retry',
  'dead-letter': 'deadLetter',
};

/** Explorer: mỗi lần "Tải thêm" xét thêm N message mới nhất mỗi trạng thái, tối đa `MESSAGE_MAX_COUNT`. */
export const MESSAGE_PAGE_SIZE = 100;
export const MESSAGE_MAX_COUNT = 500;
/** Chiều cao vùng cuộn của bảng message / danh sách hoạt động (px). */
export const MESSAGE_TABLE_HEIGHT_PX = 560;
export const ACTIVITY_MAX_HEIGHT_PX = 520;
/** Chiều cao stack trace / payload trong drawer (px). */
export const DETAIL_CODE_HEIGHT_PX = 280;
/** Content type của envelope message (BullMQ lưu JSON). */
export const MESSAGE_CONTENT_TYPE = 'application/json';

/** Từ phải gõ để xác nhận replay (discard: gõ lại message ID). Backend cũng kiểm tra chuỗi này. */
export const REPLAY_CONFIRM = 'REPLAY';

export const MESSAGING_HEALTH_TONE: Record<MessagingHealthStatus, Tone> = {
  healthy: 'ok',
  degraded: 'warn',
  reconnecting: 'warn',
  unavailable: 'crit',
  unknown: 'unknown',
};

export const CHANNEL_STATUS_TONE: Record<ChannelStatus, Tone> = {
  healthy: 'ok',
  lagging: 'warn',
  high_failure: 'warn',
  no_consumer: 'crit',
  idle: 'unknown',
};

/** Thứ tự sort mặc định: nặng nhất lên trước. */
export const CHANNEL_STATUS_RANK: Record<ChannelStatus, number> = { no_consumer: 4, high_failure: 3, lagging: 2, healthy: 1, idle: 0 };

export const CONSUMER_STATUS_TONE: Record<ConsumerStatus, Tone> = {
  healthy: 'ok',
  lagging: 'warn',
  high_failure: 'warn',
  slow: 'warn',
  paused: 'warn',
  offline: 'crit',
};

export const CONSUMER_STATUS_RANK: Record<ConsumerStatus, number> = { offline: 5, high_failure: 4, lagging: 3, slow: 2, paused: 1, healthy: 0 };

export const MESSAGE_STATUS_TONE: Record<MessageStatus, Tone> = {
  queued: 'unknown',
  scheduled: 'unknown',
  processing: 'info',
  retrying: 'warn',
  delivered: 'ok',
  dead_letter: 'crit',
  unknown: 'unknown',
};

export const LIFECYCLE_TONE: Record<LifecycleType, Tone> = {
  published: 'info',
  received: 'info',
  completed: 'ok',
  failed: 'crit',
  retry_scheduled: 'warn',
  dead_lettered: 'crit',
  retried_manually: 'warn',
  replayed: 'warn',
};

export const SEVERITY_TONE: Record<'info' | 'warning' | 'critical' | 'success', Tone> = {
  info: 'info',
  warning: 'warn',
  critical: 'crit',
  success: 'ok',
};

/** Màu series theo id backend (giá trị thật lấy từ theme). */
export const MESSAGING_SERIES_COLOR: Record<string, ChartColor> = {
  published: 'series-1',
  consumed: 'series-4',
  failed: 'crit',
  lag: 'warn',
  deadLetterSize: 'crit',
  failedPerMin: 'crit',
  retriedPerMin: 'warn',
  deadLetteredPerMin: 'series-3',
  publishFailedPerMin: 'series-5',
  processingAvg: 'series-1',
  processingP95: 'series-2',
  processingP99: 'series-3',
  consumedPerMin: 'series-4',
};

/** Config key hiển thị dạng thời lượng / nhãn dịch. */
export const CONFIG_MS_KEYS = ['timeoutMs', 'backoffDelayMs', 'processingP95Ms'];
export const CONFIG_LABELLED_KEYS = ['mode', 'acknowledgement', 'ordering', 'backoff'];

/** Rule cảnh báo backend → kiểm tra "đạt" tương ứng. */
export const LAG_RULES = ['LAG_HIGH', 'LAG_GROWING'];
export const CONSUMER_RULES = ['NO_CONSUMER', 'CONSUMER_PAUSED'];
export const FAILURE_RULES = ['FAILURE_RATE', 'PUBLISH_FAILURES'];
export const DEAD_LETTER_RULES = ['DEAD_LETTER'];
