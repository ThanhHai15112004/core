import { Injectable } from '@nestjs/common';
import type { IDrOpsPublicService } from '../contracts/index.js';
import type { DrDrillType, DrSyncScope, DrSyncTrigger } from '../enum/dr-ops.enum.js';
import type {
  DrDrillView,
  DrOverviewView,
  DrReconciliationReportView,
  DrSyncRunView,
} from '../types/dr-ops.types.js';
import { DrDrillService } from './dr-drill.service.js';
import { DrProfileService } from './dr-profile.service.js';
import { DrReconciliationService } from './dr-reconciliation.service.js';
import { DrSyncService } from './dr-sync.service.js';

@Injectable()
export class DrOrchestratorService implements IDrOpsPublicService {
  constructor(
    private readonly profileService: DrProfileService,
    private readonly syncService: DrSyncService,
    private readonly reconciliationService: DrReconciliationService,
    private readonly drillService: DrDrillService,
  ) {}

  public getOverview(): Promise<DrOverviewView> {
    return this.profileService.getOverview();
  }

  public runSync(input?: {
    scope?: DrSyncScope | undefined;
    triggerSource?: DrSyncTrigger | undefined;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
  }): Promise<DrSyncRunView> {
    return this.syncService.runSync(input);
  }

  public runScheduledSync(): Promise<DrSyncRunView | { skipped: true; reason: string }> {
    return this.syncService.runScheduledSync();
  }

  public runScheduledDrillCheck(): Promise<
    DrDrillView | { overdue: boolean; action: string; nextDrillDueAt: string | null }
  > {
    return this.drillService.runScheduledDrillCheck();
  }

  public runReconciliation(input?: {
    scope?: DrSyncScope | undefined;
    switchExecutionId?: number | null | undefined;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
  }): Promise<DrReconciliationReportView> {
    return this.reconciliationService.runReconciliation(input);
  }

  public runDrill(input?: {
    drillType?: DrDrillType | undefined;
    scenario?: string | undefined;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
    lessonsLearned?: string | undefined;
  }): Promise<DrDrillView> {
    return this.drillService.runDrill(input);
  }
}
