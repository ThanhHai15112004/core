import { Injectable } from '@nestjs/common';
import type { TrafficRoute } from '../responses/traffic.response.js';

/**
 * TrafficStoreService — cung cấp interface đọc dữ liệu traffic (tương thích ngược).
 * Số liệu hiện tại được đọc trực tiếp từ Prometheus qua TrafficService.
 */
@Injectable()
export class TrafficStoreService {
  public isAvailable(): boolean {
    return true;
  }

  public async instances(_sinceMs?: number): Promise<string[]> {
    return ['api'];
  }

  public async routes(): Promise<Map<string, TrafficRoute>> {
    return new Map();
  }

  public async buckets(
    _tier: string,
    _fromMs: number,
    _toMs: number,
    _instances: readonly string[],
  ): Promise<any[]> {
    return [];
  }
}
