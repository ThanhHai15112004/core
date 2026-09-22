import { Injectable, Logger } from '@nestjs/common';
import { BaseMessagePublisherProvider, QUEUES, type QueueName } from '@packages/messaging/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  LONG_RUNNING_RUNTIMES,
  runtimeKeys,
  type RuntimeHeartbeat,
} from '@packages/runtime/index.js';

type Handler = (args: string[]) => Promise<void>;

/**
 * Các lệnh CLI:
 *   queue:publish <topic> [jsonPayload] [queue]   Đẩy job vào queue (mặc định system.events)
 *   runtime:status                                In trạng thái heartbeat của các runtime
 *   help
 */
@Injectable()
export class SystemCommand {
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

  public commandName(args: string[]): string {
    return args[0] ?? 'help';
  }

  public async execute(args: string[]): Promise<void> {
    const [name = 'help', ...rest] = args;
    const handler = this.handlers[name];
    if (!handler) throw new Error(`Unknown command "${name}". Run "help" to list commands.`);
    await handler(rest);
  }

  private async publish([topic, rawPayload, queue]: string[]): Promise<void> {
    if (!topic) throw new Error('Usage: queue:publish <topic> [jsonPayload] [queue]');
    const queues = Object.values(QUEUES) as string[];
    if (queue && !queues.includes(queue))
      throw new Error(`Unknown queue "${queue}". Available: ${queues.join(', ')}`);
    const payload: unknown = rawPayload ? JSON.parse(rawPayload) : {};
    const envelope = await this.publisher.publish(topic, payload, queue as QueueName | undefined);
    this.logger.log(`Published ${topic} → ${queue ?? QUEUES.SYSTEM_EVENTS} (job ${envelope.id})`);
  }

  private async runtimeStatus(): Promise<void> {
    const keys = runtimeKeys(this.redis);
    for (const id of LONG_RUNNING_RUNTIMES) {
      const raw = await this.redis.client.get(keys.heartbeat(id));
      if (!raw) {
        this.logger.log(`${id.padEnd(10)} no heartbeat`);
        continue;
      }
      const hb = JSON.parse(raw) as RuntimeHeartbeat;
      this.logger.log(
        `${id.padEnd(10)} ${hb.state.padEnd(8)} pid=${hb.process.pid} cpu=${hb.resources.cpuPercent}% rss=${hb.resources.rssMb}MB up=${hb.uptimeSec}s`,
      );
    }
  }

  private help(): void {
    this.logger.log(
      'Commands: queue:publish <topic> [jsonPayload] [queue] | runtime:status | help',
    );
  }
}
