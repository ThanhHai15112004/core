import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import type { SlowQueryRecord } from '@packages/database/index.js';
import type { PerfSeverity, RuleKey } from '../responses/performance.response.js';

export interface StoredPerfEvent {
  id: string;
  at: number;
  type: 'started' | 'escalated' | 'recovered';
  bottleneckId: string;
  rule: RuleKey;
  runtime: string | null;
  severity: PerfSeverity;
  value: number;
  threshold: number;
  unit: string;
  durationMs?: number;
}

export interface ActiveRuleState {
  since: number;
  severity: PerfSeverity;
}

@Injectable()
export class PerformanceStoreService {
  constructor(private readonly redis: RedisService) {}

  public get client() {
    return this.redis.client;
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  public async instances(_sinceMs?: number): Promise<string[]> {
    return ['api', 'worker', 'scheduler'];
  }

  public async buckets(
    _tier: string,
    _fromMs: number,
    _toMs: number,
    _instances: readonly string[],
  ): Promise<any[]> {
    return [];
  }

  public async slowQueries(_limit: number): Promise<SlowQueryRecord[]> {
    return [];
  }

  public async events(): Promise<StoredPerfEvent[]> {
    return [];
  }

  public async activeRules(): Promise<Map<string, ActiveRuleState>> {
    return new Map();
  }
}
