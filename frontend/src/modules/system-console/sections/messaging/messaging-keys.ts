import type { MessageFilter, MessagingMetric, MessagingRange } from '../../types/messaging.types';

/** Query key của Messaging — prefix `['messaging']` để làm mới cả trang sau thao tác. */
export const messagingKeys = {
  all: ['messaging'] as const,
  overview: (range: MessagingRange) => ['messaging', 'overview', range] as const,
  metrics: (range: MessagingRange, metric: MessagingMetric) => ['messaging', 'metrics', range, metric] as const,
  channels: (range: MessagingRange) => ['messaging', 'channels', range] as const,
  channel: (name: string, range: MessagingRange) => ['messaging', 'channel', name, range] as const,
  consumers: (range: MessagingRange) => ['messaging', 'consumers', range] as const,
  consumer: (name: string, range: MessagingRange) => ['messaging', 'consumer', name, range] as const,
  messages: (filter: MessageFilter, count: number) => ['messaging', 'messages', filter, count] as const,
  message: (id: string, queue: string | null) => ['messaging', 'message', id, queue] as const,
  payload: (id: string, queue: string) => ['messaging', 'payload', id, queue] as const,
  retries: () => ['messaging', 'retries'] as const,
  deadLetter: () => ['messaging', 'dead-letter'] as const,
  broker: () => ['messaging', 'broker'] as const,
  errors: (range: MessagingRange) => ['messaging', 'errors', range] as const,
  events: (range: MessagingRange) => ['messaging', 'events', range] as const,
  operations: () => ['messaging', 'operations'] as const,
  config: () => ['messaging', 'config'] as const,
};
