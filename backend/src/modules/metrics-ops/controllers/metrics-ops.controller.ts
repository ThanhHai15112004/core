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
  Query,
} from '@nestjs/common';
import { Public, parseOrThrow } from '@packages/http/index.js';
import {
  AlertEventActionSchema,
  CreateAlertRuleSchema,
  ListAlertEventsQuerySchema,
  ListAlertRulesQuerySchema,
  METRICS_RANGE_MINUTES,
  MetricsOverviewQuerySchema,
  RuleIdParamSchema,
  TestAlertRuleSchema,
  UpdateAlertRuleSchema,
} from '../requests/metrics-ops.requests.js';
import { METRICS_OPS_ROUTES as R } from '../routes/metrics-ops.routes.js';
import { AlertEvaluatorService } from '../services/alert-evaluator.service.js';
import { AlertEventsService } from '../services/alert-events.service.js';
import { AlertRulesService } from '../services/alert-rules.service.js';
import { MetricsOpsService } from '../services/metrics-ops.service.js';

/** API tổng hợp Metrics & Cảnh báo (Mục 12.3) cho System Console (`/ops/metrics/*`). */
@Controller(R.PREFIX)
export class MetricsOpsController {
  constructor(
    private readonly metricsOps: MetricsOpsService,
    private readonly rulesService: AlertRulesService,
    private readonly eventsService: AlertEventsService,
    private readonly evaluator: AlertEvaluatorService,
  ) {}

  @Public()
  @Get(R.OVERVIEW)
  public overview(@Query() raw: Record<string, unknown>) {
    const q = parseOrThrow(MetricsOverviewQuerySchema, raw, 'query');
    return this.metricsOps.getOverview(METRICS_RANGE_MINUTES[q.range]);
  }

  @Public()
  @Get(R.ERRORS_BY_MODULE)
  public errorsByModule(@Query() raw: Record<string, unknown>) {
    const q = parseOrThrow(MetricsOverviewQuerySchema, raw, 'query');
    return this.metricsOps.getErrorsByModule(METRICS_RANGE_MINUTES[q.range]);
  }

  @Public()
  @Get(R.DEPENDENCIES)
  public dependencies(@Query() raw: Record<string, unknown>) {
    const q = parseOrThrow(MetricsOverviewQuerySchema, raw, 'query');
    return this.metricsOps.getDependencies(METRICS_RANGE_MINUTES[q.range]);
  }

  @Public()
  @Get(R.ALERT_RULES)
  public listRules(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListAlertRulesQuerySchema, raw, 'query');
    return this.rulesService.listPaginated(filter);
  }

  @Public()
  @Post(R.ALERT_RULES)
  public createRule(@Body() body: unknown) {
    const input = parseOrThrow(CreateAlertRuleSchema, body, 'body');
    return this.rulesService.create(input);
  }

  @Public()
  @Patch(R.ALERT_RULE_BY_ID)
  public updateRule(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(RuleIdParamSchema, rawId, 'params');
    const input = parseOrThrow(UpdateAlertRuleSchema, body, 'body');
    return this.rulesService.update(id, input);
  }

  @Public()
  @Delete(R.ALERT_RULE_BY_ID)
  public deleteRule(@Param('id') rawId: string) {
    const id = parseOrThrow(RuleIdParamSchema, rawId, 'params');
    return this.rulesService.delete(id);
  }

  @Public()
  @Post(R.ALERT_RULE_TEST)
  @HttpCode(HttpStatus.OK)
  public testRule(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(RuleIdParamSchema, rawId, 'params');
    const input = parseOrThrow(TestAlertRuleSchema, body ?? {}, 'body');
    return this.evaluator.testRule(id, input.dispatch);
  }

  @Public()
  @Get(R.ALERT_EVENTS)
  public listEvents(@Query() raw: Record<string, unknown>) {
    const filter = parseOrThrow(ListAlertEventsQuerySchema, raw, 'query');
    return this.eventsService.listPaginated(filter);
  }

  @Public()
  @Post(R.ALERT_EVENT_ACK)
  @HttpCode(HttpStatus.OK)
  public acknowledgeEvent(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(RuleIdParamSchema, rawId, 'params');
    const input = parseOrThrow(AlertEventActionSchema, body ?? {}, 'body');
    return this.eventsService.acknowledge(id, input);
  }

  @Public()
  @Post(R.ALERT_EVENT_RESOLVE)
  @HttpCode(HttpStatus.OK)
  public resolveEvent(@Param('id') rawId: string, @Body() body: unknown) {
    const id = parseOrThrow(RuleIdParamSchema, rawId, 'params');
    const input = parseOrThrow(AlertEventActionSchema, body ?? {}, 'body');
    return this.eventsService.resolve(id, input);
  }

  @Public()
  @Post(R.ALERTS_EVALUATE)
  @HttpCode(HttpStatus.OK)
  public evaluateNow() {
    return this.evaluator.evaluateAll();
  }
}
