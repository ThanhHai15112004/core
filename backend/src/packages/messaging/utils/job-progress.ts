import type { Job } from 'bullmq';

export type JobPhaseState = 'done' | 'active' | 'pending' | 'failed';

/** Tiến độ job do handler tự báo (Console chỉ hiện khi có — không đoán). */
export interface JobProgressReport {
  percent?: number | null;
  processed?: number | null;
  total?: number | null;
  /** Bước hiện tại, vd. `Generating PDF`. */
  step?: string | null;
  phases?: { name: string; state: JobPhaseState }[];
}

/**
 * Báo tiến độ cho job đang chạy (lưu ở BullMQ `progress` dạng object để phân biệt với mặc định 0). `percent` tự tính
 * từ processed/total nếu không truyền.
 */
export async function reportJobProgress(
  job: Pick<Job, 'updateProgress'>,
  report: JobProgressReport,
) {
  const percent =
    report.percent ??
    (report.total && report.processed !== null && report.processed !== undefined
      ? (report.processed / report.total) * 100
      : null);
  await job
    .updateProgress({
      percent: percent === null ? null : Math.max(0, Math.min(100, Math.round(percent * 10) / 10)),
      processed: report.processed ?? null,
      total: report.total ?? null,
      step: report.step ?? null,
      phases: report.phases ?? [],
    })
    .catch(() => undefined);
}
