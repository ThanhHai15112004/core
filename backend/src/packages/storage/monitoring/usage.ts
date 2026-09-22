import type { StorageDriverName } from '@packages/config/index.js';
import { OBJECT_KINDS, containerOf, kindOf, type ObjectKind } from '../utils/object-kind.js';
import type { ScannedObject } from './monitoring.types.js';

const DAY = 86_400_000;
export const LARGEST_OBJECTS_LIMIT = 20;
export const USAGE_CONTAINER_LIMIT = 200;

export type AgeBucket = 'lt1d' | '1to7d' | '7to30d' | '30to90d' | 'gt90d' | 'unknown';
export const AGE_BUCKETS: readonly AgeBucket[] = [
  'lt1d',
  '1to7d',
  '7to30d',
  '30to90d',
  'gt90d',
  'unknown',
];

export interface ContainerUsage {
  name: string;
  objects: number;
  bytes: number;
  /** epoch ms — object mới nhất. */
  newest: number | null;
  createdToday: number;
  bytesToday: number;
  byKind: Partial<Record<ObjectKind, { objects: number; bytes: number }>>;
}

export interface LargestObject {
  key: string;
  container: string;
  size: number;
  kind: ObjectKind;
  lastModified: number | null;
}

/** Tổng hợp usage của storage tại một thời điểm (từ lần quét có giới hạn). */
export interface UsageSnapshot {
  at: number;
  driver: StorageDriverName;
  totalObjects: number;
  scannedObjects: number;
  truncated: boolean;
  totalBytes: number;
  /** Object sửa đổi/tạo từ đầu ngày (theo lastModified). */
  createdToday: number;
  bytesToday: number;
  containers: ContainerUsage[];
  byKind: Record<ObjectKind, { objects: number; bytes: number }>;
  byAge: Record<AgeBucket, { objects: number; bytes: number }>;
  largest: LargestObject[];
  durationMs: number;
}

/** Mẫu thu gọn lưu theo giờ để vẽ tăng trưởng. */
export interface UsagePoint {
  at: number;
  bytes: number;
  objects: number;
  containers: Record<string, { bytes: number; objects: number }>;
}

export function ageBucketOf(lastModified: number | null, now: number): AgeBucket {
  if (lastModified === null) return 'unknown';
  const age = now - lastModified;
  if (age < DAY) return 'lt1d';
  if (age < 7 * DAY) return '1to7d';
  if (age < 30 * DAY) return '7to30d';
  if (age < 90 * DAY) return '30to90d';
  return 'gt90d';
}

export function buildUsageSnapshot(input: {
  objects: readonly ScannedObject[];
  total: number;
  truncated: boolean;
  driver: StorageDriverName;
  at: number;
  startOfDay: number;
  durationMs: number;
}): UsageSnapshot {
  const byKind = Object.fromEntries(
    OBJECT_KINDS.map((k) => [k, { objects: 0, bytes: 0 }]),
  ) as UsageSnapshot['byKind'];
  const byAge = Object.fromEntries(
    AGE_BUCKETS.map((a) => [a, { objects: 0, bytes: 0 }]),
  ) as UsageSnapshot['byAge'];
  const containers = new Map<string, ContainerUsage>();
  let totalBytes = 0;
  let createdToday = 0;
  let bytesToday = 0;
  let largest: LargestObject[] = [];

  for (const o of input.objects) {
    const container = containerOf(o.key);
    const kind = kindOf(o.key, o.contentType);
    const today = o.lastModified !== null && o.lastModified >= input.startOfDay;
    totalBytes += o.size;
    byKind[kind].objects++;
    byKind[kind].bytes += o.size;
    const age = byAge[ageBucketOf(o.lastModified, input.at)];
    age.objects++;
    age.bytes += o.size;
    if (today) {
      createdToday++;
      bytesToday += o.size;
    }
    const c = containers.get(container) ?? {
      name: container,
      objects: 0,
      bytes: 0,
      newest: null,
      createdToday: 0,
      bytesToday: 0,
      byKind: {},
    };
    c.objects++;
    c.bytes += o.size;
    const ck = (c.byKind[kind] ??= { objects: 0, bytes: 0 });
    ck.objects++;
    ck.bytes += o.size;
    if (o.lastModified !== null && (c.newest === null || o.lastModified > c.newest))
      c.newest = o.lastModified;
    if (today) {
      c.createdToday++;
      c.bytesToday += o.size;
    }
    containers.set(container, c);
    largest.push({ key: o.key, container, size: o.size, kind, lastModified: o.lastModified });
    if (largest.length > LARGEST_OBJECTS_LIMIT * 4) {
      largest.sort((a, b) => b.size - a.size);
      largest = largest.slice(0, LARGEST_OBJECTS_LIMIT);
    }
  }

  return {
    at: input.at,
    driver: input.driver,
    totalObjects: input.total,
    scannedObjects: input.objects.length,
    truncated: input.truncated,
    totalBytes,
    createdToday,
    bytesToday,
    containers: [...containers.values()]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, USAGE_CONTAINER_LIMIT),
    byKind,
    byAge,
    largest: largest.sort((a, b) => b.size - a.size).slice(0, LARGEST_OBJECTS_LIMIT),
    durationMs: input.durationMs,
  };
}

export function toUsagePoint(s: UsageSnapshot): UsagePoint {
  return {
    at: s.at,
    bytes: s.totalBytes,
    objects: s.totalObjects,
    containers: Object.fromEntries(
      s.containers.slice(0, 30).map((c) => [c.name, { bytes: c.bytes, objects: c.objects }]),
    ),
  };
}

/** Điểm gần nhất tại/trước mốc `at` (danh sách mới nhất trước). */
export const pointAtOrBefore = (points: readonly UsagePoint[], at: number) =>
  points.find((p) => p.at <= at) ?? null;

/** Tăng trưởng từ mốc `since` tới hiện tại; null khi chưa có điểm đủ cũ. */
export function growthSince(
  points: readonly UsagePoint[],
  current: { bytes: number; objects: number },
  since: number,
) {
  const base = pointAtOrBefore(points, since);
  if (!base) return null;
  return {
    bytes: current.bytes - base.bytes,
    objects: current.objects - base.objects,
    from: base.at,
  };
}

/** Lọc object theo filter (dùng chung cho mọi provider sau khi list). */
export function matchesFilter(
  o: ScannedObject,
  f: {
    kind: ObjectKind | null;
    minSize: number | null;
    maxSize: number | null;
    minAgeMs: number | null;
    maxAgeMs: number | null;
  },
  now: number,
): boolean {
  if (f.kind && kindOf(o.key, o.contentType) !== f.kind) return false;
  if (f.minSize !== null && o.size < f.minSize) return false;
  if (f.maxSize !== null && o.size > f.maxSize) return false;
  const age = o.lastModified === null ? null : now - o.lastModified;
  if (f.minAgeMs !== null && (age === null || age < f.minAgeMs)) return false;
  if (f.maxAgeMs !== null && (age === null || age > f.maxAgeMs)) return false;
  return true;
}
