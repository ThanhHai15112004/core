import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  defaultSettingRegistry,
} from '@packages/kernel/index.js';
import {
  CoreI18nService,
  I18N_ITEM_STATUS,
  type I18nItemStatusCode,
  type RegisteredLocaleMetadata,
  type RegisteredTimezoneMetadata,
  type RegisteredTranslationItem,
  getRegisteredLocaleMetadata,
  getRegisteredTimezoneMetadata,
  listRegisteredLocales,
  listRegisteredTimezones,
  removeRuntimeTranslation,
  setRuntimeTranslation,
  upsertRegisteredLocale,
  upsertRegisteredTimezone,
} from '@packages/i18n/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import type {
  I18nLocaleSummary,
  I18nTimezoneSummary,
  I18nTranslationSummary,
  II18nManagementPublicService,
  SyncI18nResult,
} from '../contracts/index.js';
import type { I18nLocaleEntity } from '../entities/i18n-locale.entity.js';
import type { I18nTimezoneEntity } from '../entities/i18n-timezone.entity.js';
import type { I18nTranslationEntity } from '../entities/i18n-translation.entity.js';
import { SETTINGS_AUDIT_META } from '../enum/settings.enum.js';
import {
  hydrateI18nCatalogFromDatabase,
  mapLocaleMetadataToSummary,
  mapTimezoneMetadataToSummary,
  mapTranslationItemToSummary,
  seedInMemoryTranslationsFromStaticDictionaries,
  syncI18nDatabaseCatalog,
} from '../helpers/i18n-catalog.helper.js';
import { I18nLocaleRepository } from '../repositories/i18n-locale.repository.js';
import { I18nTimezoneRepository } from '../repositories/i18n-timezone.repository.js';
import { I18nTranslationRepository } from '../repositories/i18n-translation.repository.js';
import type {
  CreateI18nLocaleRequest,
  CreateI18nTimezoneRequest,
  ListI18nLocalesQuery,
  ListI18nTimezonesQuery,
  ListI18nTranslationsQuery,
  UpdateI18nLocaleRequest,
  UpdateI18nTimezoneRequest,
  UpsertI18nTranslationRequest,
} from '../requests/i18n.requests.js';

@Injectable()
export class I18nManagementService implements II18nManagementPublicService, OnModuleInit {
  private readonly translationMap = new Map<string, RegisteredTranslationItem>();
  private localeSeq = 10;
  private timezoneSeq = 20;
  private translationSeq = 100;

