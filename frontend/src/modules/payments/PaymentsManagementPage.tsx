import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  Server,
} from 'lucide-react';
import { PaymentProvidersPanel } from './components/PaymentProvidersPanel';
import { PaymentReconciliationPanel } from './components/PaymentReconciliationPanel';
import { PaymentTransactionsPanel } from './components/PaymentTransactionsPanel';
import { usePaymentsManagement } from './hooks/usePaymentsManagement';

type PaymentsSubTab = 'reconciliation' | 'transactions' | 'providers';

export const PaymentsManagementPage: React.FC = () => {
  const {
    drivers,
    providers,
    transactions,
    selectedTransaction,
    callbacks,
    reconciliations,
    selectedReconciliation,
    setSelectedReconciliation,
    txProviderFilter,
    setTxProviderFilter,
    txStatusFilter,
    setTxStatusFilter,
    reconDiscrepancyFilter,
    setReconDiscrepancyFilter,
    loading,
    error,
    setError,
    feedback,
    setFeedback,
    loadTransactionDetail,
    loadReconciliationDetail,
    refreshAll,
  } = usePaymentsManagement();

  const [activeSubTab, setActiveSubTab] = useState<PaymentsSubTab>('reconciliation');

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: '20px 24px 48px' }}>
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 18,
          padding: 18,
          borderRadius: 14,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CreditCard size={22} color="#2563eb" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              10.5 Payment Port &amp; Đối soát Thanh toán
            </h1>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Cổng thanh toán trung lập (Sandbox, VNPay, MoMo, Stripe) • Idempotency Key chống tạo
            trùng • Xác minh chữ ký &amp; số tiền callback • Hoàn tiền toàn phần/một phần • Đối soát
            Nội bộ vs Provider
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void refreshAll()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-subtle, rgba(37,99,235,0.08))',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={14} /> Làm mới
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(220,38,38,0.09)',
            border: '1px solid rgba(220,38,38,0.3)',
            color: '#dc2626',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {feedback && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(22,163,74,0.09)',
            border: '1px solid rgba(22,163,74,0.3)',
            color: '#15803d',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <CheckCircle2 size={16} />
          <span>{feedback}</span>
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setActiveSubTab('reconciliation')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: activeSubTab === 'reconciliation' ? '#2563eb' : 'var(--bg-surface)',
            color: activeSubTab === 'reconciliation' ? '#fff' : 'inherit',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <ArrowLeftRight size={15} /> Đối soát thanh toán ({reconciliations.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('transactions')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: activeSubTab === 'transactions' ? '#2563eb' : 'var(--bg-surface)',
            color: activeSubTab === 'transactions' ? '#fff' : 'inherit',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <CreditCard size={15} /> Giao dịch &amp; Hoàn tiền ({transactions.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('providers')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: activeSubTab === 'providers' ? '#2563eb' : 'var(--bg-surface)',
            color: activeSubTab === 'providers' ? '#fff' : 'inherit',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Server size={15} /> Providers &amp; Callback Logs ({providers.length})
        </button>
      </div>

      {activeSubTab === 'reconciliation' ? (
        <PaymentReconciliationPanel
          providers={providers}
          transactions={transactions}
          reconciliations={reconciliations}
          selectedReconciliation={selectedReconciliation}
          discrepancyFilter={reconDiscrepancyFilter}
          onDiscrepancyFilterChange={setReconDiscrepancyFilter}
          onSelectReconciliation={loadReconciliationDetail}
          onSelectRunResult={(run) => setSelectedReconciliation(run)}
          onRefresh={refreshAll}
          onError={setError}
          onFeedback={setFeedback}
        />
      ) : activeSubTab === 'transactions' ? (
        <PaymentTransactionsPanel
          providers={providers}
          transactions={transactions}
          selectedTransaction={selectedTransaction}
          providerFilter={txProviderFilter}
          onProviderFilterChange={setTxProviderFilter}
          statusFilter={txStatusFilter}
          onStatusFilterChange={setTxStatusFilter}
          onSelectTransaction={loadTransactionDetail}
          onRefresh={refreshAll}
          onError={setError}
          onFeedback={setFeedback}
        />
      ) : (
        <PaymentProvidersPanel
          drivers={drivers}
          providers={providers}
          callbacks={callbacks}
          onRefresh={refreshAll}
          onError={setError}
          onFeedback={setFeedback}
        />
      )}
    </main>
  );
};
