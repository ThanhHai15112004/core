import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { TransactionManager } from '@packages/database/index.js';
import { safeJsonParse, safeJsonParseStringArray } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import type { AlertEventEntity } from '../entities/alert-event.entity.js';
import type { AlertRuleEntity } from '../entities/alert-rule.entity.js';
import {
  ALERT_CHANNEL,
  ALERT_EVENT_STATUS,
  ALL_ALERT_CHANNELS,
  type AlertChannel,
} from '../enum/metrics-ops.enum.js';
import {
  buildAlertFingerprint,
  buildAlertSummary,
  compareMetric,
  matchesRuleScope,
} from '../helpers/alert-rule-eval.helper.js';
import { AlertEventRepository } from '../repositories/alert-event.repository.js';
import { AlertRuleRepository } from '../repositories/alert-rule.repository.js';
import type {
  AlertDeliveryRecord,
  AlertEvaluationSummaryView,
  AlertNotifyTargets,
  AlertRuleScope,
  AlertRuleTestResultView,
} from '../types/metrics-ops.types.js';
import { AlertDispatcherService } from './alert-dispatcher.service.js';
import { AlertRulesService } from './alert-rules.service.js';
import { MetricsCollectorQueryService } from './metrics-collector-query.service.js';

const LOCK_KEY_PARTS = ['metrics', 'alerts', 'eval', 'lock'] as const;
const CHANNEL_SET = new Set<string>(ALL_ALERT_CHANNELS);

