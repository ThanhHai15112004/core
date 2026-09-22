import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type INestApplicationContext,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import * as os from 'node:os';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import { ResourceSampler } from './resource-sampler.js';
import { COMMAND_TTL_SEC, runtimeKeys } from '../constants/runtime.keys.js';
import { RUNTIME_IDENTITY } from '../constants/runtime.tokens.js';
import type { RuntimeContributor } from '../contracts/runtime-contributor.contract.js';
import type {
  AgentState,
  MetricValue,
  RuntimeAlert,
  RuntimeAlertKey,
  RuntimeCommand,
  RuntimeCommandResult,
  RuntimeEventData,
  RuntimeEventType,
  RuntimeHeartbeat,
  RuntimeIdentity,
  RuntimeIssue,
  RuntimeResources,
  RuntimeSample,
} from '../contracts/runtime.types.js';

const REDIS_BOOT_WAIT_MS = 5000;

/**
 * Agent chạy trong mỗi runtime chạy liên tục (API, Worker, Scheduler):
 * gửi heartbeat + time-series + sự kiện vòng đời vào Redis, và nhận lệnh
 * pause/resume/restart từ System Console qua pub/sub.
 */
@Injectable()
export class RuntimeAgentService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(RuntimeAgentService.name);
  private readonly keys: ReturnType<typeof runtimeKeys>;
  private readonly instance = `${os.hostname()}:${process.pid}`;
  private readonly startedAt = new Date();
  private contributor: RuntimeContributor | null = null;
  private app: INestApplicationContext | null = null;
  private state: AgentState = 'starting';
  private stopReason: string | null = null;
  private startCount = 0;
  private lastResources: RuntimeResources | null = null;
  private readonly alertSince = new Map<RuntimeAlertKey, string>();
  private timers: NodeJS.Timeout[] = [];
  private started = false;
  private registered = false;
  private exiting = false;

  constructor(
    @Inject(RUNTIME_IDENTITY) public readonly identity: RuntimeIdentity,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
    private readonly sampler: ResourceSampler,
    private readonly recorder: MetricRecorder,
  ) {
    this.keys = runtimeKeys(redis);
  }

  /** Contributor tự đăng ký trong `onModuleInit` của nó. */
  public registerContributor(contributor: RuntimeContributor): void {
    this.contributor = contributor;
  }

  /** Bootstrap gắn app để graceful restart có thể đóng app đúng vòng đời. */
  public attachApp(app: INestApplicationContext): void {
    this.app = app;
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
    this.sampler.start();
    await this.subscribeCommands();

    // Redis có thể chưa sẵn sàng lúc boot; khi đó việc đăng ký được làm lại ở heartbeat kế tiếp.
    if (await this.redis.waitUntilReady(REDIS_BOOT_WAIT_MS)) await this.register();

    const { heartbeatMs, sampleIntervalMs } = this.config.runtime;
    await this.beat();
    this.timers.push(setInterval(() => void this.beat(), heartbeatMs));
    this.timers.push(setInterval(() => void this.storeSample(), sampleIntervalMs));
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

  public async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.state = 'stopping';
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.sampler.stop();

    await this.recordEvent('stopped', {
      reason: this.stopReason ?? (signal ? 'signal' : 'shutdown'),
      signal: signal ?? null,
      exitCode: this.stopReason === 'force_restart' ? 1 : 0,
    });
    await this.safe(() => this.redis.client.del(this.keys.heartbeat(this.identity.id)));
  }

  private async subscribeCommands(): Promise<void> {
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
        case 'restart':
          await reply('accepted');
          // Process sẽ thoát; không gửi heartbeat nữa.
          await this.restart(command);
          return;
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

  /** Graceful: chờ việc đang chạy rồi đóng app; Force: thoát ngay. Supervisor sẽ dựng lại process. */
  private async restart(command: RuntimeCommand): Promise<void> {
    if (this.exiting) return;
    this.exiting = true;
    const mode = command.mode ?? 'graceful';
    this.state = 'stopping';
    await this.recordEvent('restart_requested', { commandId: command.id, mode });
    await this.beat();

    if (mode === 'force') {
      this.stopReason = 'force_restart';
      await this.beforeApplicationShutdown();
      process.exit(1);
    }

    this.stopReason = 'manual_restart';
    const timeout = setTimeout(() => {
      this.logger.warn('Graceful restart timed out, forcing exit');
      process.exit(1);
    }, this.config.runtime.gracefulTimeoutMs);
    timeout.unref();

    await this.contributor?.drain?.();
    if (this.app) await this.app.close();
    else await this.beforeApplicationShutdown();
    process.exit(0);
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

  private async storeSample(): Promise<void> {
    const r = this.lastResources;
    if (!r) return;
    const sample: RuntimeSample = {
      t: Date.now(),
      cpu: r.cpuPercent,
      mem: r.rssMb,
      heap: r.heapUsedMb,
      elp99: r.eventLoopP99Ms,
      starts: this.startCount,
    };
    const key = this.keys.samples(this.identity.id);
    await this.safe(() =>
      this.redis.client
        .multi()
        .lpush(key, JSON.stringify(sample))
        .ltrim(key, 0, this.config.runtime.sampleRetention - 1)
        .exec(),
    );
  }

  /** Số đo tài nguyên cho trang Performance (bucket 10s/1m/1h theo instance). */
  private recordResources(r: RuntimeResources): void {
    const m = (name: string) => `rt.${name}`;
    this.recorder.gauge(m('cpu'), r.cpuPercent);
    this.recorder.gauge(m('rss'), r.rssMb);
    this.recorder.gauge(m('heapUsed'), r.heapUsedMb);
    this.recorder.gauge(m('heapTotal'), r.heapTotalMb);
    this.recorder.gauge(m('external'), r.externalMb);
    if (r.memoryPercent !== null) this.recorder.gauge(m('memPct'), r.memoryPercent);
    if (r.memoryLimitMb !== null) this.recorder.gauge(m('memLimit'), r.memoryLimitMb);
    this.recorder.gauge(m('elMean'), r.eventLoopMeanMs);
    this.recorder.gauge(m('elP99'), r.eventLoopP99Ms);
    this.recorder.count(m('gcCount'), r.gcCount);
    this.recorder.count(m('gcPause'), r.gcPauseMs);
    if (r.gcCount > 0) this.recorder.gauge(m('gcMaxPause'), r.gcMaxPauseMs);
  }

  private async buildHeartbeat(): Promise<RuntimeHeartbeat> {
    const resources = this.sampler.sample();
    this.lastResources = resources;
    this.recordResources(resources);
    const [metrics, issues, details] = await Promise.all([
      this.contributor?.collectMetrics().catch(() => ({})) ??
        Promise.resolve({} as Record<string, MetricValue>),
      this.contributor?.collectIssues?.().catch(() => []) ?? Promise.resolve([] as RuntimeIssue[]),
      this.contributor?.collectDetails?.().catch(() => ({})) ??
        Promise.resolve({} as Record<string, unknown>),
    ]);

    return {
      id: this.identity.id,
      instance: this.instance,
      state: this.state,
      at: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      uptimeSec: Math.round(process.uptime()),
      supervisor: this.config.runtime.supervisor,
      environment: this.config.app.env,
      process: this.sampler.processInfo(),
      resources,
      metrics,
      details,
      issues,
      alerts: await this.evaluateAlerts(resources),
      descriptor: this.contributor?.describe() ?? {
        type: 'cli',
        framework: 'NestJS',
        entrypoint: `apps/${this.identity.id}/main.ts`,
        sourcePath: `backend/src/apps/${this.identity.id}/`,
      },
      capabilities: {
        pause: Boolean(this.contributor?.pause),
        restart: this.config.runtime.supervisor !== 'none',
      },
      startCount: this.startCount,
    };
  }

  /** So ngưỡng cấu hình; phát sự kiện khi bắt đầu vượt / hồi phục, giữ lại thời điểm bắt đầu. */
  private async evaluateAlerts(r: RuntimeResources): Promise<RuntimeAlert[]> {
    const { thresholds } = this.config.runtime;
    const checks: Array<{ key: RuntimeAlertKey; value: number | null; threshold: number }> = [
      { key: 'memory', value: r.memoryPercent, threshold: thresholds.memoryPercent },
      { key: 'cpu', value: r.cpuPercent, threshold: thresholds.cpuPercent },
      { key: 'eventLoop', value: r.eventLoopP99Ms, threshold: thresholds.eventLoopMs },
    ];

    const alerts: RuntimeAlert[] = [];
    for (const { key, value, threshold } of checks) {
      const exceeded = value !== null && value > threshold;
      const since = this.alertSince.get(key);
      if (exceeded && value !== null) {
        const start = since ?? new Date().toISOString();
        if (!since) {
          this.alertSince.set(key, start);
          await this.recordEvent('threshold_exceeded', { metric: key, value, threshold });
        }
        alerts.push({ key, value, threshold, since: start });
      } else if (since) {
        this.alertSince.delete(key);
        await this.recordEvent('threshold_recovered', {
          metric: key,
          value: value ?? 0,
          threshold,
        });
      }
    }
    return alerts;
  }

  private async recordEvent(type: RuntimeEventType, data: RuntimeEventData = {}): Promise<void> {
    await this.safe(() =>
      this.redis.client.xadd(
        this.keys.events(),
        'MAXLEN',
        '~',
        String(this.config.runtime.eventRetention),
        '*',
        'runtime',
        this.identity.id,
        'type',
        type,
        'at',
        new Date().toISOString(),
        'data',
        JSON.stringify(data),
      ),
    );
  }

  /** Lệnh Redis thất bại (mất kết nối) không được làm hỏng runtime. */
  private async safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  }
}
