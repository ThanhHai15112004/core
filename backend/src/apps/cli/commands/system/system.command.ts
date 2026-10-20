import { Injectable, Logger } from '@nestjs/common';
import { safeJsonParse } from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, QUEUES, type QueueName } from '@packages/messaging/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  LONG_RUNNING_RUNTIMES,
  runtimeKeys,
  type RuntimeHeartbeat,
} from '@packages/runtime/index.js';
import {
  type CliCommandDescriptor,
  type ICliCommandProvider,
} from '../../dispatcher/cli-dispatcher.service.js';

type Handler = (args: string[]) => Promise<void>;

/**
 * Các lệnh CLI:
 *   queue:publish <topic> [jsonPayload] [queue]   Đẩy job vào queue (mặc định system.events)
 *   runtime:status                                In trạng thái heartbeat của các runtime
 *   help
 */
@Injectable()
export class SystemCommand implements ICliCommandProvider {
  private readonly logger = new Logger(SystemCommand.name);
  private readonly handlers: Record<string, Handler> = {
    'queue:publish': (args) => this.publish(args),
    'runtime:status': () => this.runtimeStatus(),
    help: async () => this.help(),
  };

  constructor(
    private readonly publisher: BaseMessagePublisherProvider,
    private readonly redis: RedisService,
  ) {}

  /** Khai báo danh mục các lệnh thuộc domain System & Messaging */
  public getCommands(): CliCommandDescriptor[] {
    return [
      {
        name: 'queue:publish',
        domain: 'System & Messaging',
        description: 'Đẩy job thử nghiệm vào queue',
        usage: 'npm run cli -- queue:publish <topic> [jsonPayload] [queue]',
        execute: (args) => this.publish(args),
      },
      {
        name: 'runtime:status',
        domain: 'System & Messaging',
        description: 'In trạng thái heartbeat của các runtime từ Redis',
        usage: 'npm run cli -- runtime:status',
        execute: () => this.runtimeStatus(),
      },
    ];
  }

  /** Lấy tên lệnh đầu tiên từ mảng đối số */
  public commandName(args: string[]): string {
    return args[0] ?? 'help';
  }

  /** Thực thi lệnh hệ thống theo tên được truyền vào */
  public async execute(args: string[]): Promise<void> {
    const [name = 'help', ...rest] = args;
    const handler = this.handlers[name];
    if (!handler) throw new Error(`Unknown command "${name}". Run "help" to list commands.`);
    await handler(rest);
  }

  /** Đẩy một message payload thử nghiệm vào queue BullMQ */
  private async publish([topic, rawPayload, queue]: string[]): Promise<void> {
    if (!topic) throw new Error('Usage: queue:publish <topic> [jsonPayload] [queue]');
    const queues = Object.values(QUEUES) as string[];
    if (queue && !queues.includes(queue))
      throw new Error(`Unknown queue "${queue}". Available: ${queues.join(', ')}`);
    const payload: unknown = rawPayload ? safeJsonParse(rawPayload, {}) : {};
    const envelope = await this.publisher.publish(topic, payload, queue as QueueName | undefined);
    this.logger.log(`Published ${topic} → ${queue ?? QUEUES.SYSTEM_EVENTS} (job ${envelope.id})`);
  }

  /** Đọc và hiển thị thông tin heartbeat của các runtime từ Redis */
  private async runtimeStatus(): Promise<void> {
    const keys = runtimeKeys(this.redis);
    for (const id of LONG_RUNNING_RUNTIMES) {
      const raw = await this.redis.client.get(keys.heartbeat(id));
      const hb = safeJsonParse<RuntimeHeartbeat | null>(raw, null);
      if (!hb) {
        this.logger.log(`${id.padEnd(10)} no heartbeat`);
        continue;
      }
      this.logger.log(
        `${id.padEnd(10)} ${hb.state.padEnd(8)} pid=${hb.process.pid} cpu=${hb.resources.cpuPercent}% rss=${hb.resources.rssMb}MB up=${hb.uptimeSec}s`,
      );
    }
  }

  /** In danh sách các lệnh hệ thống cơ bản */
  private help(): void {
    this.logger.log(
      'Commands: queue:publish <topic> [jsonPayload] [queue] | runtime:status | help',
    );
  }
}
