export interface ResolvedCodeValueItem {
  typeCode: string;
  numericCode: number;
  code: string;
  behaviorCode: string | null;
  name: string;
  label: string;
  description: string | null;
  labels: Record<string, string>;
  aliases: string[];
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
  isSystem: boolean;
  metadata: Record<string, unknown> | null;
  status: number;
}

export interface CodeTypeSummaryItem {
  id: number;
  code: string;
  module: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  allowCustomValues: boolean;
  status: number;
  totalValues: number;
  values?: ResolvedCodeValueItem[];
}

export interface SyncCodesResult {
  syncedModules: string[];
  totalCodeTypes: number;
  createdTypesCount: number;
  updatedTypesCount: number;
  totalCodeValues: number;
  createdValuesCount: number;
  updatedValuesCount: number;
}

export interface CodeValueUsageCheckResult {
  typeCode: string;
  numericCode: number;
  code: string;
  inUse: boolean;
  totalUsageCount: number;
  details: Array<{
    module: string;
    entity: string;
    field?: string;
    count: number;
  }>;
}

export interface ExportCodesResult {
  fileName: string;
  contentType: string;
  format: 'csv' | 'xlsx';
  totalExported: number;
  csvContent: string;
  xlsxBase64: string;
}

export interface BulkImportCodesResult {
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  importedCodes: string[];
  errors: Array<{
    row: number;
    identifier: string;
    message: string;
  }>;
}

export interface CreateCodeTypePayload {
  code: string;
  module?: string;
  name: string;
  description?: string | null;
  allowCustomValues?: boolean;
  status?: number;
}

export interface UpdateCodeTypePayload {
  name?: string;
  description?: string | null;
  allowCustomValues?: boolean;
  status?: number;
}

export interface CreateCodeValuePayload {
  numericCode?: number;
  code: string;
  behaviorCode?: string | null;
  name: string;
  description?: string | null;
  labels?: Record<string, string>;
  aliases?: string[];
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
  isDefault?: boolean;
  status?: number;
}

export interface UpdateCodeValuePayload {
  code?: string;
  behaviorCode?: string | null;
  name?: string;
  description?: string | null;
  labels?: Record<string, string>;
  aliases?: string[];
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
  isDefault?: boolean;
  status?: number;
}

