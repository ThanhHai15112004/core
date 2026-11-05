import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In, type Repository } from 'typeorm';
import {
  BaseTypeOrmRepository,
  type PaginatedQueryBuilderResult,
  TransactionManager,
  paginateSelectQueryBuilder,
} from '@packages/database/index.js';
import type { RawPaginationInput } from '@packages/kernel/index.js';
import { NotificationTemplateUsageEntity } from '../entities/notification-template-usage.entity.js';
import { NotificationTemplateVersionEntity } from '../entities/notification-template-version.entity.js';
import { NotificationTemplateEntity } from '../entities/notification-template.entity.js';

export interface NotificationTemplateFilterOptions extends RawPaginationInput {
  readonly search?: string | undefined;
  readonly channel?: number | undefined;
  readonly category?: number | undefined;
  readonly locale?: string | undefined;
  readonly templateType?: string | undefined;
  readonly isActive?: boolean | undefined;
}

@Injectable()
export class TemplatesRepository extends BaseTypeOrmRepository<NotificationTemplateEntity> {
  public readonly templateRepo: Repository<NotificationTemplateEntity>;
  public readonly templateVersionRepo: Repository<NotificationTemplateVersionEntity>;
  public readonly templateUsageRepo: Repository<NotificationTemplateUsageEntity>;
  public countDeliveriesByTemplateCode?: (
    templateCode: string,
    channel?: number,
  ) => Promise<number>;

  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(NotificationTemplateEntity, dataSource, transactionManager);
    this.templateRepo = dataSource.getRepository(NotificationTemplateEntity);
    this.templateVersionRepo = dataSource.getRepository(NotificationTemplateVersionEntity);
    this.templateUsageRepo = dataSource.getRepository(NotificationTemplateUsageEntity);
  }

  public async findTemplateById(id: number): Promise<NotificationTemplateEntity | null> {
    return this.templateRepo.findOne({ where: { id } });
  }

  public async findTemplateByCodeChannelLocale(
    code: string,
    channel: number,
    locale = 'vi',
  ): Promise<NotificationTemplateEntity | null> {
    const cleanCode = code.trim().toUpperCase();
    const cleanLocale = locale.trim().toLowerCase() || 'vi';
    const exact = await this.templateRepo.findOne({
      where: { code: cleanCode, channel, locale: cleanLocale, isActive: true },
    });
    if (exact) return exact;
    if (cleanLocale !== 'vi') {
      const viMatch = await this.templateRepo.findOne({
        where: { code: cleanCode, channel, locale: 'vi', isActive: true },
      });
      if (viMatch) return viMatch;
    }
    return this.templateRepo.findOne({
      where: { code: cleanCode, isActive: true },
    });
  }

  public async findPaginatedTemplates(
    options: NotificationTemplateFilterOptions,
  ): Promise<PaginatedQueryBuilderResult<NotificationTemplateEntity>> {
    const qb = this.templateRepo.createQueryBuilder('t').where('t.deletedAt IS NULL');

    if (options.channel !== undefined) {
      qb.andWhere('t.channel = :channel', { channel: options.channel });
    }
    if (options.category !== undefined) {
      qb.andWhere('t.category = :category', { category: options.category });
    }
    if (options.locale && options.locale.trim()) {
      qb.andWhere('t.locale = :locale', { locale: options.locale.trim().toLowerCase() });
    }
    if (options.templateType && options.templateType.trim()) {
      qb.andWhere('t.templateType = :templateType', {
        templateType: options.templateType.trim().toUpperCase(),
      });
    }
    if (options.isActive !== undefined) {
      qb.andWhere('t.isActive = :isActive', { isActive: options.isActive });
    }
    if (options.search && options.search.trim()) {
      const kw = `%${options.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(t.code) LIKE :kw OR LOWER(t.name) LIKE :kw OR LOWER(t.bodyTemplate) LIKE :kw)',
        { kw },
      );
    }

    qb.orderBy('t.code', 'ASC').addOrderBy('t.channel', 'ASC').addOrderBy('t.locale', 'ASC');
    return paginateSelectQueryBuilder(qb, options, {
      settingPrefix: 'notifications.pagination',
    });
  }

  public async findExactTemplateByCodeChannelLocale(
    code: string,
    channel: number,
    locale = 'vi',
  ): Promise<NotificationTemplateEntity | null> {
    const cleanCode = code.trim().toUpperCase();
    const cleanLocale = locale.trim().toLowerCase() || 'vi';
    return this.templateRepo.findOne({
      where: { code: cleanCode, channel, locale: cleanLocale },
    });
  }

  public async findTemplatesByCodes(
    codes: readonly string[],
  ): Promise<NotificationTemplateEntity[]> {
    const cleanCodes = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
    if (cleanCodes.length === 0) return [];
    return this.templateRepo.find({
      where: { code: In(cleanCodes) },
      order: { code: 'ASC', locale: 'ASC' },
    });
  }

  public async upsertTemplate(
    data: Partial<NotificationTemplateEntity> & {
      code: string;
      channel: number;
      locale: string;
    },
  ): Promise<NotificationTemplateEntity> {
    const cleanCode = data.code.trim().toUpperCase();
    const cleanLocale = data.locale.trim().toLowerCase() || 'vi';
    const existing = await this.templateRepo.findOne({
      where: { code: cleanCode, channel: data.channel, locale: cleanLocale },
    });
    if (existing) {
      Object.assign(existing, {
        ...data,
        code: cleanCode,
        locale: cleanLocale,
      });
      return this.templateRepo.save(existing);
    }
    const created = this.templateRepo.create({
      ...data,
      code: cleanCode,
      locale: cleanLocale,
    });
    return this.templateRepo.save(created);
  }

  public async deleteTemplateById(id: number): Promise<void> {
    await this.templateVersionRepo.delete({ templateId: id });
    await this.templateRepo.delete({ id });
  }

  public async findTemplateVersions(
    templateId: number,
  ): Promise<NotificationTemplateVersionEntity[]> {
    return this.templateVersionRepo.find({
      where: { templateId },
      order: { version: 'DESC', id: 'DESC' },
    });
  }

  public async findTemplateVersionsByTemplateIds(
    templateIds: readonly number[],
  ): Promise<NotificationTemplateVersionEntity[]> {
    const cleanIds = [...new Set(templateIds.map(Number).filter((n) => n > 0))];
    if (cleanIds.length === 0) return [];
    return this.templateVersionRepo.find({
      where: { templateId: In(cleanIds) },
      order: { version: 'DESC' },
    });
  }

  public async findTemplateVersionByNumber(
    templateId: number,
    version: number,
  ): Promise<NotificationTemplateVersionEntity | null> {
    return this.templateVersionRepo.findOne({
      where: { templateId, version },
    });
  }

  public async saveTemplateVersion(
    data: Partial<NotificationTemplateVersionEntity> & {
      templateId: number;
      code: string;
      channel: number;
      locale: string;
      version: number;
    },
  ): Promise<NotificationTemplateVersionEntity> {
    const existing = await this.templateVersionRepo.findOne({
      where: { templateId: data.templateId, version: data.version },
    });
    if (existing) {
      Object.assign(existing, data);
      return this.templateVersionRepo.save(existing);
    }
    const created = this.templateVersionRepo.create(data);
    return this.templateVersionRepo.save(created);
  }

  public async findTemplateUsagesByCode(
    templateCode: string,
    channel?: number | null,
  ): Promise<NotificationTemplateUsageEntity[]> {
    const cleanCode = templateCode.trim().toUpperCase();
    const rows = await this.templateUsageRepo.find({
      where: { templateCode: cleanCode, isActive: true },
      order: { moduleName: 'ASC', featureCode: 'ASC' },
    });
    if (channel === undefined || channel === null) {
      return rows;
    }
    return rows.filter(
      (r) => r.channel === null || r.channel === undefined || Number(r.channel) === channel,
    );
  }

  public async findTemplateUsagesByCodes(
    templateCodes: readonly string[],
  ): Promise<NotificationTemplateUsageEntity[]> {
    const cleanCodes = [
      ...new Set(templateCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)),
    ];
    if (cleanCodes.length === 0) return [];
    return this.templateUsageRepo.find({
      where: { templateCode: In(cleanCodes), isActive: true },
      order: { moduleName: 'ASC', featureCode: 'ASC' },
    });
  }

  public async upsertTemplateUsage(params: {
    templateCode: string;
    channel?: number | null | undefined;
    moduleName: string;
    featureCode: string;
    entityType?: string | null | undefined;
    entityId?: string | null | undefined;
    description?: string | null | undefined;
    createdByUserId?: number | null | undefined;
  }): Promise<NotificationTemplateUsageEntity> {
    const cleanCode = params.templateCode.trim().toUpperCase();
    const cleanModule = params.moduleName.trim().toLowerCase();
    const cleanFeature = params.featureCode.trim();
    const existing = await this.templateUsageRepo.findOne({
      where: {
        templateCode: cleanCode,
        moduleName: cleanModule,
        featureCode: cleanFeature,
      },
    });
    if (existing) {
      existing.channel = params.channel !== undefined ? params.channel : (existing.channel ?? null);
      existing.entityType = params.entityType ?? existing.entityType ?? null;
      existing.entityId = params.entityId ?? existing.entityId ?? null;
      existing.description = params.description ?? existing.description ?? null;
      existing.isActive = true;
      return this.templateUsageRepo.save(existing);
    }
    const created = this.templateUsageRepo.create({
      templateCode: cleanCode,
      channel: params.channel ?? null,
      moduleName: cleanModule,
      featureCode: cleanFeature,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      description: params.description ?? null,
      isActive: true,
      createdByUserId: params.createdByUserId ?? null,
    });
    return this.templateUsageRepo.save(created);
  }

  public async removeTemplateUsageById(
    usageId: number,
  ): Promise<NotificationTemplateUsageEntity | null> {
    const existing = await this.templateUsageRepo.findOne({ where: { id: usageId } });
    if (!existing) return null;
    existing.isActive = false;
    return this.templateUsageRepo.save(existing);
  }
}
