import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import * as os from 'node:os';
import type { Gauge } from 'prom-client';
import { CoreConfigService } from '@packages/config/index.js';
import { safeJsonParse } from '@packages/kernel/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
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
import { ResourceSampler } from './resource-sampler.js';

const REDIS_BOOT_WAIT_MS = 5000;
/** Heartbeat sống tối thiểu chừng này (giây) — mất heartbeat 30s mới coi là runtime chết. */
const HEARTBEAT_TTL_SEC = 30;
const BYTES_PER_MB = 1024 * 1024;

export const RUNTIME_CPU_PERCENT_METRIC = 'core_runtime_cpu_percent';
export const RUNTIME_MEMORY_PERCENT_METRIC = 'core_runtime_memory_percent';
export const RUNTIME_MEMORY_RSS_BYTES_METRIC = 'core_runtime_memory_rss_bytes';
export const RUNTIME_MEMORY_LIMIT_BYTES_METRIC = 'core_runtime_memory_limit_bytes';

/**
 * Agent chạy trong mỗi runtime chạy liên tục (API, Worker, Scheduler):
 * gửi heartbeat định kỳ và sự kiện vòng đời vào Redis, nhận lệnh
 * pause/resume từ System Console qua pub/sub (restart do Docker / supervisor quản lý).
 */
