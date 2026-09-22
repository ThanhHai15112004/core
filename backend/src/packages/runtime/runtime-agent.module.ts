import { type DynamicModule, Module } from '@nestjs/common';
import * as os from 'node:os';
import { LOG_SINK } from '@packages/logging/index.js';
import { MetricRecorder, TELEMETRY_INSTANCE } from '@packages/telemetry/index.js';
import { RUNTIME_IDENTITY } from './constants/runtime.tokens.js';
import type { RuntimeIdentity } from './contracts/runtime.types.js';
import { ResourceSampler } from './providers/resource-sampler.js';
import { RuntimeAgentService } from './providers/runtime-agent.service.js';
import { CliHistoryService } from './providers/cli-history.service.js';
import { RuntimeLogSink } from './providers/runtime-log.sink.js';

/**
 * Gắn runtime agent vào một app (api/worker/scheduler/cli). Yêu cầu RedisModule & ConfigModule.
 * Cung cấp luôn `MetricRecorder` (global) để các package (database, cache, messaging…) ghi số đo hiệu năng.
 */
@Module({})
export class RuntimeAgentModule {
  public static forRuntime(identity: RuntimeIdentity): DynamicModule {
    return {
      module: RuntimeAgentModule,
      global: true,
      providers: [
        { provide: RUNTIME_IDENTITY, useValue: identity },
        // Runtime chạy theo yêu cầu (CLI) không ghi số đo hiệu năng.
        {
          provide: TELEMETRY_INSTANCE,
          useValue:
            identity.kind === 'long-running'
              ? `${identity.id}@${os.hostname()}:${process.pid}`
              : null,
        },
        MetricRecorder,
        ResourceSampler,
        RuntimeAgentService,
        CliHistoryService,
        RuntimeLogSink,
        { provide: LOG_SINK, useExisting: RuntimeLogSink },
      ],
      exports: [
        RUNTIME_IDENTITY,
        RuntimeAgentService,
        CliHistoryService,
        LOG_SINK,
        ResourceSampler,
        MetricRecorder,
      ],
    };
  }
}
