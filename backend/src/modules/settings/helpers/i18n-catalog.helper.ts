import { defaultSettingRegistry, safeJsonParseObject } from '@packages/kernel/index.js';
import {
  type CoreI18nService,
  I18N_ITEM_STATUS,
  type I18nItemStatusCode,
  type RegisteredLocaleMetadata,
  type RegisteredTimezoneMetadata,
  type RegisteredTranslationItem,
  STANDARD_BOOTSTRAP_LOCALES,
  STANDARD_BOOTSTRAP_TIMEZONES,
  getInitialStaticDictionaries,
  getRegisteredLocaleMetadata,
  getRegisteredTimezoneMetadata,
  listRegisteredLocales,
  listRegisteredTimezones,
  removeRuntimeTranslation,
  setRuntimeTranslation,
  upsertRegisteredLocale,
  upsertRegisteredTimezone,
} from '@packages/i18n/index.js';
import type {
  I18nLocaleSummary,
  I18nTimezoneSummary,
  I18nTranslationSummary,
  SyncI18nResult,
} from '../contracts/index.js';
import type { I18nLocaleEntity } from '../entities/i18n-locale.entity.js';
import type { I18nTimezoneEntity } from '../entities/i18n-timezone.entity.js';
import type { I18nTranslationEntity } from '../entities/i18n-translation.entity.js';
import type { I18nLocaleRepository } from '../repositories/i18n-locale.repository.js';
import type { I18nTimezoneRepository } from '../repositories/i18n-timezone.repository.js';
import type { I18nTranslationRepository } from '../repositories/i18n-translation.repository.js';

