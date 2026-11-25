import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { HTTP_CLIENT_TOKEN, type HttpClientContract } from '@packages/http-client/index.js';
import { DomainEventBusService, defaultDomainEventBus } from '@packages/kernel/index.js';
import {
  NOTIFICATIONS_PUBLIC_SERVICE,
  type INotificationsPublicService,
} from '@modules/notifications/contracts/index.js';
import type { AlertDomainEventPayload } from '../contracts/index.js';
import {
  ALERT_CHANNEL,
  ALERT_SEVERITY,
  METRICS_OPS_EVENTS,
  type AlertChannel,
  type AlertMetricKey,
  type AlertOperator,
  type AlertSeverity,
} from '../enum/metrics-ops.enum.js';
import { isValidWebhookUrl, resolveAlertChannels } from '../helpers/alert-rule-eval.helper.js';
import type { AlertDeliveryRecord, AlertNotifyTargets } from '../types/metrics-ops.types.js';

export interface AlertDispatchInput {
  readonly kind: 'fired' | 'resolved';
  readonly eventId: number;
  readonly ruleId: number;
  readonly ruleCode: string;
  readonly ruleName: string;
  readonly fingerprint: string;
  readonly severity: AlertSeverity;
  readonly metricKey: AlertMetricKey;
  readonly metricValue: number;
  readonly threshold: number;
  readonly operator: AlertOperator;
  readonly labels: Record<string, string>;
  readonly summary: string;
  readonly channels?: readonly AlertChannel[] | undefined;
  readonly webhookUrl?: string | null | undefined;
  readonly notifyTargets?: AlertNotifyTargets | null | undefined;
}

@Injectable()
export class AlertDispatcherService {
  private readonly logger = new Logger('MetricsAlertDispatcher');
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly config: CoreConfigService,
    @Optional() @Inject(HTTP_CLIENT_TOKEN) private readonly httpClient?: HttpClientContract,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notifications?: INotificationsPublicService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  /** Điều phối gửi cảnh báo qua các kênh theo mức độ nghiêm trọng (`INFO` / `WARNING` / `CRITICAL`). */
  public async dispatch(input: AlertDispatchInput): Promise<AlertDeliveryRecord[]> {
    const channels = resolveAlertChannels(input.severity, input.channels);
    const nowIso = new Date().toISOString();
    const records: AlertDeliveryRecord[] = [];

    for (const channel of channels) {
      switch (channel) {
        case ALERT_CHANNEL.LOG:
          records.push(this.dispatchLog(input, nowIso));
          break;
        case ALERT_CHANNEL.DOMAIN_EVENT:
          records.push(await this.dispatchDomainEvent(input, nowIso));
          break;
        case ALERT_CHANNEL.WEBHOOK:
          records.push(await this.dispatchWebhook(input, nowIso));
          break;
        case ALERT_CHANNEL.NOTIFICATION:
          records.push(await this.dispatchNotification(input, nowIso));
          break;
      }
    }

    return records;
  }

  private dispatchLog(input: AlertDispatchInput, at: string): AlertDeliveryRecord {
    const msg = `${input.kind === 'resolved' ? '[RESOLVED] ' : ''}${input.summary}`;
    if (input.kind === 'resolved' || input.severity === ALERT_SEVERITY.INFO) {
      this.logger.log(msg);
    } else if (input.severity === ALERT_SEVERITY.WARNING) {
      this.logger.warn(msg);
    } else {
      this.logger.error(msg);
    }
    return { channel: ALERT_CHANNEL.LOG, status: 'sent', at };
  }

  private async dispatchDomainEvent(
    input: AlertDispatchInput,
    at: string,
  ): Promise<AlertDeliveryRecord> {
    const type =
      input.kind === 'resolved'
        ? METRICS_OPS_EVENTS.ALERT_RESOLVED
        : METRICS_OPS_EVENTS.ALERT_FIRED;
    const payload: AlertDomainEventPayload = {
      eventId: input.eventId,
      ruleId: input.ruleId,
      ruleCode: input.ruleCode,
      ruleName: input.ruleName,
      fingerprint: input.fingerprint,
      severity: input.severity,
      metricKey: input.metricKey,
      metricValue: input.metricValue,
      threshold: input.threshold,
      operator: input.operator,
      labels: input.labels,
      summary: input.summary,
      occurredAt: at,
    };

    try {
      await this.eventBus.publish({
        type,
        dotName: type,
        sourceModule: 'metrics-ops',
        aggregateType: 'alert_event',
        aggregateId: String(input.eventId),
        payload,
      });
      return { channel: ALERT_CHANNEL.DOMAIN_EVENT, status: 'sent', target: type, at };
    } catch (err) {
      return {
        channel: ALERT_CHANNEL.DOMAIN_EVENT,
        status: 'failed',
        target: type,
        error: err instanceof Error ? err.message : String(err),
        at,
      };
    }
  }

