import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import * as os from 'node:os';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { COMMAND_TTL_SEC, runtimeKeys } from '../constants/runtime.keys.js';
import { RUNTIME_IDENTITY } from '../constants/runtime.tokens.js';
import type { RuntimeContributor } from '../contracts/runtime-contributor.contract.js';
import type {
  AgentState,
  MetricValue,
  RuntimeAlert,
  RuntimeCommand,
  RuntimeCommandResult,
  RuntimeEventData,
  RuntimeEventType,
  RuntimeHeartbeat,
  RuntimeIdentity,
  RuntimeIssue,
  RuntimeProcessInfo,
  RuntimeResources,
} from '../contracts/runtime.types.js';

const REDIS_BOOT_WAIT_MS = 5000;

/**
 * Agent chạy trong mỗi runtime chạy liên tục (API, Worker, Scheduler):
 * gửi heartbeat định kỳ và sự kiện vòng đời vào Redis, nhận lệnh
 * pause/resume từ System Console qua pub/sub (restart do Docker / supervisor quản lý).
 */
@Injectable()
export class RuntimeAgentService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(RuntimeAgentService.name);
  private readonly keys: ReturnType<typeof runtimeKeys>;
  private readonly instance = `${os.hostname()}:${process.pid}`;
  private readonly startedAt = new Date();
  private contributor: RuntimeContributor | null = null;
  private state: AgentState = 'starting';
  private stopReason: string | null = null;
  private startCount = 0;
  private timers: NodeJS.Timeout[] = [];
  private started = false;
  private registered = false;

  constructor(
    @Inject(RUNTIME_IDENTITY) public readonly identity: RuntimeIdentity,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
  ) {
    this.keys = runtimeKeys(redis);
  }

  /** Contributor tự đăng ký trong `onModuleInit` của nó. */
  public registerContributor(contributor: RuntimeContributor): void {
    this.contributor = contributor;
  }

  /** Ghi sự kiện `crashed` trước khi process chết vì lỗi không bắt được. */
  public installCrashHandlers(): void {
    const onFatal = (kind: string) => (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${kind}: ${message}`, error instanceof Error ? error.stack : undefined);
      this.stopReason = 'crash';
      void this.recordEvent('crashed', { kind, message, exitCode: 1 })
        .catch(() => undefined)
        .finally(() => process.exit(1));
    };
    process.on('uncaughtException', onFatal('uncaughtException'));
    process.on('unhandledRejection', onFatal('unhandledRejection'));
  }

  public async onApplicationBootstrap(): Promise<void> {
    if (this.identity.kind !== 'long-running' || this.started) return;
    this.started = true;
    this.state = 'running';
    await this.subscribeCommands();

    // Redis có thể chưa sẵn sàng lúc boot; khi đó việc đăng ký được làm lại ở heartbeat kế tiếp.
    if (await this.redis.waitUntilReady(REDIS_BOOT_WAIT_MS)) await this.register();

    const { heartbeatMs } = this.config.runtime;
    await this.beat();
    this.timers.push(setInterval(() => void this.beat(), heartbeatMs));
    for (const timer of this.timers) timer.unref();
  }

  /** Ghi nhận lần khởi động (đếm start, khôi phục trạng thái Stop, sự kiện `started`) — đúng 1 lần. */
  private async register(): Promise<void> {
    if (this.registered) return;
    const startCount = await this.safe(() =>
      this.redis.client.incr(this.keys.starts(this.identity.id)),
    );
    if (startCount === undefined) return;
    this.registered = true;
    this.startCount = startCount;

    const shouldPause =
      (await this.safe(() => this.redis.client.exists(this.keys.paused(this.identity.id)))) === 1;
    if (shouldPause) {
      await this.contributor?.pause?.();
      this.state = 'paused';
    }
    await this.recordEvent('started', {
      instance: this.instance,
      pid: process.pid,
      paused: shouldPause,
    });
  }

  public async beforeApplicationShutdown(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (!this.started) return;
    this.state = 'stopping';
    await this.recordEvent('stopped', {
      reason: this.stopReason ?? 'graceful_shutdown',
      uptimeSec: Math.round(process.uptime()),
    });
    await this.safe(() => this.redis.client.del(this.keys.heartbeat(this.identity.id)));
    this.started = false;
  }

  /**
   * Đăng ký nhận lệnh điều khiển (pause, resume) gửi qua pub/sub Redis.
   */
  private async subscribeCommands(): Promise<void> {
    if (!this.redis.isReady()) return;
    const channel = this.keys.commandChannel(this.identity.id);
    const subscriber = this.redis.createSubscriber();
    subscriber.on('message', (ch: string, raw: string) => {
      if (ch !== channel) return;
      try {
        void this.handleCommand(JSON.parse(raw) as RuntimeCommand);
      } catch {
        this.logger.warn(`Ignored malformed runtime command: ${raw}`);
      }
    });
    await this.safe(() => subscriber.subscribe(channel));
  }

  private async handleCommand(command: RuntimeCommand): Promise<void> {
    const reply = (status: RuntimeCommandResult['status'], message?: string) =>
      this.safe(() =>
        this.redis.client.set(
          this.keys.commandResult(command.id),
          JSON.stringify({
            id: command.id,
            status,
            at: new Date().toISOString(),
            ...(message ? { message } : {}),
          }),
          'EX',
          COMMAND_TTL_SEC,
        ),
      );

    try {
      switch (command.action) {
        case 'pause':
          if (!this.contributor?.pause) throw new Error('runtime.error.pauseUnsupported');
          await this.contributor.pause();
          await this.safe(() =>
            this.redis.client.set(this.keys.paused(this.identity.id), command.requestedAt),
          );
          this.state = 'paused';
          await this.recordEvent('paused', { commandId: command.id });
          await reply('completed');
          break;
        case 'resume':
          await this.contributor?.resume?.();
          await this.safe(() => this.redis.client.del(this.keys.paused(this.identity.id)));
          this.state = 'running';
          await this.recordEvent('resumed', { commandId: command.id });
          await reply('completed');
          break;
      }
      await this.beat();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordEvent('command_failed', {
        commandId: command.id,
        action: command.action,
        message,
      });
      await reply('failed', message);
    }
  }

  private async beat(): Promise<void> {
    if (!this.registered && this.redis.isReady()) await this.register();
    const heartbeat = await this.buildHeartbeat();
    const ttlSec = Math.ceil((this.config.runtime.heartbeatMs * 3) / 1000);
    await this.safe(() =>
      this.redis.client.set(
        this.keys.heartbeat(this.identity.id),
        JSON.stringify(heartbeat),
        'EX',
        ttlSec,
      ),
    );
  }

  private buildResources(): RuntimeResources {
    const mem = process.memoryUsage();
    return {
      cpuPercent: 0,
      rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      externalMb: Math.round((mem.external / 1024 / 1024) * 10) / 10,
      memoryLimitMb: null,
      memoryLimitSource: 'v8-heap',
      memoryPercent: null,
      eventLoopMeanMs: 0,
      eventLoopP99Ms: 0,
      gcPauseMs: 0,
      gcCount: 0,
      gcMaxPauseMs: 0,
      activeHandles:
        (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()
          ?.length ?? 0,
    };
  }

  private buildProcessInfo(): RuntimeProcessInfo {
    return {
      pid: process.pid,
      ppid: process.ppid,
      user: os.userInfo?.().username ?? 'node',
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      execArgv: process.execArgv,
    };
  }

  private async buildHeartbeat(): Promise<RuntimeHeartbeat> {
    const resources = this.buildResources();
    const [metrics, issues, details] = await Promise.all([
      this.contributor?.collectMetrics().catch(() => ({})) ??
        Promise.resolve({} as Record<string, MetricValue>),
      this.contributor?.collectIssues?.().catch(() => []) ?? Promise.resolve([] as RuntimeIssue[]),
      this.contributor?.collectDetails?.().catch(() => ({})) ??
        Promise.resolve({} as Record<string, unknown>),
    ]);

    const alerts: RuntimeAlert[] = [];

    return {
      id: this.identity.id,
      instance: this.instance,
      state: this.state,
      at: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      uptimeSec: Math.round(process.uptime()),
      supervisor: this.config.runtime.supervisor,
      environment: this.config.app.env,
      process: this.buildProcessInfo(),
      resources,
      metrics,
      details,
      issues,
      alerts,
      descriptor: this.contributor?.describe() ?? {
        type: 'http',
        framework: 'NestJS',
        entrypoint: 'unknown',
        sourcePath: 'unknown',
      },
      capabilities: {
        pause:
          this.contributor?.capabilities?.().pause ??
          (typeof this.contributor?.pause === 'function' &&
            typeof this.contributor?.resume === 'function'),
      },
      startCount: this.startCount,
    };
  }

  /**
   * Lưu sự kiện vòng đời vào Redis Stream (tối đa `eventRetention` bản ghi).
   */
  public async recordEvent(type: RuntimeEventType, data: RuntimeEventData = {}): Promise<void> {
    await this.safe(async () => {
      const payload = {
        runtime: this.identity.id,
        instance: this.instance,
        type,
        at: new Date().toISOString(),
        data: JSON.stringify(data),
      };
      await this.redis.client.xadd(
        this.keys.events(),
        'MAXLEN',
        '~',
        this.config.runtime.eventRetention,
        '*',
        ...Object.entries(payload).flat(),
      );
    });
  }

  private async safe<T>(op: () => Promise<T>): Promise<T | undefined> {
    try {
      if (!this.redis.isReady()) return undefined;
      return await op();
    } catch (error) {
      this.logger.warn(`Redis operation failed: ${error instanceof Error ? error.message : error}`);
      return undefined;
    }
  }
}
