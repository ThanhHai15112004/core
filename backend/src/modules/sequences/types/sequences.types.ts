import type {
  RegisteredSequenceRuleDefinition,
  SequenceManifestItem,
  SequenceRegistryService,
} from '@packages/kernel/index.js';
import type { AuditLogService, UserIdentity } from '@packages/security/index.js';
import type { SequenceRuleHistoryRecord } from '../contracts/index.js';
import type { SequenceHistoryActionType } from '../enum/sequences.enum.js';
import type { SequenceCounterRepository } from '../repositories/sequence-counter.repository.js';
import type { SequenceRuleHistoryRepository } from '../repositories/sequence-rule-history.repository.js';
import type { SequenceRuleRepository } from '../repositories/sequence-rule.repository.js';

export interface SyncManifestSequencesParams {
  customSequences?: readonly SequenceManifestItem[] | undefined;
  registry: SequenceRegistryService;
  ruleRepository?: SequenceRuleRepository | null | undefined;
  counterRepository?: SequenceCounterRepository | null | undefined;
  nextRuleId: () => number;
  markHydrated: () => void;
}

export interface RecordSequenceHistoryParams {
  sequenceId: number;
  sequenceKey: string;
  action: SequenceHistoryActionType;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown>;
  actor?: UserIdentity | undefined;
  reason?: string | null | undefined;
  nextHistoryId: () => number;
  historyRepository?: SequenceRuleHistoryRepository | null | undefined;
  auditLogService?: AuditLogService | null | undefined;
  inMemoryHistory: SequenceRuleHistoryRecord[];
}

export type { RegisteredSequenceRuleDefinition };
