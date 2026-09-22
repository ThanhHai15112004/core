import type { ChartSeries } from '../components/common/LineChart';
import type { StorageSeries } from '../types/storage.types';
import { STORAGE_SERIES_COLORS } from '../constants/storage';
import { FALLBACK_COLORS } from '../constants/performance';
import { formatBytes, formatSignedBytes } from './database-format';
import { NO_VALUE } from './runtime-format';

const MB = 1024 * 1024;

/** Tốc độ truyền: `28.4 MB/s`. */
export const formatRate = (bytesPerSec: number | null | undefined) =>
  bytesPerSec === null || bytesPerSec === undefined ? NO_VALUE : `${formatBytes(Math.round(bytesPerSec))}/s`;

export const formatGrowth = (bytes: number | null | undefined) => formatSignedBytes(bytes);

/** Series theo byte (B, B/s) → MB để trục dễ đọc. */
export function toStorageChart(list: StorageSeries[]): { series: ChartSeries[]; unit: string } {
  const conv = (u: string) => (u === 'B' ? 'MB' : u === 'B/s' ? 'MB/s' : u);
  const first = list[0]?.unit ?? '';
  // Lịch sử theo giờ: chưa đủ 2 điểm thì không vẽ (một điểm làm trục thời gian vô nghĩa).
  const enough = (s: StorageSeries) => (s.unit === 'B' && s.points.length < 2 ? [] : s.points);
  return {
    unit: conv(first),
    series: list.map((s, i) => ({
      id: s.id,
      label: s.label,
      unit: conv(s.unit),
      // Series khác đơn vị (vd. lượt/phút cạnh MB/s) vẽ theo trục phải.
      ...(s.unit !== first ? { axis: 'right' as const } : {}),
      color: STORAGE_SERIES_COLORS[s.id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
      points: s.unit === 'B' || s.unit === 'B/s' ? enough(s).map((p) => ({ t: p.t, value: Number((p.value / MB).toFixed(3)) })) : s.points,
    })),
  };
}
