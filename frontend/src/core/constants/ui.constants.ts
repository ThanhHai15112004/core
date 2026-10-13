/**
 * Hằng số giao diện dùng chung (core/ui, core/data). Không viết số "ma thuật" trong component —
 * thêm vào đây với tên rõ nghĩa.
 */

/** Chu kỳ tự làm mới (ms). 0 = tắt. */
export const REFRESH_OPTIONS_MS = [0, 5_000, 10_000, 30_000, 60_000] as const;
export type RefreshMs = (typeof REFRESH_OPTIONS_MS)[number];
export const DEFAULT_REFRESH_MS: RefreshMs = 10_000;

/**
 * Tầng làm mới của một query, nhân với chu kỳ người dùng chọn:
 * `live` = theo đúng chu kỳ, `slow` = thưa hơn (danh sách nặng, báo cáo), `static` = chỉ làm mới tay (cấu hình).
 */
export const QUERY_TIER_MULTIPLIER = { live: 1, slow: 6, static: 0 } as const;
export type QueryTier = keyof typeof QUERY_TIER_MULTIPLIER;

/** Khoảng thời gian xem dữ liệu. */
export const TIME_RANGES = ['5m', '15m', '1h', '6h', '24h', '7d'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];
export const DEFAULT_TIME_RANGE: TimeRange = '1h';
export const TIME_RANGE_MS: Record<TimeRange, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

/** Query */
export const QUERY_RETRY_COUNT = 1;
export const QUERY_STALE_MS = 2_000;

/** Bảng */
export const TABLE_PAGE_SIZE = 50;
export const TABLE_ROW_HEIGHT_PX = 32;
export const TABLE_SKELETON_ROWS = 5;
export const TABLE_OVERSCAN_ROWS = 12;

/** Biểu đồ */
export const CHART_HEIGHT_PX = { sm: 160, md: 240, lg: 320 } as const;
export const SPARKLINE_HEIGHT_PX = 28;
export const CHART_GROUP = 'ui-chart-group';

/** Thông báo */
export const TOAST_DURATION_MS = 4_000;

/** Ngưỡng độ trễ API hiển thị trên thanh trên cùng. */
export const API_LATENCY_THRESHOLD_MS = { warn: 150, crit: 500 } as const;

/** Text dài: số dòng hiển thị trước khi cắt. */
export const TRUNCATE_LINES_DEFAULT = 2;

/** Khoá lưu trạng thái giao diện (localStorage). */
export const UI_STORAGE_KEYS = {
  sidebarCollapsed: 'ui_sidebar_collapsed',
  refreshMs: 'ui_refresh_ms',
  timeRange: 'ui_time_range',
} as const;
