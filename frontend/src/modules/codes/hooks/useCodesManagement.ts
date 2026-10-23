import { useCallback, useEffect, useState } from 'react';
import { codesApi } from '../services/codes.api';
import type {
  BulkImportCodesResult,
  CodeTypeSummaryItem,
  CodeValueUsageCheckResult,
  CreateCodeTypePayload,
  CreateCodeValuePayload,
  ResolvedCodeValueItem,
  UpdateCodeTypePayload,
  UpdateCodeValuePayload,
} from '../types/codes.types';

export function useCodesManagement() {
  const [codeTypes, setCodeTypes] = useState<CodeTypeSummaryItem[]>([]);
  const [selectedType, setSelectedType] = useState<CodeTypeSummaryItem | null>(null);
  const [codeValues, setCodeValues] = useState<ResolvedCodeValueItem[]>([]);

  const [moduleFilter, setModuleFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [includeInactive, setIncludeInactive] = useState<boolean>(true);

  const [loadingTypes, setLoadingTypes] = useState<boolean>(false);
  const [loadingValues, setLoadingValues] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const [usageResult, setUsageResult] = useState<CodeValueUsageCheckResult | null>(null);
  const [importResult, setImportResult] = useState<BulkImportCodesResult | null>(null);

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
  }, []);

  const loadCodeTypes = useCallback(async () => {
    setLoadingTypes(true);
    try {
      const items = await codesApi.listCodeTypes({
        module: moduleFilter || undefined,
        search: searchFilter.trim() || undefined,
      });
      setCodeTypes(items);
      setSelectedType((prev) => {
        if (prev) {
          const matched = items.find((t) => t.code === prev.code);
          if (matched) return matched;
        }
        return items[0] ?? null;
      });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Không thể tải danh sách nhóm danh mục');
    } finally {
      setLoadingTypes(false);
    }
  }, [moduleFilter, searchFilter, notify]);

  const loadCodeValues = useCallback(
    async (typeCode: string) => {
      setLoadingValues(true);
      try {
        const items = await codesApi.listCodeValues(typeCode, includeInactive);
        setCodeValues(items);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Không thể tải danh sách giá trị mã');
      } finally {
        setLoadingValues(false);
      }
    },
    [includeInactive, notify],
  );

  useEffect(() => {
    void loadCodeTypes();
  }, [loadCodeTypes]);

  useEffect(() => {
    if (selectedType?.code) {
      void loadCodeValues(selectedType.code);
      setUsageResult(null);
    } else {
      setCodeValues([]);
    }
  }, [selectedType?.code, loadCodeValues]);

  const handleSyncManifests = async () => {
    setSubmitting(true);
    try {
      const res = await codesApi.syncManifests();
      notify(
        'success',
        `Đã đồng bộ ${res.totalCodeTypes} nhóm mã (${res.totalCodeValues} giá trị) từ ${res.syncedModules.length} module`,
      );
      await loadCodeTypes();
      if (selectedType?.code) {
        await loadCodeValues(selectedType.code);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Đồng bộ Manifest thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCodeType = async (payload: CreateCodeTypePayload) => {
    setSubmitting(true);
    try {
      const created = await codesApi.createCodeType(payload);
      notify('success', `Đã tạo nhóm danh mục ${created.code}`);
      await loadCodeTypes();
      setSelectedType(created);
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Tạo nhóm danh mục thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateCodeType = async (typeCode: string, payload: UpdateCodeTypePayload) => {
    setSubmitting(true);
    try {
      const updated = await codesApi.updateCodeType(typeCode, payload);
      notify('success', `Đã cập nhật nhóm danh mục ${updated.code}`);
      await loadCodeTypes();
      setSelectedType(updated);
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Cập nhật nhóm danh mục thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCodeValue = async (payload: CreateCodeValuePayload) => {
    if (!selectedType) return false;
    setSubmitting(true);
    try {
      const created = await codesApi.createCodeValue(selectedType.code, payload);
      notify('success', `Đã thêm giá trị mã ${created.code} (#${created.numericCode})`);
      await Promise.all([loadCodeValues(selectedType.code), loadCodeTypes()]);
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Thêm giá trị mã thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateCodeValue = async (
    numericCode: number,
    payload: UpdateCodeValuePayload,
  ) => {
    if (!selectedType) return false;
    setSubmitting(true);
    try {
      const updated = await codesApi.updateCodeValue(selectedType.code, numericCode, payload);
      notify('success', `Đã cập nhật giá trị mã ${updated.code}`);
      await loadCodeValues(selectedType.code);
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Cập nhật giá trị mã thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCodeValue = async (numericCode: number) => {
    if (!selectedType) return false;
    setSubmitting(true);
    try {
      const res = await codesApi.deleteCodeValue(selectedType.code, numericCode);
      notify('success', `Đã xóa giá trị mã ${res.code} (#${res.numericCode})`);
      await Promise.all([loadCodeValues(selectedType.code), loadCodeTypes()]);
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Không thể xóa giá trị mã');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckUsage = async (numericCode: number) => {
    if (!selectedType) return;
    setSubmitting(true);
    try {
      const res = await codesApi.checkCodeValueUsage(selectedType.code, numericCode);
      setUsageResult(res);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Không thể kiểm tra mức độ sử dụng');
    } finally {
      setSubmitting(false);
    }
  };

  const triggerDownloadExport = (file: {
    fileName: string;
    format: 'csv' | 'xlsx';
    csvContent: string;
    xlsxBase64: string;
  }) => {
    if (file.format === 'xlsx' && file.xlsxBase64) {
      const binary = atob(file.xlsxBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([file.csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExportCodes = async (format: 'csv' | 'xlsx', onlyCurrentType = false) => {
    setSubmitting(true);
    try {
      const res = await codesApi.exportCodes({
        format,
        module: moduleFilter || undefined,
        typeCode: onlyCurrentType && selectedType ? selectedType.code : undefined,
        includeInactive: true,
      });
      triggerDownloadExport(res);
      notify('success', `Đã xuất ${res.totalExported} dòng danh mục (${res.fileName})`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Xuất dữ liệu thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadTemplate = async (format: 'csv' | 'xlsx') => {
    setSubmitting(true);
    try {
      const res = await codesApi.downloadImportTemplate(format);
      triggerDownloadExport(res);
      notify('success', `Đã tải file mẫu ${res.fileName}`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Tải file mẫu thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkImport = async (payload: {
    typeCode?: string;
    csvContent?: string;
    xlsxBase64?: string;
    skipDuplicates?: boolean;
  }) => {
    setSubmitting(true);
    try {
      const res = await codesApi.bulkImportCodes(payload);
      setImportResult(res);
      notify(
        res.failedCount > 0 ? 'error' : 'success',
        `Đã nhập ${res.importedCount}/${res.totalRows} mục (Bỏ qua: ${res.skippedCount}, Lỗi: ${res.failedCount})`,
      );
      await loadCodeTypes();
      if (selectedType?.code) {
        await loadCodeValues(selectedType.code);
      }
      return res;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Nhập dữ liệu hàng loạt thất bại');
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    codeTypes,
    selectedType,
    setSelectedType,
    codeValues,
    moduleFilter,
    setModuleFilter,
    searchFilter,
    setSearchFilter,
    includeInactive,
    setIncludeInactive,
    loadingTypes,
    loadingValues,
    submitting,
    feedback,
    clearFeedback: () => setFeedback(null),
    usageResult,
    clearUsageResult: () => setUsageResult(null),
    importResult,
    clearImportResult: () => setImportResult(null),
    loadCodeTypes,
    loadCodeValues,
    handleSyncManifests,
    handleCreateCodeType,
    handleUpdateCodeType,
    handleCreateCodeValue,
    handleUpdateCodeValue,
    handleDeleteCodeValue,
    handleCheckUsage,
    handleExportCodes,
    handleDownloadTemplate,
    handleBulkImport,
  };
}

