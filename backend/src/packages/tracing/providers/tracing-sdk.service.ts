import { hostname } from 'node:os';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { TRACING_OPTIONS } from '../constants/tracing.constant.js';
import type { TracingConfigStats, TracingModuleOptions } from '../contracts/tracing.types.js';
import { SpanBufferProcessor } from '../processors/span-buffer.processor.js';
import { RouteFilteringSampler, buildBaseSampler } from '../samplers/route-filtering.sampler.js';

/**
 * Khởi tạo và quản lý vòng đời OpenTelemetry `NodeTracerProvider` cho từng runtime (`api`, `worker`, `scheduler`),
 * cấu hình W3C TraceContext propagator, Sampler lọc route nhiễu, OTLP exporter và Console SpanBuffer.
 */
@Injectable()
export class TracingSdkService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TracingSdkService.name);
  public readonly spanBuffer: SpanBufferProcessor;
  private provider: NodeTracerProvider | null = null;
  private initialized = false;

  constructor(
    private readonly config: CoreConfigService,
    @Inject(TRACING_OPTIONS) private readonly options: TracingModuleOptions,
    @Optional() private readonly redis?: RedisService,
  ) {
    const cfg = this.config.tracing;
    this.spanBuffer = new SpanBufferProcessor({
      maxSize: cfg.consoleBufferMax,
      runtime: this.options.runtime,
      serviceName: cfg.serviceName,
    });
  }

  /** Khởi tạo OpenTelemetry SDK khi module boot (idempotent). */
  public onModuleInit(): void {
    if (this.initialized) return;
    this.initialized = true;

    const cfg = this.config.tracing;
    if (this.redis) {
      this.spanBuffer.attachRedis(this.redis, this.config.app.env);
    }

    // Luôn bật W3C TraceContext propagator để propagate `traceparent` xuyên HTTP & BullMQ
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    if (!cfg.enabled) {
      this.logger.log(`OpenTelemetry tracing disabled (runtime=${this.options.runtime})`);
      return;
    }

    const spanProcessors: SpanProcessor[] = [];
    if (cfg.consoleBufferEnabled) {
      spanProcessors.push(this.spanBuffer);
    }

    if (cfg.exporter === 'otlp') {
      const hasHeaders = Object.keys(cfg.otlpHeaders).length > 0;
      const exporter = new OTLPTraceExporter({
        url: cfg.otlpEndpoint,
        timeoutMillis: cfg.otlpTimeoutMs,
        ...(hasHeaders ? { headers: cfg.otlpHeaders } : {}),
      });
      spanProcessors.push(new BatchSpanProcessor(exporter));
    } else if (cfg.exporter === 'console') {
      spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    }

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: cfg.serviceName,
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: this.config.app.env,
      [ATTR_SERVICE_INSTANCE_ID]: `${hostname()}:${process.pid}`,
      'core.runtime': this.options.runtime,
    });

    const baseSampler = buildBaseSampler(cfg.sampler, cfg.samplingRatio);
    const sampler = new RouteFilteringSampler(baseSampler, cfg.ignoreRoutes);

    this.provider = new NodeTracerProvider({
      resource,
      sampler,
      spanProcessors,
    });
    this.provider.register({
      propagator: new W3CTraceContextPropagator(),
    });

    this.logger.log(
      `OpenTelemetry tracing active (runtime=${this.options.runtime}, exporter=${cfg.exporter}, sampler=${cfg.sampler}, ratio=${cfg.samplingRatio})`,
    );
  }

  /** Flush toàn bộ span đang chờ và tắt provider an toàn khi ứng dụng shutdown. */
  public async onApplicationShutdown(): Promise<void> {
    if (!this.provider) return;
    try {
      await this.provider.forceFlush();
      await this.provider.shutdown();
    } catch (err) {
      this.logger.warn(
        `OpenTelemetry shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.provider = null;
    }
  }

  /** Thống kê trạng thái & cấu hình OpenTelemetry hiện tại cho System Console. */
  public getStats(): TracingConfigStats {
    const cfg = this.config.tracing;
    return {
      enabled: cfg.enabled,
      serviceName: cfg.serviceName,
      runtime: this.options.runtime,
      exporter: cfg.exporter,
      otlpEndpoint: cfg.exporter === 'otlp' ? cfg.otlpEndpoint : null,
      sampler: cfg.sampler,
      samplingRatio: cfg.samplingRatio,
      ignoreRoutes: [...cfg.ignoreRoutes],
      consoleBufferEnabled: cfg.consoleBufferEnabled,
      consoleBufferMax: cfg.consoleBufferMax,
      bufferedSpans: this.spanBuffer.bufferedCount,
      exportedSpans: this.spanBuffer.exportedSpans,
      droppedSpans: this.spanBuffer.droppedSpans,
    };
  }
}
