import { type DynamicModule, Module } from '@nestjs/common';
import { RUNTIME_IDENTITY } from './constants/runtime.tokens.js';
import type { RuntimeIdentity } from './contracts/runtime.types.js';
import { RuntimeAgentService } from './providers/runtime-agent.service.js';
import { CliHistoryService } from './providers/cli-history.service.js';
import { RuntimeManageableAdapter } from './providers/runtime-manageable.adapter.js';

/**
 * Gắn runtime agent vào một app (api/worker/scheduler/cli). Yêu cầu RedisModule & ConfigModule.
 */
@Module({})
export class RuntimeAgentModule {
  public static forRuntime(identity: RuntimeIdentity): DynamicModule {
    return {
      module: RuntimeAgentModule,
      global: true,
      providers: [
        { provide: RUNTIME_IDENTITY, useValue: identity },
        RuntimeAgentService,
        CliHistoryService,
        RuntimeManageableAdapter,
      ],
      exports: [
        RUNTIME_IDENTITY,
        RuntimeAgentService,
        CliHistoryService,
        RuntimeManageableAdapter,
      ],
    };
  }
}
