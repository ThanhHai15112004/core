import { Injectable } from '@nestjs/common';
import type {
  ActiveSnapshot,
  RequestDetail,
  RequestSummary,
  TrafficRoute,
} from '../responses/traffic.response.js';

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

  public async requestLog(): Promise<RequestSummary[]> {
    return [];
  }

  public async latestRequest(): Promise<RequestSummary | null> {
    return null;
  }

  public async requestDetail(_id: string): Promise<RequestDetail | null> {
    return null;
  }

  public async active(_now: number): Promise<ActiveSnapshot[]> {
    return [];
  }
}
