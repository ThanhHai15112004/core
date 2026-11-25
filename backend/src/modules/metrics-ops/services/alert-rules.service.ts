import { Injectable } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import type { AlertRuleEntity } from '../entities/alert-rule.entity.js';
import { resolveAlertChannels, isValidWebhookUrl } from '../helpers/alert-rule-eval.helper.js';
import {
  AlertRuleCodeDuplicateException,
  AlertRuleNotFoundException,
  AlertWebhookInvalidException,
  SystemAlertRuleDeleteForbiddenException,
} from '../exceptions/metrics-ops.exceptions.js';
import {
  AlertRuleRepository,
  type ListAlertRulesFilter,
} from '../repositories/alert-rule.repository.js';
import type {
  CreateAlertRuleRequest,
  UpdateAlertRuleRequest,
} from '../requests/metrics-ops.requests.js';
import { MetricsOpsResponseMapper } from '../responses/metrics-ops.response.js';
import type { AlertRuleView } from '../types/metrics-ops.types.js';

@Injectable()
export class AlertRulesService {
  constructor(
    private readonly ruleRepo: AlertRuleRepository,
    private readonly txManager: TransactionManager,
  ) {}

  public async listPaginated(
    filter: ListAlertRulesFilter,
  ): Promise<PaginatedResult<AlertRuleView>> {
    const page = await this.ruleRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => MetricsOpsResponseMapper.toRuleView(item)),
    };
  }

  public async listAll(): Promise<AlertRuleView[]> {
    if (!this.ruleRepo.isDatabaseReady()) return [];
    const list = await this.ruleRepo.listEnabled();
    return list.map((item) => MetricsOpsResponseMapper.toRuleView(item));
  }

  public async listEnabledEntities(): Promise<AlertRuleEntity[]> {
    return this.ruleRepo.listEnabled();
  }

  public async getEntityOrThrow(id: number): Promise<AlertRuleEntity> {
    const entity = await this.ruleRepo.findByIdSafe(id);
    if (!entity) throw new AlertRuleNotFoundException(id);
    return entity;
  }

  public async getById(id: number): Promise<AlertRuleView> {
    const entity = await this.getEntityOrThrow(id);
    return MetricsOpsResponseMapper.toRuleView(entity);
  }

  public async create(
    input: CreateAlertRuleRequest,
    actorUserId?: number | null,
  ): Promise<AlertRuleView> {
    const normalizedCode = input.code.trim().toUpperCase();
    const existing = await this.ruleRepo.findByCode(normalizedCode);
    if (existing) {
      throw new AlertRuleCodeDuplicateException(normalizedCode);
    }

    const webhookUrl = input.webhookUrl?.trim() || null;
    if (webhookUrl && !isValidWebhookUrl(webhookUrl)) {
      throw new AlertWebhookInvalidException();
    }

    const channels = resolveAlertChannels(input.severity, input.channels);
    const saved = await this.txManager.runInTransaction(() =>
      this.ruleRepo.saveEntity({
        code: normalizedCode,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isEnabled: input.isEnabled ?? true,
        metricKey: input.metricKey,
        scopeJson: input.scope ? JSON.stringify(input.scope) : null,
        operator: input.operator,
        threshold: input.threshold,
        windowSeconds: input.windowSeconds,
        forSeconds: input.forSeconds,
        cooldownSeconds: input.cooldownSeconds,
        severity: input.severity,
        channelsJson: JSON.stringify(channels),
        webhookUrl,
        notifyTargetsJson: input.notifyTargets ? JSON.stringify(input.notifyTargets) : null,
        isSystem: false,
        createdBy: actorUserId ?? null,
        updatedBy: actorUserId ?? null,
      }),
    );

    return MetricsOpsResponseMapper.toRuleView(saved);
  }

  public async update(
    id: number,
    input: UpdateAlertRuleRequest,
    actorUserId?: number | null,
  ): Promise<AlertRuleView> {
    const entity = await this.getEntityOrThrow(id);

    if (input.webhookUrl !== undefined) {
      const trimmed = input.webhookUrl?.trim() || null;
      if (trimmed && !isValidWebhookUrl(trimmed)) {
        throw new AlertWebhookInvalidException();
      }
      entity.webhookUrl = trimmed;
    }
    if (input.name !== undefined) entity.name = input.name.trim();
    if (input.description !== undefined) entity.description = input.description?.trim() || null;
    if (input.isEnabled !== undefined) entity.isEnabled = input.isEnabled;
    if (input.metricKey !== undefined) entity.metricKey = input.metricKey;
    if (input.scope !== undefined) {
      entity.scopeJson = input.scope ? JSON.stringify(input.scope) : null;
    }
    if (input.operator !== undefined) entity.operator = input.operator;
    if (input.threshold !== undefined) entity.threshold = input.threshold;
    if (input.windowSeconds !== undefined) entity.windowSeconds = input.windowSeconds;
    if (input.forSeconds !== undefined) entity.forSeconds = input.forSeconds;
    if (input.cooldownSeconds !== undefined) entity.cooldownSeconds = input.cooldownSeconds;
    if (input.severity !== undefined) entity.severity = input.severity;
    if (input.channels !== undefined) {
      const resolved = resolveAlertChannels(entity.severity, input.channels);
      entity.channelsJson = JSON.stringify(resolved);
    }
    if (input.notifyTargets !== undefined) {
      entity.notifyTargetsJson = input.notifyTargets ? JSON.stringify(input.notifyTargets) : null;
    }
    entity.updatedBy = actorUserId ?? null;

    const saved = await this.txManager.runInTransaction(() => this.ruleRepo.saveEntity(entity));
    return MetricsOpsResponseMapper.toRuleView(saved);
  }

  public async delete(id: number): Promise<{ deleted: true; id: number }> {
    const entity = await this.getEntityOrThrow(id);
    if (entity.isSystem) {
      throw new SystemAlertRuleDeleteForbiddenException();
    }
    await this.txManager.runInTransaction(() => this.ruleRepo.repository.softDelete(id));
    return { deleted: true, id };
  }
}
