import {
  DomainEventBusService,
  type DomainEvent,
  toPascalEventName,
} from '@packages/kernel/index.js';

export interface DomainEventTestHarness {
  readonly bus: DomainEventBusService;
  getEvents(): readonly DomainEvent[];
  findByType(eventType: string): readonly DomainEvent[];
  expectEmitted<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    eventType: string,
    predicate?: (event: DomainEvent<TPayload>) => boolean,
  ): DomainEvent<TPayload>;
  clear(): void;
  dispose(): void;
}

/**
 * Helper kiểm thử dùng chung cho mọi module để xác minh Domain Event đã được phát đúng chuẩn
 * (`id`, `type`, `version`, `occurredAt`, `requestId`, `correlationId`, payload sạch).
 */
export function createDomainEventTestHarness(
  bus: DomainEventBusService = new DomainEventBusService(),
): DomainEventTestHarness {
  bus.startRecording();

  const findByType = (eventType: string): readonly DomainEvent[] => {
    const canonical = toPascalEventName(eventType);
    return bus.getRecordedEvents().filter((e) => e.type === canonical);
  };

  return {
    bus,
    getEvents: () => bus.getRecordedEvents(),
    findByType,
    expectEmitted: <TPayload extends Record<string, unknown> = Record<string, unknown>>(
      eventType: string,
      predicate?: (event: DomainEvent<TPayload>) => boolean,
    ): DomainEvent<TPayload> => {
      const matched = findByType(eventType) as readonly DomainEvent<TPayload>[];
      const found = predicate ? matched.find(predicate) : matched[matched.length - 1];
      if (!found) {
        const emittedTypes = bus.getRecordedEvents().map((e) => e.type);
        throw new Error(
          `Expected DomainEvent "${eventType}" to be emitted, but recorded events were: [${emittedTypes.join(', ')}]`,
        );
      }
      return found;
    },
    clear: () => bus.clearRecordedEvents(),
    dispose: () => {
      bus.stopRecording();
      bus.clearRecordedEvents();
    },
  };
}
