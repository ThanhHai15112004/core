import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENCY_METADATA_KEY = 'core:idempotent_options';

export interface IdempotentOptions {
  /**
   * Tên luồng định danh cho khóa chống trùng (mặc định tự sinh `"<METHOD> <route>"`).
   * Dùng để ghép chính sách TTL riêng theo từng luồng trong `idempotency.flow_ttl_overrides`.
   */
  readonly scopeTarget?: string | undefined;
  /** Thời gian lưu khóa chống trùng (giây). Nếu bỏ trống sẽ lấy từ Setting `idempotency.ttl.api_sec`. */
  readonly ttlSec?: number | undefined;
  /** Thời gian giữ khóa xử lý đồng thời (giây) chống race condition. */
  readonly leaseSec?: number | undefined;
  /**
   * `true`: bắt buộc client gửi header `Idempotency-Key` (thiếu → 400 `IDEMPOTENCY_KEY_REQUIRED`).
   * `false` (mặc định): chỉ kích hoạt chống trùng khi client gửi header `Idempotency-Key`.
   */
  readonly required?: boolean | undefined;
  /** Tên HTTP header chứa Idempotency Key (mặc định `idempotency-key`). */
  readonly headerName?: string | undefined;
  /** Có đưa query string vào dấu vân tay dữ liệu hay không (mặc định `true`). */
  readonly includeQueryInFingerprint?: boolean | undefined;
  /** Giới hạn kích thước (byte) payload phản hồi được lưu để replay (mặc định 256 KB). */
  readonly maxResponseBytes?: number | undefined;
}

/**
 * Đánh dấu một Controller hoặc Endpoint HTTP được bảo vệ chống tạo/xử lý trùng qua `Idempotency-Key` (Phase 11.3).
 */
export function Idempotent(options: IdempotentOptions = {}): MethodDecorator & ClassDecorator {
  return SetMetadata(IDEMPOTENCY_METADATA_KEY, options);
}
