import type { Section } from './database.types';

export type { Section };
export type MessagingRange = '15m' | '1h' | '6h' | '24h';
export type MessagingMetric = 'throughput' | 'lag' | 'failures' | 'processing' | 'size';
export type MessagingTab =
  | 'overview'
  | 'channels'
  | 'producers'
  | 'consumers'
  | 'messages'
  | 'retries'
  | 'dead-letter'
  | 'errors'
  | 'operations'
  | 'configuration';
export type MessagingHealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'reconnecting' | 'unknown';
export type MessagingCapability =
  | 'queueDepth'
  | 'consumers'
  | 'browse'
  | 'lifecycle'
  | 'retry'
  | 'deadLetter'
  | 'replay'
  | 'discard'
  | 'brokerInfo'
  | 'partitions'
  | 'consumerGroups'
  | 'exchanges';
export type MessageStatus = 'queued' | 'scheduled' | 'processing' | 'retrying' | 'delivered' | 'dead_letter' | 'unknown';
export type ChannelStatus = 'healthy' | 'lagging' | 'high_failure' | 'no_consumer' | 'idle';
export type ConsumerStatus = 'healthy' | 'lagging' | 'high_failure' | 'slow' | 'paused' | 'offline';
export type MessagingErrorKind = 'processing' | 'timeout' | 'deserialize' | 'publish' | 'connection' | 'stalled' | 'other';
export type MessagingEventType =
  | 'connection_lost'
  | 'connection_recovered'
  | 'alert_started'
  | 'alert_recovered'
  | 'dead_lettered'
  | 'consumer_started'
  | 'consumer_stopped'
  | 'message_retried'
  | 'message_replayed'
  | 'message_discarded';
export type MessagingOperationAction = 'retry' | 'replay' | 'discard' | 'payload' | 'test';
export type LifecycleType = 'published' | 'received' | 'completed' | 'failed' | 'retry_scheduled' | 'dead_lettered' | 'retried_manually' | 'replayed';

export interface MessagingProviderInfo {
  driver: 'bullmq';
  product: string;
  broker: string;
  endpoint: string;
  prefix: string;
  channelTerm: 'topic' | 'queue' | 'subject' | 'stream';
}

export interface MessagingAlert {
  id: string;
  rule: string;
  severity: 'warning' | 'critical' | 'info';
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string;
  tab: MessagingTab;
  target: string | null;
}

export interface MessagingHealth {
  status: MessagingHealthStatus;
  reasons: { code: string; message: string }[];
  state: 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
  since: string;
  lastSuccessAt: string | null;
  lastPublishAt: string | null;
  pingMs: number | null;
  lastError: string | null;
  failures: number;
}

export interface QueueRow {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
  workers: number | null;
  consumers: string[];
  oldestWaitingSec: number | null;
}

export interface ChannelRow {
  channel: string;
  queue: string | null;
  published: number;
  consumed: number;
  failed: number;
  retried: number;
  deadLettered: number;
  publishPerSec: number | null;
  consumePerSec: number | null;
  failureRatePercent: number | null;
  lag: number | null;
  oldestWaitingSec: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  avgSizeBytes: number | null;
  producers: string[];
  consumers: string[];
  status: ChannelStatus;
  lastPublishedAt: string | null;
}

export interface ProducerRow {
  producer: string;
  published: number;
  perSec: number | null;
  failures: number;
  failureRatePercent: number | null;
  channels: { channel: string; queue: string; published: number; perSec: number | null }[];
  lastPublishedAt: string | null;
  lastFailureAt: string | null;
}

export interface ConsumerInstance {
  instance: string;
  runtime: string | null;
  concurrency: number;
  paused: boolean;
  inFlight: number;
  startedAt: string;
}

export interface ConsumerRow {
  consumer: string;
  queue: string;
  runtime: string | null;
  instances: ConsumerInstance[];
  brokerWorkers: number | null;
  consumed: number;
  failed: number;
  perSec: number | null;
  failureRatePercent: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  lag: number | null;
  idempotent: boolean | null;
  status: ConsumerStatus;
}

export interface MessageRow {
  id: string;
  queue: string;
  channel: string;
  status: MessageStatus;
  producer: string | null;
  correlationId: string | null;
  attempts: number;
  maxAttempts: number;
  publishedAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  nextAttemptAt: string | null;
  durationMs: number | null;
  waitMs: number | null;
  error: string | null;
  size: number;
  large: boolean;
}

export interface LifecycleEntry {
  at: string;
  type: LifecycleType;
  runtime: string | null;
  consumer: string | null;
  attempt: number | null;
  ms: number | null;
  error: string | null;
  delayMs: number | null;
}

export interface MessagingSettings {
  retry: boolean;
  replay: boolean;
  discard: boolean;
  payload: boolean;
  maxAttempts: number;
  largeMessageBytes: number;
}

export interface MessageDetail extends MessageRow {
  lifecycle: LifecycleEntry[];
  stacktrace: string[];
  backoff: { type: string; delayMs: number } | null;
  malformed: boolean;
  consumers: string[];
  idempotent: boolean | null;
  settings: MessagingSettings;
}

export interface MessagePayload {
  id: string;
  queue: string;
  channel: string;
  payload: unknown;
  redacted: boolean;
  size: number;
}

export interface Delivery {
  published: number;
  consumed: number;
  failed: number;
  retried: number;
  deadLettered: number;
  recovered: number;
  publishFailures: number;
  failureRatePercent: number | null;
}