@Injectable()
export class AlertEvaluatorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('MetricsAlertEvaluator');
  private readonly pendingSince = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: CoreConfigService,
    private readonly ruleRepo: AlertRuleRepository,
    private readonly eventRepo: AlertEventRepository,
    private readonly rulesService: AlertRulesService,
    private readonly collector: MetricsCollectorQueryService,
    private readonly dispatcher: AlertDispatcherService,
    private readonly txManager: TransactionManager,
    @Optional() private readonly redis?: RedisService,
  ) {}

  public onApplicationBootstrap(): void {
    if (this.config.isTest || !this.config.metrics.alerts.enabled) return;
    const every = Math.max(5000, this.config.metrics.alerts.evaluateMs);
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
    setTimeout(() => void this.tick(), 12_000).unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(now = Date.now()): Promise<AlertEvaluationSummaryView | null> {
    if (this.running || !this.ruleRepo.isDatabaseReady()) return null;
    this.running = true;
    try {
      if (this.redis?.isReady()) {
        const every = Math.max(5000, this.config.metrics.alerts.evaluateMs);
        const lockKey = this.redis.key(...LOCK_KEY_PARTS);
        const locked = await this.redis.client.set(lockKey, String(now), 'PX', every - 1000, 'NX');
        if (locked !== 'OK') return null;
      }
      return await this.evaluateAll(now);
    } catch (err) {
      this.logger.warn(
        `Alert evaluation tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      this.running = false;
    }
  }

  public async evaluateAll(now = Date.now()): Promise<AlertEvaluationSummaryView> {
    const [rules, openEvents] = await Promise.all([
      this.ruleRepo.listEnabled(),
      this.eventRepo.listOpenEvents(),
    ]);

    const openByFingerprint = new Map<string, AlertEventEntity>();
    for (const evt of openEvents) {
      if (!openByFingerprint.has(evt.fingerprint)) {
        openByFingerprint.set(evt.fingerprint, evt);
      }
    }

    const activeFingerprints = new Set<string>();
    const nowDate = new Date(now);
    let firedNew = 0;
    let renotified = 0;
    let autoResolved = 0;

    for (const rule of rules) {
      const scope = safeJsonParse<AlertRuleScope | null>(rule.scopeJson, null);
      const samples = await this.collector.sampleMetricForRule(rule.metricKey, rule.windowSeconds);
      const filtered = samples.filter((s) => matchesRuleScope(s.labels, scope));
      let ruleTriggered = false;

      for (const sample of filtered) {
        const fingerprint = buildAlertFingerprint(rule.code, sample.labels);
        const breached = compareMetric(sample.value, rule.operator, Number(rule.threshold));

        if (!breached) {
          this.pendingSince.delete(fingerprint);
          continue;
        }

        const firstSeen = this.pendingSince.get(fingerprint) ?? now;
        if (!this.pendingSince.has(fingerprint)) {
          this.pendingSince.set(fingerprint, firstSeen);
        }

        const sustainMs = Math.max(0, Number(rule.forSeconds)) * 1000;
        if (now - firstSeen < sustainMs) {
          continue;
        }

        ruleTriggered = true;
        activeFingerprints.add(fingerprint);
        const summary = buildAlertSummary({
          severity: rule.severity,
          ruleName: rule.name,
          metricKey: rule.metricKey,
          value: sample.value,
          operator: rule.operator,
          threshold: Number(rule.threshold),
          labels: sample.labels,
        });

        const existing = openByFingerprint.get(fingerprint);
        if (!existing) {
          const created = await this.createAndDispatchEvent(
            rule,
            fingerprint,
            sample.value,
            sample.labels,
            summary,
            nowDate,
          );
          openByFingerprint.set(fingerprint, created);
          firedNew += 1;
        } else {
          const didRenotify = await this.updateAndMaybeRenotify(
            rule,
            existing,
            sample.value,
            sample.labels,
            summary,
            nowDate,
          );
          if (didRenotify) renotified += 1;
        }
      }

      rule.lastEvaluatedAt = nowDate;
      if (ruleTriggered) rule.lastTriggeredAt = nowDate;
      await this.txManager.runInTransaction(() => this.ruleRepo.saveEntity(rule));
    }

    const enabledCodes = new Set(rules.map((r) => r.code));
    const ruleById = new Map(rules.map((r) => [Number(r.id), r]));
    for (const open of openEvents) {
      if (!enabledCodes.has(open.ruleCode)) continue;
      if (activeFingerprints.has(open.fingerprint)) continue;

      const rule = ruleById.get(Number(open.ruleId));
      await this.resolveOpenEvent(open, rule, nowDate);
      this.pendingSince.delete(open.fingerprint);
      autoResolved += 1;
    }

    return {
      evaluatedRules: rules.length,
      firingCount: activeFingerprints.size,
      firedNew,
      renotified,
      autoResolved,
      evaluatedAt: nowDate.toISOString(),
    };
  }

  public async testRule(id: number, dispatch = false): Promise<AlertRuleTestResultView> {
    const rule = await this.rulesService.getEntityOrThrow(id);
    const scope = safeJsonParse<AlertRuleScope | null>(rule.scopeJson, null);
    const samples = await this.collector.sampleMetricForRule(rule.metricKey, rule.windowSeconds);
    const evaluated = samples
      .filter((s) => matchesRuleScope(s.labels, scope))
      .map((s) => ({
        value: s.value,
        labels: s.labels,
        breached: compareMetric(s.value, rule.operator, Number(rule.threshold)),
      }));

    let dispatched: AlertDeliveryRecord[] = [];
    const firstBreached = evaluated.find((s) => s.breached);
    if (dispatch && firstBreached) {
      const fingerprint = buildAlertFingerprint(rule.code, firstBreached.labels);
      const summary = buildAlertSummary({
        severity: rule.severity,
        ruleName: rule.name,
        metricKey: rule.metricKey,
        value: firstBreached.value,
        operator: rule.operator,
        threshold: Number(rule.threshold),
        labels: firstBreached.labels,
      });
      dispatched = await this.dispatcher.dispatch({
        kind: 'fired',
        eventId: 0,
        ruleId: Number(rule.id),
        ruleCode: rule.code,
        ruleName: rule.name,
        fingerprint,
        severity: rule.severity,
        metricKey: rule.metricKey,
        metricValue: firstBreached.value,
        threshold: Number(rule.threshold),
        operator: rule.operator,
        labels: firstBreached.labels,
        summary,
        channels: this.parseChannels(rule.channelsJson),
        webhookUrl: rule.webhookUrl,
        notifyTargets: safeJsonParse<AlertNotifyTargets | null>(rule.notifyTargetsJson, null),
      });
    }

    return {
      ruleId: Number(rule.id),
      ruleCode: rule.code,
      metricKey: rule.metricKey,
      matched: evaluated.some((s) => s.breached),
      samples: evaluated,
      dispatched,
    };
  }

  private parseChannels(channelsJson: string | null): AlertChannel[] {
    return safeJsonParseStringArray(channelsJson).filter((c) =>
      CHANNEL_SET.has(c),
    ) as AlertChannel[];
  }

  private async createAndDispatchEvent(
    rule: AlertRuleEntity,
    fingerprint: string,
    metricValue: number,
    labels: Record<string, string>,
    summary: string,
    nowDate: Date,
  ): Promise<AlertEventEntity> {
    const saved = await this.txManager.runInTransaction(() =>
      this.eventRepo.saveEntity({
        ruleId: Number(rule.id),
        ruleCode: rule.code,
        ruleName: rule.name,
        fingerprint,
        severity: rule.severity,
        status: ALERT_EVENT_STATUS.FIRING,
        metricKey: rule.metricKey,
        metricValue,
        threshold: Number(rule.threshold),
        operator: rule.operator,
        labelsJson: JSON.stringify(labels),
        summary,
        firedAt: nowDate,
        lastEvaluatedAt: nowDate,
        lastNotifiedAt: nowDate,
      }),
    );

    const delivery = await this.dispatcher.dispatch({
      kind: 'fired',
      eventId: Number(saved.id),
      ruleId: Number(rule.id),
      ruleCode: rule.code,
      ruleName: rule.name,
      fingerprint,
      severity: rule.severity,
      metricKey: rule.metricKey,
      metricValue,
      threshold: Number(rule.threshold),
      operator: rule.operator,
      labels,
      summary,
      channels: this.parseChannels(rule.channelsJson),
      webhookUrl: rule.webhookUrl,
      notifyTargets: safeJsonParse<AlertNotifyTargets | null>(rule.notifyTargetsJson, null),
    });

    saved.deliveryStatusJson = JSON.stringify(delivery);
    return this.txManager.runInTransaction(() => this.eventRepo.saveEntity(saved));
  }

  private async updateAndMaybeRenotify(
    rule: AlertRuleEntity,
    existing: AlertEventEntity,
    metricValue: number,
    labels: Record<string, string>,
    summary: string,
    nowDate: Date,
  ): Promise<boolean> {
    existing.metricValue = metricValue;
    existing.summary = summary;
    existing.lastEvaluatedAt = nowDate;

    const cooldownMs = Math.max(10, Number(rule.cooldownSeconds)) * 1000;
    const lastNotifiedMs = existing.lastNotifiedAt ? existing.lastNotifiedAt.getTime() : 0;
    const shouldRenotify =
      existing.status === ALERT_EVENT_STATUS.FIRING &&
      nowDate.getTime() - lastNotifiedMs >= cooldownMs;

    if (shouldRenotify) {
      const delivery = await this.dispatcher.dispatch({
        kind: 'fired',
        eventId: Number(existing.id),
        ruleId: Number(rule.id),
        ruleCode: rule.code,
        ruleName: rule.name,
        fingerprint: existing.fingerprint,
        severity: rule.severity,
        metricKey: rule.metricKey,
        metricValue,
        threshold: Number(rule.threshold),
        operator: rule.operator,
        labels,
        summary,
        channels: this.parseChannels(rule.channelsJson),
        webhookUrl: rule.webhookUrl,
        notifyTargets: safeJsonParse<AlertNotifyTargets | null>(rule.notifyTargetsJson, null),
      });
      existing.lastNotifiedAt = nowDate;
      existing.deliveryStatusJson = JSON.stringify(delivery);
    }

    await this.txManager.runInTransaction(() => this.eventRepo.saveEntity(existing));
    return shouldRenotify;
  }

  private async resolveOpenEvent(
    event: AlertEventEntity,
    rule: AlertRuleEntity | undefined,
    nowDate: Date,
  ): Promise<void> {
    event.status = ALERT_EVENT_STATUS.RESOLVED;
    event.resolvedAt = nowDate;
    event.lastEvaluatedAt = nowDate;

    const labels = safeJsonParse<Record<string, string>>(event.labelsJson, {}) ?? {};
    const channels = rule
      ? this.parseChannels(rule.channelsJson)
      : [ALERT_CHANNEL.LOG, ALERT_CHANNEL.DOMAIN_EVENT];
    const delivery = await this.dispatcher.dispatch({
      kind: 'resolved',
      eventId: Number(event.id),
      ruleId: Number(event.ruleId),
      ruleCode: event.ruleCode,
      ruleName: event.ruleName,
      fingerprint: event.fingerprint,
      severity: event.severity,
      metricKey: event.metricKey,
      metricValue: Number(event.metricValue),
      threshold: Number(event.threshold),
      operator: event.operator,
      labels,
      summary: event.summary,
      channels,
      webhookUrl: rule?.webhookUrl,
      notifyTargets: rule
        ? safeJsonParse<AlertNotifyTargets | null>(rule.notifyTargetsJson, null)
        : null,
    });
    event.deliveryStatusJson = JSON.stringify(delivery);
    await this.txManager.runInTransaction(() => this.eventRepo.saveEntity(event));
  }
}
