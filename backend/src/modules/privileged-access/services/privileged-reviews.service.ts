import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  DomainEventBusService,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  NotFoundAppException,
  PRIVILEGED_ACCESS_DOMAIN_EVENTS,
  type PaginatedResult,
  SettingRegistryService,
  defaultDomainEventBus,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import { type IRolesPublicService, ROLES_PUBLIC_SERVICE } from '@modules/roles/contracts/index.js';
import {
  SESSIONS_PUBLIC_SERVICE,
  type ISessionsPublicService,
} from '@modules/sessions/contracts/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import {
  ACCESS_REVIEW_DECISION,
  ACCESS_REVIEW_STATUS,
  PRIVILEGED_ALERT_EVENT_TYPE,
  PRIVILEGED_REVIEW_SOURCE,
  PRIVILEGED_TARGET_TYPE,
} from '../enum/privileged-access.enum.js';
import { resolvePrivilegedAccessRuntimeConfig } from '../helpers/privileged-config.helper.js';
import {
  mapReviewDetailToView,
  mapReviewEntityToView,
} from '../helpers/privileged-mapper.helper.js';
import type { PrivilegedAccessReviewItemEntity } from '../entities/privileged-access-review-item.entity.js';
import { PrivilegedAccessGrantRepository } from '../repositories/privileged-access-grant.repository.js';
import { PrivilegedAccessReviewItemRepository } from '../repositories/privileged-access-review-item.repository.js';
import { PrivilegedAccessReviewRepository } from '../repositories/privileged-access-review.repository.js';
import { PrivilegedBreakGlassAccountRepository } from '../repositories/privileged-break-glass-account.repository.js';
import type {
  CreatePrivilegedReviewRequest,
  DecideReviewItemRequest,
  ListPrivilegedReviewsQuery,
} from '../requests/privileged-access.requests.js';
import type {
  PrivilegedAccessReviewDetailView,
  PrivilegedAccessReviewView,
  PrivilegedReviewScheduleResult,
} from '../types/privileged-access.types.js';
import { PrivilegedAlertsService } from './privileged-alerts.service.js';
import { PrivilegedBreakGlassService } from './privileged-break-glass.service.js';
import { PrivilegedGrantsService } from './privileged-grants.service.js';
import { PrivilegedTargetsService } from './privileged-targets.service.js';

@Injectable()
export class PrivilegedReviewsService {
  constructor(
    private readonly reviewRepository: PrivilegedAccessReviewRepository,
    private readonly reviewItemRepository: PrivilegedAccessReviewItemRepository,
    private readonly grantRepository: PrivilegedAccessGrantRepository,
    private readonly breakGlassRepository: PrivilegedBreakGlassAccountRepository,
    private readonly targetsService: PrivilegedTargetsService,
    private readonly grantsService: PrivilegedGrantsService,
    private readonly breakGlassService: PrivilegedBreakGlassService,
    private readonly alertsService: PrivilegedAlertsService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersService: IUsersPublicService,
    @Inject(ROLES_PUBLIC_SERVICE)
    private readonly rolesService: IRolesPublicService,
    @Optional()
    @Inject(SESSIONS_PUBLIC_SERVICE)
    private readonly sessionsService?: ISessionsPublicService,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService?: AuditLogService,
    @Optional()
    private readonly domainEventBus: DomainEventBusService = defaultDomainEventBus,
    @Optional()
    private readonly settingRegistry: SettingRegistryService = defaultSettingRegistry,
    @Optional()
    private readonly featureFlagRegistry: FeatureFlagRegistryService = defaultFeatureFlagRegistry,
  ) {}

