import type {
  SequenceCounterSnapshot,
  SequenceDateFormatCode,
  SequenceDateFormatName,
  SequenceGenerateContext,
  SequenceGeneratedResult,
  SequencePreviewInput,
  SequencePreviewResult,
  SequenceResetPolicyCode,
  SequenceResetPolicyName,
} from '@packages/kernel/index.js';

export const SEQUENCES_PUBLIC_SERVICE = Symbol('SEQUENCES_PUBLIC_SERVICE');

export interface SequenceRuleSummary {
  readonly id: number;
  readonly key: string;
  readonly module: string;
  readonly name: string;
  readonly description: string | null;
  readonly prefix: string;
  readonly suffix: string;
  readonly separator: string;
  readonly dateFormat: SequenceDateFormatCode;
  readonly dateFormatName: SequenceDateFormatName;
  readonly templatePattern: string | null;
  readonly resolvedTemplate: string;
  readonly paddingLength: number;
  readonly startValue: number;
  readonly step: number;
  readonly resetPolicy: SequenceResetPolicyCode;
  readonly resetPolicyName: SequenceResetPolicyName;
  readonly scopeByUnit: boolean;
  readonly timezone: string;
  readonly samplePreview: string;
  readonly currentPeriodKey: string;
  readonly currentCounterValue: number;
  readonly counters: readonly SequenceCounterSnapshot[];
  readonly isSystem: boolean;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'ARCHIVED';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface SequenceRuleHistoryRecord {
  readonly id: number;
  readonly sequenceId: number;
  readonly sequenceKey: string;
  readonly action: 'CREATE' | 'UPDATE' | 'RESET_COUNTER' | 'ARCHIVE';
  readonly oldState: Record<string, unknown> | null;
  readonly newState: Record<string, unknown>;
  readonly actorUserId: number | null;
  readonly actorIdentifier: string | null;
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

export interface SyncSequencesResult {
  readonly syncedModules: string[];
  readonly totalSequences: number;
}

export interface ISequencesPublicService {
  syncManifests(): Promise<SyncSequencesResult>;
  preview(input: SequencePreviewInput): SequencePreviewResult;
  nextCode(key: string, context?: SequenceGenerateContext): Promise<SequenceGeneratedResult>;
  nextBatch(
    key: string,
    count: number,
    context?: SequenceGenerateContext,
  ): Promise<SequenceGeneratedResult[]>;
}
