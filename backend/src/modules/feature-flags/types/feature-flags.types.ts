import type {
  FeatureFlagEvaluationContext,
  FeatureFlagEvaluationResult,
  FeatureFlagManifestItem,
  FeatureFlagRegistryService,
  RegisteredFeatureFlagDefinition,
} from '@packages/kernel/index.js';
import type { AuditLogService, UserIdentity } from '@packages/security/index.js';
import type { FeatureFlagHistoryRecord } from '../contracts/index.js';
import type { FeatureFlagHistoryActionType } from '../enum/feature-flags.enum.js';
import type { FeatureFlagHistoryRepository } from '../repositories/feature-flag-history.repository.js';
import type { FeatureFlagRepository } from '../repositories/feature-flag.repository.js';

export interface SyncManifestFeatureFlagsParams {
  customFlags?: readonly FeatureFlagManifestItem[] | undefined;
  registry: FeatureFlagRegistryService;
  flagRepository?: FeatureFlagRepository | null | undefined;
  upsertDefinitionSilent: (def: RegisteredFeatureFlagDefinition) => void;
  markHydrated: () => void;
}

export interface RecordFeatureFlagHistoryParams {
  flagId: number;
  flagKey: string;
  action: FeatureFlagHistoryActionType;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown>;
  reason: string | null;
  actor?: UserIdentity | undefined;
  nextHistoryId: () => number;
  historyRepository?: FeatureFlagHistoryRepository | null | undefined;
  auditLogService?: AuditLogService | null | undefined;
  inMemoryHistory: FeatureFlagHistoryRecord[];
}

export type {
  FeatureFlagEvaluationContext,
  FeatureFlagEvaluationResult,
  RegisteredFeatureFlagDefinition,
};
