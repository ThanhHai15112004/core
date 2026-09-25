import type { QueueName } from '../constants/queues.constant.js';

export interface MessageEnvelope<T = unknown> {
  readonly id: string;
  readonly topic: string;
  readonly payload: T;
  readonly timestamp: string;
  /** Runtime đã publish (api, scheduler, cli…) — để trang Messaging biết producer. */
  readonly producer?: string | null;
  /** Correlation ID của request/tác vụ đã publish — consumer chạy trong cùng correlation để lần theo log. */
  readonly correlationId?: string | null;
}

export interface MessagePublisherContract {
  /** Đưa message vào queue (mặc định `system.events`); tên job = `topic`. Trả về envelope đã gửi. */
  publish<T>(topic: string, payload: T, queue?: QueueName): Promise<MessageEnvelope<T>>;
}
