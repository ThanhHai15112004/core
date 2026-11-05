export const I18N_MANAGEMENT_PUBLIC_SERVICE = Symbol('I18N_MANAGEMENT_PUBLIC_SERVICE');
export const LOCALIZATION_PUBLIC_SERVICE = I18N_MANAGEMENT_PUBLIC_SERVICE;

export interface I18nLocaleSummary {
  readonly id: number;
  readonly code: string;
  readonly bcp47Tag: string;
  readonly name: string;
  readonly nativeName: string;
  readonly direction: 'ltr' | 'rtl';
  readonly dateFormat: string;
  readonly datetimeFormat: string;
  readonly currencyCode: string;
  readonly numberDecimalSeparator: string;
  readonly numberGroupSeparator: string;
  readonly isDefault: boolean;
  readonly isSystem: boolean;
  readonly sortOrder: number;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface I18nTimezoneSummary {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly labels: Record<string, string>;
  readonly utcOffset: string;
  readonly utcOffsetMinutes: number;
  readonly region: string;
  readonly isDefault: boolean;
  readonly isSystem: boolean;
  readonly sortOrder: number;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface I18nTranslationSummary {
  readonly id: number;
  readonly locale: string;
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

export interface SyncI18nResult {
  readonly totalLocales: number;
  readonly totalTimezones: number;
  readonly totalTranslations: number;
}

export interface II18nManagementPublicService {
  syncDatabaseCatalog(): Promise<SyncI18nResult>;
  listLocales(query?: { status?: number }): Promise<I18nLocaleSummary[]>;
  listTimezones(query?: {
    status?: number;
    region?: string;
    q?: string;
  }): Promise<I18nTimezoneSummary[]>;
  listTranslations(query?: {
    locale?: string;
    namespace?: string;
    status?: number;
    q?: string;
  }): Promise<I18nTranslationSummary[]>;
}

export type ILocalizationPublicService = II18nManagementPublicService;
