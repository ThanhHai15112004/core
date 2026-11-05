import { z } from 'zod';
import { intQueryParam, optionalQueryParam } from '@packages/http/index.js';
import { I18N_ITEM_STATUS } from '@packages/i18n/index.js';

const i18nStatusSchema = z.union([
  z.literal(I18N_ITEM_STATUS.ACTIVE),
  z.literal(I18N_ITEM_STATUS.INACTIVE),
]);

const validateIanaTzString = (tz: string): boolean => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
};

export const listI18nLocalesQuerySchema = z.object({
  status: intQueryParam({ min: 1, max: 2 }).optional(),
});

export type ListI18nLocalesQuery = z.infer<typeof listI18nLocalesQuerySchema>;

export const createI18nLocaleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/, 'Invalid locale code (e.g., vi, en, ja, ko)'),
  bcp47Tag: z.string().trim().min(2).max(32).optional(),
  name: z.string().trim().min(2).max(100),
  nativeName: z.string().trim().min(1).max(100),
  direction: z.enum(['ltr', 'rtl']).default('ltr'),
  dateFormat: z.string().trim().min(4).max(32).default('dd/MM/yyyy'),
  datetimeFormat: z.string().trim().min(8).max(64).default('dd/MM/yyyy HH:mm:ss'),
  currencyCode: z.string().trim().min(3).max(16).default('VND'),
  numberDecimalSeparator: z.string().trim().min(1).max(4).default(','),
  numberGroupSeparator: z.string().trim().min(1).max(4).default('.'),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(10),
  status: i18nStatusSchema.default(I18N_ITEM_STATUS.ACTIVE),
});

export type CreateI18nLocaleRequest = z.infer<typeof createI18nLocaleSchema>;

export const updateI18nLocaleSchema = z.object({
  bcp47Tag: z.string().trim().min(2).max(32).optional(),
  name: z.string().trim().min(2).max(100).optional(),
  nativeName: z.string().trim().min(1).max(100).optional(),
  direction: z.enum(['ltr', 'rtl']).optional(),
  dateFormat: z.string().trim().min(4).max(32).optional(),
  datetimeFormat: z.string().trim().min(8).max(64).optional(),
  currencyCode: z.string().trim().min(3).max(16).optional(),
  numberDecimalSeparator: z.string().trim().min(1).max(4).optional(),
  numberGroupSeparator: z.string().trim().min(1).max(4).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  status: i18nStatusSchema.optional(),
});

export type UpdateI18nLocaleRequest = z.infer<typeof updateI18nLocaleSchema>;

export const listI18nTimezonesQuerySchema = z.object({
  status: intQueryParam({ min: 1, max: 2 }).optional(),
  region: optionalQueryParam(z.string().trim().max(64)),
  q: optionalQueryParam(z.string().trim().max(100)),
});

export type ListI18nTimezonesQuery = z.infer<typeof listI18nTimezonesQuerySchema>;

export const createI18nTimezoneSchema = z.object({
  code: z.string().trim().min(2).max(64).refine(validateIanaTzString, {
    message: 'Invalid IANA timezone identifier (e.g., Asia/Ho_Chi_Minh, UTC, Asia/Tokyo)',
  }),
  name: z.string().trim().min(2).max(150),
  labels: z.record(z.string(), z.string()).default({}),
  utcOffset: z
    .string()
    .trim()
    .regex(/^[+-]\d{2}:\d{2}$/, 'utcOffset must match ±HH:mm (e.g., +07:00, +00:00, -05:00)'),
  utcOffsetMinutes: z.number().int().min(-840).max(840),
  region: z.string().trim().min(2).max(64).default('Asia'),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(10),
  status: i18nStatusSchema.default(I18N_ITEM_STATUS.ACTIVE),
});

export type CreateI18nTimezoneRequest = z.infer<typeof createI18nTimezoneSchema>;

export const updateI18nTimezoneSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  utcOffset: z
    .string()
    .trim()
    .regex(/^[+-]\d{2}:\d{2}$/)
    .optional(),
  utcOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  region: z.string().trim().min(2).max(64).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  status: i18nStatusSchema.optional(),
});

export type UpdateI18nTimezoneRequest = z.infer<typeof updateI18nTimezoneSchema>;

export const listI18nTranslationsQuerySchema = z.object({
  locale: optionalQueryParam(z.string().trim().max(16)),
  namespace: optionalQueryParam(z.string().trim().max(64)),
  status: intQueryParam({ min: 1, max: 2 }).optional(),
  q: optionalQueryParam(z.string().trim().max(150)),
});

export type ListI18nTranslationsQuery = z.infer<typeof listI18nTranslationsQuerySchema>;

export const upsertI18nTranslationSchema = z.object({
  locale: z.string().trim().min(2).max(16),
  namespace: z.string().trim().min(1).max(64).default('common'),
  key: z.string().trim().min(1).max(191),
  value: z.string().min(1).max(4000),
  description: z.string().trim().max(255).nullable().optional(),
  status: i18nStatusSchema.default(I18N_ITEM_STATUS.ACTIVE),
});

export type UpsertI18nTranslationRequest = z.infer<typeof upsertI18nTranslationSchema>;
