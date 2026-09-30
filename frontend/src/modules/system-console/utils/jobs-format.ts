import type { JobRow, JobSource } from '../types/jobs.types';

/** Nhãn nguồn job ngắn: `POST /reports`, task ID, `#job`, hoặc runtime. */
export function sourceDetail(s: JobSource): string | null {
  if (s.kind === 'http') return s.name ?? s.id;
  if (s.kind === 'scheduler') return s.name ?? s.id;
  if (s.kind === 'job') return s.name ?? (s.id ? `#${s.id.slice(0, 8)}` : null);
  return s.name;
}

/** Thời lượng hiển thị của một job: đang chạy → đã chạy bao lâu; xong → thời gian xử lý. */
export const jobDuration = (j: Pick<JobRow, 'status' | 'runningMs' | 'durationMs'>) =>
  j.status === 'active' || j.status === 'stalled' ? j.runningMs : j.durationMs;

/** `3/3`, lần thử thủ công vượt max → `4/3`. */
export const attemptsLabel = (j: Pick<JobRow, 'attempts' | 'maxAttempts'>) => `${j.attempts}/${j.maxAttempts}`;
