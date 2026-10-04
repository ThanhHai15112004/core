import { createServer, type Server } from 'node:http';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { METRICS_OPTIONS, type MetricsModuleOptions } from '../contracts/metrics.types.js';
import { MetricsRegistryService } from './metrics-registry.service.js';

/** HTTP server nhỏ phục vụ `GET /metrics` cho runtime không có HTTP server (worker, scheduler). */
@Injectable()
export class MetricsServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MetricsServer.name);
  private server: Server | null = null;

  constructor(
    private readonly metrics: MetricsRegistryService,
    private readonly config: CoreConfigService,
    @Inject(METRICS_OPTIONS) private readonly options: MetricsModuleOptions,
  ) {}

  public get port(): number {
    return this.config.metrics.port || this.options.port || 0;
  }

  public onApplicationBootstrap(): void {
    const port = this.port;
    if (!port) return;
    this.server = createServer((req, res) => {
      if (req.method !== 'GET' || !req.url?.startsWith('/metrics')) {
        res.writeHead(404).end();
        return;
      }
      this.metrics
        .metrics()
        .then((body) => res.writeHead(200, { 'Content-Type': this.metrics.contentType }).end(body))
        .catch((err: unknown) => res.writeHead(500).end(String(err)));
    });
    this.server.on('error', (err) => this.logger.warn(`Metrics server error: ${err.message}`));
    this.server.listen(port, '0.0.0.0', () =>
      this.logger.log(`Metrics exposed on :${port}/metrics`),
    );
  }

  public async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