export interface MessagingReport {
  published: number;
  consumed: number;
  failed: number;
  retried: number;
  deadLettered: number;
  avgProcessingMs: number | null;
  avgLag: number | null;
  peakLag: number | null;
}

export interface MessagingEvent {
  id: string;
  at: string;
  type: MessagingEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  runtime: string | null;
  tab: MessagingTab | null;
  target: string | null;
}

export interface MessagingOverview {
  generatedAt: string;
  range: MessagingRange;
  provider: MessagingProviderInfo;
  environment: string;
  capabilities: MessagingCapability[];
  health: MessagingHealth;
  kpis: {
    publishedPerSec: number | null;
    consumedPerSec: number | null;
    lag: number | null;
    failed: number;
    retrying: number | null;
    deadLetter: number | null;
    consumers: number | null;
    channels: number;
  };
  balance: {
    publishedPerSec: number | null;
    consumedPerSec: number | null;
    diffPerSec: number | null;
    growthPerHour: number | null;
    state: 'growing' | 'draining' | 'stable' | null;
  };
  lagTrend: { current: number | null; ago15m: number | null; changePercent: number | null; direction: 'up' | 'down' | 'flat' | null };
  processing: { avgMs: number | null; p95Ms: number | null; p99Ms: number | null };
  payload: { avgBytes: number | null; maxBytes: number | null; largeBytes: number };
  delivery: Delivery;
  queues: Section<QueueRow[]>;
  topChannels: ChannelRow[];
  consumers: ConsumerRow[];
  deadLetter: Section<{ total: number; latest: MessageRow[] }>;
  alerts: MessagingAlert[];
  report: { today: MessagingReport; yesterday: MessagingReport };
  events: MessagingEvent[];
  settings: MessagingSettings;
}

export interface MessagingSeries {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface MessagingMetrics {
  metric: MessagingMetric;
  range: MessagingRange;
  resolutionSec: number | null;
  unit: string;
  series: MessagingSeries[];
}

export interface MessagingChannels {
  range: MessagingRange;
  channels: ChannelRow[];
  queues: Section<QueueRow[]>;
  backlogSampled: number | null;
  backlogTruncated: boolean;
}

export interface MessagingError {
  at: string;
  stage: 'publish' | 'consume';
  kind: MessagingErrorKind;
  channel: string;
  queue: string;
  messageId: string | null;
  consumer: string | null;
  runtime: string | null;
  attempt: number | null;
  maxAttempts: number | null;
  final: boolean;
  code: string | null;
  message: string;
  correlationId: string | null;
}

export interface ChannelDetail {
  range: MessagingRange;
  channel: ChannelRow;
  throughput: MessagingSeries[];
  processing: MessagingSeries[];
  consumers: ConsumerRow[];
  recentErrors: MessagingError[];
  recentMessages: Section<MessageRow[]>;
}

export interface MessagingProducers {
  range: MessagingRange;
  producers: ProducerRow[];
}

export interface MessagingConsumers {
  range: MessagingRange;
  consumers: ConsumerRow[];
  unconsumed: QueueRow[];
}

export interface ConsumerDetail {
  range: MessagingRange;
  consumer: ConsumerRow;
  processing: MessagingSeries[];
  throughput: MessagingSeries[];
  lag: MessagingSeries[];
  recentErrors: MessagingError[];
  recentMessages: Section<MessageRow[]>;
  retry: { retried: number; recovered: number; deadLettered: number };
}

export interface MessageFilter {
  queue: string;
  channel: string;
  status: MessageStatus | '';
  producer: string;
  search: string;
}

export interface MessagingMessages {
  messages: Section<MessageRow[]>;
  examined: number;
  truncated: boolean;
}

export interface MessagingRetries {
  retrying: Section<MessageRow[]>;
  stats: { retryingNow: number | null; retriedToday: number; recoveredToday: number; deadLetteredToday: number };
  policy: { maxAttempts: number; backoff: string; initialDelayMs: number; maxDelayMs: number };
  retryEnabled: boolean;
}

export interface MessagingDeadLetter {
  items: Section<MessageRow[]>;
  total: number | null;
  addedToday: number;
  oldestSec: number | null;
  bySource: { channel: string; count: number }[];
  settings: MessagingSettings;
}

export interface MessagingErrors {
  counts: Record<MessagingErrorKind, number>;
  byStage: { publish: number; consume: number };
  total: number;
  items: MessagingError[];
  range: MessagingRange;
}

export interface MessagingOperation {
  id: string;
  at: string;
  action: MessagingOperationAction;
  target: string;
  result: 'success' | 'failed';
  detail: string | null;
  durationMs: number;
  actor: string | null;
  ip: string | null;
  error: string | null;
}

export interface BrokerInfo {
  version: string | null;
  uptimeSec: number | null;
  usedMemoryBytes: number | null;
  maxMemoryBytes: number | null;
  connectedClients: number | null;
  connections: { runtime: string; count: number }[];
}

export interface MessagingBroker {
  broker: Section<BrokerInfo>;
}

export interface MessagingConfig {
  items: { key: string; value: string | number | boolean | null; sensitive?: boolean; group: string }[];
}

export type BrokerTestStep = 'connect' | 'publish' | 'consume' | 'ack';

export interface MessagingTest {
  ok: boolean;
  steps: { step: BrokerTestStep; ok: boolean; ms: number | null; error: string | null }[];
  totalMs: number;
  roundTripMs: number | null;
  failedStep: BrokerTestStep | null;
  at: string;
}
