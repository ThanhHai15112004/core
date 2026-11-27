import type { LegalHoldCheckDecision, LegalHoldCheckQuery } from '@packages/kernel/index.js';
import type {
  DataGovernanceOverviewView,
  GovernanceExpirationSweepResult,
  RetentionSweepSummaryView,
} from '../types/data-governance.types.js';

export * from '../enum/data-governance.enum.js';
export * from '../types/data-governance.types.js';

export const DATA_GOVERNANCE_PUBLIC_SERVICE = Symbol('DATA_GOVERNANCE_PUBLIC_SERVICE');

export interface IDataGovernancePublicService {
  getOverview(): Promise<DataGovernanceOverviewView>;
  checkLegalHold(query: LegalHoldCheckQuery): Promise<LegalHoldCheckDecision>;
  runRetentionSweep(options?: {
    readonly dataTypeCode?: string | undefined;
    readonly dryRun?: boolean | undefined;
    readonly now?: Date | undefined;
  }): Promise<RetentionSweepSummaryView>;
  runExpirationSweep(now?: Date): Promise<GovernanceExpirationSweepResult>;
}
