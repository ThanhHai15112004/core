import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/index';
import type {
  ChannelDetail,
  ConsumerDetail,
  MessageDetail,
  MessageFilter,
  MessagePayload,
  MessagingBroker,
  MessagingChannels,
  MessagingConfig,
  MessagingConsumers,
  MessagingDeadLetter,
  MessagingErrors,
  MessagingEvent,
  MessagingMessages,
  MessagingMetric,
  MessagingMetrics,
  MessagingOperation,
  MessagingOverview,
  MessagingProducers,
  MessagingRange,
  MessagingRetries,
  MessagingTest,
} from '../types/messaging.types';
import { toQuery } from './traffic.api';

const M = API_ROUTES.OPS.MESSAGING.path;
const send = <T>(method: 'POST' | 'DELETE', path: string, body: object = {}) => fetchApi<T>(M(path), { method, body: JSON.stringify(body) });
const id = (v: string) => encodeURIComponent(v);

export const messagingApi = {
  overview: (range: MessagingRange) => fetchApi<MessagingOverview>(M('overview', toQuery({ range }))),
  metrics: (range: MessagingRange, metric: MessagingMetric) => fetchApi<MessagingMetrics>(M('metrics', toQuery({ range, metric }))),
  channels: (range: MessagingRange) => fetchApi<MessagingChannels>(M('channels', toQuery({ range }))),
  channel: (name: string, range: MessagingRange) => fetchApi<ChannelDetail>(M(`channels/${id(name)}`, toQuery({ range }))),
  producers: (range: MessagingRange) => fetchApi<MessagingProducers>(M('producers', toQuery({ range }))),
  consumers: (range: MessagingRange) => fetchApi<MessagingConsumers>(M('consumers', toQuery({ range }))),
  consumer: (name: string, range: MessagingRange) => fetchApi<ConsumerDetail>(M(`consumers/${id(name)}`, toQuery({ range }))),
  messages: (f: MessageFilter, count = 100) =>
    fetchApi<MessagingMessages>(
      M(
        'messages',
        toQuery({
          queue: f.queue || undefined,
          channel: f.channel || undefined,
          status: f.status || undefined,
          producer: f.producer || undefined,
          search: f.search || undefined,
          count,
        }),
      ),
    ),
  message: (messageId: string, queue?: string) => fetchApi<MessageDetail>(M(`messages/${id(messageId)}`, toQuery({ queue }))),
  /** Payload đã che — mỗi lần gọi được ghi audit, chỉ gọi khi người dùng bấm. */
  payload: (messageId: string, queue: string) => fetchApi<MessagePayload>(M(`messages/${id(messageId)}/payload`, toQuery({ queue }))),
  retry: (messageId: string, queue: string) => send<MessagingOperation>('POST', `messages/${id(messageId)}/retry`, { queue }),
  retries: () => fetchApi<MessagingRetries>(M('retries')),
  deadLetter: () => fetchApi<MessagingDeadLetter>(M('dead-letter')),
  replay: (messageId: string, queue: string) => send<MessagingOperation>('POST', `dead-letter/${id(messageId)}/replay`, { queue, confirm: 'REPLAY' }),
  discard: (messageId: string, queue: string, confirm: string) => send<MessagingOperation>('DELETE', `dead-letter/${id(messageId)}`, { queue, confirm }),
  broker: () => fetchApi<MessagingBroker>(M('broker')),
  errors: (range: MessagingRange) => fetchApi<MessagingErrors>(M('errors', toQuery({ range }))),
  events: (range: MessagingRange) => fetchApi<MessagingEvent[]>(M('events', toQuery({ range }))),
  operations: () => fetchApi<MessagingOperation[]>(M('operations')),
  config: () => fetchApi<MessagingConfig>(M('config')),
  test: () => send<MessagingTest>('POST', 'test'),
};
