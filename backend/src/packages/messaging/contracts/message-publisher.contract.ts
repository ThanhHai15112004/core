import type { QueueName } from '../constants/queues.constant.js';

export interface MessageEnvelope<T = unknown> {
  readonly id: string;
  readonly topic: string;
  readonly payload: T;
  readonly timestamp: string;
}

export interface MessagePublisherContract {
  /** Đưa message vào queue (mặc định `system.events`); tên job = `topic`. Trả về envelope đã gửi. */
  publish<T>(topic: string, payload: T, queue?: QueueName): Promise<MessageEnvelope<T>>;
}