@Injectable()
export class RuntimeAgentService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(RuntimeAgentService.name);
  private readonly keys: ReturnType<typeof runtimeKeys>;
  private readonly instance: string;
  private readonly startedAt = new Date();
  private contributor: RuntimeContributor | null = null;
  private state: AgentState = 'starting';
  private stopReason: string | null = null;
  private startCount = 0;
  private timers: NodeJS.Timeout[] = [];
  private started = false;
  private registered = false;
  private drained = false;
  private subscriber: ReturnType<RedisService['createSubscriber']> | null = null;
  private readonly sampler = new ResourceSampler();
  private readonly cpuPercentGauge: Gauge | null;
  private readonly memoryPercentGauge: Gauge | null;
  private readonly memoryRssBytesGauge: Gauge | null;
  private readonly memoryLimitBytesGauge: Gauge | null;

  constructor(
    @Inject(RUNTIME_IDENTITY) public readonly identity: RuntimeIdentity,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
    @Optional() metrics?: MetricsRegistryService,
  ) {
    this.keys = runtimeKeys(redis);
    this.instance = config.app.instanceId || `${os.hostname()}:${process.pid}`;
    this.cpuPercentGauge = metrics
      ? metrics.gauge(
          RUNTIME_CPU_PERCENT_METRIC,
          'Process CPU utilization percentage sampled by RuntimeAgent (100 = 1 core)',
        )
      : null;
    this.memoryPercentGauge = metrics
      ? metrics.gauge(
          RUNTIME_MEMORY_PERCENT_METRIC,
          'Process memory utilization percentage against cgroup or V8 heap limit',
        )
      : null;
    this.memoryRssBytesGauge = metrics
      ? metrics.gauge(
          RUNTIME_MEMORY_RSS_BYTES_METRIC,
          'Process resident set size (RSS) memory in bytes',
        )
      : null;
    this.memoryLimitBytesGauge = metrics
      ? metrics.gauge(
          RUNTIME_MEMORY_LIMIT_BYTES_METRIC,
          'Effective container/process memory limit in bytes (cgroup or V8 heap)',
        )
      : null;
  }

  /** Cập nhật các gauge CPU và RAM lên Prometheus registry (phục vụ autoscaler). */
  public recordResourceMetrics(resources: RuntimeResources): void {
    this.cpuPercentGauge?.set(Math.max(0, resources.cpuPercent));
    if (resources.memoryPercent !== null && Number.isFinite(resources.memoryPercent)) {
      this.memoryPercentGauge?.set(Math.max(0, resources.memoryPercent));
    }
    this.memoryRssBytesGauge?.set(Math.max(0, Math.round(resources.rssMb * BYTES_PER_MB)));
    if (resources.memoryLimitMb !== null && Number.isFinite(resources.memoryLimitMb)) {
      this.memoryLimitBytesGauge?.set(
        Math.max(0, Math.round(resources.memoryLimitMb * BYTES_PER_MB)),
      );
    }
  }

  /** Contributor tự đăng ký trong `onModuleInit` của nó. */
  public registerContributor(contributor: RuntimeContributor): void {
    this.contributor = contributor;
  }

  /** Trạng thái vòng đời hiện tại của runtime process (`starting` | `running` | `paused` | `stopping`). */
  public getState(): AgentState {
    return this.state;
  }

  /** Kiểm tra process có đang trong giai đoạn rút kết nối (Connection Draining) hay không. */
  public isDraining(): boolean {
    return this.state === 'draining';
  }

  /** Kiểm tra process có đang trong giai đoạn tắt dần (graceful shutdown) hay không. */
  public isShuttingDown(): boolean {
    return this.state === 'stopping';
  }

  /** Số request/job đang xử lý đồng thời (in-flight) do RuntimeContributor báo cáo. */
  public getInFlightCount(): number {
    return this.contributor?.getInFlightCount?.() ?? 0;
  }

  /**
   * Chuyển runtime sang trạng thái `draining` (ngay khi nhận SIGTERM/SIGINT):
   * - `/health/ready` trả 503 để Load Balancer ngừng đẩy request mới, `/health/live` vẫn 200.
   * - Ghi sự kiện `draining` và phát heartbeat ngay lập tức.
   */
  public async beginDraining(reason = 'SIGTERM'): Promise<void> {
    if (this.state === 'draining' || this.state === 'stopping') {
      return;
    }
    this.stopReason = reason;
    this.state = 'draining';
    if (!this.started) {
      return;
    }
    await this.recordEvent('draining', {
      reason,
      inFlight: this.getInFlightCount(),
    });
    await this.beat();
  }

  /**
   * Gọi `contributor.drain()` (idempotent) có giới hạn timeout để chờ in-flight requests/jobs hoàn tất.
   */
  public async executeContributorDrain(timeoutMs?: number): Promise<void> {
    if (this.drained) {
      return;
    }
    this.drained = true;
    const drainFn = this.contributor?.drain;
    if (typeof drainFn !== 'function') {
      return;
    }

    const effectiveTimeoutMs = Math.max(
      100,
      timeoutMs ?? this.config.runtime.gracefulTimeoutMs ?? 30_000,
    );
    let timer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        drainFn.call(this.contributor),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            this.logger.warn(
              `Contributor drain timed out after ${effectiveTimeoutMs}ms (inFlight=${this.getInFlightCount()})`,
            );
            resolve();
          }, effectiveTimeoutMs);
          timer.unref();
        }),
      ]);
    } catch (error) {
      this.logger.warn(
        `Contributor drain failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Ghi sự kiện `crashed` trước khi process chết vì lỗi không bắt được. */
  public installCrashHandlers(): void {
    /** Xử lý sự cố nghiêm trọng không thể phục hồi (fatal error) */
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

  /** Thực thi tác vụ khởi động sau khi toàn bộ ứng dụng hoàn tất bootstrap */
  public async onApplicationBootstrap(): Promise<void> {
    if (this.identity.kind !== 'long-running' || this.started) return;
    this.started = true;
    this.state = 'running';
    this.sampler.start();
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

  /** Thực hiện dọn dẹp tài nguyên trước khi ứng dụng tắt */
  public async beforeApplicationShutdown(): Promise<void> {
    if (!this.drained) {
      await this.executeContributorDrain();
    }
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.subscriber) {
      const sub = this.subscriber;
      this.subscriber = null;
      await sub.quit().catch(() => undefined);
    }
    if (!this.started) return;
    this.sampler.stop();
    this.state = 'stopping';
    await this.recordEvent('stopped', {
      reason: this.stopReason ?? 'graceful_shutdown',
      uptimeSec: Math.round(process.uptime()),
    });
    await this.safe(() =>
      this.redis.client
        .multi()
        .del(this.keys.heartbeat(this.identity.id))
        .del(this.keys.instanceHeartbeat(this.identity.id, this.instance))
        .srem(this.keys.instanceIndex(this.identity.id), this.instance)
        .exec(),
    );
    this.started = false;
  }

  /**
   * Đăng ký nhận lệnh điều khiển (pause, resume) gửi qua pub/sub Redis.
   */
  private async subscribeCommands(): Promise<void> {
    if (!this.redis.isReady()) return;
    const channel = this.keys.commandChannel(this.identity.id);
    const subscriber = this.redis.createSubscriber();
    this.subscriber = subscriber;
    subscriber.on('message', (ch: string, raw: string) => {
      if (ch !== channel) return;
      const command = safeJsonParse<RuntimeCommand | null>(raw, null);
      if (!command) {
        this.logger.warn(`Ignored malformed runtime command: ${raw}`);
        return;
      }
      void this.handleCommand(command);
    });
    await this.safe(() => subscriber.subscribe(channel));
  }

  /** Tiếp nhận và xử lý lệnh điều khiển gửi tới runtime agent */
  private async handleCommand(command: RuntimeCommand): Promise<void> {
    /** Gửi phản hồi cho lệnh điều khiển runtime */
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

  /** Phát tín hiệu nhịp tim (heartbeat) định kỳ của runtime agent */
  private async beat(): Promise<void> {
    if (!this.registered && this.redis.isReady()) await this.register();
    const heartbeat = await this.buildHeartbeat();
    const ttlSec = Math.max(
      HEARTBEAT_TTL_SEC,
      Math.ceil((this.config.runtime.heartbeatMs * 2) / 1000),
    );
    const serialized = JSON.stringify(heartbeat);
    const indexKey = this.keys.instanceIndex(this.identity.id);
    await this.safe(() =>
      this.redis.client
        .multi()
        .set(this.keys.heartbeat(this.identity.id), serialized, 'EX', ttlSec)
        .set(this.keys.instanceHeartbeat(this.identity.id, this.instance), serialized, 'EX', ttlSec)
        .sadd(indexKey, this.instance)
        .expire(indexKey, Math.max(ttlSec * 2, 120))
        .exec(),
    );
  }

  /** Thu thập thông tin tiến trình Node.js (PID, bộ nhớ, uptime) */
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

  /** Xây dựng gói tin heartbeat chứa thông tin sức khỏe của tiến trình */
  private async buildHeartbeat(): Promise<RuntimeHeartbeat> {
    const resources = this.sampler.sample();
    this.recordResourceMetrics(resources);
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

  /** Bọc lệnh thực thi với khối try-catch an toàn */
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
