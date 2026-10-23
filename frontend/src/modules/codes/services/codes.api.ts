import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  BulkImportCodesResult,
  CodeTypeSummaryItem,
  CodeValueUsageCheckResult,
  CreateCodeTypePayload,
  CreateCodeValuePayload,
  ExportCodesResult,
  ResolvedCodeValueItem,
  SyncCodesResult,
  UpdateCodeTypePayload,
  UpdateCodeValuePayload,
} from '../types/codes.types';

export const codesApi = {
  listCodeTypes(params?: {
    module?: string;
    search?: string;
    includeValues?: boolean;
  }): Promise<CodeTypeSummaryItem[]> {
    const qs = new URLSearchParams();
    if (params?.module) qs.set('module', params.module);
    if (params?.search) qs.set('search', params.search);
    if (params?.includeValues) qs.set('includeValues', 'true');
    return fetchApi<CodeTypeSummaryItem[]>(API_ROUTES.CODES.LIST_TYPES(qs.toString()));
  },

  syncManifests(): Promise<SyncCodesResult> {
    return fetchApi<SyncCodesResult>(API_ROUTES.CODES.SYNC, {
      method: 'POST',
    });
  },

  createCodeType(payload: CreateCodeTypePayload): Promise<CodeTypeSummaryItem> {
    return fetchApi<CodeTypeSummaryItem>(API_ROUTES.CODES.CREATE_TYPE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateCodeType(typeCode: string, payload: UpdateCodeTypePayload): Promise<CodeTypeSummaryItem> {
    return fetchApi<CodeTypeSummaryItem>(API_ROUTES.CODES.UPDATE_TYPE(typeCode), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  listCodeValues(
    typeCode: string,
    includeInactive = true,
  ): Promise<ResolvedCodeValueItem[]> {
    const qs = new URLSearchParams({ includeInactive: String(includeInactive) });
    return fetchApi<ResolvedCodeValueItem[]>(API_ROUTES.CODES.VALUES(typeCode, qs.toString()));
  },

  createCodeValue(
    typeCode: string,
    payload: CreateCodeValuePayload,
  ): Promise<ResolvedCodeValueItem> {
    return fetchApi<ResolvedCodeValueItem>(API_ROUTES.CODES.VALUES(typeCode), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateCodeValue(
    typeCode: string,
    numericCode: number,
    payload: UpdateCodeValuePayload,
  ): Promise<ResolvedCodeValueItem> {
    return fetchApi<ResolvedCodeValueItem>(
      API_ROUTES.CODES.VALUE_BY_NUMERIC(typeCode, numericCode),
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
    );
  },

  deleteCodeValue(
    typeCode: string,
    numericCode: number,
  ): Promise<{ deleted: true; typeCode: string; numericCode: number; code: string }> {
    return fetchApi(API_ROUTES.CODES.VALUE_BY_NUMERIC(typeCode, numericCode), {
      method: 'DELETE',
    });
  },

  checkCodeValueUsage(
    typeCode: string,
    numericCode: number,
  ): Promise<CodeValueUsageCheckResult> {
    return fetchApi<CodeValueUsageCheckResult>(
      API_ROUTES.CODES.VALUE_USAGE(typeCode, numericCode),
    );
  },

  exportCodes(params?: {
    format?: 'csv' | 'xlsx';
    module?: string;
    typeCode?: string;
    includeInactive?: boolean;
  }): Promise<ExportCodesResult> {
    const qs = new URLSearchParams();
    if (params?.format) qs.set('format', params.format);
    if (params?.module) qs.set('module', params.module);
    if (params?.typeCode) qs.set('typeCode', params.typeCode);
    if (params?.includeInactive !== undefined) {
      qs.set('includeInactive', String(params.includeInactive));
    }
    return fetchApi<ExportCodesResult>(API_ROUTES.CODES.EXPORT(qs.toString()));
  },

  downloadImportTemplate(format: 'csv' | 'xlsx' = 'xlsx'): Promise<ExportCodesResult> {
    return fetchApi<ExportCodesResult>(API_ROUTES.CODES.IMPORT_TEMPLATE(format));
  },

  bulkImportCodes(payload: {
    typeCode?: string;
    csvContent?: string;
    xlsxBase64?: string;
    skipDuplicates?: boolean;
  }): Promise<BulkImportCodesResult> {
    return fetchApi<BulkImportCodesResult>(API_ROUTES.CODES.IMPORT, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

