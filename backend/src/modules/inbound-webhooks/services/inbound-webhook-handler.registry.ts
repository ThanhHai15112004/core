import { Injectable } from '@nestjs/common';
import type { IInboundWebhookHandlerRegistry } from '../contracts/index.js';
import type { InboundWebhookHandlerRegistration } from '../types/inbound-webhooks.types.js';

@Injectable()
export class InboundWebhookHandlerRegistry implements IInboundWebhookHandlerRegistry {
  private readonly handlers = new Map<string, InboundWebhookHandlerRegistration>();

  private static makeBindingKey(providerCode: string, eventType: string): string {
    return `${providerCode.trim().toLowerCase()}::${eventType.trim().toLowerCase()}`;
  }

  public registerHandler(registration: InboundWebhookHandlerRegistration): void {
    const cleanName = registration.name.trim();
    if (!cleanName) return;
    this.handlers.set(cleanName, {
      ...registration,
      name: cleanName,
      providerCode: registration.providerCode.trim().toLowerCase() || '*',
      eventType: registration.eventType.trim().toLowerCase() || '*',
    });
  }

  public unregisterHandler(name: string): void {
    this.handlers.delete(name.trim());
  }

  public listHandlers(): readonly Omit<InboundWebhookHandlerRegistration, 'handle'>[] {
    return [...this.handlers.values()].map(({ handle: _handle, ...meta }) => meta);
  }

  public resolveHandler(
    providerCode: string,
    eventType: string | null | undefined,
  ): InboundWebhookHandlerRegistration | null {
    const pCode = providerCode.trim().toLowerCase();
    const eType = (eventType ?? '').trim().toLowerCase();

    const candidates = [
      ...(eType ? [InboundWebhookHandlerRegistry.makeBindingKey(pCode, eType)] : []),
      InboundWebhookHandlerRegistry.makeBindingKey(pCode, '*'),
      ...(eType ? [InboundWebhookHandlerRegistry.makeBindingKey('*', eType)] : []),
      InboundWebhookHandlerRegistry.makeBindingKey('*', '*'),
    ];

    for (const key of candidates) {
      for (const reg of this.handlers.values()) {
        if (InboundWebhookHandlerRegistry.makeBindingKey(reg.providerCode, reg.eventType) === key) {
          return reg;
        }
      }
    }

    return null;
  }
}
