import type {
  BreakGlassAccountItem,
  PrivilegedSensitivityLevel,
  PrivilegedTargetType,
} from '../types/privileged-access.types';

export type { BreakGlassAccountItem };

export interface PrivilegedAccessTargetInput {
  readonly targetType: PrivilegedTargetType;
  readonly targetCode: string;
  readonly displayName: string;
  readonly description?: string | null;
  readonly sensitivityLevel: PrivilegedSensitivityLevel;
  readonly requireMfaStepUp: boolean;
  readonly requireApproval: boolean;
  readonly autoApproveAllowed: boolean;
  readonly maxGrantMinutes: number;
  readonly alertOnUse: boolean;
  readonly reviewIntervalDays: number;
  readonly isEnabled: boolean;
}
