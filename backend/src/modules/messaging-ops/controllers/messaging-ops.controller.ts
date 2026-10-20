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
import { Public, extractRequestContext, isPrintableString } from '@packages/http/index.js';
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

const nameSchema = z.string().min(1).max(256).refine(isPrintableString);
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
  producer: z.string().max(64).refine(isPrintableString).optional(),
  search: z.string().max(256).refine(isPrintableString).default(''),
  count: z.coerce.number().int().min(10).max(500).default(100),
});
const actionSchema = z.object({ queue: nameSchema });

/** Xác thực và ép kiểu dữ liệu đầu vào theo schema Zod */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new MessagingValidationException(result.error.issues);
  return result.data;
}

/** Trích xuất thông tin ngữ cảnh yêu cầu (RequestContext) từ Fastify request */
const context = (req: FastifyRequest): OperationContext => extractRequestContext(req);

/**
 * Messaging Monitor — health broker, throughput, lag, channel/producer/consumer, message explorer & vòng đời,
 * retry, Dead Letter, lỗi & sự kiện. Thao tác (retry, replay, discard, xem payload) bật/tắt bằng env,
 * có xác nhận và audit.
 */
@Controller(R.PREFIX)
export class MessagingOpsController {
  constructor(private readonly messaging: MessagingOpsService) {}

  /** Lấy dữ liệu tổng quan cho trang quản trị vận hành */
  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() q: Record<string, string>) {
    return this.messaging.getOverview(parse(rangeSchema, q).range);
  }

  /** Lấy các chỉ số đo lường hiệu năng và vận hành */
  @Public()
  @Get(R.METRICS)
  public metrics(@Query() q: Record<string, string>) {
    const { range, metric } = parse(metricsSchema, q);
    return this.messaging.getMetrics(range, metric);
  }

  /** Lấy danh sách các kênh truyền tin nhắn */
  @Public()
  @Get(R.CHANNELS)
  public channels(@Query() q: Record<string, string>) {
    return this.messaging.getChannels(parse(rangeSchema, q).range);
  }

  /** Lấy thông tin chi tiết một kênh truyền tin nhắn */
  @Public()
  @Get(R.CHANNEL_DETAIL)
  public channel(@Param('id') id: string, @Query() q: Record<string, string>) {
    return this.messaging.getChannelDetail(parse(nameSchema, id), parse(rangeSchema, q).range);
  }

  /** Lấy danh sách các consumer đang lắng nghe tin nhắn */
  @Public()
  @Get(R.CONSUMERS)
  public consumers(@Query() q: Record<string, string>) {
    return this.messaging.getConsumers(parse(rangeSchema, q).range);
  }

  /** Lấy thông tin chi tiết một consumer */
  @Public()
  @Get(R.CONSUMER_DETAIL)
  public consumer(@Param('id') id: string, @Query() q: Record<string, string>) {
    return this.messaging.getConsumerDetail(parse(nameSchema, id), parse(rangeSchema, q).range);
  }

  /** Lấy danh sách các tin nhắn trong hàng đợi */
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

  /** Lấy thông tin chi tiết một tin nhắn theo mã định danh */
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

  /** Thực hiện thử lại một tác vụ hoặc job thất bại */
  @Public()
  @Post(R.MESSAGE_RETRY)
  @HttpCode(HttpStatus.OK)
  public retry(@Param('id') id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const { queue } = parse(actionSchema, body ?? {});
    return this.messaging.retry(queue, parse(nameSchema, id), context(req));
  }

  /** Lấy danh sách các lần thử lại hoặc thông tin retry */
  @Public()
  @Get(R.RETRIES)
  public retries() {
    return this.messaging.getRetries();
  }

  /** Lấy danh sách các tin nhắn trong hàng đợi Dead Letter Queue (DLQ) */
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

  /** Lấy thông tin trạng thái hoạt động của broker truyền tin */
  @Public()
  @Get(R.BROKER)
  public broker() {
    return this.messaging.getBroker();
  }

  /** Truy vấn danh sách các lỗi và ngoại lệ ghi nhận được */
  @Public()
  @Get(R.ERRORS)
  public errors(@Query() q: Record<string, string>) {
    return this.messaging.getErrors(parse(rangeSchema, q).range);
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  @Public()
  @Get(R.EVENTS)
  public events(@Query() q: Record<string, string>) {
    return this.messaging.getEvents(parse(rangeSchema, q).range);
  }

  /** Truy vấn lịch sử các thao tác vận hành đã thực hiện */
  @Public()
  @Get(R.OPERATIONS)
  public operations() {
    return this.messaging.getOperations();
  }

  /** Lấy thông tin cấu hình hiện tại của dịch vụ */
  @Public()
  @Get(R.CONFIG)
  public config() {
    return this.messaging.getConfig();
  }

  /** Kiểm tra khả năng kết nối và tính sẵn sàng của dịch vụ */
  @Public()
  @Post(R.TEST)
  @HttpCode(HttpStatus.OK)
  public test(@Req() req: FastifyRequest) {
    return this.messaging.test(context(req));
  }
}
