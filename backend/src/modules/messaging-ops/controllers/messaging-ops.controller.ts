import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Public } from '@packages/http/index.js';
import { maskIp } from '@packages/traffic/utils/capture.js';
import {
  MESSAGE_STATUSES,
  type MessageStatus,
  type OperationContext,
} from '@packages/messaging/index.js';
import { MESSAGING_OPS_ROUTES as R } from '../routes/messaging-ops.routes.js';
import {
  MESSAGING_METRICS,
  MESSAGING_RANGES,
  MessagingOpsService,
} from '../services/messaging-ops.service.js';
import { MessagingValidationException } from '../exceptions/messaging-ops.exceptions.js';
import type { MessagingMetric, MessagingRange } from '../responses/messaging-ops.response.js';

const printable = (s: string) =>
  ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const nameSchema = z.string().min(1).max(256).refine(printable);
const rangeSchema = z.object({
  range: z
    .enum(Object.keys(MESSAGING_RANGES) as [MessagingRange, ...MessagingRange[]])
    .default('1h'),
});
const metricsSchema = rangeSchema.extend({
  metric: z
    .enum(MESSAGING_METRICS as [MessagingMetric, ...MessagingMetric[]])
    .default('throughput'),
});
const queueSchema = z.object({ queue: nameSchema.optional() });
const messagesSchema = z.object({
  queue: nameSchema.optional(),
  channel: nameSchema.optional(),
  status: z.enum(MESSAGE_STATUSES as [MessageStatus, ...MessageStatus[]]).optional(),
  producer: z.string().max(64).refine(printable).optional(),
  search: z.string().max(256).refine(printable).default(''),
  count: z.coerce.number().int().min(10).max(500).default(100),
});
const actionSchema = z.object({ queue: nameSchema });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new MessagingValidationException(result.error.issues);
  return result.data;
}

const context = (req: FastifyRequest): OperationContext => ({ ip: maskIp(req.ip), actor: null });

/**
 * Messaging Monitor — health broker, throughput, lag, channel/producer/consumer, message explorer & vòng đời,
 * retry, Dead Letter, lỗi & sự kiện. Thao tác (retry, replay, discard, xem payload) bật/tắt bằng env,
 * có xác nhận và audit.
 */
@Controller(R.PREFIX)
export class MessagingOpsController {
  constructor(private readonly messaging: MessagingOpsService) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.messaging.getOverview(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    const { range, metric } = parse(metricsSchema, q);
    return this.messaging.getMetrics(range, metric);
  }

  @Public()
  @Get(R.CHANNELS)
  public channels(@Query() q: Record<string, string>) {
    return this.messaging.getChannels(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.CHANNEL_DETAIL)
  public channel(@Param('id') id: string, @Query() q: Record<string, string>) {
    return this.messaging.getChannelDetail(parse(nameSchema, id), parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.PRODUCERS)
  public producers(@Query() q: Record<string, string>) {
    return this.messaging.getProducers(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.CONSUMERS)
  public consumers(@Query() q: Record<string, string>) {
    return this.messaging.getConsumers(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.CONSUMER_DETAIL)
  public consumer(@Param('id') id: string, @Query() q: Record<string, string>) {
    return this.messaging.getConsumerDetail(parse(nameSchema, id), parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.MESSAGES)
  public messages(@Query() q: Record<string, string>) {
    const f = parse(messagesSchema, q);
    return this.messaging.getMessages(
      {
        queue: f.queue ?? null,
        channel: f.channel ?? null,
        status: f.status ?? null,
        producer: f.producer ?? null,
        search: f.search,
      },
      f.count,
    );
  }

  @Public()
  @Get(R.MESSAGE_DETAIL)
  public message(@Param('id') id: string, @Query() q: Record<string, string>) {
    return this.messaging.getMessageDetail(
      parse(nameSchema, id),
      parse(queueSchema, q).queue ?? null,
    );
  }

  /** Payload (đã che) — quyền riêng (`OPS_MESSAGING_PAYLOAD_ENABLED`), mỗi lần xem ghi audit. */
  @Public()
  @Get(R.MESSAGE_PAYLOAD)
  public payload(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Req() req: FastifyRequest,
  ) {
    return this.messaging.payload(
      parse(nameSchema, id),
      parse(queueSchema, q).queue ?? null,
      context(req),
    );
  }

  @Public()
  @Post(R.MESSAGE_RETRY)
  @HttpCode(HttpStatus.OK)
  public retry(@Param('id') id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const { queue } = parse(actionSchema, body ?? {});
    return this.messaging.retry(queue, parse(nameSchema, id), context(req));
  }

  @Public()
  @Get(R.RETRIES)
  public retries() {
    return this.messaging.getRetries();
  }

  @Public()
  @Get(R.DEAD_LETTER)
  public deadLetter() {
    return this.messaging.getDeadLetter();
  }

  /** Replay có thể chạy lại nghiệp vụ — phải gõ REPLAY để xác nhận. */
  @Public()
  @Post(R.DEAD_LETTER_REPLAY)
  @HttpCode(HttpStatus.OK)
  public replay(@Param('id') id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const { queue } = parse(actionSchema.extend({ confirm: z.literal('REPLAY') }), body ?? {});
    return this.messaging.replay(queue, parse(nameSchema, id), context(req));
  }

  /** Xoá vĩnh viễn — phải gõ lại đúng message ID. */
  @Public()
  @Delete(R.DEAD_LETTER_DISCARD)
  @HttpCode(HttpStatus.OK)
  public discard(@Param('id') id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const messageId = parse(nameSchema, id);
    const { queue } = parse(actionSchema.extend({ confirm: z.literal(messageId) }), body ?? {});
    return this.messaging.discard(queue, messageId, context(req));
  }

  @Public()
  @Get(R.BROKER)
  public broker() {
    return this.messaging.getBroker();
  }

  @Public()
  @Get(R.ERRORS)
  public errors(@Query() q: Record<string, string>) {
    return this.messaging.getErrors(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.EVENTS)
  public events(@Query() q: Record<string, string>) {
    return this.messaging.getEvents(parse(rangeSchema, q).range);
  }

  @Public()
  @Get(R.OPERATIONS)
  public operations() {
    return this.messaging.getOperations();
  }

  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.messaging.getConfig();
  }

  @Public()
  @Post(R.TEST)
  @HttpCode(HttpStatus.OK)
  public test(@Req() req: FastifyRequest) {
    return this.messaging.test(context(req));
  }
}
