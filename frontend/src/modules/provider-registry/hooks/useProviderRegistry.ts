import { useCallback, useEffect, useState } from 'react';
import { providerRegistryApi } from '../services/provider-registry.api';
import type {
  ProviderCatalogView,
  ProviderConfigHistoryItem,
  ProviderDashboardView,
  ProviderRegistryEntryItem,
  ProviderUnitAssignmentItem,
} from '../types/provider-registry.types';

export function useProviderRegistry() {
  const [catalog, setCatalog] = useState<ProviderCatalogView | null>(null);
  const [dashboard, setDashboard] = useState<ProviderDashboardView | null>(null);
  const [providers, setProviders] = useState<ProviderRegistryEntryItem[]>([]);
  const [unitAssignments, setUnitAssignments] = useState<ProviderUnitAssignmentItem[]>([]);
  const [histories, setHistories] = useState<ProviderConfigHistoryItem[]>([]);

  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [historyActionFilter, setHistoryActionFilter] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadCatalogAndDashboard = useCallback(async () => {
    try {
      const qs = typeFilter ? `providerType=${encodeURIComponent(typeFilter)}` : '';
      const [cat, dash] = await Promise.all([
        providerRegistryApi.getCatalog(),
        providerRegistryApi.getDashboard(qs),
      ]);
      setCatalog(cat);
      setDashboard(dash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dashboard nhà cung cấp');
    }
  }, [typeFilter]);

  const loadProviders = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (typeFilter) params.set('providerType', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await providerRegistryApi.listProviders(params.toString());
      setProviders(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách nhà cung cấp');
    }
  }, [typeFilter, statusFilter]);

  const loadUnitAssignments = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (typeFilter) params.set('providerType', typeFilter);
      const res = await providerRegistryApi.listUnitAssignments(params.toString());
      setUnitAssignments(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải phân công theo đơn vị');
    }
  }, [typeFilter]);

  const loadHistories = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (typeFilter) params.set('providerType', typeFilter);
      if (historyActionFilter) params.set('action', historyActionFilter);
      const res = await providerRegistryApi.listHistories(params.toString());
      setHistories(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải lịch sử thay đổi');
    }
  }, [typeFilter, historyActionFilter]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        loadCatalogAndDashboard(),
        loadProviders(),
        loadUnitAssignments(),
        loadHistories(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadCatalogAndDashboard, loadProviders, loadUnitAssignments, loadHistories]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  return {
    catalog,
    dashboard,
    providers,
    unitAssignments,
    histories,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    historyActionFilter,
    setHistoryActionFilter,
    loading,
    error,
    setError,
    feedback,
    setFeedback,
    refreshAll,
  };
}
