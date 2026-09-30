/** Nguồn tạo job: HTTP request, lần chạy Scheduler, job khác, thao tác thủ công (CLI/Console) hoặc hệ thống. */
export type JobSourceKind = 'http' | 'scheduler' | 'job' | 'manual' | 'system';

export const JOB_SOURCE_KINDS: JobSourceKind[] = ['http', 'scheduler', 'job', 'manual', 'system'];

export interface JobSource {
  kind: JobSourceKind;
  /** request ID / scheduler execution ID / job ID cha. */
  id: string | null;
  /** `POST /api/v1/reports`, task ID, loại job cha… */
  name: string | null;
  /** Queue của job cha. */
  detail: string | null;
}

/** Metadata vận hành đi kèm envelope (không phải payload nghiệp vụ) — nền cho Job Explorer. */
export interface JobMeta {
  source: JobSource;
  requestId: string | null;
  /** Khoá idempotency do producer khai báo (vd. `payment:821`). */
  idempotencyKey: string | null;
  /** Field nghiệp vụ được index để tìm kiếm (vd. `{ orderId: '82918' }`) — không quét payload. */
  index: Record<string, string>;
  /** Tên schema / phiên bản payload (vd. `GenerateReportPayload:v2`). */
  schema: string | null;
}

export interface PublishOptions {
  /** Chưa được chạy trước chừng này (ms) — job ở trạng thái Delayed. */
  delayMs?: number;
  /** Độ ưu tiên BullMQ (1 = cao nhất). Job không có priority được BullMQ lấy trước job có priority. */
  priority?: number;
  idempotencyKey?: string;
  index?: Record<string, string | number>;
  schema?: string;
}
