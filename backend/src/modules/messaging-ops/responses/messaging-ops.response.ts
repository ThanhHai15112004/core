import type {
  BrokerInfo,
  LifecycleType,
  MessageStatus,
  MessagingCapability,
  MessagingConnectionState,
  MessagingErrorKind,
  MessagingEventType,
  MessagingOperationAction,
  MessagingProviderInfo,
  MessagingSection,
  MessagingTestResult,
} from '@packages/messaging/index.js';

export type MessagingRange = '15m' | '1h' | '6h' | '24h';
export type MessagingMetric = 'throughput' | 'lag' | 'failures' | 'processing' | 'size';
export type MessagingSeverity = 'warning' | 'critical' | 'info';
export type MessagingHealthStatus =
  'healthy' | 'degraded' | 'unavailable' | 'reconnecting' | 'unknown';
export type ChannelStatus = 'healthy' | 'lagging' | 'high_failure' | 'no_consumer' | 'idle';
export type ConsumerStatus = 'healthy' | 'lagging' | 'high_failure' | 'slow' | 'paused' | 'offline';
export type SectionDto<T> = MessagingSection<T>;

export interface MessagingAlertDto {
  id: string;
  rule: string;
  severity: MessagingSeverity;
  title: string;
  message: string;
  value: number;
  threshold: number;
  unit: string;
  since: string;
  tab: string;
  /** Đối tượng liên quan để mở thẳng (queue/channel/consumer). */
  target: string | null;
}

export interface MessagingHealthDto {
  status: MessagingHealthStatus;
  reasons: { code: string; message: string }[];
  state: MessagingConnectionState;
  since: string;
  lastSuccessAt: string | null;
  lastPublishAt: string | null;
  pingMs: number | null;
  lastError: string | null;
  failures: number;
}

export interface QueueRowDto {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
  /** Kết nối worker trên broker. */
  workers: number | null;
  /** Consumer đã đăng ký (tên processor). */
  consumers: string[];
  oldestWaitingSec: number | null;
}

