import { randomUUID } from 'node:crypto';
import type { MessageEnvelope } from '../contracts/message-publisher.contract.js';

export function serializeMessage<T>(topic: string, payload: T): MessageEnvelope<T> {
  return {
    id: randomUUID(),
    topic,
    payload,
    timestamp: new Date().toISOString(),
  };
}
