import type {
  CodeRegistryService,
  CodeTypeManifestItem,
  ResolvedCodeValueView,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import type { CodeTypeSummary } from '../contracts/index.js';
import type { CodeTypeRepository } from '../repositories/code-type.repository.js';
import type { CodeValueRepository } from '../repositories/code-value.repository.js';
import type {
  BulkImportCodesRequest,
  CreateCodeValueRequest,
  ExportCodesQuery,
} from '../requests/codes.requests.js';

export interface CodeRegistryRefreshParams {
  codeTypeRepository: CodeTypeRepository;
  codeValueRepository: CodeValueRepository;
  registry: CodeRegistryService;
  manifestCodeTypes: ReadonlyMap<string, CodeTypeManifestItem>;
}

export interface SingleCodeTypeRefreshParams extends CodeRegistryRefreshParams {
  typeCode: string;
}

export interface SyncDeclaredCodeTypesParams extends CodeRegistryRefreshParams {
  allDeclared: readonly CodeTypeManifestItem[];
}

export interface ExecuteBulkImportCodesParams extends CodeRegistryRefreshParams {
  dto: BulkImportCodesRequest;
  fallbackTypeCode: string;
  settingRegistry?: SettingRegistryService | undefined;
  syncManifests: () => Promise<unknown>;
  createCodeValue: (
    typeCode: string,
    dto: CreateCodeValueRequest,
  ) => Promise<ResolvedCodeValueView>;
}

export interface BuildCodesExportPayloadParams {
  registry: CodeRegistryService;
  settingRegistry?: SettingRegistryService | undefined;
  allTypes: readonly CodeTypeSummary[];
  query: Partial<ExportCodesQuery>;
  locale?: string | undefined;
}

export interface CodeTypeSummaryBuildOptions {
  locale?: string | undefined;
  includeValues?: boolean | undefined;
}
