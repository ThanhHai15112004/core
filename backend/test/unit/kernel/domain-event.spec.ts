import {
  DOMAIN_EVENT_CRITICALITY,
  DOMAIN_EVENT_ERROR_CODE,
  DomainEventBusService,
  DomainEventNamingViolationException,
  DomainEventPayloadViolationException,
  DomainEventRequiredHandlerException,
  assertSafeDomainEventPayload,
  createDomainEvent,
  isValidDotEventName,
  isValidPascalEventName,
  matchesDomainEventPattern,
  normalizeDomainEventType,
  toDotEventName,
  toPascalEventName,
  type DomainEvent,
  type DomainEventLogger,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { createDomainEventTestHarness } from '../../concerns/domain-event.concern.js';

const ORM_ENTITY_WATERMARK = Symbol.for('core:orm_entity');

class FakeOrmEntity {
  public static readonly [ORM_ENTITY_WATERMARK] = true;
  public id = 1;
  public username = 'alice';
}

class CustomDomainClass {
  public readonly id = 99;
}

describe('Domain Event Standard & Bus (Phase 11.1)', () => {
  describe('Naming convention & bidirectional mapping (PascalCase <-> dot.snake_case)', () => {
    it('accepts valid PascalCase names and maps to dot.snake_case', () => {
      expect(isValidPascalEventName('UserCreated')).toBe(true);
      expect(isValidPascalEventName('OrderApproved')).toBe(true);
      expect(isValidPascalEventName('UserRolesAssigned')).toBe(true);

      expect(toDotEventName('UserCreated')).toBe('user.created');
      expect(toDotEventName('OrderApproved')).toBe('order.approved');
      expect(toDotEventName('UserRolesAssigned')).toBe('user.roles_assigned');
    });

    it('accepts manifest dot.snake_case names and normalizes to canonical PascalCase', () => {
      expect(isValidDotEventName('user.created')).toBe(true);
      expect(isValidDotEventName('payments.transaction.succeeded')).toBe(true);

      expect(toPascalEventName('user.created')).toBe('UserCreated');
      expect(toPascalEventName('order.approved')).toBe('OrderApproved');
      expect(toPascalEventName('user.roles_assigned')).toBe('UserRolesAssigned');
      expect(toPascalEventName('custom-fields.definition.created')).toBe(
        'CustomFieldsDefinitionCreated',
      );

      expect(normalizeDomainEventType('user.created')).toEqual({
        type: 'UserCreated',
        dotName: 'user.created',
      });
    });

    it('rejects invalid event names (single word, camelCase, empty, special chars)', () => {
      for (const bad of ['', 'User', 'userCreated', 'USER_CREATED', 'user', '123Created']) {
        expect(() => toPascalEventName(bad)).toThrow(DomainEventNamingViolationException);
      }
    });
  });

  describe('Event envelope standard & RequestContext tracing', () => {
    it('creates an immutable standard DomainEvent with id, type, version, occurredAt, requestId and correlationId', () => {
      const event = createDomainEvent(
        {
          type: 'OrderApproved',
          version: 2,
          sourceModule: 'orders',
          aggregateType: 'Order',
          aggregateId: 'ORD-1001',
          payload: {
            orderId: 'ORD-1001',
            totalAmount: 500000,
            approvedAt: new Date('2026-11-25T00:00:00.000Z'),
          },
        },
        {
          requestId: 'req-abc-123',
          correlationId: 'corr-xyz-999',
          actorId: 42,
        },
      );

      expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(event.type).toBe('OrderApproved');
      expect(event.version).toBe(2);
      expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
      expect(event.aggregateType).toBe('Order');
      expect(event.aggregateId).toBe('ORD-1001');
      expect(event.metadata).toEqual({
        requestId: 'req-abc-123',
        correlationId: 'corr-xyz-999',
        causationId: null,
        actorId: 42,
        sourceModule: 'orders',
        dotName: 'order.approved',
      });
      expect(event.payload).toEqual({
        orderId: 'ORD-1001',
        totalAmount: 500000,
        approvedAt: '2026-11-25T00:00:00.000Z',
      });
      expect(Object.isFrozen(event)).toBe(true);
      expect(Object.isFrozen(event.payload)).toBe(true);
    });

    it('automatically attaches requestId & correlationId from AsyncLocalStorage RequestContextService', async () => {
      const bus = new DomainEventBusService();
      bus.setContextResolver(() => {
        const store = RequestContextService.current();
        if (!store) return undefined;
        return {
          requestId: store.requestId ?? null,
          correlationId: store.correlationId ?? null,
          actorId: store.userId ?? null,
        };
      });

      const harness = createDomainEventTestHarness(bus);

      await RequestContextService.runWith(
        {
          requestId: 'req-http-777',
          correlationId: 'corr-trace-888',
          userId: '15',
        },
        async () => {
          await bus.publish({
            type: 'UserCreated',
            sourceModule: 'users',
            payload: { userId: 101, username: 'bob' },
          });
        },
      );

      const emitted = harness.expectEmitted<{ userId: number; username: string }>('UserCreated');
      expect(emitted.metadata.requestId).toBe('req-http-777');
      expect(emitted.metadata.correlationId).toBe('corr-trace-888');
      expect(emitted.metadata.actorId).toBe('15');
      harness.dispose();
    });
  });

  describe('Payload safety policy (strictly blocks ORM Entities & secrets)', () => {
    it('throws DOMAIN_EVENT_ENTITY_LEAK when passing an ORM entity or class instance', () => {
      const ormEntity = new FakeOrmEntity() as unknown as Record<string, unknown>;
      expect(() => assertSafeDomainEventPayload(ormEntity)).toThrow(
        DomainEventPayloadViolationException,
      );

      try {
        assertSafeDomainEventPayload({ nested: new CustomDomainClass() });
        throw new Error('Expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(DomainEventPayloadViolationException);
        expect((err as DomainEventPayloadViolationException).code).toBe(
          DOMAIN_EVENT_ERROR_CODE.ENTITY_LEAK,
        );
        expect((err as DomainEventPayloadViolationException).fieldPath).toBe('payload.nested');
      }
    });

    it('throws DOMAIN_EVENT_SECRET_LEAK when payload contains password/token/secret/apiKey fields', () => {
      const badPayloads: Record<string, unknown>[] = [
        { userId: 1, passwordHash: 'argon2...' },
        { userId: 1, auth: { accessToken: 'jwt...' } },
        { clientId: 'c1', clientSecret: 'sec_123' },
        { provider: 'stripe', api_key: 'sk_live_xxx' },
        { otp: '123456' },
      ];

      for (const payload of badPayloads) {
        try {
          assertSafeDomainEventPayload(payload);
          throw new Error(`Expected secret leak error for ${JSON.stringify(payload)}`);
        } catch (err) {
          expect(err).toBeInstanceOf(DomainEventPayloadViolationException);
          expect((err as DomainEventPayloadViolationException).code).toBe(
            DOMAIN_EVENT_ERROR_CODE.SECRET_LEAK,
          );
        }
      }
    });

    it('rejects circular references and invalid version numbers', () => {
      const cyclic: Record<string, unknown> = { id: 1 };
      cyclic['self'] = cyclic;
      expect(() => assertSafeDomainEventPayload(cyclic)).toThrow(
        DomainEventPayloadViolationException,
      );

      expect(() =>
        createDomainEvent({
          type: 'UserCreated',
          version: 0,
          sourceModule: 'users',
          payload: { userId: 1 },
        }),
      ).toThrow(DomainEventPayloadViolationException);
    });
  });

  describe('Event pattern matching, handler decoupling & error classification', () => {
    it('matches exact PascalCase, dotName, prefix wildcards and global wildcard', () => {
      const event = createDomainEvent({
        type: 'UserCreated',
        sourceModule: 'users',
        payload: { userId: 1 },
      });
      expect(matchesDomainEventPattern('UserCreated', event)).toBe(true);
      expect(matchesDomainEventPattern('user.created', event)).toBe(true);
      expect(matchesDomainEventPattern('user.*', event)).toBe(true);
      expect(matchesDomainEventPattern('User*', event)).toBe(true);
      expect(matchesDomainEventPattern('*', event)).toBe(true);
      expect(matchesDomainEventPattern('OrderApproved', event)).toBe(false);
      expect(matchesDomainEventPattern('order.*', event)).toBe(false);
    });

    it('isolates optional handler failures, logs warn, and lets remaining handlers succeed', async () => {
      const bus = new DomainEventBusService();
      const warnings: Array<{ message: string; meta?: Record<string, unknown> | undefined }> = [];
      const errors: Array<{ message: string; meta?: Record<string, unknown> | undefined }> = [];
      const spyLogger: DomainEventLogger = {
        log: () => undefined,
        warn: (message, meta) => warnings.push({ message, meta }),
        error: (message, meta) => errors.push({ message, meta }),
      };
      bus.setLogger(spyLogger);

      const received: DomainEvent[] = [];

      bus.registerHandler({
        id: 'analytics.optional_fail',
        module: 'analytics',
        eventPattern: 'UserCreated',
        criticality: DOMAIN_EVENT_CRITICALITY.OPTIONAL,
        handler: async () => {
          throw new Error('Analytics sink unreachable');
        },
      });

      bus.registerHandler({
        id: 'notifications.welcome',
        module: 'notifications',
        eventPattern: 'user.*',
        criticality: DOMAIN_EVENT_CRITICALITY.OPTIONAL,
        handler: async (ev) => {
          received.push(ev);
        },
      });

      const report = await bus.publish({
        type: 'UserCreated',
        sourceModule: 'users',
        requestId: 'req-1',
        correlationId: 'corr-1',
        payload: { userId: 7, username: 'carol' },
      });

      expect(report.matchedHandlers).toBe(2);
      expect(report.succeededCount).toBe(1);
      expect(report.failedOptionalCount).toBe(1);
      expect(report.failedRequiredCount).toBe(0);
      expect(received).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.meta?.['criticality']).toBe('optional');
      expect(warnings[0]?.meta?.['handlerId']).toBe('analytics.optional_fail');
      expect(warnings[0]?.meta?.['correlationId']).toBe('corr-1');
    });

    it('logs error and throws DomainEventRequiredHandlerException when a required handler fails', async () => {
      const bus = new DomainEventBusService();
      const errors: Array<{ message: string; meta?: Record<string, unknown> | undefined }> = [];
      bus.setLogger({
        log: () => undefined,
        warn: () => undefined,
        error: (message, meta) => errors.push({ message, meta }),
      });

      bus.registerHandler({
        id: 'billing.ledger_required',
        module: 'billing',
        eventPattern: 'OrderApproved',
        criticality: DOMAIN_EVENT_CRITICALITY.REQUIRED,
        handler: async () => {
          throw new Error('Ledger write constraint violation');
        },
      });

      await expect(
        bus.publish({
          type: 'OrderApproved',
          sourceModule: 'orders',
          requestId: 'req-ord-9',
          correlationId: 'corr-ord-9',
          payload: { orderId: 'ORD-9', amount: 120000 },
        }),
      ).rejects.toThrow(DomainEventRequiredHandlerException);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.meta?.['criticality']).toBe('required');
      expect(errors[0]?.meta?.['handlerId']).toBe('billing.ledger_required');
      expect(errors[0]?.meta?.['requestId']).toBe('req-ord-9');

      const snapshot = bus.getSnapshot();
      expect(snapshot.totalRequiredFailures).toBe(1);
      expect(snapshot.handlers[0]?.failedCount).toBe(1);
    });
  });
});
