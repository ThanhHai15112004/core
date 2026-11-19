import { Injectable } from '@nestjs/common';
import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IInboundWebhooksPublicService } from '../contracts/index.js';
import type {
  CreateInboundWebhookProviderRequest,
  ListInboundWebhookEventsQuery,
  ListInboundWebhookProvidersQuery,
  ReprocessInboundWebhookEventRequest,
  RotateInboundWebhookSecretRequest,
  SimulateInboundWebhookRequest,
  UpdateInboundWebhookProviderRequest,
} from '../requests/inbound-webhooks.requests.js';
import type {
  InboundWebhookEventView,
  InboundWebhookProviderView,
  InboundWebhookProviderWithSecretView,
  ProcessQueuedInboundWebhookContext,
  ProcessQueuedInboundWebhookResult,
  QueuedInboundWebhookJobPayload,
  ReceiveInboundWebhookInput,
  ReceiveInboundWebhookResult,
  SimulateInboundWebhookResult,
} from '../types/inbound-webhooks.types.js';
import { InboundWebhooksProcessingService } from './inbound-webhooks-processing.service.js';
import { InboundWebhooksProvidersService } from './inbound-webhooks-providers.service.js';
import { InboundWebhooksReceiveService } from './inbound-webhooks-receive.service.js';

@Injectable()
export class InboundWebhooksService implements IInboundWebhooksPublicService {
  constructor(
    private readonly providersService: InboundWebhooksProvidersService,
    private readonly receiveService: InboundWebhooksReceiveService,
    private readonly processingService: InboundWebhooksProcessingService,
  ) {}

  public async listProviders(
    query: ListInboundWebhookProvidersQuery,
  ): Promise<PaginatedResult<InboundWebhookProviderView>> {
    return this.providersService.listProviders(query);
  }

  public async getProviderById(id: number): Promise<InboundWebhookProviderView> {
    return this.providersService.getProviderById(id);
  }

  public async createProvider(
    input: CreateInboundWebhookProviderRequest,
    actor?: UserIdentity,
  ): Promise<InboundWebhookProviderWithSecretView> {
    return this.providersService.createProvider(input, actor);
  }

  public async updateProvider(
    id: number,
    input: UpdateInboundWebhookProviderRequest,
    actor?: UserIdentity,
  ): Promise<InboundWebhookProviderView> {
    return this.providersService.updateProvider(id, input, actor);
  }

  public async deleteProvider(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.providersService.deleteProvider(id, actor);
  }

  public async rotateSecret(
    id: number,
    input: RotateInboundWebhookSecretRequest,
    actor?: UserIdentity,
  ): Promise<InboundWebhookProviderWithSecretView> {
    return this.providersService.rotateSecret(id, input, actor);
  }

  public async simulateProviderWebhook(
    id: number,
    input: SimulateInboundWebhookRequest,
    actor?: UserIdentity,
  ): Promise<SimulateInboundWebhookResult> {
    return this.receiveService.simulateProviderWebhook(id, input, actor);
  }

  public async receiveWebhook(
    input: ReceiveInboundWebhookInput,
  ): Promise<ReceiveInboundWebhookResult> {
    return this.receiveService.receiveWebhook(input);
  }

  public async listEvents(
    query: ListInboundWebhookEventsQuery,
  ): Promise<PaginatedResult<InboundWebhookEventView>> {
    return this.processingService.listEvents(query);
  }

  public async getEventById(id: number): Promise<InboundWebhookEventView> {
    return this.processingService.getEventById(id);
  }

  public async reprocessEvent(
    eventId: number,
    input: ReprocessInboundWebhookEventRequest,
    actor?: UserIdentity,
  ): Promise<InboundWebhookEventView> {
    return this.processingService.reprocessEvent(eventId, input, actor);
  }

  public async processQueuedEvent(
    payload: QueuedInboundWebhookJobPayload,
    context?: ProcessQueuedInboundWebhookContext,
  ): Promise<ProcessQueuedInboundWebhookResult> {
    return this.processingService.processQueuedEvent(payload, context);
  }
}
