import { z } from 'zod';

export const i18nLocaleResponseSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  bcp47Tag: z.string(),
  name: z.string(),
  nativeName: z.string(),
  direction: z.enum(['ltr', 'rtl']),
  dateFormat: z.string(),
  datetimeFormat: z.string(),
  currencyCode: z.string(),
  numberDecimalSeparator: z.string(),
  numberGroupSeparator: z.string(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
  status: z.number().int(),
  statusName: z.enum(['ACTIVE', 'INACTIVE']),
  updatedBy: z.number().int().nullable(),
  updatedAt: z.string(),
});

export const i18nTimezoneResponseSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
  labels: z.record(z.string(), z.string()),
  utcOffset: z.string(),
  utcOffsetMinutes: z.number().int(),
  region: z.string(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
  status: z.number().int(),
  statusName: z.enum(['ACTIVE', 'INACTIVE']),
  updatedBy: z.number().int().nullable(),
  updatedAt: z.string(),
});

export const i18nTranslationResponseSchema = z.object({
  id: z.number().int(),
  locale: z.string(),
  namespace: z.string(),
  key: z.string(),
  value: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  status: z.number().int(),
  statusName: z.enum(['ACTIVE', 'INACTIVE']),
  updatedBy: z.number().int().nullable(),
  updatedAt: z.string(),
});

export const syncI18nResultResponseSchema = z.object({
  totalLocales: z.number().int(),
  totalTimezones: z.number().int(),
  totalTranslations: z.number().int(),
});
