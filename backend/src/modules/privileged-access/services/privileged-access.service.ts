import { Injectable, Optional } from '@nestjs/common';
import {
  FeatureFlagRegistryService,
  type PaginatedResult,
  SettingRegistryService,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import { PRIVILEGED_GRANT_STATUS } from '../enum/privileged-access.enum.js';
import { resolvePrivilegedAccessRuntimeConfig } from '../helpers/privileged-config.helper.js';
import { PrivilegedAccessGrantRepository } from '../repositories/privileged-access-grant.repository.js';
import { PrivilegedAccessReviewRepository } from '../repositories/privileged-access-review.repository.js';
import { PrivilegedAccessTargetRepository } from '../repositories/privileged-access-target.repository.js';
import { PrivilegedBreakGlassAccountRepository } from '../repositories/privileged-break-glass-account.repository.js';
import type {
  AcknowledgeAlertRequest,
  ActivateBreakGlassRequest,
  CreateBreakGlassAccountRequest,
  CreatePrivilegedGrantRequest,
  CreatePrivilegedReviewRequest,
  DecideReviewItemRequest,
  GrantDecisionRequest,
  ListBreakGlassAccountsQuery,
  ListDirectoryUsersQuery,
  ListPrivilegedAlertsQuery,
  ListPrivilegedGrantsQuery,
  ListPrivilegedReviewsQuery,
  ListPrivilegedTargetsQuery,
  SealBreakGlassRequest,
  UpdatePrivilegedTargetRequest,
  UpsertPrivilegedTargetRequest,
} from '../requests/privileged-access.requests.js';
import type {
  BreakGlassAccountView,
  PrivilegedAccessOverviewView,
  PrivilegedAccessReviewDetailView,
  PrivilegedAccessReviewView,
  PrivilegedExpirationSweepResult,
  PrivilegedGrantView,
  PrivilegedReviewScheduleResult,
  PrivilegedTargetView,
  PrivilegedUsageAlertView,
  PrivilegedUserDirectoryItemView,
} from '../types/privileged-access.types.js';
import type { IPrivilegedAccessPublicService } from '../contracts/index.js';
import { PrivilegedAlertsService } from './privileged-alerts.service.js';
import { PrivilegedBreakGlassService } from './privileged-break-glass.service.js';
import { PrivilegedGrantsService } from './privileged-grants.service.js';
import { PrivilegedReviewsService } from './privileged-reviews.service.js';
import { PrivilegedTargetsService } from './privileged-targets.service.js';

@Injectable()
export class PrivilegedAccessService implements IPrivilegedAccessPublicService {
  constructor(
    private readonly targetsService: PrivilegedTargetsService,
    private readonly grantsService: PrivilegedGrantsService,
    private readonly breakGlassService: PrivilegedBreakGlassService,
    private readonly alertsService: PrivilegedAlertsService,
    private readonly reviewsService: PrivilegedReviewsService,
    private readonly targetRepository: PrivilegedAccessTargetRepository,
    private readonly grantRepository: PrivilegedAccessGrantRepository,
    private readonly breakGlassRepository: PrivilegedBreakGlassAccountRepository,
    private readonly reviewRepository: PrivilegedAccessReviewRepository,
    @Optional()
    private readonly settingRegistry: SettingRegistryService = defaultSettingRegistry,
    @Optional()
    private readonly featureFlagRegistry: FeatureFlagRegistryService = defaultFeatureFlagRegistry,
  ) {}

  public async getOverview(): Promise<PrivilegedAccessOverviewView> {
    const runtimeConfig = resolvePrivilegedAccessRuntimeConfig(
      this.settingRegistry,
      this.featureFlagRegistry,
    );
    const [
      allTargets,
      pendingGrantsCount,
      activeGrantsCount,
      allBreakGlass,
      unacknowledgedAlertsCount,
      openReviewsCount,
      standingUsers,
    ] = await Promise.all([
      this.targetRepository.findAll(),
      this.grantRepository.countByStatus(PRIVILEGED_GRANT_STATUS.PENDING_APPROVAL),
      this.grantRepository.countByStatus(PRIVILEGED_GRANT_STATUS.ACTIVE),
      this.breakGlassRepository.findAll(),
      this.alertsService.countUnacknowledged(),
      this.reviewRepository.countOpen(),
      this.targetsService.listStandingPrivilegedUsers().catch(() => []),
    ]);

    return {
      runtimeConfig,
      targetsTotal: allTargets.length,
      targetsEnabled: allTargets.filter((t) => t.isEnabled).length,
      pendingGrantsCount,
      activeGrantsCount,
      breakGlassTotal: allBreakGlass.length,
      breakGlassActiveCount: allBreakGlass.filter((b) => Number(b.status) === 2).length,
      unacknowledgedAlertsCount,
      openReviewsCount,
      standingPrivilegedUsersCount: standingUsers.length,
    };
  }

  public async listExistingUsersDirectory(
    query: ListDirectoryUsersQuery,
  ): Promise<PaginatedResult<PrivilegedUserDirectoryItemView>> {
    return this.targetsService.listExistingUsersDirectory(query);
  }

  public async listStandingPrivilegedUsers(): Promise<PrivilegedUserDirectoryItemView[]> {
    return this.targetsService.listStandingPrivilegedUsers();
  }

  public async listTargets(
    query: ListPrivilegedTargetsQuery,
  ): Promise<PaginatedResult<PrivilegedTargetView>> {
    return this.targetsService.listTargets(query);
  }

  public async upsertTarget(
    dto: UpsertPrivilegedTargetRequest,
    actor?: UserIdentity,
  ): Promise<PrivilegedTargetView> {
    return this.targetsService.upsertTarget(dto, actor);
  }

  public async updateTarget(
    id: number,
    dto: UpdatePrivilegedTargetRequest,
    actor?: UserIdentity,
  ): Promise<PrivilegedTargetView> {
    return this.targetsService.updateTarget(id, dto, actor);
  }

  public async deleteTarget(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.targetsService.deleteTarget(id, actor);
  }

  public async listGrants(
    query: ListPrivilegedGrantsQuery,
  ): Promise<PaginatedResult<PrivilegedGrantView>> {
    return this.grantsService.listGrants(query);
  }

  public async requestGrant(
    dto: CreatePrivilegedGrantRequest,
    actor?: UserIdentity,
    stepUpVerified = false,
  ): Promise<PrivilegedGrantView> {
    return this.grantsService.requestGrant(dto, actor, { stepUpVerified });
  }

  public async approveGrant(
    id: number,
    dto: GrantDecisionRequest,
    actor: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    return this.grantsService.approveGrant(id, dto, actor);
  }

  public async rejectGrant(
    id: number,
    dto: GrantDecisionRequest,
    actor: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    return this.grantsService.rejectGrant(id, dto, actor);
  }

  public async revokeGrant(
    id: number,
    dto: GrantDecisionRequest,
    actor?: UserIdentity,
  ): Promise<PrivilegedGrantView> {
    return this.grantsService.revokeGrant(id, dto, actor);
  }

  public async cancelGrant(id: number, actor: UserIdentity): Promise<PrivilegedGrantView> {
    return this.grantsService.cancelGrant(id, actor);
  }

  public async sweepExpiredAccess(
    now: Date = new Date(),
  ): Promise<PrivilegedExpirationSweepResult> {
    const [grantRes, bgRes] = await Promise.all([
      this.grantsService.sweepExpiredGrants(now),
      this.breakGlassService.sweepExpiredBreakGlassAccounts(now),
    ]);
    return {
      expiredGrantsCount: grantRes.expiredCount,
      expiredGrantIds: grantRes.expiredGrantIds,
      autoSealedBreakGlassCount: bgRes.autoSealedCount,
      autoSealedBreakGlassIds: bgRes.autoSealedIds,
    };
  }

  public async listBreakGlassAccounts(
    query: ListBreakGlassAccountsQuery,
  ): Promise<PaginatedResult<BreakGlassAccountView>> {
    return this.breakGlassService.listBreakGlassAccounts(query);
  }

  public async createBreakGlassAccount(
    dto: CreateBreakGlassAccountRequest,
    actor?: UserIdentity,
  ): Promise<BreakGlassAccountView> {
    return this.breakGlassService.createBreakGlassAccount(dto, actor);
  }

  public async activateBreakGlass(
    id: number,
    dto: ActivateBreakGlassRequest,
    actor?: UserIdentity,
  ): Promise<BreakGlassAccountView> {
    return this.breakGlassService.activateBreakGlass(id, dto, actor);
  }

  public async sealBreakGlass(
    id: number,
    dto: SealBreakGlassRequest,
    actor?: UserIdentity,
  ): Promise<BreakGlassAccountView> {
    return this.breakGlassService.sealBreakGlass(id, dto, actor);
  }

  public async listAlerts(
    query: ListPrivilegedAlertsQuery,
  ): Promise<PaginatedResult<PrivilegedUsageAlertView>> {
    return this.alertsService.listAlerts(query);
  }

  public async acknowledgeAlert(
    id: number,
    dto: AcknowledgeAlertRequest,
    actor?: UserIdentity,
  ): Promise<PrivilegedUsageAlertView> {
    return this.alertsService.acknowledgeAlert(id, dto, actor);
  }

  public async listReviews(
    query: ListPrivilegedReviewsQuery,
  ): Promise<PaginatedResult<PrivilegedAccessReviewView>> {
    return this.reviewsService.listReviews(query);
  }

  public async getReviewDetail(id: number): Promise<PrivilegedAccessReviewDetailView> {
    return this.reviewsService.getReviewDetail(id);
  }

  public async createReviewCampaign(
    dto: CreatePrivilegedReviewRequest,
    actor?: UserIdentity,
  ): Promise<PrivilegedAccessReviewDetailView> {
    return this.reviewsService.createReviewCampaign(dto, actor, 'MANUAL');
  }

  public async decideReviewItem(
    reviewId: number,
    itemId: number,
    dto: DecideReviewItemRequest,
    actor: UserIdentity,
  ): Promise<PrivilegedAccessReviewDetailView> {
    return this.reviewsService.decideReviewItem(reviewId, itemId, dto, actor);
  }

  public async closeReview(
    id: number,
    actor?: UserIdentity,
  ): Promise<PrivilegedAccessReviewDetailView> {
    return this.reviewsService.closeReview(id, actor);
  }

  public async runScheduledReviewCheck(
    now: Date = new Date(),
  ): Promise<PrivilegedReviewScheduleResult> {
    return this.reviewsService.runScheduledReviewCheck(now);
  }
}
