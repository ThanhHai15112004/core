import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Server } from 'node:http';
import { CoreConfigService } from '@packages/config/index.js';
import { HttpMetricsService } from '@packages/logging/index.js';
import {
  RuntimeAgentService,
  withVersion,
  type MetricValue,
  type RuntimeContributor,
  type RuntimeDescriptor,
} from '@packages/runtime/index.js';

/**
 * Metric riêng của API runtime. API không hỗ trợ pause: tạm dừng API sẽ khoá luôn System Console.
 * Graceful restart dùng `app.close()` — Fastify ngừng nhận request mới và chờ request đang chạy.
 */
@Injectable()
export class ApiRuntimeContributor implements RuntimeContributor, OnModuleInit {
  private server: Server | null = null;

  constructor(
    private readonly agent: RuntimeAgentService,
    private readonly http: HttpMetricsService,
    private readonly config: CoreConfigService,
  ) {}

  public onModuleInit(): void {
    this.agent.registerContributor(this);
  }

  /** Bootstrap gắn HTTP server để đếm kết nối đang mở. */
  public attachServer(server: Server): void {
    this.server = server;
  }

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

  public async collectMetrics(): Promise<Record<string, MetricValue>> {
    const snapshot = this.http.snapshot();
    return {
      requestsPerSecond: snapshot.requestsPerSecond,
      p95LatencyMs: snapshot.p95LatencyMs,
      errorRatePercent: snapshot.errorRatePercent,
      errorCount: snapshot.errorCount,
      totalRequests: snapshot.totalRequests,
      windowSeconds: snapshot.windowSeconds,
      activeRequests: this.http.activeRequests(),
      openConnections: await this.countConnections(),
    };
  }

  private countConnections(): Promise<number | null> {
    const server = this.server;
    if (!server) return Promise.resolve(null);
    return new Promise((resolve) =>
      server.getConnections((err, count) => resolve(err ? null : count)),
    );
  }
}
