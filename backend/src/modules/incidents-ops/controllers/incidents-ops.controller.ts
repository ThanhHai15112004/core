import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Public, parseOrThrow } from '@packages/http/index.js';
import {
  AssignIncidentOwnerSchema,
  CreateIncidentSchema,
  CreateOwnerMappingSchema,
  CreateRunbookSchema,
  IncidentNoteActionSchema,
  ListIncidentsQuerySchema,
  ListOwnerMappingsQuerySchema,
  ListPostmortemsQuerySchema,
  ListRunbooksQuerySchema,
  ListSiemLogsQuerySchema,
  MitigateIncidentSchema,
  PositiveIdParamSchema,
  ResolveIncidentSchema,
  SeverityParamSchema,
  TestSiemConnectionSchema,
  UpdateOwnerMappingSchema,
  UpdateRunbookSchema,
  UpdateSeverityPolicySchema,
  UpsertPostmortemSchema,
} from '../requests/incidents-ops.requests.js';
import { INCIDENTS_OPS_ROUTES as R } from '../routes/incidents-ops.routes.js';
import { IncidentGovernanceService } from '../services/incident-governance.service.js';
import { IncidentLifecycleService } from '../services/incident-lifecycle.service.js';
import { SiemDispatcherService } from '../services/siem-dispatcher.service.js';

/** API Quản lý sự cố & SIEM (Mục 12.6) cho System Console (`/ops/incidents/*`). */
@Controller(R.PREFIX)
export class IncidentsOpsController {
  constructor(
    private readonly governance: IncidentGovernanceService,
    private readonly lifecycle: IncidentLifecycleService,
    private readonly siem: SiemDispatcherService,
  ) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview() {
    return this.lifecycle.getOverview();
  }

  @Public()
  @Get(R.POLICIES)
  public listPolicies() {
    return this.governance.listSeverityPolicies();
  }

  @Public()
  @Patch(R.POLICY_BY_SEVERITY)
  public updatePolicy(@Param('severity') rawSeverity: string, @Body() body: unknown) {
    const severity = parseOrThrow(SeverityParamSchema, rawSeverity, 'params');
    const input = parseOrThrow(UpdateSeverityPolicySchema, body, 'body');
    return this.governance.updateSeverityPolicy(severity, input);
  }

  @Public()
  @Get(R.RUNBOOKS)
  public listRunbooks(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListRunbooksQuerySchema, raw, 'query');
    return this.governance.listRunbooks(filter);
  }

  @Public()
  @Get(R.RUNBOOK_BY_ID)
  public getRunbook(@Param('id') rawId: string) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    return this.governance.getRunbookById(id);
  }

  @Public()
  @Post(R.RUNBOOKS)
  public createRunbook(@Body() body: unknown) {
    const input = parseOrThrow(CreateRunbookSchema, body, 'body');
    return this.governance.createRunbook(input);
  }

  @Public()
  @Patch(R.RUNBOOK_BY_ID)
  public updateRunbook(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(UpdateRunbookSchema, body, 'body');
    return this.governance.updateRunbook(id, input);
  }

  @Public()
  @Delete(R.RUNBOOK_BY_ID)
  public deleteRunbook(@Param('id') rawId: string) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    return this.governance.deleteRunbook(id);
  }

  @Public()
  @Get(R.OWNERS)
  public listOwners(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListOwnerMappingsQuerySchema, raw, 'query');
    return this.governance.listOwnerMappings(filter);
  }

  @Public()
  @Post(R.OWNERS)
  public createOwnerMapping(@Body() body: unknown) {
    const input = parseOrThrow(CreateOwnerMappingSchema, body, 'body');
    return this.governance.createOwnerMapping(input);
  }

  @Public()
  @Patch(R.OWNER_BY_ID)
  public updateOwnerMapping(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(UpdateOwnerMappingSchema, body, 'body');
    return this.governance.updateOwnerMapping(id, input);
  }

  @Public()
  @Delete(R.OWNER_BY_ID)
  public deleteOwnerMapping(@Param('id') rawId: string) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    return this.governance.deleteOwnerMapping(id);
  }

  @Public()
  @Get(R.REPEATED_ALERTS)
  public listRepeatedAlerts() {
    return this.lifecycle.listRepeatedAlerts(25);
  }

  @Public()
  @Get(R.POSTMORTEMS)
  public listPostmortems(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListPostmortemsQuerySchema, raw, 'query');
    return this.lifecycle.listPostmortems(filter);
  }

  @Public()
  @Get(R.SIEM_LOGS)
  public listSiemLogs(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListSiemLogsQuerySchema, raw, 'query');
    return this.siem.listLogs(filter);
  }

  @Public()
  @Post(R.SIEM_TEST)
  @HttpCode(HttpStatus.OK)
  public testSiemConnection(@Body() body: unknown) {
    const input = parseOrThrow(TestSiemConnectionSchema, body ?? {}, 'body');
    return this.siem.testConnection(input);
  }

  @Public()
  @Get(R.INCIDENTS_ROOT)
  public listIncidents(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListIncidentsQuerySchema, raw, 'query');
    return this.lifecycle.listIncidents(filter);
  }

  @Public()
  @Post(R.INCIDENTS_ROOT)
  public createIncident(@Body() body: unknown) {
    const input = parseOrThrow(CreateIncidentSchema, body, 'body');
    return this.lifecycle.createManualIncident(input);
  }

  @Public()
  @Get(R.INCIDENT_BY_ID)
  public getIncident(@Param('id') rawId: string) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    return this.lifecycle.getIncidentDetail(id);
  }

  @Public()
  @Post(R.INCIDENT_ACK)
  @HttpCode(HttpStatus.OK)
  public acknowledgeIncident(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(IncidentNoteActionSchema, body ?? {}, 'body');
    return this.lifecycle.acknowledge(id, input);
  }

  @Public()
  @Post(R.INCIDENT_MITIGATE)
  @HttpCode(HttpStatus.OK)
  public mitigateIncident(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(MitigateIncidentSchema, body, 'body');
    return this.lifecycle.mitigate(id, input);
  }

  @Public()
  @Post(R.INCIDENT_RESOLVE)
  @HttpCode(HttpStatus.OK)
  public resolveIncident(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(ResolveIncidentSchema, body, 'body');
    return this.lifecycle.resolve(id, input);
  }

  @Public()
  @Post(R.INCIDENT_CLOSE)
  @HttpCode(HttpStatus.OK)
  public closeIncident(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(IncidentNoteActionSchema, body ?? {}, 'body');
    return this.lifecycle.close(id, input);
  }

  @Public()
  @Post(R.INCIDENT_ASSIGN_OWNER)
  @HttpCode(HttpStatus.OK)
  public assignOwner(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(AssignIncidentOwnerSchema, body, 'body');
    return this.lifecycle.assignOwner(id, input);
  }

  @Public()
  @Get(R.INCIDENT_POSTMORTEM)
  public getPostmortem(@Param('id') rawId: string) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    return this.lifecycle.getPostmortem(id);
  }

  @Public()
  @Put(R.INCIDENT_POSTMORTEM)
  public upsertPostmortem(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(UpsertPostmortemSchema, body, 'body');
    return this.lifecycle.upsertPostmortem(id, input);
  }

  @Public()
  @Post(R.INCIDENT_POSTMORTEM_PUBLISH)
  @HttpCode(HttpStatus.OK)
  public publishPostmortem(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(PositiveIdParamSchema, rawId, 'params');
    const input = parseOrThrow(IncidentNoteActionSchema, body ?? {}, 'body');
    return this.lifecycle.publishPostmortem(id, input.actorUserId);
  }
}
