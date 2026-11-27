import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public, extractRequestContext, parseOrThrow } from '@packages/http/index.js';
import { DR_SWITCH_DIRECTION, DR_SYNC_TRIGGER } from '../enum/dr-ops.enum.js';
import {
  AbortDrSwitchSchema,
  CompleteDrSwitchSchema,
  InitiateDrSwitchSchema,
  ListDrDrillsQuerySchema,
  ListDrReconciliationsQuerySchema,
  ListDrSwitchesQuerySchema,
  ListDrSyncRunsQuerySchema,
  PositiveIdParamSchema,
  RunDrDrillSchema,
  RunDrReconciliationSchema,
  RunDrSyncSchema,
  StepKeyParamSchema,
  UpdateDrChecklistStepSchema,
  UpdateDrProfileSchema,
} from '../requests/dr-ops.requests.js';
import { DR_OPS_ROUTES as R } from '../routes/dr-ops.routes.js';
import { DrDrillService } from '../services/dr-drill.service.js';
import { DrProfileService } from '../services/dr-profile.service.js';
import { DrReconciliationService } from '../services/dr-reconciliation.service.js';
import { DrSwitchoverService } from '../services/dr-switchover.service.js';
import { DrSyncService } from '../services/dr-sync.service.js';

function resolveActor(req: FastifyRequest): { userId: number | null; name: string } {
  const reqWithUser = req as FastifyRequest & {
    user?: { id?: number; email?: string; username?: string };
  };
  const ctx = extractRequestContext(req);
  const userId =
    typeof reqWithUser.user?.id === 'number' && reqWithUser.user.id > 0
      ? reqWithUser.user.id
      : null;
  const name =
    reqWithUser.user?.email || reqWithUser.user?.username || ctx.actor || 'system-console-operator';
  return { userId, name };
}

/** API Disaster Recovery Operations (Mục 13.7) cho System Console (`/ops/dr/*`). */
@Controller(R.PREFIX)
export class DrOpsController {
  constructor(
    private readonly profileService: DrProfileService,
    private readonly syncService: DrSyncService,
    private readonly switchoverService: DrSwitchoverService,
    private readonly reconciliationService: DrReconciliationService,
    private readonly drillService: DrDrillService,
  ) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview() {
    return this.profileService.getOverview();
  }

  @Public()
  @Get(R.PROFILE)
  public getProfile() {
    return this.profileService.getProfile();
  }

  @Public()
  @Patch(R.PROFILE)
  public updateProfile(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(UpdateDrProfileSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.profileService.updateProfile(input, actor);
  }

  @Public()
  @Get(R.SYNC_RUNS)
  public listSyncRuns(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListDrSyncRunsQuerySchema, raw, 'query');
    return this.syncService.listSyncRuns(filter);
  }

  @Public()
  @Post(R.SYNC_RUN)
  @HttpCode(HttpStatus.OK)
  public runSync(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(RunDrSyncSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.syncService.runSync({
      scope: input.scope,
      triggerSource: DR_SYNC_TRIGGER.MANUAL,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
  }

  @Public()
  @Get(R.SWITCHES)
  public listSwitches(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListDrSwitchesQuerySchema, raw, 'query');
    return this.switchoverService.listSwitches(filter);
  }

  @Public()
  @Get(R.SWITCH_BY_ID)
  public getSwitch(@Param('id') rawId: string) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    return this.switchoverService.getSwitchById(id);
  }

  @Public()
  @Post(R.SWITCH_FAILOVER)
  @HttpCode(HttpStatus.CREATED)
  public initiateFailover(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(InitiateDrSwitchSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.switchoverService.initiateSwitch({
      direction: DR_SWITCH_DIRECTION.FAILOVER,
      mode: input.mode,
      reason: input.reason,
      confirm: input.confirm,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
  }

  @Public()
  @Post(R.SWITCH_FAILBACK)
  @HttpCode(HttpStatus.CREATED)
  public initiateFailback(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(InitiateDrSwitchSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.switchoverService.initiateSwitch({
      direction: DR_SWITCH_DIRECTION.FAILBACK,
      mode: input.mode,
      reason: input.reason,
      confirm: input.confirm,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
  }

  @Public()
  @Patch(R.SWITCH_CHECKLIST_STEP)
  public updateChecklistStep(
    @Param('id') rawId: string,
    @Param('stepKey') rawStepKey: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const stepKey = parseOrThrow(StepKeyParamSchema, rawStepKey, 'params');
    const input = parseOrThrow(UpdateDrChecklistStepSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.switchoverService.updateChecklistStep(id, stepKey, {
      status: input.status,
      note: input.note,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
  }

  @Public()
  @Post(R.SWITCH_COMPLETE)
  @HttpCode(HttpStatus.OK)
  public completeSwitch(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(CompleteDrSwitchSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.switchoverService.completeSwitch(id, {
      confirm: input.confirm,
      reconciliationReportId: input.reconciliationReportId,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
  }

  @Public()
  @Post(R.SWITCH_ABORT)
  @HttpCode(HttpStatus.OK)
  public abortSwitch(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(AbortDrSwitchSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.switchoverService.abortSwitch(id, {
      reason: input.reason,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
  }

  @Public()
  @Get(R.RECONCILIATIONS)
  public listReconciliations(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListDrReconciliationsQuerySchema, raw, 'query');
    return this.reconciliationService.listReports(filter);
  }

  @Public()
  @Post(R.RECONCILIATION_RUN)
  @HttpCode(HttpStatus.OK)
  public runReconciliation(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(RunDrReconciliationSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.reconciliationService.runReconciliation({
      ...input,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
  }

  @Public()
  @Get(R.DRILLS)
  public listDrills(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListDrDrillsQuerySchema, raw, 'query');
    return this.drillService.listDrills(filter);
  }

  @Public()
  @Post(R.DRILL_RUN)
  @HttpCode(HttpStatus.OK)
  public runDrill(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(RunDrDrillSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.drillService.runDrill({
      ...input,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
  }

  @Public()
  @Get(R.RUNBOOK)
  public runbook() {
    return this.profileService.getRunbook();
  }
}
