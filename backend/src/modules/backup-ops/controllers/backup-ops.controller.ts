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
import { BACKUP_TRIGGER_SOURCE } from '../enum/backup-ops.enum.js';
import {
  CreateBackupPolicySchema,
  EnableStorageVersioningSchema,
  ExecuteOrRecordRestoreSchema,
  ListBackupRecordsQuerySchema,
  ListRestoreHistoriesQuerySchema,
  PositiveIdParamSchema,
  RunBackupSchema,
  UpdateBackupPolicySchema,
  VerifyBackupSchema,
} from '../requests/backup-ops.requests.js';
import { BACKUP_OPS_ROUTES as R } from '../routes/backup-ops.routes.js';
import { BackupOrchestratorService } from '../services/backup-orchestrator.service.js';
import { BackupRestoreDrillService } from '../services/backup-restore-drill.service.js';

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
    reqWithUser.user?.email ||
    reqWithUser.user?.username ||
    ctx.actor ||
    'system-console-operator';
  return { userId, name };
}

/** API Backup & Restore Operations (Mục 13.6) cho System Console (`/ops/backups/*`). */
@Controller(R.PREFIX)
export class BackupOpsController {
  constructor(
    private readonly orchestrator: BackupOrchestratorService,
    private readonly restoreDrill: BackupRestoreDrillService,
  ) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview() {
    return this.orchestrator.getOverview();
  }

  @Public()
  @Get(R.POLICIES)
  public listPolicies() {
    return this.orchestrator.listPolicies();
  }

  @Public()
  @Post(R.POLICIES)
  public createPolicy(@Body() body: unknown) {
    const input = parseOrThrow(CreateBackupPolicySchema, body ?? {}, 'body');
    return this.orchestrator.createPolicy(input);
  }

  @Public()
  @Patch(R.POLICY_BY_ID)
  public updatePolicy(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(UpdateBackupPolicySchema, body ?? {}, 'body');
    return this.orchestrator.updatePolicy(id, input);
  }

  @Public()
  @Get(R.RECORDS)
  public listRecords(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListBackupRecordsQuerySchema, raw, 'query');
    return this.orchestrator.listRecords(filter);
  }

  @Public()
  @Get(R.RECORD_BY_ID)
  public getRecord(@Param('id') rawId: string) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    return this.orchestrator.getRecordById(id);
  }

  @Public()
  @Post(R.RUN)
  @HttpCode(HttpStatus.OK)
  public runBackup(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(RunBackupSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.orchestrator.runBackup({
      ...input,
      triggerSource: BACKUP_TRIGGER_SOURCE.MANUAL,
      actorUserId: actor.userId,
      actorName: actor.name,
    });
  }

  @Public()
  @Post(R.PRUNE)
  @HttpCode(HttpStatus.OK)
  public pruneExpired() {
    return this.orchestrator.pruneExpiredBackups();
  }

  @Public()
  @Post(R.RECORD_VERIFY)
  @HttpCode(HttpStatus.OK)
  public verifyRecord(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(VerifyBackupSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.orchestrator.verifyBackupRecord(id, {
      actorUserId: actor.userId,
      actorName: actor.name,
      reason: input.reason,
    });
  }

  @Public()
  @Get(R.STORAGE_VERSIONING)
  public storageVersioning() {
    return this.orchestrator.getStorageVersioningStatus();
  }

  @Public()
  @Post(R.STORAGE_VERSIONING_ENABLE)
  @HttpCode(HttpStatus.OK)
  public enableStorageVersioning(@Body() body: unknown, @Req() req: FastifyRequest) {
    parseOrThrow(EnableStorageVersioningSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.orchestrator.enableStorageVersioning(actor);
  }

  @Public()
  @Get(R.RESTORES)
  public listRestores(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListRestoreHistoriesQuerySchema, raw, 'query');
    return this.restoreDrill.listRestoreHistories(filter);
  }

  @Public()
  @Post(R.RESTORES)
  @HttpCode(HttpStatus.CREATED)
  public executeOrRecordRestore(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(ExecuteOrRecordRestoreSchema, body ?? {}, 'body');
    const actor = resolveActor(req);
    return this.orchestrator.executeOrRecordRestore({
      ...input,
      actorUserId: actor.userId,
      actorName: input.actorName ?? actor.name,
    });
  }

  @Public()
  @Get(R.RUNBOOK)
  public runbook() {
    return this.orchestrator.getRunbook();
  }
}
