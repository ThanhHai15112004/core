import { jest } from '@jest/globals';
import { DomainEventBusService } from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { buildUserCreatedEventInput } from '@modules/users/events/user-domain.events.js';
import {
  WEBHOOKS_DOMAIN_EVENT_HANDLER_ID,
  WebhooksDomainEventListener,
} from '@modules/webhooks/listeners/webhooks-domain-event.listener.js';
import type { WebhooksService } from '@modules/webhooks/services/webhooks.service.js';
import { createDomainEventTestHarness } from '../../concerns/domain-event.concern.js';

describe('Decoupled Users -> Webhooks Domain Event flow', () => {
  it('forwards UserCreated from users module to webhooks listener with requestId & correlationId intact', async () => {
    const bus = new DomainEventBusService();
    bus.setContextResolver(() => {
      const store = RequestContextService.current();
      return store
        ? {
            requestId: store.requestId ?? null,
            correlationId: store.correlationId ?? null,
            actorId: store.userId ?? null,
          }
        : undefined;
    });

    const dispatchEvent = jest.fn(async () => ({
      eventName: 'user.created',
      eventId: 'ev-1',
      matchedEndpointsCount: 1,
      queuedCount: 1,
      failedEnqueueCount: 0,
      deliveryIds: [10],
    }));

    const mockWebhooksService = {
      dispatchEvent,
    } as unknown as WebhooksService;

    const listener = new WebhooksDomainEventListener(mockWebhooksService, bus);
    listener.onModuleInit();

    const harness = createDomainEventTestHarness(bus);

    await RequestContextService.runWith(
      {
        requestId: 'req-user-create-1',
        correlationId: 'corr-user-create-1',
        userId: '5',
      },
      async () => {
        await bus.publish(
          buildUserCreatedEventInput(
            {
              id: 88,
              username: 'nguyenvana',
              status: 1,
              primaryOrganizationUnitId: 3,
              roles: [{ roleId: 2, code: 'member', name: 'Member' }],
            },
            5,
          ),
        );
      },
    );

    const emitted = harness.expectEmitted('UserCreated');
    expect(emitted.metadata.dotName).toBe('user.created');
    expect(emitted.metadata.requestId).toBe('req-user-create-1');
    expect(emitted.metadata.correlationId).toBe('corr-user-create-1');
    expect(emitted.payload).toEqual({
      userId: 88,
      username: 'nguyenvana',
      status: 1,
      primaryOrganizationUnitId: 3,
      roleIds: [2],
    });

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'user.created',
        eventId: emitted.id,
        correlationId: 'corr-user-create-1',
        requestedBy: 5,
        payload: expect.objectContaining({
          userId: 88,
          username: 'nguyenvana',
          eventType: 'UserCreated',
          eventVersion: 1,
          sourceModule: 'users',
          requestId: 'req-user-create-1',
        }),
      }),
    );

    listener.onModuleDestroy();
    expect(
      bus.listHandlers().find((h) => h.id === WEBHOOKS_DOMAIN_EVENT_HANDLER_ID),
    ).toBeUndefined();
    harness.dispose();
  });

  it('ignores events originating from webhooks module and never fails publisher if webhook dispatch throws', async () => {
    const bus = new DomainEventBusService();
    const warnings: string[] = [];
    bus.setLogger({
      log: () => undefined,
      warn: (m) => warnings.push(m),
      error: () => undefined,
    });

    const dispatchEvent = jest.fn(async () => {
      throw new Error('Webhook DB temporarily down');
    });
    const listener = new WebhooksDomainEventListener(
      { dispatchEvent } as unknown as WebhooksService,
      bus,
    );
    listener.onModuleInit();

    // 1. Self-emitted webhooks event should be ignored
    await bus.publish({
      type: 'WebhooksDeliveryFailed',
      dotName: 'webhooks.delivery.failed',
      sourceModule: 'webhooks',
      payload: { deliveryId: 99 },
    });
    expect(dispatchEvent).not.toHaveBeenCalled();

    // 2. External event fails inside optional webhooks handler -> publisher still succeeds & warning is logged
    const report = await bus.publish({
      type: 'UserUpdated',
      dotName: 'user.updated',
      sourceModule: 'users',
      payload: { userId: 88, username: 'nguyenvana', status: 1, changedFields: ['fullName'] },
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(report.failedOptionalCount).toBe(1);
    expect(report.failedRequiredCount).toBe(0);
    expect(warnings).toHaveLength(1);

    listener.onModuleDestroy();
  });
});