  private resolveWebhookUrl(input: AlertDispatchInput): string | null {
    const explicit = input.webhookUrl?.trim();
    if (explicit) return explicit;
    const hooks = this.config.metrics.alerts.webhooks;
    if (input.severity === ALERT_SEVERITY.CRITICAL) return hooks.critical || hooks.warning || null;
    if (input.severity === ALERT_SEVERITY.WARNING) return hooks.warning || null;
    return hooks.info || null;
  }

  private async dispatchWebhook(
    input: AlertDispatchInput,
    at: string,
  ): Promise<AlertDeliveryRecord> {
    const url = this.resolveWebhookUrl(input);
    if (!url || !isValidWebhookUrl(url)) {
      return {
        channel: ALERT_CHANNEL.WEBHOOK,
        status: 'skipped',
        error: 'No valid webhook URL configured for severity',
        at,
      };
    }
    if (!this.httpClient) {
      return {
        channel: ALERT_CHANNEL.WEBHOOK,
        status: 'skipped',
        target: url,
        error: 'HttpClientContract unavailable',
        at,
      };
    }

    const body = {
      kind: input.kind,
      eventId: input.eventId,
      ruleId: input.ruleId,
      ruleCode: input.ruleCode,
      ruleName: input.ruleName,
      fingerprint: input.fingerprint,
      severity: input.severity,
      metricKey: input.metricKey,
      metricValue: input.metricValue,
      threshold: input.threshold,
      operator: input.operator,
      labels: input.labels,
      summary: input.summary,
      occurredAt: at,
    };
    const secret = this.config.metrics.alerts.webhookSecret;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Alert-Severity': input.severity,
      'X-Alert-Rule': input.ruleCode,
    };
    if (secret) {
      const signature = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
      headers['X-Alert-Signature'] = `sha256=${signature}`;
    }

    try {
      await this.httpClient.post(url, body, {
        service: 'alert-webhook',
        headers,
        timeoutMs: this.config.metrics.alerts.webhookTimeoutMs,
        skipCircuitBreaker: false,
      });
      return { channel: ALERT_CHANNEL.WEBHOOK, status: 'sent', target: url, at };
    } catch (err) {
      return {
        channel: ALERT_CHANNEL.WEBHOOK,
        status: 'failed',
        target: url,
        error: err instanceof Error ? err.message : String(err),
        at,
      };
    }
  }

  private async dispatchNotification(
    input: AlertDispatchInput,
    at: string,
  ): Promise<AlertDeliveryRecord> {
    if (!this.notifications) {
      return {
        channel: ALERT_CHANNEL.NOTIFICATION,
        status: 'skipped',
        error: 'Notifications service unavailable',
        at,
      };
    }

    const userIds = input.notifyTargets?.userIds?.length
      ? [...input.notifyTargets.userIds]
      : this.config.metrics.alerts.notifyUserIds;
    const roleCodes = input.notifyTargets?.roleCodes?.length
      ? [...input.notifyTargets.roleCodes]
      : this.config.metrics.alerts.notifyRoleCodes;

    if (userIds.length === 0 && roleCodes.length === 0) {
      return {
        channel: ALERT_CHANNEL.NOTIFICATION,
        status: 'skipped',
        error: 'No notification recipients configured',
        at,
      };
    }

    const priority =
      input.severity === ALERT_SEVERITY.CRITICAL
        ? 'URGENT'
        : input.severity === ALERT_SEVERITY.WARNING
          ? 'HIGH'
          : 'NORMAL';
    const channels = this.config.metrics.alerts.notifyChannels as ('IN_APP' | 'EMAIL')[];

    try {
      if (userIds.length > 0) {
        await this.notifications.dispatch({
          title: `[${input.severity}] ${input.ruleName}`,
          content: input.summary,
          category: 'SYSTEM',
          priority,
          targetType: 'USER_GROUP',
          userIds,
          channels,
          referenceModule: 'metrics-ops',
          referenceType: 'alert_event',
          referenceId: String(input.eventId),
          forceDeliver: input.severity === ALERT_SEVERITY.CRITICAL,
        });
      }
      if (roleCodes.length > 0) {
        await this.notifications.dispatch({
          title: `[${input.severity}] ${input.ruleName}`,
          content: input.summary,
          category: 'SYSTEM',
          priority,
          targetType: 'ROLE',
          roleCodes,
          channels,
          referenceModule: 'metrics-ops',
          referenceType: 'alert_event',
          referenceId: String(input.eventId),
          forceDeliver: input.severity === ALERT_SEVERITY.CRITICAL,
        });
      }
      return {
        channel: ALERT_CHANNEL.NOTIFICATION,
        status: 'sent',
        target: [...userIds.map((u) => `user:${u}`), ...roleCodes.map((r) => `role:${r}`)].join(
          ',',
        ),
        at,
      };
    } catch (err) {
      return {
        channel: ALERT_CHANNEL.NOTIFICATION,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        at,
      };
    }
  }
}
