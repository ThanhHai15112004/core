import type { Tone } from '@core/theme';
import type {
  ExecutionStatus,
  ExecutionTrigger,
  SchedulerMetric,
  SchedulerRange,
  SchedulerSeverity,
  SchedulerStatus,
  TaskDisplayStatus,
  TaskHealth,
} from '../types/scheduler.types';

/** Tab của Scheduler (Lỗi → bộ lọc trong Lịch sử; Sự kiện → Tổng quan; Cấu hình → nút ⚙). */
export const SCHEDULER_TABS = ['overview', 'tasks', 'history', 'timeline'] as const;
export type SchedulerPageTab = (typeof SCHEDULER_TABS)[number];
/** Tab con của trang chi tiết task. */
export const TASK_DETAIL_TABS = ['overview', 'history'] as const;
export type TaskPageTab = (typeof TASK_DETAIL_TABS)[number];
/** Tab con cũ → tab con mới (`metrics`, `configuration` gộp vào Tổng quan; `logs` gộp vào Lịch sử). */
export const TASK_DETAIL_ALIASES: Record<string, TaskPageTab> = { metrics: 'overview', configuration: 'overview', logs: 'history' };

export const SCHEDULER_RANGES = ['1h', '6h', '24h', '7d'] as const satisfies readonly SchedulerRange[];
/** Timeline vẽ từng lần chạy: 7 ngày quá dày. */
export const TIMELINE_RANGES = ['1h', '6h', '24h'] as const satisfies readonly SchedulerRange[];
export const SCHEDULER_METRICS: SchedulerMetric[] = ['executions', 'duration', 'failures'];
export const EXECUTION_STATUSES: ExecutionStatus[] = ['success', 'failed', 'running', 'scheduled'];
export const EXECUTION_TRIGGERS: ExecutionTrigger[] = ['scheduled', 'manual'];
export const TASK_STATUS_FILTERS = ['all', 'enabled', 'disabled', 'failing'] as const;
export const TASK_TYPE_FILTERS = ['all', 'cron', 'interval'] as const;
export const TASK_HEALTH_FILTERS = ['all', 'healthy', 'warning', 'error'] as const;

export const SCHEDULER_TONE: Record<SchedulerStatus, Tone> = { healthy: 'ok', degraded: 'warn', down: 'crit', paused: 'unknown', unknown: 'unknown' };
export const TASK_STATUS_TONE: Record<TaskDisplayStatus, Tone> = { enabled: 'ok', running: 'info', disabled: 'unknown', failing: 'warn' };
export const TASK_HEALTH_TONE: Record<TaskHealth, Tone> = { healthy: 'ok', warning: 'warn', error: 'crit', unknown: 'unknown' };
export const EXECUTION_TONE: Record<ExecutionStatus, Tone> = { success: 'ok', running: 'info', failed: 'crit', scheduled: 'unknown' };
export const SEVERITY_TONE: Record<SchedulerSeverity, Tone> = { critical: 'crit', warning: 'warn', info: 'info' };
/** Màu series do backend trả (`id`) → màu theme. */
export const SCHEDULER_SERIES_COLOR = { successful: 'ok', failed: 'crit', durationAvg: 'series-1' } as const;

/** Tỉ lệ thành công dưới ngưỡng này → cảnh báo. */
export const SUCCESS_RATE_WARN_PERCENT = 95;
/** Số lần chạy tối đa mỗi lần tải Lịch sử (toàn bộ / một task). */
export const HISTORY_LIMIT = 300;
export const TASK_HISTORY_LIMIT = 200;
/** Lịch sắp chạy: số giờ nhìn trước và số dòng hiển thị. */
export const UPCOMING_HOURS = 24;
export const UPCOMING_ROWS = 48;
/** Phần tương lai trên Timeline (tỉ lệ so với khoảng đã chọn) để thấy lịch sắp chạy. */
export const TIMELINE_FUTURE_RATIO = 1 / 6;
/** Độ rộng tối thiểu một mốc "lần tới" trên Gantt (tỉ lệ so với cả trục). */
export const TIMELINE_NEXT_WIDTH_RATIO = 1 / 400;
/** Chiều cao vùng cuộn của các danh sách (px). */
export const LIST_MAX_HEIGHT_PX = 420;
export const HISTORY_TABLE_HEIGHT_PX = 620;
export const ACTIVITY_MAX_HEIGHT_PX = 360;
/** Heatmap mật độ lịch: chiều cao mỗi hàng task và phần trục (px). */
export const HEATMAP_ROW_PX = 28;
export const HEATMAP_AXIS_PX = 48;
/** Số tên task hiện cạnh mỗi loại lỗi (còn lại gộp thành +N). */
export const BREAKDOWN_TASKS = 2;
/** Chu kỳ cập nhật đếm ngược "còn …" (ms). */
export const COUNTDOWN_TICK_MS = 5_000;
/** Cron Inspector. */
export const CRON_DEBOUNCE_MS = 350;
export const CRON_DEFAULT_EXPRESSION = '0 */6 * * *';
export const CRON_EXPRESSION_MAX = 120;
export const TIMEZONE_MAX = 64;
/** Config key là chu kỳ (ms) → `5m`, `1h`. */
export const CONFIG_INTERVAL_KEYS = new Set(['every']);
