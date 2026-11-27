import { Injectable } from '@nestjs/common';
import type {
  ILegalHoldGuardEvaluator,
  IPersonalDataContributor,
  IRetentionExecutor,
  ISensitiveFieldPolicyEvaluator,
} from '../contracts/data-governance.contract.js';

/**
 * Registry thuần kỹ thuật không chứa nghiệp vụ (Zero Domain Leakage — Mục 14.5).
 * Cho phép module tùy chọn `data-governance` và các module nền tảng đăng ký:
 * - Chính sách che trường nhạy cảm cho Log, Export và Phân quyền.
 * - Kiểm tra chặn xóa / chặn dọn Retention khi đang có lệnh tạm giữ pháp lý (Legal Hold).
 * - Đầu mối tổng hợp / xuất / xóa (có ngoại lệ) dữ liệu cá nhân liên module (DSAR).
 * - Trình thực thi thời gian lưu trữ dữ liệu (Data Retention) theo từng loại dữ liệu.
 */
@Injectable()
export class DataGovernanceHookRegistry {
  private sensitiveFieldEvaluator: ISensitiveFieldPolicyEvaluator | null = null;
  private legalHoldGuard: ILegalHoldGuardEvaluator | null = null;
  private readonly personalDataContributors = new Map<string, IPersonalDataContributor>();
  private readonly retentionExecutors = new Map<string, IRetentionExecutor>();
  private logRedactSyncListener: ((extraKeys: readonly string[]) => void) | null = null;

  public registerSensitiveFieldEvaluator(evaluator: ISensitiveFieldPolicyEvaluator | null): void {
    this.sensitiveFieldEvaluator = evaluator;
    this.notifyLogRedactSync();
  }

  public getSensitiveFieldEvaluator(): ISensitiveFieldPolicyEvaluator | null {
    return this.sensitiveFieldEvaluator;
  }

  public registerLogRedactSyncListener(
    listener: ((extraKeys: readonly string[]) => void) | null,
  ): void {
    this.logRedactSyncListener = listener;
    this.notifyLogRedactSync();
  }

  public notifyLogRedactSync(): void {
    if (!this.logRedactSyncListener) return;
    const keys = this.sensitiveFieldEvaluator?.getLogRedactFieldNames() ?? [];
    this.logRedactSyncListener(keys);
  }

  public registerLegalHoldGuard(guard: ILegalHoldGuardEvaluator | null): void {
    this.legalHoldGuard = guard;
  }

  public getLegalHoldGuard(): ILegalHoldGuardEvaluator | null {
    return this.legalHoldGuard;
  }

  public registerPersonalDataContributor(contributor: IPersonalDataContributor): void {
    this.personalDataContributors.set(contributor.contributorKey, contributor);
  }

  public unregisterPersonalDataContributor(contributorKey: string): void {
    this.personalDataContributors.delete(contributorKey);
  }

  public listPersonalDataContributors(): IPersonalDataContributor[] {
    return [...this.personalDataContributors.values()];
  }

  public registerRetentionExecutor(executor: IRetentionExecutor): void {
    this.retentionExecutors.set(executor.dataTypeCode, executor);
  }

  public getRetentionExecutor(dataTypeCode: string): IRetentionExecutor | null {
    return this.retentionExecutors.get(dataTypeCode) ?? null;
  }

  public listRetentionExecutors(): IRetentionExecutor[] {
    return [...this.retentionExecutors.values()];
  }

  public clearPolicyHooks(): void {
    this.sensitiveFieldEvaluator = null;
    this.legalHoldGuard = null;
    this.notifyLogRedactSync();
  }
}

export const defaultDataGovernanceHookRegistry = new DataGovernanceHookRegistry();
