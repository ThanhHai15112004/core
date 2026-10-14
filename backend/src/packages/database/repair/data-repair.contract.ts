import type { EntityManager } from 'typeorm';

/** Kết quả trả về từ một kịch bản sửa dữ liệu (`DataRepairContract.execute`) */
export interface DataRepairExecutionResult {
  /** Tổng số bản ghi đã quét để kiểm tra */
  scannedCount: number;
  /** Số bản ghi bị tác động (sẽ được sửa nếu commit, hoặc đã sửa thử trong dry-run) */
  affectedCount: number;
  /** Tóm tắt ngắn gọn kết quả xử lý */
  summary: string;
  /** Thông tin chi tiết bổ sung (diff mẫu, danh sách ID...) */
  details?: Record<string, unknown>;
}

/** Hợp đồng chuẩn cho công cụ sửa/đồng bộ dữ liệu có hỗ trợ Dry-Run */
export interface DataRepairContract {
  /** Tên định danh duy nhất của kịch bản (kebab-case, vd: `migration-checksum-sync`) */
  readonly name: string;
  /** Mô tả mục đích của kịch bản sửa dữ liệu */
  readonly description: string;
  /**
   * Thực thi logic kiểm tra và sửa dữ liệu bên trong một Transaction do `DataRepairRunnerService` quản lý.
   * Khi `context.dryRun === true`, mọi câu lệnh ghi dữ liệu vẫn chạy trên `manager` để đếm chính xác `affectedCount`
   * và kiểm tra ràng buộc DB, sau đó `DataRepairRunnerService` sẽ tự động `ROLLBACK` hoàn toàn.
   */
  execute(
    manager: EntityManager,
    context: { readonly dryRun: boolean },
  ): Promise<DataRepairExecutionResult>;
}

/** Báo cáo hoàn chỉnh sau khi chạy một kịch bản sửa dữ liệu */
export interface DataRepairRunReport {
  name: string;
  description: string;
  dryRun: boolean;
  status: 'DRY_RUN_ROLLED_BACK' | 'APPLIED_COMMITTED';
  scannedCount: number;
  affectedCount: number;
  summary: string;
  durationMs: number;
  executedAt: string;
  details?: Record<string, unknown>;
}

export const DATA_REPAIR_SCRIPTS = Symbol('DATA_REPAIR_SCRIPTS');
