export interface MessageEnvelope<T = unknown> {
  readonly id: string;
  readonly topic: string;
  readonly payload: T;
  readonly timestamp: string;
}

export interface MessagePublisherContract {
  publish<T>(topic: string, payload: T): Promise<void>;
}