export interface ChannelRowDto {
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
  /** Message đang chờ của channel (theo mẫu waiting). */
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

export interface ProducerRowDto {
  producer: string;
  published: number;
  perSec: number | null;
  failures: number;
  failureRatePercent: number | null;
  channels: { channel: string; queue: string; published: number; perSec: number | null }[];
  lastPublishedAt: string | null;
  lastFailureAt: string | null;
}

export interface ConsumerInstanceDto {
  instance: string;
  runtime: string | null;
  concurrency: number;
  paused: boolean;
  inFlight: number;
  startedAt: string;
}

export interface ConsumerRowDto {
  consumer: string;
  queue: string;
  runtime: string | null;
  instances: ConsumerInstanceDto[];
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

export interface MessageRowDto {
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

export interface LifecycleEntryDto {
  at: string;
  type: LifecycleType | 'published';
  runtime: string | null;
  consumer: string | null;
  attempt: number | null;
  ms: number | null;
  error: string | null;
  delayMs: number | null;
}

export interface MessageDetailDto extends MessageRowDto {
  lifecycle: LifecycleEntryDto[];
  stacktrace: string[];
  backoff: { type: string; delayMs: number } | null;
  malformed: boolean;
  consumers: string[];
  /** Consumer của queue tự khai báo idempotent (true/false) hoặc null = không rõ. */
  idempotent: boolean | null;
  settings: MessagingSettingsDto;
}

export interface MessagingSettingsDto {
  retry: boolean;
  replay: boolean;
  discard: boolean;
  payload: boolean;
  maxAttempts: number;
  largeMessageBytes: number;
}

export interface DeliveryDto {
  published: number;
  consumed: number;
  failed: number;
  retried: number;
  deadLettered: number;
  recovered: number;
  publishFailures: number;
  failureRatePercent: number | null;
}

export interface MessagingReportDto {
  published: number;
  consumed: number;
  failed: number;
  retried: number;
  deadLettered: number;
  avgProcessingMs: number | null;
  avgLag: number | null;
  peakLag: number | null;
}

export interface MessagingEventDto {
  id: string;
  at: string;
  type: MessagingEventType;
  severity: 'info' | 'warning' | 'critical' | 'success';
  message: string;
  runtime: string | null;
  tab: string | null;
  target: string | null;
}

export interface MessagingOverviewDto {
  generatedAt: string;
  range: MessagingRange;
  provider: MessagingProviderInfo;
  environment: string;
  capabilities: MessagingCapability[];
  health: MessagingHealthDto;
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
    /** Ước tính lag tăng/giờ nếu giữ nhịp hiện tại (chỉ khi đang tăng). */
    growthPerHour: number | null;
    state: 'growing' | 'draining' | 'stable' | null;
  };
  lagTrend: {
    current: number | null;
    ago15m: number | null;
    changePercent: number | null;
    direction: 'up' | 'down' | 'flat' | null;
  };
  processing: { avgMs: number | null; p95Ms: number | null; p99Ms: number | null };
  payload: { avgBytes: number | null; maxBytes: number | null; largeBytes: number };
  delivery: DeliveryDto;
  queues: SectionDto<QueueRowDto[]>;
  topChannels: ChannelRowDto[];
  consumers: ConsumerRowDto[];
  deadLetter: SectionDto<{ total: number; latest: MessageRowDto[] }>;
  alerts: MessagingAlertDto[];
  report: { today: MessagingReportDto; yesterday: MessagingReportDto };
  events: MessagingEventDto[];
  settings: MessagingSettingsDto;
}

export interface MessagingSeriesDto {
  id: string;
  label: string;
  unit: string;
  points: { t: number; value: number }[];
}

export interface MessagingMetricsDto {
  metric: MessagingMetric;
  range: MessagingRange;
  resolutionSec: number | null;
  unit: string;
  series: MessagingSeriesDto[];
}

export interface MessagingChannelsDto {
  range: MessagingRange;
  channels: ChannelRowDto[];
  queues: SectionDto<QueueRowDto[]>;
  backlogSampled: number | null;
  backlogTruncated: boolean;
}

export interface ChannelDetailDto {
  range: MessagingRange;
  channel: ChannelRowDto;
  throughput: MessagingSeriesDto[];
  processing: MessagingSeriesDto[];
  consumers: ConsumerRowDto[];
  recentErrors: MessagingErrorDto[];
  recentMessages: SectionDto<MessageRowDto[]>;
}

export interface MessagingProducersDto {
  range: MessagingRange;
  producers: ProducerRowDto[];
}

export interface MessagingConsumersDto {
  range: MessagingRange;
  consumers: ConsumerRowDto[];
  /** Queue có message nhưng không có consumer nào. */
  unconsumed: QueueRowDto[];
}

export interface ConsumerDetailDto {
  range: MessagingRange;
  consumer: ConsumerRowDto;
  processing: MessagingSeriesDto[];
  throughput: MessagingSeriesDto[];
  lag: MessagingSeriesDto[];
  recentErrors: MessagingErrorDto[];
  recentMessages: SectionDto<MessageRowDto[]>;
  retry: { retried: number; recovered: number; deadLettered: number };
}

export interface MessagingMessagesDto {
  messages: SectionDto<MessageRowDto[]>;
  examined: number;
  truncated: boolean;
}

export interface MessagingRetriesDto {
  retrying: SectionDto<MessageRowDto[]>;
  stats: {
    retryingNow: number | null;
    retriedToday: number;
    recoveredToday: number;
    deadLetteredToday: number;
  };
  policy: {
    maxAttempts: number;
    backoff: string;
    initialDelayMs: number;
    maxDelayMs: number;
  };
  retryEnabled: boolean;
}

export interface MessagingDeadLetterDto {
  items: SectionDto<MessageRowDto[]>;
  total: number | null;
  addedToday: number;
  oldestSec: number | null;
  bySource: { channel: string; count: number }[];
  settings: MessagingSettingsDto;
}

export interface MessagingErrorDto {
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

export interface MessagingErrorsDto {
  counts: Record<MessagingErrorKind, number>;
  byStage: { publish: number; consume: number };
  total: number;
  items: MessagingErrorDto[];
  range: MessagingRange;
}

export interface MessagingOperationDto {
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

export interface MessagingBrokerDto {
  broker: SectionDto<BrokerInfo>;
}

export interface MessagingConfigDto {
  items: {
    key: string;
    value: string | number | boolean | null;
    sensitive?: boolean;
    group: string;
  }[];
}

export type MessagingTestDto = MessagingTestResult & { at: string };
