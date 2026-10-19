import type {
  CodeItemStatusCode,
  CodeTypeManifestItem,
  ResolvedCodeValueView,
} from '@packages/kernel/index.js';

export {
  CODE_ITEM_STATUS,
  type CodeItemStatusCode,
  type CodeTypeManifestItem,
  type CodeValueManifestItem,
  type ResolvedCodeValueView,
} from '@packages/kernel/index.js';

export interface CodeTypeSummary {
  readonly id: number;
  readonly code: string;
  readonly module: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly allowCustomValues: boolean;
  readonly status: CodeItemStatusCode;
  readonly totalValues: number;
  readonly values?: readonly ResolvedCodeValueView[];
}

export interface SyncCodesResult {
  readonly syncedModules: readonly string[];
  readonly totalCodeTypes: number;
  readonly createdTypesCount: number;
  readonly updatedTypesCount: number;
  readonly totalCodeValues: number;
  readonly createdValuesCount: number;
  readonly updatedValuesCount: number;
}

export interface ICodesPublicService {
  getBootstrapDictionary(params?: {
    locale?: string | undefined;
    module?: string | undefined;
    includeInactive?: boolean | undefined;
  }): Promise<{
    locale: string;
    totalTypes: number;
    dictionary: Record<string, ResolvedCodeValueView[]>;
  }>;
  listCodeTypes(params?: {
    module?: string | undefined;
    search?: string | undefined;
    includeValues?: boolean | undefined;
    locale?: string | undefined;
  }): Promise<CodeTypeSummary[]>;
  listCodeValues(
    typeCode: string,
    params?: {
      includeInactive?: boolean | undefined;
      locale?: string | undefined;
    },
  ): Promise<ResolvedCodeValueView[]>;
  syncManifests(customCodeTypes?: readonly CodeTypeManifestItem[]): Promise<SyncCodesResult>;
}

export const CODES_PUBLIC_SERVICE = Symbol('CODES_PUBLIC_SERVICE');
