import { useCallback, useEffect, useState } from 'react';
import { paymentsApi } from '../services/payments.api';
import type {
  PaymentCallbackItem,
  PaymentDriverMetadata,
  PaymentProviderItem,
  PaymentReconciliationItem,
  PaymentTransactionItem,
} from '../types/payments.types';

export function usePaymentsManagement() {
  const [drivers, setDrivers] = useState<PaymentDriverMetadata[]>([]);
  const [providers, setProviders] = useState<PaymentProviderItem[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransactionItem[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<PaymentTransactionItem | null>(
    null,
  );
  const [callbacks, setCallbacks] = useState<PaymentCallbackItem[]>([]);
  const [reconciliations, setReconciliations] = useState<PaymentReconciliationItem[]>([]);
  const [selectedReconciliation, setSelectedReconciliation] =
    useState<PaymentReconciliationItem | null>(null);

  const [txProviderFilter, setTxProviderFilter] = useState('');
  const [txStatusFilter, setTxStatusFilter] = useState('');
  const [reconProviderFilter, setReconProviderFilter] = useState('');
  const [reconDiscrepancyFilter, setReconDiscrepancyFilter] = useState('');

  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadDriversAndProviders = useCallback(async () => {
    try {
      const [driverList, providerRes] = await Promise.all([
        paymentsApi.listDrivers(),
        paymentsApi.listProviders('limit=100'),
      ]);
      setDrivers(Array.isArray(driverList) ? driverList : []);
      setProviders(Array.isArray(providerRes.data) ? providerRes.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách cổng thanh toán');
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (txProviderFilter) params.set('providerCode', txProviderFilter);
      if (txStatusFilter) params.set('status', txStatusFilter);
      const res = await paymentsApi.listTransactions(params.toString());
      setTransactions(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách giao dịch');
    }
  }, [txProviderFilter, txStatusFilter]);

  const loadTransactionDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const detail = await paymentsApi.getTransactionById(id);
      setSelectedTransaction(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải chi tiết giao dịch');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadCallbacks = useCallback(async () => {
    try {
      const res = await paymentsApi.listCallbacks('limit=50');
      setCallbacks(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải lịch sử callback');
    }
  }, []);

  const loadReconciliationDetail = useCallback(
    async (id: number, discrepancyStatus = reconDiscrepancyFilter) => {
      setDetailLoading(true);
      try {
        const params = new URLSearchParams();
        if (discrepancyStatus) params.set('discrepancyStatus', discrepancyStatus);
        const detail = await paymentsApi.getReconciliationById(id, params.toString());
        setSelectedReconciliation(detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể tải chi tiết đối soát');
      } finally {
        setDetailLoading(false);
      }
    },
    [reconDiscrepancyFilter],
  );

  const loadReconciliations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (reconProviderFilter) params.set('providerCode', reconProviderFilter);
      const res = await paymentsApi.listReconciliations(params.toString());
      const rows = Array.isArray(res.data) ? res.data : [];
      setReconciliations(rows);
      if (rows.length > 0 && !selectedReconciliation) {
        await loadReconciliationDetail(rows[0]!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách phiên đối soát');
    }
  }, [reconProviderFilter, selectedReconciliation, loadReconciliationDetail]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([
      loadDriversAndProviders(),
      loadTransactions(),
      loadCallbacks(),
      loadReconciliations(),
    ]);
    if (selectedTransaction) {
      await loadTransactionDetail(selectedTransaction.id);
    }
    if (selectedReconciliation) {
      await loadReconciliationDetail(selectedReconciliation.id);
    }
    setLoading(false);
  }, [
    loadDriversAndProviders,
    loadTransactions,
    loadCallbacks,
    loadReconciliations,
    loadTransactionDetail,
    loadReconciliationDetail,
    selectedTransaction,
    selectedReconciliation,
  ]);

  useEffect(() => {
    void loadDriversAndProviders();
    void loadCallbacks();
  }, [loadDriversAndProviders, loadCallbacks]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    void loadReconciliations();
  }, [loadReconciliations]);

  return {
    drivers,
    providers,
    transactions,
    selectedTransaction,
    setSelectedTransaction,
    callbacks,
    reconciliations,
    selectedReconciliation,
    setSelectedReconciliation,
    txProviderFilter,
    setTxProviderFilter,
    txStatusFilter,
    setTxStatusFilter,
    reconProviderFilter,
    setReconProviderFilter,
    reconDiscrepancyFilter,
    setReconDiscrepancyFilter,
    loading,
    detailLoading,
    error,
    setError,
    feedback,
    setFeedback,
    loadTransactionDetail,
    loadReconciliationDetail,
    refreshAll,
  };
}
