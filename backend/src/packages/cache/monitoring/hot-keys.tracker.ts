import type { HotKeySnapshot, HotKeyStat } from '../contracts/cache.contract.js';
import { namespaceOf } from '../utils/namespace.js';

export type HotKeyOperation = 'get' | 'set' | 'delete' | 'has';

export interface HotKeyTrackerOptions {
  windowSec: number;
  warnRpm: number;
  maxTrackedKeys: number;
  depth: number;
}

interface KeyBucketEntry {
  /** Số lượt truy cập theo từng giây (epochSec -> count). */
  buckets: Map<number, number>;
  totalInWindow: number;
  lastAccessedAt: number;
}

/**
 * Bộ đếm Hot Key trong bộ nhớ (sliding-window theo giây, giới hạn kích thước cố định).
 * Không bao giờ dùng lệnh `MONITOR` gây nghẽn Redis ở production.
 */
export class HotKeyTracker {
  private readonly windowSec: number;
  private readonly warnRpm: number;
  private readonly maxTrackedKeys: number;
  private readonly depth: number;
  private readonly entries = new Map<string, KeyBucketEntry>();

  constructor(options: HotKeyTrackerOptions) {
    this.windowSec = Math.max(10, Math.round(options.windowSec));
    this.warnRpm = Math.max(1, Math.round(options.warnRpm));
    this.maxTrackedKeys = Math.max(50, Math.round(options.maxTrackedKeys));
    this.depth = Math.max(1, Math.round(options.depth));
  }

  /** Ghi nhận một lượt truy cập key vào cửa sổ trượt hiện tại. */
  public record(key: string, _op: HotKeyOperation, now: number = Date.now()): void {
    const cleanKey = key.trim();
    if (!cleanKey) return;

    const currentSec = Math.floor(now / 1000);
    let entry = this.entries.get(cleanKey);

    if (!entry) {
      if (this.entries.size >= this.maxTrackedKeys) {
        this.evictIfFull(currentSec);
      }
      entry = { buckets: new Map<number, number>(), totalInWindow: 0, lastAccessedAt: now };
      this.entries.set(cleanKey, entry);
    }

    this.pruneEntry(entry, currentSec);
    entry.buckets.set(currentSec, (entry.buckets.get(currentSec) ?? 0) + 1);
    entry.totalInWindow += 1;
    entry.lastAccessedAt = now;
  }

  /** Chụp danh sách Top Hot Keys và tính RPM + tỷ trọng % truy cập. */
  public snapshot(limit: number = 20, now: number = Date.now()): HotKeySnapshot {
    const currentSec = Math.floor(now / 1000);
    const active: { key: string; hits: number; lastAccessedAt: number }[] = [];
    let totalAccesses = 0;

    for (const [key, entry] of this.entries) {
      this.pruneEntry(entry, currentSec);
      if (entry.totalInWindow <= 0) {
        this.entries.delete(key);
        continue;
      }
      totalAccesses += entry.totalInWindow;
      active.push({ key, hits: entry.totalInWindow, lastAccessedAt: entry.lastAccessedAt });
    }

    active.sort((a, b) => b.hits - a.hits || b.lastAccessedAt - a.lastAccessedAt);

    const safeLimit = Math.max(1, Math.min(100, Math.round(limit)));
    const items: HotKeyStat[] = active.slice(0, safeLimit).map((item) => {
      const rpm = Math.round(((item.hits * 60) / this.windowSec) * 10) / 10;
      const sharePercent =
        totalAccesses > 0 ? Math.round((item.hits / totalAccesses) * 1000) / 10 : 0;
      return {
        key: item.key,
        namespace: namespaceOf(item.key, this.depth),
        hits: item.hits,
        rpm,
        sharePercent,
        lastAccessedAt: new Date(item.lastAccessedAt).toISOString(),
        hot: rpm >= this.warnRpm,
      };
    });

    return {
      windowSec: this.windowSec,
      warnRpm: this.warnRpm,
      totalAccesses,
      items,
    };
  }

  /** Xóa toàn bộ dữ liệu theo dõi. */
  public reset(): void {
    this.entries.clear();
  }

  private pruneEntry(entry: KeyBucketEntry, currentSec: number): void {
    const cutoff = currentSec - this.windowSec + 1;
    for (const [sec, count] of entry.buckets) {
      if (sec < cutoff) {
        entry.buckets.delete(sec);
        entry.totalInWindow = Math.max(0, entry.totalInWindow - count);
      }
    }
  }

  private evictIfFull(currentSec: number): void {
    let lowestKey: string | null = null;
    let lowestHits = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.entries) {
      this.pruneEntry(entry, currentSec);
      if (entry.totalInWindow <= 0) {
        this.entries.delete(key);
        continue;
      }
      if (entry.totalInWindow < lowestHits) {
        lowestHits = entry.totalInWindow;
        lowestKey = key;
      }
    }

    if (this.entries.size >= this.maxTrackedKeys && lowestKey !== null) {
      this.entries.delete(lowestKey);
    }
  }
}