export function seedInMemoryTranslationsFromStaticDictionaries(
  translationMap: Map<string, RegisteredTranslationItem>,
  nextTranslationId: () => number,
): void {
  const staticDicts = getInitialStaticDictionaries();
  for (const [locale, dict] of Object.entries(staticDicts)) {
    for (const [key, value] of Object.entries(dict)) {
      const namespace = key.includes('.') ? key.split('.')[0]! : 'common';
      const mapKey = `${locale}::${key}`;
      if (!translationMap.has(mapKey)) {
        translationMap.set(mapKey, {
          id: nextTranslationId(),
          locale,
          namespace,
          key,
          value,
          description: null,
          isSystem: true,
          status: I18N_ITEM_STATUS.ACTIVE,
          updatedBy: null,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }
}

export function mapLocaleEntityToMetadata(entity: I18nLocaleEntity): RegisteredLocaleMetadata {
  return {
    id: Number(entity.id),
    code: entity.code.trim().toLowerCase(),
    bcp47Tag: entity.bcp47Tag,
    name: entity.name,
    nativeName: entity.nativeName,
    direction: entity.direction === 'rtl' ? 'rtl' : 'ltr',
    dateFormat: entity.dateFormat,
    datetimeFormat: entity.datetimeFormat,
    currencyCode: entity.currencyCode,
    numberDecimalSeparator: entity.numberDecimalSeparator,
    numberGroupSeparator: entity.numberGroupSeparator,
    isDefault: Boolean(entity.isDefault),
    isSystem: Boolean(entity.isSystem),
    sortOrder: Number(entity.sortOrder ?? 1),
    status: (entity.status ?? I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode,
    updatedBy: entity.updatedBy ?? null,
    updatedAt: (entity.updatedAt ?? new Date()).toISOString(),
  };
}

export function mapTimezoneEntityToMetadata(
  entity: I18nTimezoneEntity,
): RegisteredTimezoneMetadata {
  const parsedLabels = safeJsonParseObject<Record<string, string>>(entity.labelsJson, {});
  return {
    id: Number(entity.id),
    code: entity.code.trim(),
    name: entity.name,
    labels: parsedLabels,
    utcOffset: entity.utcOffset,
    utcOffsetMinutes: Number(entity.utcOffsetMinutes ?? 0),
    region: entity.region,
    isDefault: Boolean(entity.isDefault),
    isSystem: Boolean(entity.isSystem),
    sortOrder: Number(entity.sortOrder ?? 1),
    status: (entity.status ?? I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode,
    updatedBy: entity.updatedBy ?? null,
    updatedAt: (entity.updatedAt ?? new Date()).toISOString(),
  };
}

export function mapTranslationEntityToItem(
  entity: I18nTranslationEntity,
): RegisteredTranslationItem {
  return {
    id: Number(entity.id),
    locale: entity.locale.trim().toLowerCase(),
    namespace: entity.namespace.trim().toLowerCase(),
    key: entity.translationKey.trim(),
    value: entity.translationValue,
    description: entity.description ?? null,
    isSystem: Boolean(entity.isSystem),
    status: (entity.status ?? I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode,
    updatedBy: entity.updatedBy ?? null,
    updatedAt: (entity.updatedAt ?? new Date()).toISOString(),
  };
}

export function mapLocaleMetadataToSummary(
  meta: RegisteredLocaleMetadata,
  fallbackId = 1,
): I18nLocaleSummary {
  return {
    id: meta.id ?? fallbackId,
    code: meta.code,
    bcp47Tag: meta.bcp47Tag,
    name: meta.name,
    nativeName: meta.nativeName,
    direction: meta.direction,
    dateFormat: meta.dateFormat,
    datetimeFormat: meta.datetimeFormat,
    currencyCode: meta.currencyCode,
    numberDecimalSeparator: meta.numberDecimalSeparator,
    numberGroupSeparator: meta.numberGroupSeparator,
    isDefault: meta.isDefault,
    isSystem: meta.isSystem,
    sortOrder: meta.sortOrder,
    status: meta.status,
    statusName: meta.status === I18N_ITEM_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
    updatedBy: meta.updatedBy ?? null,
    updatedAt: meta.updatedAt ?? new Date().toISOString(),
  };
}

export function mapTimezoneMetadataToSummary(
  meta: RegisteredTimezoneMetadata,
  fallbackId = 1,
): I18nTimezoneSummary {
  return {
    id: meta.id ?? fallbackId,
    code: meta.code,
    name: meta.name,
    labels: meta.labels,
    utcOffset: meta.utcOffset,
    utcOffsetMinutes: meta.utcOffsetMinutes,
    region: meta.region,
    isDefault: meta.isDefault,
    isSystem: meta.isSystem,
    sortOrder: meta.sortOrder,
    status: meta.status,
    statusName: meta.status === I18N_ITEM_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
    updatedBy: meta.updatedBy ?? null,
    updatedAt: meta.updatedAt ?? new Date().toISOString(),
  };
}

export function mapTranslationItemToSummary(
  item: RegisteredTranslationItem,
  fallbackId = 1,
): I18nTranslationSummary {
  return {
    id: item.id ?? fallbackId,
    locale: item.locale,
    namespace: item.namespace,
    key: item.key,
    value: item.value,
    description: item.description ?? null,
    isSystem: item.isSystem,
    status: item.status,
    statusName: item.status === I18N_ITEM_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
    updatedBy: item.updatedBy ?? null,
    updatedAt: item.updatedAt ?? new Date().toISOString(),
  };
}

export async function hydrateI18nCatalogFromDatabase(params: {
  localeRepository?: I18nLocaleRepository | null | undefined;
  timezoneRepository?: I18nTimezoneRepository | null | undefined;
  translationRepository?: I18nTranslationRepository | null | undefined;
  translationMap: Map<string, RegisteredTranslationItem>;
  i18nService?: CoreI18nService | null | undefined;
}): Promise<void> {
  const {
    localeRepository,
    timezoneRepository,
    translationRepository,
    translationMap,
    i18nService,
  } = params;

  if (localeRepository) {
    try {
      const dbLocales = await localeRepository.findAllOrdered();
      for (const entity of dbLocales) {
        const meta = mapLocaleEntityToMetadata(entity);
        upsertRegisteredLocale(meta);
        if (meta.isDefault && meta.status === I18N_ITEM_STATUS.ACTIVE) {
          defaultSettingRegistry.setGlobalValue('ui.locale.default', meta.code);
        }
      }
    } catch {
      // Fallback to in-memory registry
    }
  }

  if (timezoneRepository) {
    try {
      const dbTimezones = await timezoneRepository.findAllOrdered();
      for (const entity of dbTimezones) {
        const meta = mapTimezoneEntityToMetadata(entity);
        upsertRegisteredTimezone(meta);
        if (meta.isDefault && meta.status === I18N_ITEM_STATUS.ACTIVE) {
          defaultSettingRegistry.setGlobalValue('ui.timezone.default', meta.code);
        }
      }
    } catch {
      // Fallback to in-memory registry
    }
  }

  if (translationRepository) {
    try {
      const dbTranslations = await translationRepository.findFiltered();
      for (const entity of dbTranslations) {
        const item = mapTranslationEntityToItem(entity);
        translationMap.set(`${item.locale}::${item.key}`, item);
        if (item.status === I18N_ITEM_STATUS.ACTIVE) {
          setRuntimeTranslation(item.locale, item.key, item.value);
          i18nService?.upsertTranslation(item.locale, item.key, item.value, item.namespace);
        } else {
          removeRuntimeTranslation(item.locale, item.key);
        }
      }
    } catch {
      // Fallback to in-memory registry
    }
  }
}

export async function syncI18nDatabaseCatalog(params: {
  localeRepository?: I18nLocaleRepository | null | undefined;
  timezoneRepository?: I18nTimezoneRepository | null | undefined;
  translationRepository?: I18nTranslationRepository | null | undefined;
  translationMap: Map<string, RegisteredTranslationItem>;
  i18nService?: CoreI18nService | null | undefined;
}): Promise<SyncI18nResult> {
  const { localeRepository, timezoneRepository, translationRepository, translationMap } = params;
  let totalLocales = 0;
  let totalTimezones = 0;
  let totalTranslations = 0;

  for (const loc of STANDARD_BOOTSTRAP_LOCALES) {
    if (!localeRepository) {
      if (!getRegisteredLocaleMetadata(loc.code)) {
        upsertRegisteredLocale(loc);
      }
    } else {
      try {
        const existing = await localeRepository.findByCode(loc.code);
        if (!existing) {
          await localeRepository.saveEntity({
            code: loc.code,
            bcp47Tag: loc.bcp47Tag,
            name: loc.name,
            nativeName: loc.nativeName,
            direction: loc.direction,
            dateFormat: loc.dateFormat,
            datetimeFormat: loc.datetimeFormat,
            currencyCode: loc.currencyCode,
            numberDecimalSeparator: loc.numberDecimalSeparator,
            numberGroupSeparator: loc.numberGroupSeparator,
            isDefault: loc.isDefault,
            isSystem: loc.isSystem,
            sortOrder: loc.sortOrder,
            status: loc.status,
          });
        }
      } catch {
        // Ignore if DB table not ready
      }
    }
    totalLocales++;
  }

  for (const tz of STANDARD_BOOTSTRAP_TIMEZONES) {
    if (!timezoneRepository) {
      if (!getRegisteredTimezoneMetadata(tz.code)) {
        upsertRegisteredTimezone(tz);
      }
    } else {
      try {
        const existing = await timezoneRepository.findByCode(tz.code);
        if (!existing) {
          await timezoneRepository.saveEntity({
            code: tz.code,
            name: tz.name,
            labelsJson: JSON.stringify(tz.labels),
            utcOffset: tz.utcOffset,
            utcOffsetMinutes: tz.utcOffsetMinutes,
            region: tz.region,
            isDefault: tz.isDefault,
            isSystem: tz.isSystem,
            sortOrder: tz.sortOrder,
            status: tz.status,
          });
        }
      } catch {
        // Ignore if DB table not ready
      }
    }
    totalTimezones++;
  }

  if (translationRepository) {
    for (const item of translationMap.values()) {
      try {
        const existing = await translationRepository.findByLocaleAndKey(item.locale, item.key);
        if (!existing) {
          await translationRepository.saveEntity({
            locale: item.locale,
            namespace: item.namespace,
            translationKey: item.key,
            translationValue: item.value,
            description: item.description ?? null,
            isSystem: item.isSystem,
            status: item.status,
          });
        }
      } catch {
        // Ignore if DB table not ready
      }
      totalTranslations++;
    }
  } else {
    totalTranslations = translationMap.size;
  }

  await hydrateI18nCatalogFromDatabase(params);

  return {
    totalLocales: listRegisteredLocales(true).length || totalLocales,
    totalTimezones: listRegisteredTimezones(true).length || totalTimezones,
    totalTranslations: translationMap.size || totalTranslations,
  };
}
