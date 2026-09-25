import type {
  ChannelStatus,
  ConsumerStatus,
  MessageStatus,
  MessagingCapability,
  MessagingHealthStatus,
  MessagingMetric,
  MessagingRange,
  MessagingTab,
} from '../types/messaging.types';
import type { StatusTone } from '../utils/status-tone';

export const MESSAGING_TABS: MessagingTab[] = [
  'overview',
  'channels',
  'producers',
  'consumers',
  'messages',
  'retries',
  'dead-letter',
  'errors',
  'operations',
  'configuration',
];
export const MESSAGING_RANGES: MessagingRange[] = ['15m', '1h', '6h', '24h'];
export const DEFAULT_MESSAGING_RANGE: MessagingRange = '1h';
export const MESSAGING_METRICS: MessagingMetric[] = ['throughput', 'lag', 'failures', 'processing', 'size'];
export const MESSAGE_STATUSES: MessageStatus[] = ['queued', 'scheduled', 'processing', 'retrying', 'delivered', 'dead_letter'];
export const MESSAGE_PAGE_SIZE = 100;

/** Tab cần capability nào (broker không hỗ trợ → "Không hỗ trợ"). */
export const TAB_CAPABILITY: Partial<Record<MessagingTab, MessagingCapability>> = {
  consumers: 'consumers',
  messages: 'browse',
  retries: 'retry',
  'dead-letter': 'deadLetter',
};

export const MESSAGING_HEALTH_TONE: Record<MessagingHealthStatus, StatusTone> = {
  healthy: 'ok',
  degraded: 'warn',
  reconnecting: 'warn',
  unavailable: 'crit',
  unknown: 'unknown',
};

export const CHANNEL_STATUS_TONE: Record<ChannelStatus, StatusTone> = {
  healthy: 'ok',
  lagging: 'warn',
  high_failure: 'warn',
  no_consumer: 'crit',
  idle: 'unknown',
};

export const CONSUMER_STATUS_TONE: Record<ConsumerStatus, StatusTone> = {
  healthy: 'ok',
  lagging: 'warn',
  high_failure: 'warn',
  slow: 'warn',
  paused: 'warn',
  offline: 'crit',
};

export const MESSAGE_STATUS_TONE: Record<MessageStatus, StatusTone> = {
  queued: 'unknown',
  scheduled: 'unknown',
  processing: 'ok',
  retrying: 'warn',
  delivered: 'ok',
  dead_letter: 'crit',
  unknown: 'unknown',
};

export const MESSAGING_SERIES_COLORS: Record<string, string> = {
  published: 'var(--scp-series-1)',
  consumed: 'var(--scp-series-4)',
  failed: 'var(--scp-danger)',
  lag: 'var(--scp-warning)',
  deadLetterSize: 'var(--scp-danger)',
  failedPerMin: 'var(--scp-danger)',
  retriedPerMin: 'var(--scp-warning)',
  deadLetteredPerMin: 'var(--scp-series-3)',
  publishFailedPerMin: 'var(--scp-series-5)',
  processingAvg: 'var(--scp-series-1)',
  processingP95: 'var(--scp-series-2)',
  processingP99: 'var(--scp-series-3)',
  sizeAvg: 'var(--scp-series-1)',
  sizeMax: 'var(--scp-series-3)',
  consumedPerMin: 'var(--scp-series-4)',
};

/** Từ phải gõ để xác nhận replay (discard: gõ lại message ID). */
export const REPLAY_CONFIRM = 'REPLAY';
