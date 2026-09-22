import { Injectable } from '@nestjs/common';
import { CoreI18nService } from '@packages/i18n/index.js';
import { PackageStatus } from '@packages/kernel/index.js';
import type { RecentActivityEventDto } from '../responses/overview.response.js';

type EventLevel = RecentActivityEventDto['level'];
type Params = Record<string, string | number>;

interface StoredEvent {
  id: string;
  at: Date;
  level: EventLevel;
  /** i18n key của nguồn, vd. `overview.map.api.name`, hoặc text thô (tên package). */
  source: string;
  messageKey: string;
  params: Params;
  /** Params là i18n key (vd. trạng thái), được dịch lúc đọc theo locale của request. */
  keyParams?: Record<string, string>;
}

interface StatusRecord {
  status: PackageStatus;
  since: Date;
}

const MAX_EVENTS = 100;

/**
 * Nhật ký sự kiện vận hành trong bộ nhớ của API process: khởi động, action được
 * thực thi và thay đổi trạng thái package. Text được dịch lúc đọc theo locale của request.
 */
@Injectable()
export class OpsEventService {
  private events: StoredEvent[] = [];
  private readonly statuses = new Map<string, StatusRecord>();
  private sequence = 0;

  constructor(private readonly i18n: CoreI18nService) {
    const startedAt = new Date(Date.now() - process.uptime() * 1000);
    this.push(
      {
        level: 'info',
        source: 'overview.map.api.name',
        messageKey: 'ops.event.apiStarted',
        params: {},
      },
      startedAt,
    );
  }

  public record(level: EventLevel, source: string, messageKey: string, params: Params = {}): void {
    this.push({ level, source, messageKey, params });
  }

  /** Ghi nhận trạng thái hiện tại của package; phát sinh sự kiện khi trạng thái thay đổi. */
  public trackStatus(packageId: string, displayName: string, status: PackageStatus): void {
    const previous = this.statuses.get(packageId);
    if (previous?.status === status) return;

    this.statuses.set(packageId, { status, since: new Date() });
    const level: EventLevel = status === PackageStatus.ERROR ? 'error' : 'warn';
    if (!previous) {
      if (status === PackageStatus.WARNING || status === PackageStatus.ERROR) {
        this.push({
          level,
          source: displayName,
          messageKey: 'ops.event.statusDetected',
          params: {},
          keyParams: { status: `ops.status.${status}` },
        });
      }
      return;
    }

    const recovered = status === PackageStatus.HEALTHY;
    this.push({
      level: recovered ? 'success' : level,
      source: displayName,
      messageKey: recovered ? 'ops.event.statusRecovered' : 'ops.event.statusChanged',
      params: {},
      keyParams: { from: `ops.status.${previous.status}`, to: `ops.status.${status}` },
    });
  }

  /** Thời điểm package chuyển sang trạng thái hiện tại (nếu đã được theo dõi). */
  public getStatusSince(packageId: string): Date | undefined {
    return this.statuses.get(packageId)?.since;
  }

  public getRecent(limit = 20): RecentActivityEventDto[] {
    return this.events.slice(0, limit).map((e) => ({
      id: e.id,
      time: e.at.toISOString(),
      level: e.level,
      source: this.i18n.t(e.source),
      message: this.i18n.t(e.messageKey, { ...e.params, ...this.translateKeys(e.keyParams) }),
    }));
  }

  private translateKeys(keyParams: Record<string, string> = {}): Params {
    return Object.fromEntries(Object.entries(keyParams).map(([k, key]) => [k, this.i18n.t(key)]));
  }

  private push(event: Omit<StoredEvent, 'id' | 'at'>, at = new Date()): void {
    this.sequence++;
    this.events = [{ ...event, id: `evt-${this.sequence}`, at }, ...this.events].slice(
      0,
      MAX_EVENTS,
    );
  }
}
