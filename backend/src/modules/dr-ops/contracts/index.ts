import type { DrDrillType, DrSyncScope, DrSyncTrigger } from '../enum/dr-ops.enum.js';
import type {
  DrDrillView,
  DrOverviewView,
  DrReconciliationReportView,
  DrSyncRunView,
} from '../types/dr-ops.types.js';

export const DR_OPS_PUBLIC_SERVICE = Symbol('DR_OPS_PUBLIC_SERVICE');

export interface IDrOpsPublicService {
  getOverview(): Promise<DrOverviewView>;
  runSync(input?: {
    scope?: DrSyncScope | undefined;
    triggerSource?: DrSyncTrigger | undefined;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
  }): Promise<DrSyncRunView>;
  runScheduledSync(): Promise<DrSyncRunView | { skipped: true; reason: string }>;
  runScheduledDrillCheck(): Promise<
    DrDrillView | { overdue: boolean; action: string; nextDrillDueAt: string | null }
  >;
  runReconciliation(input?: {
    scope?: DrSyncScope | undefined;
    switchExecutionId?: number | null | undefined;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
  }): Promise<DrReconciliationReportView>;
  runDrill(input?: {
    drillType?: DrDrillType | undefined;
    scenario?: string | undefined;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
    lessonsLearned?: string | undefined;
  }): Promise<DrDrillView>;
}
