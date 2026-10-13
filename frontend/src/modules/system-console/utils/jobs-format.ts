import { shortId } from '@core/lib/format';
import type { JobDetail, JobRow, JobSource } from '../types/jobs.types';
import { SHORT_ID_HEAD, SHORT_ID_TAIL } from '../constants/jobs';

/** Nhãn nguồn job ngắn: `POST /reports`, task ID, `#job`, hoặc runtime. */
export function sourceDetail(s: JobSource): string | null {
  if (s.kind === 'http' || s.kind === 'scheduler') return s.name ?? s.id;
  if (s.kind === 'job') return s.name ?? (s.id ? `#${s.id.slice(0, SHORT_ID_HEAD)}` : null);
  return s.name;
}

/** Thời lượng hiển thị: đang chạy → đã chạy bao lâu; xong → thời gian xử lý. */
export const jobDuration = (j: Pick<JobRow, 'status' | 'runningMs' | 'durationMs'>) =>
  j.status === 'active' || j.status === 'stalled' ? j.runningMs : j.durationMs;

/** `3/3`; lần thử thủ công vượt max → `4/3`. */
export const attemptsLabel = (j: Pick<JobRow, 'attempts' | 'maxAttempts'>) => `${j.attempts}/${j.maxAttempts}`;

/** Job ID ngắn gọn để hiển thị (id đầy đủ ở tooltip / nút sao chép). */
export const jobShortId = (id: string) => shortId(id, SHORT_ID_HEAD, SHORT_ID_TAIL);

/** Instance `worker@host:pid` → `host:pid`. */
export const instanceLabel = (id: string) => (id.includes('@') ? id.slice(id.indexOf('@') + 1) : id);

/** Khoá duy nhất của một job (id chỉ duy nhất trong một queue). */
export const jobKey = (j: Pick<JobRow, 'queue' | 'id'>) => `${j.queue}|${j.id}`;

/** Còn bao lâu tới thời điểm (ms), không âm; null khi không có. */
export const msUntil = (at: string | null | undefined, now: number) => (at ? Math.max(0, Date.parse(at) - now) : null);

/** Thời điểm đầy đủ theo trình duyệt (ngày + giờ). */
export const dateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : null);

/** Đường dẫn Logs Explorer cho job (theo correlation nếu log được khớp theo correlation). */
export const logsPathOf = (data: Pick<JobDetail, 'job' | 'logsMatchedBy'>) =>
  `logs/explorer?${data.logsMatchedBy === 'correlation' && data.job.correlationId ? `correlationId=${encodeURIComponent(data.job.correlationId)}` : `jobId=${encodeURIComponent(data.job.id)}`}`;
