import { performance } from 'node:perf_hooks';
import { Injectable, Optional } from '@nestjs/common';
import {
  CorePackageId,
  PackageCategory,
  PackageStatus,
  type ManageablePackage,
  type PackageActionDescriptor,
  type PackageActionResult,
  type PackageStatusReport,
} from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { RedisService } from './redis.service.js';

const parseField = (info: string, field: string): string | undefined => {
  const match = info.match(new RegExp(`^${field}:(.+)$`, 'm'));
  return match && match[1] ? match[1].trim() : undefined;
};

@Injectable()
export class RedisManageableAdapter implements ManageablePackage {
  public readonly packageId = CorePackageId.REDIS;
  public readonly category = PackageCategory.CUSTOM;
  public readonly icon = 'server';

  constructor(
    private readonly redis: RedisService,
    @Optional() private readonly i18n?: CoreI18nService,
  ) {}

  public get displayName(): string {
    return this.i18n?.t('ops.redis.displayName') ?? 'Redis';
  }

  public async getStatus(): Promise<PackageStatusReport> {
    if (!this.redis.isReady()) {
      const err = this.redis.getLastError();
      return {
        status: PackageStatus.ERROR,
        summary: err ? `Redis error: ${err}` : 'Redis is not connected',
        metrics: {
          ready: false,
          error: err ?? 'disconnected',
        },
      };
    }

    try {
      const start = performance.now();
      await this.redis.client.ping();
      const latencyMs = Math.round((performance.now() - start) * 10) / 10;

      const [infoServer, infoMemory, infoClients] = await Promise.all([
        this.redis.client.info('server').catch(() => ''),
        this.redis.client.info('memory').catch(() => ''),
        this.redis.client.info('clients').catch(() => ''),
      ]);

      const version = parseField(infoServer, 'redis_version') ?? 'unknown';
      const uptimeSec = Number(parseField(infoServer, 'uptime_in_seconds') ?? 0);
      const usedMemory = parseField(infoMemory, 'used_memory_human') ?? 'unknown';
      const usedMemoryPeak = parseField(infoMemory, 'used_memory_peak_human') ?? 'unknown';
      const connectedClients = Number(parseField(infoClients, 'connected_clients') ?? 0);
      const blockedClients = Number(parseField(infoClients, 'blocked_clients') ?? 0);

      const days = Math.floor(uptimeSec / 86400);

      return {
        status: PackageStatus.HEALTHY,
        summary: `Redis v${version} up ${days}d, mem: ${usedMemory}, clients: ${connectedClients}`,
        metrics: {
          ready: true,
          version,
          uptimeSeconds: uptimeSec,
          usedMemory,
          usedMemoryPeak,
          connectedClients,
          blockedClients,
          latencyMs,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: PackageStatus.WARNING,
        summary: `Redis ping/info warning: ${msg}`,
        metrics: {
          ready: true,
          error: msg,
        },
      };
    }
  }

  public getActions(): PackageActionDescriptor[] {
    return [
      {
        id: 'ping',
        label: 'Ping Redis',
        description: 'Send PING command to verify Redis responsiveness and latency',
        isDanger: false,
      },
    ];
  }

  public async executeAction(actionId: string): Promise<PackageActionResult> {
    if (actionId === 'ping') {
      try {
        const start = performance.now();
        const res = await this.redis.client.ping();
        const latencyMs = Math.round((performance.now() - start) * 10) / 10;
        return {
          success: res === 'PONG',
          message: `PONG response received in ${latencyMs}ms`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `Ping failed: ${msg}`,
        };
      }
    }

    return {
      success: false,
      message: `Unsupported action: ${actionId}`,
    };
  }
}
