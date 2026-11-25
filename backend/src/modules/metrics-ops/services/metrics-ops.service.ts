import { Injectable } from '@nestjs/common';
import type { IMetricsOpsPublicService } from '../contracts/index.js';
import type {
  AlertEvaluationSummaryView,
  AlertEventView,
  AlertRuleView,
  MetricsOverviewView,
  ModuleErrorMetricItem,
  ProviderLatencyMetricItem,
  RedisDependencyLatencySummary,
} from '../types/metrics-ops.types.js';
import { AlertEvaluatorService } from './alert-evaluator.service.js';
import { AlertEventsService } from './alert-events.service.js';
import { AlertRulesService } from './alert-rules.service.js';
import { MetricsCollectorQueryService } from './metrics-collector-query.service.js';

@Injectable()
export class MetricsOpsService implements IMetricsOpsPublicService {
  constructor(
    private readonly collector: MetricsCollectorQueryService,
    private readonly rulesService: AlertRulesService,
    private readonly eventsService: AlertEventsService,
    private readonly evaluator: AlertEvaluatorService,
  ) {}

  public async getOverview(rangeMinutes = 15): Promise<MetricsOverviewView> {
    const [overview, activeAlerts] = await Promise.all([
      this.collector.getOverview(rangeMinutes),
      this.eventsService.countActiveBySeverity(),
    ]);
    return {
      ...overview,
      activeAlerts,
    };
  }

  public async getErrorsByModule(rangeMinutes = 15): Promise<readonly ModuleErrorMetricItem[]> {
    return this.collector.getErrorsByModule(rangeMinutes);
  }

  public async getDependencies(rangeMinutes = 15): Promise<{
    readonly redis: RedisDependencyLatencySummary;
    readonly providers: readonly ProviderLatencyMetricItem[];
  }> {
    return this.collector.getDependencies(rangeMinutes);
  }

  public async listRules(): Promise<readonly AlertRuleView[]> {
    return this.rulesService.listAll();
  }

  public async listActiveEvents(): Promise<readonly AlertEventView[]> {
    return this.eventsService.listOpenViews();
  }

  public async evaluateAlerts(): Promise<AlertEvaluationSummaryView> {
    return this.evaluator.evaluateAll();
  }
}
