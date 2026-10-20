import { scanModuleManifests } from './manifest.contract.js';

export type CodeBadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const CODE_ITEM_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type CodeItemStatusCode = (typeof CODE_ITEM_STATUS)[keyof typeof CODE_ITEM_STATUS];

export interface CodeValueManifestItem {
  readonly numericCode: number;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly labels?: Readonly<Record<string, string>> | null | undefined;
  readonly aliases?: readonly string[] | null | undefined;
  readonly behaviorCode?: string | null | undefined;
  readonly badgeTone?: CodeBadgeTone | undefined;
  readonly color?: string | null | undefined;
  readonly icon?: string | null | undefined;
  readonly sortOrder?: number | undefined;
  readonly isDefault?: boolean | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | null | undefined;
  readonly isSystem?: boolean | undefined;
  readonly status?: number | undefined;
}

export interface CodeTypeManifestItem {
  readonly code: string;
  readonly module?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly isSystem?: boolean | undefined;
  readonly allowCustomValues?: boolean | undefined;
  readonly status?: number | undefined;
  readonly values?: readonly CodeValueManifestItem[] | undefined;
}

export interface RegisteredCodeValue {
  id?: number | undefined;
  typeCode: string;
  numericCode: number;
  code: string;
  name: string;
  description: string | null;
  labels: Record<string, string>;
  aliases: string[];
  behaviorCode: string | null;
  badgeTone: CodeBadgeTone;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
  metadata: Record<string, unknown> | null;
  isSystem: boolean;
  status: number;
}

export interface RegisteredCodeType {
  id?: number | undefined;
  code: string;
  module: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  allowCustomValues: boolean;
  status: CodeItemStatusCode;
  valuesByNumericCode: Map<number, RegisteredCodeValue>;
  valuesByCode: Map<string, RegisteredCodeValue>;
}

export interface ResolvedCodeValueView {
  readonly typeCode: string;
  readonly numericCode: number;
  readonly code: string;
  readonly name: string;
  readonly label: string;
  readonly displayLabel: string;
  readonly description: string | null;
  readonly labels: Record<string, string>;
  readonly aliases: string[];
  readonly behaviorCode: string | null;
  readonly badgeTone: CodeBadgeTone;
  readonly color: string | null;
  readonly icon: string | null;
  readonly sortOrder: number;
  readonly isDefault: boolean;
  readonly metadata: Record<string, unknown> | null;
  readonly isSystem: boolean;
  readonly status: number;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
}

export type CodeI18nTranslator = (key: string, locale?: string) => string | undefined;
export type CodeI18nResolver = (
  typeCode: string,
  valueCode: string,
  locale: string,
) => string | undefined;

export interface CodeValueUsageSource {
  readonly source: string;
  readonly count: number;
}

export interface CodeValueUsageCheckResult {
  readonly typeCode: string;
  readonly numericCode: number;
  readonly code: string;
  readonly inUse: boolean;
  readonly totalUsageCount: number;
  readonly details: readonly CodeValueUsageSource[];
}

export type CodeValueUsageChecker = (params: {
  typeCode: string;
  numericCode: number;
  code: string;
}) => Promise<number> | number;

/**
 * Quét tự động (Zero-Hardcode, 100% Domain-Agnostic) các tệp `module.manifest.json`
 * trong `modules/*` và `project-modules/*` để thu thập `codeTypes` phục vụ Seeder và L1 Fallback.
 */
export function discoverManifestCodeTypes(): CodeTypeManifestItem[] {
  const discovered = new Map<string, CodeTypeManifestItem>();

  for (const { moduleName, raw } of scanModuleManifests<{
    name?: string;
    codeTypes?: CodeTypeManifestItem[];
  }>()) {
    if (Array.isArray(raw.codeTypes)) {
      for (const ct of raw.codeTypes) {
        if (!ct?.code) continue;
        const normalizedCode = ct.code.trim().toLowerCase();
        discovered.set(normalizedCode, {
          ...ct,
          code: normalizedCode,
          module: (ct.module || moduleName).trim().toLowerCase(),
        });
      }
    }
  }

  return [...discovered.values()];
}
