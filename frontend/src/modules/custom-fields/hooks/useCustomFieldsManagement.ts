import { useCallback, useEffect, useState } from 'react';
import { customFieldsApi } from '../services/custom-fields.api';
import type {
  CustomFieldDefinitionItem,
  CustomFieldHistoryItem,
  ExtensibleEntityItem,
} from '../types/custom-fields.types';

export function useCustomFieldsManagement() {
  const [entities, setEntities] = useState<ExtensibleEntityItem[]>([]);
  const [selectedEntityCode, setSelectedEntityCode] = useState<string>('users.user');
  const [definitions, setDefinitions] = useState<CustomFieldDefinitionItem[]>([]);
  const [selectedDefinition, setSelectedDefinition] = useState<CustomFieldDefinitionItem | null>(
    null,
  );
  const [histories, setHistories] = useState<CustomFieldHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadEntities = useCallback(async () => {
    try {
      const list = await customFieldsApi.listExtensibleEntities();
      const safeList = Array.isArray(list) ? list : [];
      setEntities(safeList);
      if (safeList.length > 0 && !safeList.some((e) => e.code === selectedEntityCode)) {
        setSelectedEntityCode(safeList[0].code);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách đối tượng mở rộng');
    }
  }, [selectedEntityCode]);

  const loadDefinitionsAndHistories = useCallback(async (entityCode: string) => {
    setLoading(true);
    setError(null);
    try {
      const [defsRes, histRes] = await Promise.all([
        customFieldsApi.listDefinitions(
          `entityCode=${encodeURIComponent(entityCode)}&limit=100`,
        ),
        customFieldsApi.listAllHistories(
          `entityCode=${encodeURIComponent(entityCode)}&limit=30`,
        ),
      ]);
      const defItems = Array.isArray(defsRes.data) ? defsRes.data : [];
      setDefinitions(defItems);
      setSelectedDefinition((prev) => {
        if (prev && prev.entityCode === entityCode) {
          return defItems.find((d) => d.fieldKey === prev.fieldKey) ?? defItems[0] ?? null;
        }
        return defItems[0] ?? null;
      });
      setHistories(Array.isArray(histRes.data) ? histRes.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải cấu hình trường tùy chỉnh');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntities();
  }, [loadEntities]);

  useEffect(() => {
    if (selectedEntityCode) {
      void loadDefinitionsAndHistories(selectedEntityCode);
    }
  }, [selectedEntityCode, loadDefinitionsAndHistories]);

  const handleRefreshAll = useCallback(async () => {
    await loadEntities();
    await loadDefinitionsAndHistories(selectedEntityCode);
  }, [loadDefinitionsAndHistories, loadEntities, selectedEntityCode]);

  return {
    entities,
    selectedEntityCode,
    setSelectedEntityCode,
    definitions,
    selectedDefinition,
    setSelectedDefinition,
    histories,
    loading,
    error,
    setError,
    feedback,
    setFeedback,
    refresh: handleRefreshAll,
  };
}
