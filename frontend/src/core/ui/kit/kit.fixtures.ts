/** Dữ liệu mẫu cho trang `_kit` (chỉ dev) — chỉ để duyệt giao diện, không phải số liệu thật. */
import type { ActivityItem, AlertItem } from '../blocks';
import type { TimeSeries } from '../charts';

const MIN = 60_000;
export const KIT_NOW = Date.UTC(2026, 9, 13, 4, 0, 0);
const points = (n: number, f: (i: number) => number | null) => Array.from({ length: n }, (_, i) => ({ t: KIT_NOW - (n - 1 - i) * MIN, v: f(i) }));

export const KIT_TEXT = {
  title: 'UI kit',
  description: 'Mọi block / chart dùng chung, dữ liệu mẫu.',
  sections: {
    stats: 'StatTile / StatGrid',
    charts: 'Charts',
    table: 'DataTable',
    alerts: 'AlertList / ActivityFeed',
    misc: 'Badge / LevelBadge / UsageBar / Truncate / JsonView',
    states: 'PanelState',
  },
  stat: { requests: 'Requests / s', p95: 'p95 latency', errors: 'Error rate', cpu: 'CPU', sub: 'so với 1 giờ trước', hint: 'Prometheus · rate(http_requests_total[1m])' },
  chart: { latency: 'Latency', levels: 'Log theo level', heat: 'Lỗi theo giờ', bars: 'Endpoint chậm nhất', gantt: 'Lịch chạy' },
  table: { route: 'Route', rps: 'RPS', p95: 'p95', errors: 'Lỗi' },
  confirm: { open: 'Mở ConfirmDialog', title: 'Xoá namespace cache?', confirm: 'Xoá', impact: ['Xoá 1.234 key', 'Request kế tiếp sẽ miss cache'] },
  sheet: { open: 'Mở DetailSheet', title: 'GET /api/v1/users/:id' },
  longText:
    "SQLSTATE[23000]: Integrity constraint violation: 1048 Column 'category_id' cannot be null (SQL: insert into report_new_bc49 (id, name, category_id, created_at) values (1, Dale Carnegie, ?, 2026-10-13 11:10:20)) — lặp lại nhiều lần trong batch merge.",
};

export const KIT_SERIES: TimeSeries[] = [
  { id: 'p95', label: 'p95', color: 'series-2', points: points(60, (i) => 180 + Math.sin(i / 6) * 60 + (i === 40 ? 420 : 0)) },
  { id: 'p50', label: 'p50', color: 'series-1', points: points(60, (i) => (i > 20 && i < 24 ? null : 60 + Math.cos(i / 5) * 15)), area: true },
];

export const KIT_LEVELS: TimeSeries[] = (['error', 'warn', 'info', 'debug'] as const).map((lvl, k) => ({
  id: lvl,
  label: lvl.toUpperCase(),
  color: `level-${lvl}` as const,
  points: points(30, (i) => Math.max(0, Math.round((4 - k) * 3 + Math.sin(i + k) * 4 + (lvl === 'error' && i === 22 ? 30 : 0)))),
}));

export const KIT_ROWS = [
  { id: '1', route: 'GET /api/v1/users/:id', rps: 42.1, p95: 120, errors: 0.2 },
  { id: '2', route: 'POST /api/v1/orders', rps: 8.4, p95: 940, errors: 5.1 },
  { id: '3', route: 'GET /api/v1/reports/export/very/long/path/that/should/truncate', rps: 0.6, p95: 4200, errors: 0 },
  { id: '4', route: 'GET /health', rps: 1, p95: 3, errors: 0 },
];

export const KIT_ALERTS: AlertItem[] = [
  { id: 'a1', tone: 'crit', title: 'Queue "emails" có 1.204 job đang chờ', detail: 'Vượt ngưỡng 1.000 trong 5 phút', since: new Date(KIT_NOW - 6 * MIN).toISOString() },
  { id: 'a2', tone: 'warn', title: 'p95 POST /orders 940 ms', detail: 'Ngưỡng 800 ms', since: new Date(KIT_NOW - 20 * MIN).toISOString() },
];

export const KIT_OK = ['Redis phản hồi', 'MySQL pool < 80%', 'Không có job stalled'];

export const KIT_FEED: ActivityItem[] = [
  { id: 'e1', at: new Date(KIT_NOW - 2 * MIN).toISOString(), tone: 'crit', title: 'Cron 36 failed: report_new_bc49:update', kind: 'error', source: 'scheduler' },
  { id: 'e2', at: new Date(KIT_NOW - 9 * MIN).toISOString(), tone: 'ok', title: 'Worker restarted', kind: 'event', source: 'worker' },
  { id: 'e3', at: new Date(KIT_NOW - 30 * MIN).toISOString(), tone: 'info', title: 'Clear namespace "session"', kind: 'operation', detail: '312 keys' },
];

export const KIT_KINDS = { error: 'Lỗi', event: 'Sự kiện', operation: 'Thao tác' };

export const KIT_HEAT = {
  x: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
  y: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
  cells: Array.from({ length: 24 * 7 }, (_, i) => [i % 24, Math.floor(i / 24), (i * 37) % 11 === 0 ? 12 : (i * 7) % 5] as [number, number, number]),
};

export const KIT_GANTT = {
  rows: [
    { id: 'r1', label: 'report:daily' },
    { id: 'r2', label: 'cache:warm' },
    { id: 'r3', label: 'cleanup:logs' },
  ],
  items: [
    { id: 'g1', rowId: 'r1', start: KIT_NOW - 50 * MIN, end: KIT_NOW - 44 * MIN, tone: 'ok' as const, label: 'ok · 6m' },
    { id: 'g2', rowId: 'r1', start: KIT_NOW - 20 * MIN, end: KIT_NOW - 12 * MIN, tone: 'crit' as const, label: 'failed · 8m' },
    { id: 'g3', rowId: 'r2', start: KIT_NOW - 40 * MIN, end: KIT_NOW - 39 * MIN, tone: 'ok' as const, label: 'ok · 1m' },
    { id: 'g4', rowId: 'r3', start: KIT_NOW - 5 * MIN, end: KIT_NOW, tone: 'info' as const, label: 'running' },
  ],
};
