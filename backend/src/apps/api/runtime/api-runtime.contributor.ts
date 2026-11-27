import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Server } from 'node:http';
import { CoreConfigService } from '@packages/config/index.js';
import {
  RuntimeAgentService,
  withVersion,
  type MetricValue,
  type RuntimeContributor,
  type RuntimeDescriptor,
} from '@packages/runtime/index.js';

const DRAIN_HOOKS_INSTALLED = Symbol.for('core:api_draining_hooks_installed');
const IN_FLIGHT_TRACKED = Symbol('core:api_in_flight_tracked');

interface DrainingRequestLike {
  [IN_FLIGHT_TRACKED]?: boolean;
}

interface DrainingReplyLike {
  header?: (name: string, value: string) => unknown;
}

interface FastifyDrainingInstanceLike {
  [DRAIN_HOOKS_INSTALLED]?: boolean;
  addHook?: (
    name: string,
    handler: (
      req: DrainingRequestLike,
      replyOrDone?: DrainingReplyLike | (() => void),
      done?: () => void,
    ) => void,
  ) => void;
}

/**
 * Metric riêng của API runtime. API không hỗ trợ pause: tạm dừng API sẽ khoá luôn System Console.
 * Graceful restart / Connection Draining dùng `beginDraining()` → `drain()` (chờ in-flight requests) → `app.close()`.
 */
@Injectable()
export class ApiRuntimeContributor implements RuntimeContributor, OnModuleInit {
  private server: Server | null = null;
  private inFlightRequests = 0;
  private drainWaiters: Array<() => void> = [];

  constructor(
    private readonly agent: RuntimeAgentService,
    private readonly config: CoreConfigService,
  ) {}

  /** Đăng ký contributor này với RuntimeAgentService khi khởi tạo module */
  public onModuleInit(): void {
    this.agent.registerContributor(this);
  }

  /** Bootstrap gắn HTTP server để đếm kết nối đang mở. */
  public attachServer(server: Server): void {
    this.server = server;
  }

  /**
   * Gắn Fastify hooks để:
   * - Đếm chính xác số HTTP requests đang xử lý (`inFlightRequests`).
   * - Khi đang `draining`/`stopping`, trả header `Connection: close` để ngắt keep-alive socket sau khi xong request.
   */
  public attachFastifyDrainingHooks(instance: unknown): void {
    if (!instance || typeof instance !== 'object') return;
    const fastify = instance as FastifyDrainingInstanceLike;
    if (fastify[DRAIN_HOOKS_INSTALLED] || typeof fastify.addHook !== 'function') return;

    const decrement = (req: DrainingRequestLike) => {
      if (!req[IN_FLIGHT_TRACKED]) return;
      req[IN_FLIGHT_TRACKED] = false;
      if (this.inFlightRequests > 0) {
        this.inFlightRequests -= 1;
      }
      if (this.inFlightRequests === 0 && this.drainWaiters.length > 0) {
        const waiters = this.drainWaiters.splice(0);
        for (const resolve of waiters) resolve();
      }
    };

    try {
      fastify.addHook('onRequest', (req, replyOrDone, doneMaybe) => {
        if (!req[IN_FLIGHT_TRACKED]) {
          req[IN_FLIGHT_TRACKED] = true;
          this.inFlightRequests += 1;
        }
        const reply = replyOrDone && typeof replyOrDone !== 'function' ? replyOrDone : undefined;
        if (this.agent.isDraining() || this.agent.isShuttingDown()) {
          reply?.header?.('connection', 'close');
        }
        const cb = typeof replyOrDone === 'function' ? replyOrDone : doneMaybe;
        if (typeof cb === 'function') cb();
      });

      fastify.addHook('onResponse', (req, replyOrDone, doneMaybe) => {
        decrement(req);
        const cb = typeof replyOrDone === 'function' ? replyOrDone : doneMaybe;
        if (typeof cb === 'function') cb();
      });

      fastify.addHook('onRequestAbort', (req, replyOrDone, doneMaybe) => {
        decrement(req);
        const cb = typeof replyOrDone === 'function' ? replyOrDone : doneMaybe;
        if (typeof cb === 'function') cb();
      });

      fastify[DRAIN_HOOKS_INSTALLED] = true;
    } catch {
      // Ignore if Fastify hooks are already locked
    }
  }

  /** Số HTTP requests đang được xử lý tại thời điểm hiện tại. */
  public getInFlightCount(): number {
    return this.inFlightRequests;
  }

  /** Chờ toàn bộ HTTP requests đang xử lý (in-flight) hoàn tất trước khi đóng server. */
  public async drain(): Promise<void> {
    if (this.inFlightRequests <= 0) return;
    await new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  /** Cung cấp thông tin mô tả chi tiết về HTTP API runtime */
  public describe(): RuntimeDescriptor {
    return {
      type: 'http',
      framework: withVersion('NestJS', '@nestjs/core'),
      adapter: withVersion('Fastify', 'fastify'),
      port: this.config.app.port,
      entrypoint: 'apps/api/main.ts',
      sourcePath: 'backend/src/apps/api/',
      details: { apiPrefix: this.config.app.apiPrefix, host: this.config.app.host },
    };
  }

  /** RPS / p95 / tỉ lệ lỗi HTTP nằm ở Prometheus (`http_request_duration_seconds`). */
  public async collectMetrics(): Promise<Record<string, MetricValue>> {
    return {
      openConnections: await this.countConnections(),
      inFlightRequests: this.inFlightRequests,
    };
  }

  /** Đếm số lượng kết nối HTTP hiện đang mở tới server */
  private countConnections(): Promise<number | null> {
    const server = this.server;
    if (!server) return Promise.resolve(null);
    return new Promise((resolve) =>
      server.getConnections((err, count) => resolve(err ? null : count)),
    );
  }
}
