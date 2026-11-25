import type {
  CreateDomainEventInput,
  DomainEvent,
  EnqueueOutboxEventOptions,
  OutboxEnqueuedRecord,
  OutboxMetricsSnapshot,
  PaginatedResult,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  OutboxDispatchBatchOptions,
  OutboxDispatchBatchResult,
  OutboxEventDetailView,
  OutboxEventView,
  OutboxLagAlertCheckResult,
  OutboxPurgeOptions,
  OutboxPurgeResult,
  OutboxReplayBatchResult,
  OutboxTransportDispatchInput,
  OutboxTransportDispatchResult,
} from '../types/outbox.types.js';

export const OUTBOX_PUBLIC_SERVICE = Symbol('OUTBOX_PUBLIC_SERVICE');
export const OUTBOX_TRANSPORT_PORT = Symbol('OUTBOX_TRANSPORT_PORT');

export interface IOutboxTransport {
  readonly driverName: string;
  dispatch(input: OutboxTransportDispatchInput): Promise<OutboxTransportDispatchResult>;
}

export interface ListOutboxEventsInput {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly status?: number | undefined;
  readonly sourceModule?: string | undefined;
  readonly eventType?: string | undefined;
  readonly aggregateType?: string | undefined;
  readonly aggregateId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly search?: string | undefined;
}

export interface ReplayOutboxEventInput {
  readonly reason: string;
  readonly force?: boolean | undefined;
}

export interface ReplayOutboxBatchInput {
  readonly ids: readonly number[];
  readonly reason: string;
  readonly force?: boolean | undefined;
}

export interface IOutboxPublicService {
  enqueueEvent<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    input: CreateDomainEventInput<TPayload> | DomainEvent<TPayload>,
    options?: EnqueueOutboxEventOptions,
  ): Promise<OutboxEnqueuedRecord>;
  listEvents(query: ListOutboxEventsInput): Promise<PaginatedResult<OutboxEventView>>;
  getEventById(id: number): Promise<OutboxEventDetailView>;
  getMetrics(now?: Date): Promise<OutboxMetricsSnapshot>;
  replayEvent(
    id: number,
    input: ReplayOutboxEventInput,
    actor?: UserIdentity,
  ): Promise<OutboxEventDetailView>;
  replayBatch(
    input: ReplayOutboxBatchInput,
    actor?: UserIdentity,
  ): Promise<OutboxReplayBatchResult>;
  processPendingBatch(options?: OutboxDispatchBatchOptions): Promise<OutboxDispatchBatchResult>;
  checkLagAndAlert(now?: Date): Promise<OutboxLagAlertCheckResult>;
  purgeExpiredEvents(
    options?: OutboxPurgeOptions,
    actor?: UserIdentity,
  ): Promise<OutboxPurgeResult>;
}
