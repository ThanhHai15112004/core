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

/**
 * Metric riêng của API runtime. API không hỗ trợ pause: tạm dừng API sẽ khoá luôn System Console.
 * Graceful restart dùng `app.close()` — Fastify ngừng nhận request mới và chờ request đang chạy.
 */
@Injectable()
export class ApiRuntimeContributor implements RuntimeContributor, OnModuleInit {
  private server: Server | null = null;

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
