import { Injectable } from '@nestjs/common';
import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IWebhooksPublicService } from '../contracts/index.js';
import type {
  CreateWebhookEndpointRequest,
  ListWebhookDeliveriesQuery,
  ListWebhookEndpointsQuery,
  ReactivateWebhookEndpointRequest,
  ReplayWebhookDeliveryRequest,
  SendWebhookTestEventRequest,
  UpdateWebhookEndpointRequest,
} from '../requests/webhooks.requests.js';
import type {
  DispatchWebhookEventInput,
  DispatchWebhookEventResult,
  ProcessQueuedWebhookDeliveryContext,
  ProcessQueuedWebhookDeliveryResult,
  QueuedWebhookDeliveryJobPayload,
  WebhookDeliveryView,
  WebhookEndpointView,
  WebhookEndpointWithSecretView,
  WebhookEventCatalogItem,
} from '../types/webhooks.types.js';
import { WebhooksDeliveryService } from './webhooks-delivery.service.js';
import { WebhooksEndpointsService } from './webhooks-endpoints.service.js';

@Injectable()
export class WebhooksService implements IWebhooksPublicService {
  constructor(
    private readonly endpointsService: WebhooksEndpointsService,
    private readonly deliveryService: WebhooksDeliveryService,
  ) {}

  public listEventCatalog(): WebhookEventCatalogItem[] {
    return this.endpointsService.listEventCatalog();
  }

  public async listEndpoints(
    query: ListWebhookEndpointsQuery,
  ): Promise<PaginatedResult<WebhookEndpointView>> {
    return this.endpointsService.listEndpoints(query);
  }

  public async getEndpointById(id: number): Promise<WebhookEndpointView> {
    return this.endpointsService.getEndpointById(id);
  }

  public async createEndpoint(
    input: CreateWebhookEndpointRequest,
    actor?: UserIdentity,
  ): Promise<WebhookEndpointWithSecretView> {
    return this.endpointsService.createEndpoint(input, actor);
  }

  public async updateEndpoint(
    id: number,
    input: UpdateWebhookEndpointRequest,
    actor?: UserIdentity,
  ): Promise<WebhookEndpointView> {
    return this.endpointsService.updateEndpoint(id, input, actor);
  }

  public async deleteEndpoint(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.endpointsService.deleteEndpoint(id, actor);
  }

  public async rotateSecret(
    id: number,
    actor?: UserIdentity,
  ): Promise<WebhookEndpointWithSecretView> {
    return this.endpointsService.rotateSecret(id, actor);
  }

  public async reactivateEndpoint(
    id: number,
    input: ReactivateWebhookEndpointRequest,
    actor?: UserIdentity,
  ): Promise<WebhookEndpointView> {
    return this.endpointsService.reactivateEndpoint(id, input, actor);
  }

  public async listDeliveries(
    query: ListWebhookDeliveriesQuery,
  ): Promise<PaginatedResult<WebhookDeliveryView>> {
    return this.deliveryService.listDeliveries(query);
  }

  public async getDeliveryById(id: number): Promise<WebhookDeliveryView> {
    return this.deliveryService.getDeliveryById(id);
  }

  public async sendTestEvent(
    endpointId: number,
    input: SendWebhookTestEventRequest,
    actor?: UserIdentity,
  ): Promise<WebhookDeliveryView> {
    return this.deliveryService.sendTestEvent(endpointId, input, actor);
  }

  public async replayDelivery(
    deliveryId: number,
    input: ReplayWebhookDeliveryRequest,
    actor?: UserIdentity,
  ): Promise<WebhookDeliveryView> {
    return this.deliveryService.replayDelivery(deliveryId, input, actor);
  }

  public async dispatchEvent(
    input: DispatchWebhookEventInput,
  ): Promise<DispatchWebhookEventResult> {
    return this.deliveryService.dispatchEvent(input);
  }

  public async processQueuedDelivery(
    payload: QueuedWebhookDeliveryJobPayload,
    context?: ProcessQueuedWebhookDeliveryContext,
  ): Promise<ProcessQueuedWebhookDeliveryResult> {
    return this.deliveryService.processQueuedDelivery(payload, context);
  }
}