  constructor(
    @Optional()
    @Inject(I18nLocaleRepository)
    private readonly localeRepository?: I18nLocaleRepository | null,
    @Optional()
    @Inject(I18nTimezoneRepository)
    private readonly timezoneRepository?: I18nTimezoneRepository | null,
    @Optional()
    @Inject(I18nTranslationRepository)
    private readonly translationRepository?: I18nTranslationRepository | null,
    @Optional()
    @Inject(CoreI18nService)
    private readonly i18nService?: CoreI18nService | null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService?: AuditLogService | null,
  ) {
    seedInMemoryTranslationsFromStaticDictionaries(
      this.translationMap,
      () => ++this.translationSeq,
    );
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.syncDatabaseCatalog();
    } catch {
      // Safe fallback to L1 memory when DB is not yet connected in isolated tests
    }
  }

  /**
   * Đồng bộ Idempotent danh mục Ngôn ngữ (`i18n_locales`), Múi giờ (`i18n_timezones`)
   * và Từ điển thông báo (`i18n_translations`) giữa Database và bộ nhớ Runtime (Mục 5.3.1 -> 5.3.6).
   */
  public async syncDatabaseCatalog(): Promise<SyncI18nResult> {
    return syncI18nDatabaseCatalog({
      localeRepository: this.localeRepository,
      timezoneRepository: this.timezoneRepository,
      translationRepository: this.translationRepository,
      translationMap: this.translationMap,
      i18nService: this.i18nService,
    });
  }

  /** Nạp toàn bộ dữ liệu từ 3 bảng DB `i18n_locales`, `i18n_timezones`, `i18n_translations` lên bộ nhớ Runtime */
  public async hydrateFromDatabaseSafe(): Promise<void> {
    await hydrateI18nCatalogFromDatabase({
      localeRepository: this.localeRepository,
      timezoneRepository: this.timezoneRepository,
      translationRepository: this.translationRepository,
      translationMap: this.translationMap,
      i18nService: this.i18nService,
    });
  }

  /** Liệt kê danh sách ngôn ngữ lưu trong Database (`i18n_locales`) */
  public async listLocales(query: ListI18nLocalesQuery = {}): Promise<I18nLocaleSummary[]> {
    await this.hydrateFromDatabaseSafe();
    let locales = listRegisteredLocales(true);
    if (query.status !== undefined) {
      locales = locales.filter((l) => l.status === query.status);
    }
    return locales.map((l, idx) => mapLocaleMetadataToSummary(l, idx + 1));
  }

  /** Thêm ngôn ngữ mới vào Database (`i18n_locales`) */
  public async createLocale(
    dto: CreateI18nLocaleRequest,
    actor?: UserIdentity | null,
  ): Promise<I18nLocaleSummary> {
    await this.hydrateFromDatabaseSafe();
    const code = dto.code.trim().toLowerCase();
    const existing = getRegisteredLocaleMetadata(code);
    if (existing) {
      throw new ConflictAppException('i18n.localeAlreadyExists', [], { code });
    }

    const bcp47Tag =
      dto.bcp47Tag?.trim() ||
      (code === 'vi' ? 'vi-VN' : code === 'en' ? 'en-US' : `${code}-${code.toUpperCase()}`);
    const actorUserId = actor?.id ?? null;

    if (dto.isDefault && this.localeRepository) {
      try {
        const allDb = await this.localeRepository.findAllOrdered();
        for (const item of allDb) {
          if (item.isDefault) {
            await this.localeRepository.saveEntity({ ...item, isDefault: false });
          }
        }
      } catch {
        // Ignore in memory mode
      }
    }

    let savedEntity: I18nLocaleEntity | null = null;
    if (this.localeRepository) {
      try {
        savedEntity = await this.localeRepository.saveEntity({
          code,
          bcp47Tag,
          name: dto.name.trim(),
          nativeName: dto.nativeName.trim(),
          direction: dto.direction ?? 'ltr',
          dateFormat: dto.dateFormat.trim(),
          datetimeFormat: dto.datetimeFormat.trim(),
          currencyCode: dto.currencyCode.trim().toUpperCase(),
          numberDecimalSeparator: dto.numberDecimalSeparator,
          numberGroupSeparator: dto.numberGroupSeparator,
          isDefault: dto.isDefault ?? false,
          isSystem: false,
          sortOrder: dto.sortOrder ?? 10,
          status: (dto.status ?? I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode,
          updatedBy: actorUserId,
        });
      } catch {
        // Fallback to L1 memory
      }
    }

    const registered = upsertRegisteredLocale({
      id: savedEntity?.id ? Number(savedEntity.id) : ++this.localeSeq,
      code,
      bcp47Tag,
      name: dto.name.trim(),
      nativeName: dto.nativeName.trim(),
      direction: dto.direction ?? 'ltr',
      dateFormat: dto.dateFormat.trim(),
      datetimeFormat: dto.datetimeFormat.trim(),
      currencyCode: dto.currencyCode.trim().toUpperCase(),
      numberDecimalSeparator: dto.numberDecimalSeparator,
      numberGroupSeparator: dto.numberGroupSeparator,
      isDefault: dto.isDefault ?? false,
      isSystem: false,
      sortOrder: dto.sortOrder ?? 10,
      status: (dto.status ?? I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode,
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    });

    if (registered.isDefault && registered.status === I18N_ITEM_STATUS.ACTIVE) {
      defaultSettingRegistry.setGlobalValue('ui.locale.default', registered.code);
      defaultSettingRegistry.setGlobalValue('ui.currency.default', registered.currencyCode);
    }

    await this.auditLogService?.record({
      actor,
      module: SETTINGS_AUDIT_META.MODULE,
      feature: SETTINGS_AUDIT_META.FEATURES.I18N_LOCALES,
      action: 'I18N_LOCALE_CREATED',
      resourceType: 'i18n_locale',
      resourceId: registered.code,
      afterData: {
        code: registered.code,
        bcp47Tag: registered.bcp47Tag,
        name: registered.name,
        dateFormat: registered.dateFormat,
        currencyCode: registered.currencyCode,
        isDefault: registered.isDefault,
      },
    });

    return mapLocaleMetadataToSummary(registered);
  }

  /** Cập nhật ngôn ngữ trong Database (`i18n_locales`): đổi định dạng ngày/số/tiền tệ, bật/tắt hoặc đặt làm mặc định */
  public async updateLocale(
    codeParam: string,
    dto: UpdateI18nLocaleRequest,
    actor?: UserIdentity | null,
  ): Promise<I18nLocaleSummary> {
    await this.hydrateFromDatabaseSafe();
    const code = codeParam.trim().toLowerCase();
    const existing = getRegisteredLocaleMetadata(code);
    if (!existing) {
      throw new NotFoundAppException('i18n.localeNotFound', { code });
    }

    const nextStatus = (dto.status ?? existing.status) as I18nItemStatusCode;
    const nextIsDefault = dto.isDefault !== undefined ? dto.isDefault : existing.isDefault;

    if (nextIsDefault && nextStatus !== I18N_ITEM_STATUS.ACTIVE) {
      throw new BadRequestAppException('i18n.cannotSetInactiveLocaleDefault');
    }

    const actorUserId = actor?.id ?? null;

    if (dto.isDefault === true && this.localeRepository) {
      try {
        const allDb = await this.localeRepository.findAllOrdered();
        for (const item of allDb) {
          if (item.code !== code && item.isDefault) {
            await this.localeRepository.saveEntity({ ...item, isDefault: false });
          }
        }
      } catch {
        // Ignore in memory mode
      }
    }

    const updatedMeta: RegisteredLocaleMetadata = {
      ...existing,
      bcp47Tag: dto.bcp47Tag?.trim() || existing.bcp47Tag,
      name: dto.name?.trim() || existing.name,
      nativeName: dto.nativeName?.trim() || existing.nativeName,
      direction: dto.direction ?? existing.direction,
      dateFormat: dto.dateFormat?.trim() || existing.dateFormat,
      datetimeFormat: dto.datetimeFormat?.trim() || existing.datetimeFormat,
      currencyCode: dto.currencyCode?.trim().toUpperCase() || existing.currencyCode,
      numberDecimalSeparator: dto.numberDecimalSeparator ?? existing.numberDecimalSeparator,
      numberGroupSeparator: dto.numberGroupSeparator ?? existing.numberGroupSeparator,
      isDefault: nextIsDefault,
      sortOrder: dto.sortOrder ?? existing.sortOrder,
      status: nextStatus,
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    };

    if (this.localeRepository) {
      try {
        const dbEntity = await this.localeRepository.findByCode(code);
        if (dbEntity) {
          await this.localeRepository.saveEntity({
            ...dbEntity,
            bcp47Tag: updatedMeta.bcp47Tag,
            name: updatedMeta.name,
            nativeName: updatedMeta.nativeName,
            direction: updatedMeta.direction,
            dateFormat: updatedMeta.dateFormat,
            datetimeFormat: updatedMeta.datetimeFormat,
            currencyCode: updatedMeta.currencyCode,
            numberDecimalSeparator: updatedMeta.numberDecimalSeparator,
            numberGroupSeparator: updatedMeta.numberGroupSeparator,
            isDefault: updatedMeta.isDefault,
            sortOrder: updatedMeta.sortOrder,
            status: updatedMeta.status,
            updatedBy: actorUserId,
          });
        }
      } catch {
        // Fallback to L1 memory
      }
    }

    const saved = upsertRegisteredLocale(updatedMeta);
    if (saved.isDefault && saved.status === I18N_ITEM_STATUS.ACTIVE) {
      defaultSettingRegistry.setGlobalValue('ui.locale.default', saved.code);
      defaultSettingRegistry.setGlobalValue('ui.currency.default', saved.currencyCode);
    }

    await this.auditLogService?.record({
      actor,
      module: SETTINGS_AUDIT_META.MODULE,
      feature: SETTINGS_AUDIT_META.FEATURES.I18N_LOCALES,
      action: 'I18N_LOCALE_UPDATED',
      resourceType: 'i18n_locale',
      resourceId: saved.code,
      beforeData: {
        dateFormat: existing.dateFormat,
        currencyCode: existing.currencyCode,
        isDefault: existing.isDefault,
        status: existing.status,
      },
      afterData: {
        dateFormat: saved.dateFormat,
        currencyCode: saved.currencyCode,
        isDefault: saved.isDefault,
        status: saved.status,
      },
    });

    return mapLocaleMetadataToSummary(saved);
  }

  /** Liệt kê danh sách khung giờ/múi giờ lưu trong Database (`i18n_timezones`) */
  public async listTimezones(query: ListI18nTimezonesQuery = {}): Promise<I18nTimezoneSummary[]> {
    await this.hydrateFromDatabaseSafe();
    let timezones = listRegisteredTimezones(true);
    if (query.status !== undefined) {
      timezones = timezones.filter((t) => t.status === query.status);
    }
    if (query.region?.trim()) {
      const reg = query.region.trim().toLowerCase();
      timezones = timezones.filter((t) => t.region.toLowerCase() === reg);
    }
    if (query.q?.trim()) {
      const kw = query.q.trim().toLowerCase();
      timezones = timezones.filter(
        (t) =>
          t.code.toLowerCase().includes(kw) ||
          t.name.toLowerCase().includes(kw) ||
          t.utcOffset.toLowerCase().includes(kw),
      );
    }
    return timezones.map((t, idx) => mapTimezoneMetadataToSummary(t, idx + 1));
  }

  /** Thêm mới một khung giờ/múi giờ IANA vào Database (`i18n_timezones`) */
  public async createTimezone(
    dto: CreateI18nTimezoneRequest,
    actor?: UserIdentity | null,
  ): Promise<I18nTimezoneSummary> {
    await this.hydrateFromDatabaseSafe();
    const code = dto.code.trim();
    const existing = getRegisteredTimezoneMetadata(code);
    if (existing) {
      throw new ConflictAppException('i18n.timezoneAlreadyExists', [], { code });
    }

    const actorUserId = actor?.id ?? null;

    if (dto.isDefault && this.timezoneRepository) {
      try {
        const allDb = await this.timezoneRepository.findAllOrdered();
        for (const item of allDb) {
          if (item.isDefault) {
            await this.timezoneRepository.saveEntity({ ...item, isDefault: false });
          }
        }
      } catch {
        // Ignore in memory mode
      }
    }

    let savedEntity: I18nTimezoneEntity | null = null;
    if (this.timezoneRepository) {
      try {
        savedEntity = await this.timezoneRepository.saveEntity({
          code,
          name: dto.name.trim(),
          labelsJson: JSON.stringify(dto.labels ?? {}),
          utcOffset: dto.utcOffset.trim(),
          utcOffsetMinutes: dto.utcOffsetMinutes,
          region: dto.region.trim(),
          isDefault: dto.isDefault ?? false,
          isSystem: false,
          sortOrder: dto.sortOrder ?? 10,
          status: (dto.status ?? I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode,
          updatedBy: actorUserId,
        });
      } catch {
        // Fallback to L1 memory
      }
    }

    const registered = upsertRegisteredTimezone({
      id: savedEntity?.id ? Number(savedEntity.id) : ++this.timezoneSeq,
      code,
      name: dto.name.trim(),
      labels: {
        vi: dto.labels?.['vi'] ?? dto.name.trim(),
        en: dto.labels?.['en'] ?? dto.name.trim(),
        ...(dto.labels ?? {}),
      },
      utcOffset: dto.utcOffset.trim(),
      utcOffsetMinutes: dto.utcOffsetMinutes,
      region: dto.region.trim(),
      isDefault: dto.isDefault ?? false,
      isSystem: false,
      sortOrder: dto.sortOrder ?? 10,
      status: (dto.status ?? I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode,
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    });

    if (registered.isDefault && registered.status === I18N_ITEM_STATUS.ACTIVE) {
      defaultSettingRegistry.setGlobalValue('ui.timezone.default', registered.code);
    }

    await this.auditLogService?.record({
      actor,
      module: SETTINGS_AUDIT_META.MODULE,
      feature: SETTINGS_AUDIT_META.FEATURES.I18N_TIMEZONES,
      action: 'I18N_TIMEZONE_CREATED',
      resourceType: 'i18n_timezone',
      resourceId: registered.code,
      afterData: {
        code: registered.code,
        name: registered.name,
        utcOffset: registered.utcOffset,
        isDefault: registered.isDefault,
      },
    });

    return mapTimezoneMetadataToSummary(registered);
  }

  /** Cập nhật khung giờ/múi giờ trong Database (`i18n_timezones`): đổi tên, bật/tắt hoặc đặt làm khung giờ mặc định */
  public async updateTimezone(
    codeParam: string,
    dto: UpdateI18nTimezoneRequest,
    actor?: UserIdentity | null,
  ): Promise<I18nTimezoneSummary> {
    await this.hydrateFromDatabaseSafe();
    const existing = getRegisteredTimezoneMetadata(codeParam);
    if (!existing) {
      throw new NotFoundAppException('i18n.timezoneNotFound', { code: codeParam });
    }

    const nextStatus = (dto.status ?? existing.status) as I18nItemStatusCode;
    const nextIsDefault = dto.isDefault !== undefined ? dto.isDefault : existing.isDefault;

    if (nextIsDefault && nextStatus !== I18N_ITEM_STATUS.ACTIVE) {
      throw new BadRequestAppException('i18n.cannotSetInactiveTimezoneDefault');
    }

    const actorUserId = actor?.id ?? null;

    if (dto.isDefault === true && this.timezoneRepository) {
      try {
        const allDb = await this.timezoneRepository.findAllOrdered();
        for (const item of allDb) {
          if (item.code.toLowerCase() !== existing.code.toLowerCase() && item.isDefault) {
            await this.timezoneRepository.saveEntity({ ...item, isDefault: false });
          }
        }
      } catch {
        // Ignore in memory mode
      }
    }

    const updatedMeta: RegisteredTimezoneMetadata = {
      ...existing,
      name: dto.name?.trim() || existing.name,
      labels: dto.labels ? { ...existing.labels, ...dto.labels } : existing.labels,
      utcOffset: dto.utcOffset?.trim() || existing.utcOffset,
      utcOffsetMinutes: dto.utcOffsetMinutes ?? existing.utcOffsetMinutes,
      region: dto.region?.trim() || existing.region,
      isDefault: nextIsDefault,
      sortOrder: dto.sortOrder ?? existing.sortOrder,
      status: nextStatus,
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    };

    if (this.timezoneRepository) {
      try {
        const dbEntity = await this.timezoneRepository.findByCode(existing.code);
        if (dbEntity) {
          await this.timezoneRepository.saveEntity({
            ...dbEntity,
            name: updatedMeta.name,
            labelsJson: JSON.stringify(updatedMeta.labels),
            utcOffset: updatedMeta.utcOffset,
            utcOffsetMinutes: updatedMeta.utcOffsetMinutes,
            region: updatedMeta.region,
            isDefault: updatedMeta.isDefault,
            sortOrder: updatedMeta.sortOrder,
            status: updatedMeta.status,
            updatedBy: actorUserId,
          });
        }
      } catch {
        // Fallback to L1 memory
      }
    }

    const saved = upsertRegisteredTimezone(updatedMeta);
    if (saved.isDefault && saved.status === I18N_ITEM_STATUS.ACTIVE) {
      defaultSettingRegistry.setGlobalValue('ui.timezone.default', saved.code);
    }

    await this.auditLogService?.record({
      actor,
      module: SETTINGS_AUDIT_META.MODULE,
      feature: SETTINGS_AUDIT_META.FEATURES.I18N_TIMEZONES,
      action: 'I18N_TIMEZONE_UPDATED',
      resourceType: 'i18n_timezone',
      resourceId: saved.code,
      beforeData: {
        isDefault: existing.isDefault,
        status: existing.status,
      },
      afterData: {
        isDefault: saved.isDefault,
        status: saved.status,
      },
    });

    return mapTimezoneMetadataToSummary(saved);
  }

  /** Tra cứu danh sách bản dịch đa ngôn ngữ trong Database (`i18n_translations`) */
  public async listTranslations(
    query: ListI18nTranslationsQuery = {},
  ): Promise<I18nTranslationSummary[]> {
    await this.hydrateFromDatabaseSafe();
    let items = [...this.translationMap.values()];

    if (query.locale?.trim()) {
      const loc = query.locale.trim().toLowerCase();
      items = items.filter((t) => t.locale === loc);
    }
    if (query.namespace?.trim()) {
      const ns = query.namespace.trim().toLowerCase();
      items = items.filter((t) => t.namespace.toLowerCase() === ns);
    }
    if (query.status !== undefined) {
      items = items.filter((t) => t.status === query.status);
    }
    if (query.q?.trim()) {
      const kw = query.q.trim().toLowerCase();
      items = items.filter(
        (t) => t.key.toLowerCase().includes(kw) || t.value.toLowerCase().includes(kw),
      );
    }

    items.sort((a, b) => a.key.localeCompare(b.key) || a.locale.localeCompare(b.locale));
    return items.map((t, idx) => mapTranslationItemToSummary(t, idx + 1));
  }

  /** Thêm mới hoặc cập nhật (Upsert) một bản dịch / thông báo lỗi đa ngôn ngữ trong DB (`i18n_translations`) */
  public async upsertTranslation(
    dto: UpsertI18nTranslationRequest,
    actor?: UserIdentity | null,
  ): Promise<I18nTranslationSummary> {
    await this.hydrateFromDatabaseSafe();
    const locale = dto.locale.trim().toLowerCase();
    const key = dto.key.trim();
    const namespace = (
      dto.namespace?.trim() || (key.includes('.') ? key.split('.')[0]! : 'common')
    ).toLowerCase();
    const value = dto.value;
    const status = (dto.status ?? I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode;
    const actorUserId = actor?.id ?? null;

    const mapKey = `${locale}::${key}`;
    const existing = this.translationMap.get(mapKey);

    let savedEntity: I18nTranslationEntity | null = null;
    if (this.translationRepository) {
      try {
        const dbExisting = await this.translationRepository.findByLocaleAndKey(locale, key);
        savedEntity = await this.translationRepository.saveEntity({
          ...(dbExisting ? { id: dbExisting.id } : {}),
          locale,
          namespace,
          translationKey: key,
          translationValue: value,
          description:
            dto.description !== undefined ? dto.description : (existing?.description ?? null),
          isSystem: existing?.isSystem ?? false,
          status,
          updatedBy: actorUserId,
        });
      } catch {
        // Fallback to L1 memory
      }
    }

    const item: RegisteredTranslationItem = {
      id: savedEntity?.id ? Number(savedEntity.id) : (existing?.id ?? ++this.translationSeq),
      locale,
      namespace,
      key,
      value,
      description:
        dto.description !== undefined ? dto.description : (existing?.description ?? null),
      isSystem: existing?.isSystem ?? false,
      status,
      updatedBy: actorUserId,
      updatedAt: new Date().toISOString(),
    };

    this.translationMap.set(mapKey, item);

    if (status === I18N_ITEM_STATUS.ACTIVE) {
      setRuntimeTranslation(locale, key, value);
      this.i18nService?.upsertTranslation(locale, key, value, namespace);
    } else {
      removeRuntimeTranslation(locale, key);
    }

    await this.auditLogService?.record({
      actor,
      module: SETTINGS_AUDIT_META.MODULE,
      feature: SETTINGS_AUDIT_META.FEATURES.I18N_TRANSLATIONS,
      action: existing ? 'I18N_TRANSLATION_UPDATED' : 'I18N_TRANSLATION_CREATED',
      resourceType: 'i18n_translation',
      resourceId: `${locale}:${key}`,
      beforeData: existing ? { value: existing.value, status: existing.status } : null,
      afterData: { locale, namespace, key, value, status },
    });

    return mapTranslationItemToSummary(item);
  }
}
