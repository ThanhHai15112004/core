import {
  safeJsonParse,
  safeJsonParseObject,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import type { AlertEventEntity } from '../entities/alert-event.entity.js';
import type { AlertRuleEntity } from '../entities/alert-rule.entity.js';
import {
  ALL_ALERT_CHANNELS,
  type AlertChannel,
} from '../enum/metrics-ops.enum.js';
import type {
  AlertDeliveryRecord,
  AlertEventView,
  AlertNotifyTargets,
  AlertRuleScope,
  AlertRuleView,
} from '../types/metrics-ops.types.js';

const CHANNEL_SET = new Set<string>(ALL_ALERT_CHANNELS);

export class MetricsOpsResponseMapper {
  public static toRuleView(entity: AlertRuleEntity): AlertRuleView {
    const scopeRaw = safeJsonParse<AlertRuleScope | null>(entity.scopeJson, null);
    const channelsRaw = safeJsonParseStringArray(entity.channelsJson).filter((c) =>
      CHANNEL_SET.has(c),
    ) as AlertChannel[];
    const notifyRaw = safeJsonParse<AlertNotifyTargets | null>(entity.notifyTargetsJson, null);

    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      description: entity.description,
      isEnabled: Boolean(entity.isEnabled),
      metricKey: entity.metricKey,
      scope: scopeRaw,
      operator: entity.operator,
      threshold: Number(entity.threshold),
      windowSeconds: Number(entity.windowSeconds),
      forSeconds: Number(entity.forSeconds),
      cooldownSeconds: Number(entity.cooldownSeconds),
      severity: entity.severity,
      channels: channelsRaw,
      webhookUrl: entity.webhookUrl,
      notifyTargets: notifyRaw,
      isSystem: Boolean(entity.isSystem),
      lastEvaluatedAt: entity.lastEvaluatedAt ? entity.lastEvaluatedAt.toISOString() : null,
      lastTriggeredAt: entity.lastTriggeredAt ? entity.lastTriggeredAt.toISOString() : null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  public static toEventView(entity: AlertEventEntity): AlertEventView {
    const labelsRaw = safeJsonParseObject(entity.labelsJson) ?? {};
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(labelsRaw)) {
      labels[k] = String(v);
    }
    const deliveryStatus = safeJsonParse<AlertDeliveryRecord[]>(entity.deliveryStatusJson, []);

    return {
      id: Number(entity.id),
      ruleId: Number(entity.ruleId),
      ruleCode: entity.ruleCode,
      ruleName: entity.ruleName,
      fingerprint: entity.fingerprint,
      severity: entity.severity,
      status: entity.status,
      metricKey: entity.metricKey,
      metricValue: Number(entity.metricValue),
      threshold: Number(entity.threshold),
      operator: entity.operator,
      labels,
      summary: entity.summary,
      firedAt: entity.firedAt.toISOString(),
      lastEvaluatedAt: entity.lastEvaluatedAt.toISOString(),
      lastNotifiedAt: entity.lastNotifiedAt ? entity.lastNotifiedAt.toISOString() : null,
      acknowledgedAt: entity.acknowledgedAt ? entity.acknowledgedAt.toISOString() : null,
      acknowledgedBy: entity.acknowledgedBy,
      acknowledgeNote: entity.acknowledgeNote,
      resolvedAt: entity.resolvedAt ? entity.resolvedAt.toISOString() : null,
      resolvedBy: entity.resolvedBy,
      deliveryStatus: Array.isArray(deliveryStatus) ? deliveryStatus : [],
    };
  }
}
