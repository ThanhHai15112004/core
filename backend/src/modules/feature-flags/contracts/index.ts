import type {
  FeatureFlagEvaluationContext,
  FeatureFlagEvaluationResult,
} from '@packages/kernel/index.js';

export const FEATURE_FLAGS_PUBLIC_SERVICE = Symbol('FEATURE_FLAGS_PUBLIC_SERVICE');

export interface FeatureFlagSummary {
  readonly id: number;
  readonly key: string;
  readonly module: string;
  readonly isModuleInstalled: boolean;
  readonly name: string;
  readonly description: string;
  readonly isEnabled: boolean;
  readonly rolloutPercentage: number;
  readonly targetUserIds: readonly string[];
  readonly targetRoles: readonly string[];
  readonly targetOrganizationUnitIds: readonly string[];
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly isCurrentlyInWindow: boolean;
  readonly isExpired: boolean;
  readonly metadata: Record<string, unknown> | null;
  readonly isSystem: boolean;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'ARCHIVED';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface FeatureFlagHistoryRecord {
  readonly id: number;
  readonly flagId: number;
  readonly flagKey: string;
  readonly action: 'CREATE' | 'UPDATE' | 'TOGGLE' | 'ARCHIVE';
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

export interface SyncFeatureFlagsResult {
  readonly syncedModules: string[];
  readonly totalFlags: number;
}

export interface IFeatureFlagsPublicService {
  syncManifests(): Promise<SyncFeatureFlagsResult>;
  evaluate(
    key: string,
    context?: FeatureFlagEvaluationContext,
  ): Promise<FeatureFlagEvaluationResult>;
  isEnabled(key: string, context?: FeatureFlagEvaluationContext): Promise<boolean>;
}