  /** Tạo đợt rà soát quyền đặc biệt định kỳ (quét standing roles + active JIT grants + Break-glass) */
  public async createReviewCampaign(
    dto: CreatePrivilegedReviewRequest,
    actor?: UserIdentity,
    triggerSource: 'MANUAL' | 'SCHEDULED' = 'MANUAL',
  ): Promise<PrivilegedAccessReviewDetailView> {
    const cfg = resolvePrivilegedAccessRuntimeConfig(
      this.settingRegistry,
      this.featureFlagRegistry,
    );
    if (!cfg.enabled || !cfg.periodicReviewEnabled) {
      throw new ForbiddenAppException('privileged-access.periodicReviewFeatureDisabled');
    }

    const now = new Date();
    const dueDays = dto.dueDays ?? cfg.reviewDueDays;
    const dueAt = new Date(now.getTime() + dueDays * 86_400_000);
    const reviewCode = `REV-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;

    const [standingUsers, activeGrants, breakGlassAccounts] = await Promise.all([
      this.targetsService.listStandingPrivilegedUsers(),
      this.grantRepository.findAllActive(now),
      this.breakGlassRepository.findAll(),
    ]);

    const review = this.reviewRepository.create({
      reviewCode,
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      triggerSource,
      status: ACCESS_REVIEW_STATUS.OPEN,
      dueAt,
      completedAt: null,
      totalItems: 0,
      decidedItems: 0,
      keptItems: 0,
      revokedItems: 0,
      createdBy: actor?.id ?? null,
    });
    const savedReview = await this.reviewRepository.saveEntity(review);

    const itemsToCreate: PrivilegedAccessReviewItemEntity[] = [];

    // 1. Standing Privileged Roles trong bảng users + user_roles
    for (const u of standingUsers) {
      for (const roleCode of u.privilegedRoleCodes) {
        const matchedRole = u.roles.find((r) => r.code === roleCode);
        itemsToCreate.push(
          this.reviewItemRepository.create({
            reviewId: Number(savedReview.id),
            userId: Number(u.id),
            username: u.username,
            email: u.email || null,
            grantSource: PRIVILEGED_REVIEW_SOURCE.STANDING_ROLE,
            targetType: PRIVILEGED_TARGET_TYPE.ROLE,
            targetCode: roleCode,
            roleId: matchedRole ? Number(matchedRole.roleId) : null,
            grantId: null,
            breakGlassId: null,
            decision: ACCESS_REVIEW_DECISION.PENDING,
          }),
        );
      }
    }

    // 2. Active Temporary Grants (JIT)
    for (const grant of activeGrants) {
      const user = await this.usersService
        .getProvisionedUserById?.(Number(grant.userId))
        .catch(() => null);
      itemsToCreate.push(
        this.reviewItemRepository.create({
          reviewId: Number(savedReview.id),
          userId: Number(grant.userId),
          username: user?.username ?? `user_${grant.userId}`,
          email: user?.email ?? null,
          grantSource: PRIVILEGED_REVIEW_SOURCE.TEMPORARY_GRANT,
          targetType: grant.targetType,
          targetCode: grant.targetCode,
          roleId: grant.roleId ?? null,
          grantId: Number(grant.id),
          breakGlassId: null,
          decision: ACCESS_REVIEW_DECISION.PENDING,
        }),
      );
    }

    // 3. Break-glass accounts
    for (const bg of breakGlassAccounts) {
      const user = await this.usersService
        .getProvisionedUserById?.(Number(bg.userId))
        .catch(() => null);
      itemsToCreate.push(
        this.reviewItemRepository.create({
          reviewId: Number(savedReview.id),
          userId: Number(bg.userId),
          username: user?.username ?? `user_${bg.userId}`,
          email: user?.email ?? null,
          grantSource: PRIVILEGED_REVIEW_SOURCE.BREAK_GLASS,
          targetType: PRIVILEGED_TARGET_TYPE.ROLE,
          targetCode: bg.roleCode,
          roleId: null,
          grantId: null,
          breakGlassId: Number(bg.id),
          decision: ACCESS_REVIEW_DECISION.PENDING,
        }),
      );
    }

    const savedItems = await this.reviewItemRepository.saveMany(itemsToCreate);
    savedReview.totalItems = savedItems.length;
    if (savedItems.length === 0) {
      savedReview.status = ACCESS_REVIEW_STATUS.COMPLETED;
      savedReview.completedAt = now;
    }
    const finalReview = await this.reviewRepository.saveEntity(savedReview);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_reviews',
          action: 'pam.review.create',
          resourceType: 'privileged_access_reviews',
          resourceId: String(finalReview.id),
          actor: actor ?? null,
          afterData: {
            reviewCode: finalReview.reviewCode,
            triggerSource,
            totalItems: finalReview.totalItems,
          },
        })
        .catch(() => undefined);
    }

    await this.domainEventBus
      .publish({
        type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.REVIEW_CREATED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedAccessReview',
        aggregateId: String(finalReview.id),
        payload: {
          reviewCode: finalReview.reviewCode,
          totalItems: finalReview.totalItems,
          triggerSource,
        },
      })
      .catch(() => undefined);

    await this.alertsService
      .recordAndDispatchAlert({
        eventType: PRIVILEGED_ALERT_EVENT_TYPE.REVIEW_CREATED,
        severity: 'HIGH',
        actorUserId: actor?.id ?? null,
        actorUsername: actor?.username ?? null,
        action: 'review.create',
        title: `[PAM] Đợt rà soát quyền đặc biệt mới: ${finalReview.reviewCode}`,
        content: `Đã khởi tạo đợt rà soát "${finalReview.title}" gồm ${finalReview.totalItems} mục quyền đặc biệt (hạn hoàn tất ${dueAt.toISOString()}).`,
        details: { reviewId: finalReview.id, reviewCode: finalReview.reviewCode },
        bypassCooldown: true,
      })
      .catch(() => undefined);

    return mapReviewDetailToView(finalReview, savedItems);
  }

  public async listReviews(
    query: ListPrivilegedReviewsQuery,
  ): Promise<PaginatedResult<PrivilegedAccessReviewView>> {
    let statusCode: number | undefined;
    if (query.status !== undefined) {
      if (typeof query.status === 'number') {
        statusCode = query.status;
      } else {
        const up = String(query.status).trim().toUpperCase();
        statusCode =
          up === 'OPEN'
            ? ACCESS_REVIEW_STATUS.OPEN
            : up === 'COMPLETED'
              ? ACCESS_REVIEW_STATUS.COMPLETED
              : up === 'CANCELLED'
                ? ACCESS_REVIEW_STATUS.CANCELLED
                : Number(up) || undefined;
      }
    }

    const res = await this.reviewRepository.paginateFiltered({
      status: statusCode as 1 | 2 | 3 | undefined,
      page: query.page,
      limit: query.limit,
    });
    return createPaginatedResult(
      res.data.map(mapReviewEntityToView),
      res.meta.total,
      res.meta.page,
      res.meta.limit,
    );
  }

  public async getReviewDetail(reviewId: number): Promise<PrivilegedAccessReviewDetailView> {
    const review = await this.reviewRepository.findById(reviewId);
    if (!review) {
      throw new NotFoundAppException('privileged-access.reviewNotFound');
    }
    const items = await this.reviewItemRepository.findByReviewId(reviewId);
    return mapReviewDetailToView(review, items);
  }

  /** Quyết định Giữ (`KEEP`) hoặc Thu hồi (`REVOKE`) một mục quyền đặc biệt trong đợt rà soát */
  public async decideReviewItem(
    reviewId: number,
    itemId: number,
    dto: DecideReviewItemRequest,
    actor: UserIdentity,
  ): Promise<PrivilegedAccessReviewDetailView> {
    const review = await this.reviewRepository.findById(reviewId);
    if (!review) {
      throw new NotFoundAppException('privileged-access.reviewNotFound');
    }
    if (Number(review.status) !== ACCESS_REVIEW_STATUS.OPEN) {
      throw new BadRequestAppException('privileged-access.reviewAlreadyCompleted');
    }

    const item = await this.reviewItemRepository.findByIdAndReviewId(itemId, reviewId);
    if (!item) {
      throw new NotFoundAppException('privileged-access.reviewItemNotFound');
    }

    const previousDecision = Number(item.decision);
    const nextDecision =
      dto.decision === 'KEEP' ? ACCESS_REVIEW_DECISION.KEEP : ACCESS_REVIEW_DECISION.REVOKE;

    let enforcementApplied = false;
    let enforcementError: string | null = null;

    if (nextDecision === ACCESS_REVIEW_DECISION.REVOKE) {
      try {
        if (item.grantSource === PRIVILEGED_REVIEW_SOURCE.STANDING_ROLE && item.roleId) {
          if (item.targetCode === 'super_admin' && this.rolesService.findUserIdsByRoleIds) {
            const holders = await this.rolesService.findUserIdsByRoleIds([Number(item.roleId)]);
            if (holders.length <= 1 && holders.includes(Number(item.userId))) {
              throw new ConflictAppException('privileged-access.cannotRevokeLastSuperAdmin');
            }
          }
          if (this.rolesService.findUserRoleLinksByUserIds && this.rolesService.replaceUserRoles) {
            const links = await this.rolesService.findUserRoleLinksByUserIds([Number(item.userId)]);
            const remaining = links
              .map((l) => Number(l.roleId))
              .filter((rid) => rid !== Number(item.roleId));
            await this.rolesService.replaceUserRoles(Number(item.userId), remaining, actor.id);
          }
          await this.sessionsService
            ?.revokeAllUserSessions(
              Number(item.userId),
              `Privileged role ${item.targetCode} revoked during periodic review ${review.reviewCode}`,
            )
            .catch(() => undefined);
          enforcementApplied = true;
        } else if (item.grantSource === PRIVILEGED_REVIEW_SOURCE.TEMPORARY_GRANT && item.grantId) {
          await this.grantsService.revokeGrant(
            Number(item.grantId),
            { comment: dto.note ?? `Revoked during review ${review.reviewCode}` },
            actor,
          );
          enforcementApplied = true;
        } else if (item.grantSource === PRIVILEGED_REVIEW_SOURCE.BREAK_GLASS && item.breakGlassId) {
          await this.breakGlassService.sealBreakGlass(
            Number(item.breakGlassId),
            { reason: dto.note ?? `Revoked during review ${review.reviewCode}` },
            actor,
            { revokePermanently: true },
          );
          enforcementApplied = true;
        }
      } catch (err) {
        if (err instanceof ConflictAppException || err instanceof ForbiddenAppException) {
          throw err;
        }
        enforcementError = err instanceof Error ? err.message : String(err);
      }
    }

    item.decision = nextDecision;
    item.decidedBy = Number(actor.id);
    item.decidedAt = new Date();
    item.decisionNote = dto.note?.trim() ?? null;
    item.enforcementApplied = enforcementApplied;
    item.enforcementError = enforcementError;
    await this.reviewItemRepository.saveEntity(item);

    const allItems = await this.reviewItemRepository.findByReviewId(reviewId);
    const decided = allItems.filter((x) => Number(x.decision) !== ACCESS_REVIEW_DECISION.PENDING);
    const kept = allItems.filter((x) => Number(x.decision) === ACCESS_REVIEW_DECISION.KEEP);
    const revoked = allItems.filter((x) => Number(x.decision) === ACCESS_REVIEW_DECISION.REVOKE);

    review.totalItems = allItems.length;
    review.decidedItems = decided.length;
    review.keptItems = kept.length;
    review.revokedItems = revoked.length;

    const completedNow = allItems.length > 0 && decided.length >= allItems.length;
    if (completedNow) {
      review.status = ACCESS_REVIEW_STATUS.COMPLETED;
      review.completedAt = new Date();
    }
    const savedReview = await this.reviewRepository.saveEntity(review);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_reviews',
          action: 'pam.review.item.decide',
          resourceType: 'privileged_access_review_items',
          resourceId: String(item.id),
          actor,
          beforeData: { decision: previousDecision },
          afterData: {
            reviewCode: savedReview.reviewCode,
            userId: item.userId,
            targetCode: item.targetCode,
            decision: dto.decision,
            enforcementApplied,
          },
        })
        .catch(() => undefined);
    }

    await this.domainEventBus
      .publish({
        type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.REVIEW_ITEM_DECIDED,
        sourceModule: 'privileged-access',
        aggregateType: 'PrivilegedAccessReviewItem',
        aggregateId: String(item.id),
        payload: {
          reviewId: savedReview.id,
          decision: dto.decision,
          userId: item.userId,
          targetCode: item.targetCode,
        },
      })
      .catch(() => undefined);

    if (nextDecision === ACCESS_REVIEW_DECISION.REVOKE) {
      await this.alertsService
        .recordAndDispatchAlert({
          eventType: PRIVILEGED_ALERT_EVENT_TYPE.REVIEW_ITEM_REVOKED,
          severity: 'HIGH',
          actorUserId: actor.id,
          actorUsername: actor.username ?? null,
          targetType: item.targetType,
          targetCode: item.targetCode,
          action: 'review.revoke',
          title: `[PAM] Đã thu hồi quyền đặc biệt ${item.targetCode} khi rà soát`,
          content: `Người dùng ${item.username} (#${item.userId}) bị thu hồi ${item.grantSource}:${item.targetCode} trong đợt rà soát ${savedReview.reviewCode}.`,
          details: { reviewId: savedReview.id, itemId: item.id, targetUserId: item.userId },
          bypassCooldown: true,
        })
        .catch(() => undefined);
    }

    if (completedNow) {
      await this.domainEventBus
        .publish({
          type: PRIVILEGED_ACCESS_DOMAIN_EVENTS.REVIEW_COMPLETED,
          sourceModule: 'privileged-access',
          aggregateType: 'PrivilegedAccessReview',
          aggregateId: String(savedReview.id),
          payload: {
            reviewCode: savedReview.reviewCode,
            keptItems: savedReview.keptItems,
            revokedItems: savedReview.revokedItems,
          },
        })
        .catch(() => undefined);
    }

    return mapReviewDetailToView(savedReview, allItems);
  }

  public async closeReview(
    reviewId: number,
    actor?: UserIdentity,
  ): Promise<PrivilegedAccessReviewDetailView> {
    const review = await this.reviewRepository.findById(reviewId);
    if (!review) {
      throw new NotFoundAppException('privileged-access.reviewNotFound');
    }
    if (Number(review.status) !== ACCESS_REVIEW_STATUS.OPEN) {
      throw new BadRequestAppException('privileged-access.reviewAlreadyCompleted');
    }

    review.status = ACCESS_REVIEW_STATUS.COMPLETED;
    review.completedAt = new Date();
    const saved = await this.reviewRepository.saveEntity(review);
    const items = await this.reviewItemRepository.findByReviewId(reviewId);

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          module: 'privileged-access',
          feature: 'pam_reviews',
          action: 'pam.review.close',
          resourceType: 'privileged_access_reviews',
          resourceId: String(saved.id),
          actor: actor ?? null,
          afterData: {
            reviewCode: saved.reviewCode,
            decidedItems: saved.decidedItems,
            totalItems: saved.totalItems,
          },
        })
        .catch(() => undefined);
    }

    return mapReviewDetailToView(saved, items);
  }

  /** Kiểm tra chu kỳ rà soát định kỳ và tự động khởi tạo đợt rà soát mới nếu đến hạn */
  public async runScheduledReviewCheck(
    now: Date = new Date(),
  ): Promise<PrivilegedReviewScheduleResult> {
    const cfg = resolvePrivilegedAccessRuntimeConfig(
      this.settingRegistry,
      this.featureFlagRegistry,
    );
    if (!cfg.enabled || !cfg.periodicReviewEnabled) {
      return { created: false, reviewId: null, reviewCode: null, totalItems: 0 };
    }

    const openCount = await this.reviewRepository.countOpen();
    if (openCount > 0) {
      return { created: false, reviewId: null, reviewCode: null, totalItems: 0 };
    }

    const latest = await this.reviewRepository.findLatest();
    if (latest) {
      const nextDueMs = latest.createdAt.getTime() + cfg.reviewCycleDays * 86_400_000;
      if (now.getTime() < nextDueMs) {
        return { created: false, reviewId: null, reviewCode: null, totalItems: 0 };
      }
    }

    const created = await this.createReviewCampaign(
      {
        title: `Rà soát quyền đặc biệt định kỳ (${now.toISOString().slice(0, 10)})`,
        description: `Tự động tạo theo chu kỳ ${cfg.reviewCycleDays} ngày.`,
        dueDays: cfg.reviewDueDays,
      },
      undefined,
      'SCHEDULED',
    );
    return {
      created: true,
      reviewId: created.id,
      reviewCode: created.reviewCode,
      totalItems: created.totalItems,
    };
  }
}
