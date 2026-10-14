import { Injectable, Logger } from '@nestjs/common';
import { DatabaseConnectionService } from '../providers/database-connection.service.js';
import { TransactionManager } from '../transaction/transaction-manager.service.js';
import type {
  DataRepairContract,
  DataRepairExecutionResult,
  DataRepairRunReport,
} from './data-repair.contract.js';

/** Tín hiệu nội bộ dùng để kích hoạt ROLLBACK chủ động khi chạy ở chế độ Dry-Run */
class DryRunRollbackSignal extends Error {
  constructor(public readonly result: DataRepairExecutionResult) {
    super('DRY_RUN_ROLLBACK_SIGNAL');
    this.name = 'DryRunRollbackSignal';
  }
}

/**
 * Dịch vụ thực thi các kịch bản sửa/chuẩn hóa dữ liệu (`DataRepairContract`) có cơ chế Dry-Run an toàn:
 * - Mặc định luôn chạy với `dryRun = true`: Mở Transaction thật, thực thi kịch bản, thu thập số liệu
 *   `scannedCount` / `affectedCount`, sau đó chủ động `ROLLBACK` 100% để không thay đổi dữ liệu thật.
 * - Khi truyền `dryRun = false` (`--apply`): Mở Transaction thật, thực thi kịch bản và `COMMIT` nếu không có lỗi.
 */
@Injectable()
export class DataRepairRunnerService {
  private readonly logger = new Logger(DataRepairRunnerService.name);
  private readonly registry = new Map<string, DataRepairContract>();

  constructor(
    private readonly connection: DatabaseConnectionService,
    private readonly transactionManager: TransactionManager,
  ) {}

  /** Đăng ký một hoặc nhiều kịch bản sửa dữ liệu vào bộ điều phối */
  public register(...scripts: DataRepairContract[]): void {
    for (const script of scripts) {
      this.registry.set(script.name, script);
    }
  }

  /** Lấy danh sách tất cả kịch bản sửa dữ liệu đã đăng ký */
  public list(): DataRepairContract[] {
    return Array.from(this.registry.values());
  }

  /** Thực thi một kịch bản sửa dữ liệu theo tên với cờ `dryRun` (mặc định `true` để bảo vệ dữ liệu) */
  public async run(name: string, options?: { dryRun?: boolean }): Promise<DataRepairRunReport> {
    if (!this.connection.connected()) {
      throw new Error(
        `Database is not connected (state: ${this.connection.getStatus().state}). Cannot run data repair.`,
      );
    }

    const script = this.registry.get(name);
    if (!script) {
      const available = Array.from(this.registry.keys()).join(', ') || 'none';
      throw new Error(`Data repair script "${name}" not found. Available scripts: ${available}`);
    }

    const dryRun = options?.dryRun ?? true;
    const startedAt = Date.now();

    this.logger.log(
      `Starting data repair script "${script.name}" (mode=${dryRun ? 'DRY-RUN' : 'APPLY'})...`,
    );

    let executionResult: DataRepairExecutionResult;

    try {
      executionResult = await this.transactionManager.runInTransaction(async (manager) => {
        const res = await script.execute(manager, { dryRun });
        if (dryRun) {
          throw new DryRunRollbackSignal(res);
        }
        return res;
      });
    } catch (err: unknown) {
      if (err instanceof DryRunRollbackSignal) {
        executionResult = err.result;
      } else {
        throw err;
      }
    }

    const durationMs = Date.now() - startedAt;
    const status = dryRun ? 'DRY_RUN_ROLLED_BACK' : 'APPLIED_COMMITTED';

    this.logger.log(
      `Data repair "${script.name}" finished: status=${status}, scanned=${executionResult.scannedCount}, affected=${executionResult.affectedCount}, duration=${durationMs}ms`,
    );

    return {
      name: script.name,
      description: script.description,
      dryRun,
      status,
      scannedCount: executionResult.scannedCount,
      affectedCount: executionResult.affectedCount,
      summary: executionResult.summary,
      durationMs,
      executedAt: new Date().toISOString(),
      ...(executionResult.details ? { details: executionResult.details } : {}),
    };
  }
}
