import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  EyeOff,
  FileSpreadsheet,
  Play,
  RefreshCw,
} from 'lucide-react';
import { paymentsApi } from '../services/payments.api';
import {
  formatMinorMoney,
  type PaymentProviderItem,
  type PaymentReconciliationItem,
  type PaymentReconciliationLineItem,
  type PaymentReconciliationResolveAction,
  type PaymentReconciliationSource,
  type PaymentTransactionItem,
} from '../types/payments.types';

interface PaymentReconciliationPanelProps {
  providers: readonly PaymentProviderItem[];
  transactions: readonly PaymentTransactionItem[];
  reconciliations: readonly PaymentReconciliationItem[];
  selectedReconciliation: PaymentReconciliationItem | null;
  discrepancyFilter: string;
  onDiscrepancyFilterChange: (val: string) => void;
  onSelectReconciliation: (id: number, discrepancyFilter?: string) => Promise<void>;
  onSelectRunResult: (run: PaymentReconciliationItem) => void;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

const DISCREPANCY_BADGE_MAP: Record<string, { bg: string; color: string; label: string }> = {
  MATCHED: { bg: 'rgba(22,163,74,0.12)', color: '#15803d', label: 'Khớp' },
  STATUS_MISMATCH: { bg: 'rgba(217,119,6,0.14)', color: '#b45309', label: 'Lệch trạng thái' },
  AMOUNT_MISMATCH: { bg: 'rgba(220,38,38,0.12)', color: '#dc2626', label: 'Lệch số tiền' },
  REFUND_MISMATCH: { bg: 'rgba(220,38,38,0.12)', color: '#dc2626', label: 'Lệch hoàn tiền' },
  MISSING_AT_PROVIDER: { bg: 'rgba(220,38,38,0.12)', color: '#dc2626', label: 'Thiếu bên Provider' },
  MISSING_INTERNALLY: { bg: 'rgba(124,58,237,0.12)', color: '#6d28d9', label: 'Thiếu nội bộ' },
};

export const PaymentReconciliationPanel: React.FC<PaymentReconciliationPanelProps> = ({
  providers,
  transactions,
  reconciliations,
  selectedReconciliation,
  discrepancyFilter,
  onDiscrepancyFilterChange,
  onSelectReconciliation,
  onSelectRunResult,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const defaultProviderCode = providers[0]?.providerCode ?? 'sandbox';
  const [providerCode, setProviderCode] = useState('');
  const [sourceMode, setSourceMode] = useState<PaymentReconciliationSource>('STATEMENT');
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [periodEnd, setPeriodEnd] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  });
  const [statementFormat, setStatementFormat] = useState<'JSON' | 'CSV'>('JSON');
  const [statementText, setStatementText] = useState('');
  const [running, setRunning] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const effectiveProvider = providerCode || defaultProviderCode;

  const filteredItems = useMemo(() => {
    const items = selectedReconciliation?.items ?? [];
    if (!discrepancyFilter) return items;
    return items.filter((item) => String(item.discrepancyStatus) === discrepancyFilter);
  }, [selectedReconciliation, discrepancyFilter]);

  const fillSampleStatement = () => {
    const matchingTxs = transactions.filter((t) => t.providerCode === effectiveProvider).slice(0, 3);
    const sampleRows = matchingTxs.map((t, idx) => ({
      paymentCode: t.paymentCode,
      merchantOrderRef: t.merchantOrderRef,
      providerTransactionId: t.providerTransactionId ?? undefined,
      status: idx === 1 ? 'SUCCEEDED' : t.statusName,
      amount: t.amount,
      refundedAmount: t.refundedAmount,
      currency: t.currency,
    }));
    sampleRows.push({
      paymentCode: 'PAY-PROVIDER-ONLY-001',
      merchantOrderRef: 'ORD-EXTERNAL-999',
      providerTransactionId: 'ext_tx_999',
      status: 'SUCCEEDED',
      amount: 250000,
      refundedAmount: 0,
      currency: 'VND',
    });

    if (statementFormat === 'CSV') {
      const csvLines = [
        'paymentCode,merchantOrderRef,providerTransactionId,status,amount,refundedAmount,currency',
        ...sampleRows.map(
          (r) =>
            `${r.paymentCode},${r.merchantOrderRef},${r.providerTransactionId ?? ''},${r.status},${r.amount},${r.refundedAmount},${r.currency}`,
        ),
      ];
      setStatementText(csvLines.join('\n'));
    } else {
      setStatementText(JSON.stringify(sampleRows, null, 2));
    }
  };

  const handleRunReconciliation = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onFeedback(null);
    setRunning(true);
    try {
      const payload: Record<string, unknown> = {
        providerCode: effectiveProvider,
        sourceMode,
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
      };
      if (sourceMode === 'STATEMENT') {
        if (statementFormat === 'CSV') {
          payload['statementCsv'] = statementText;
        } else {
          payload['statementItems'] = JSON.parse(statementText || '[]');
        }
      }
      const result = await paymentsApi.runReconciliation(payload);
      onSelectRunResult(result);
      onFeedback(`Đã chạy đối soát ${result.reconciliationCode} (${result.providerCode}).`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Chạy đối soát thất bại');
    } finally {
      setRunning(false);
    }
  };

  const handleResolveItem = async (
    item: PaymentReconciliationLineItem,
    action: PaymentReconciliationResolveAction,
  ) => {
    if (!selectedReconciliation) return;
    setResolvingId(item.id);
    onError(null);
    try {
      await paymentsApi.resolveReconciliationItem(selectedReconciliation.id, item.id, { action });
      onFeedback(`Đã xử lý mục đối soát #${item.id} (${action}).`);
      await onSelectReconciliation(selectedReconciliation.id, discrepancyFilter);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể xử lý sai lệch đối soát');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Run Reconciliation Card */}
      <form
        onSubmit={(e) => void handleRunReconciliation(e)}
        style={{
          padding: 16,
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ArrowLeftRight size={18} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Chạy đối soát dữ liệu Nội bộ vs Provider
            </h2>
          </div>
          {sourceMode === 'STATEMENT' && (
            <button
              type="button"
              onClick={fillSampleStatement}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <FileSpreadsheet size={14} /> Nạp sao kê mẫu từ GD hiện có
            </button>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Cổng thanh toán</span>
            <select
              value={effectiveProvider}
              onChange={(e) => setProviderCode(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            >
              {providers.length === 0 ? (
                <option value="sandbox">sandbox</option>
              ) : (
                providers.map((p) => (
                  <option key={p.id} value={p.providerCode}>
                    {p.displayName} ({p.providerCode})
                  </option>
                ))
              )}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Nguồn đối soát</span>
            <select
              value={sourceMode}
              onChange={(e) => setSourceMode(e.target.value as PaymentReconciliationSource)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            >
              <option value="STATEMENT">STATEMENT (Đối chiếu sao kê JSON/CSV)</option>
              <option value="LIVE_QUERY">LIVE_QUERY (Truy vấn trực tiếp API Provider)</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Từ thời điểm</span>
            <input
              type="datetime-local"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Đến thời điểm</span>
            <input
              type="datetime-local"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
        </div>

        {sourceMode === 'STATEMENT' && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
              <span>Định dạng sao kê Provider:</span>
              <button
                type="button"
                onClick={() => setStatementFormat('JSON')}
                style={{
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  fontWeight: statementFormat === 'JSON' ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                JSON Array
              </button>
              <button
                type="button"
                onClick={() => setStatementFormat('CSV')}
                style={{
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  fontWeight: statementFormat === 'CSV' ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                CSV
              </button>
            </div>
            <textarea
              rows={5}
              value={statementText}
              onChange={(e) => setStatementText(e.target.value)}
              placeholder={
                statementFormat === 'JSON'
                  ? '[{"paymentCode":"PAY-202611-000001","status":"SUCCEEDED","amount":100000,"currency":"VND"}]'
                  : 'paymentCode,merchantOrderRef,status,amount,currency\nPAY-202611-000001,ORD-1,SUCCEEDED,100000,VND'
              }
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            />
          </div>
        )}

        <div>
          <button
            type="submit"
            disabled={running}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Play size={14} /> {running ? 'Đang đối soát...' : 'Chạy đối soát'}
          </button>
        </div>
      </form>

      {/* Split Layout: Runs History + Side-by-Side Comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>Lịch sử các đợt đối soát</div>
          {reconciliations.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Chưa có phiên đối soát nào.
            </div>
          ) : (
            reconciliations.map((run) => {
              const active = selectedReconciliation?.id === run.id;
              const issueCount =
                run.mismatchCount + run.missingAtProviderCount + run.missingInternallyCount;
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => void onSelectReconciliation(run.id, discrepancyFilter)}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 8,
                    border: active ? '1px solid #2563eb' : '1px solid var(--border-subtle)',
                    background: active ? 'rgba(37,99,235,0.06)' : 'transparent',
                    cursor: 'pointer',
                    display: 'grid',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                    <span>{run.reconciliationCode}</span>
                    <span>{run.sourceMode}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {run.providerCode} • Khớp {run.matchedCount} • Sai lệch {issueCount}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Chênh lệch tiền: {formatMinorMoney(run.amountDifference, run.currency)}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Comparison Table */}
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'grid',
            gap: 12,
          }}
        >
          {!selectedReconciliation ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Chọn một phiên đối soát bên trái hoặc chạy đợt đối soát mới để xem bảng so sánh Nội bộ vs Provider.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                    Chi tiết đối soát: {selectedReconciliation.reconciliationCode}
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Provider: <strong>{selectedReconciliation.providerCode}</strong> • Nội bộ:{' '}
                    <strong>{formatMinorMoney(selectedReconciliation.internalTotalAmount, selectedReconciliation.currency)}</strong>{' '}
                    • Provider:{' '}
                    <strong>{formatMinorMoney(selectedReconciliation.providerTotalAmount, selectedReconciliation.currency)}</strong>{' '}
                    • Chênh lệch:{' '}
                    <strong>{formatMinorMoney(selectedReconciliation.amountDifference, selectedReconciliation.currency)}</strong>
                  </div>
                </div>

                <select
                  value={discrepancyFilter}
                  onChange={(e) => {
                    onDiscrepancyFilterChange(e.target.value);
                    void onSelectReconciliation(selectedReconciliation.id, e.target.value);
                  }}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
                >
                  <option value="">Tất cả ({selectedReconciliation.items?.length ?? 0})</option>
                  <option value="1">Khớp hoàn toàn ({selectedReconciliation.matchedCount})</option>
                  <option value="2">Lệch trạng thái</option>
                  <option value="3">Lệch số tiền</option>
                  <option value="4">Lệch hoàn tiền</option>
                  <option value="5">Thiếu bên Provider ({selectedReconciliation.missingAtProviderCount})</option>
                  <option value="6">Thiếu nội bộ ({selectedReconciliation.missingInternallyCount})</option>
                </select>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                      <th style={{ padding: '8px 6px' }}>Mã GD / Đơn</th>
                      <th style={{ padding: '8px 6px' }}>Nội bộ (Status / Tiền)</th>
                      <th style={{ padding: '8px 6px' }}>Provider (Status / Tiền)</th>
                      <th style={{ padding: '8px 6px' }}>Kết quả so sánh</th>
                      <th style={{ padding: '8px 6px' }}>Xử lý</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => {
                      const badge = DISCREPANCY_BADGE_MAP[item.discrepancyStatusName] ?? {
                        bg: 'rgba(100,116,139,0.12)',
                        color: '#475569',
                        label: item.discrepancyStatusName,
                      };
                      const isOpen = item.resolutionStatus === 1;
                      const canSync =
                        isOpen && item.discrepancyStatusName === 'STATUS_MISMATCH' && item.paymentTransactionId !== null;
                      return (
                        <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '8px 6px' }}>
                            <div style={{ fontWeight: 700 }}>{item.paymentCode || '—'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              Order: {item.merchantOrderRef || '—'} • PTX: {item.providerTransactionId || '—'}
                            </div>
                          </td>
                          <td style={{ padding: '8px 6px' }}>
                            <div>{item.internalStatusName || '—'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {formatMinorMoney(item.internalAmount, item.currency)}
                              {item.internalRefundedAmount
                                ? ` (Hoàn: ${formatMinorMoney(item.internalRefundedAmount, item.currency)})`
                                : ''}
                            </div>
                          </td>
                          <td style={{ padding: '8px 6px' }}>
                            <div>{item.providerStatusName || '—'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {formatMinorMoney(item.providerAmount, item.currency)}
                              {item.providerRefundedAmount
                                ? ` (Hoàn: ${formatMinorMoney(item.providerRefundedAmount, item.currency)})`
                                : ''}
                            </div>
                          </td>
                          <td style={{ padding: '8px 6px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: 99,
                                background: badge.bg,
                                color: badge.color,
                                fontWeight: 700,
                                fontSize: 11,
                              }}
                            >
                              {badge.label}
                            </span>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              {item.resolutionStatusName}
                              {item.resolutionNote ? ` • ${item.resolutionNote}` : ''}
                            </div>
                          </td>
                          <td style={{ padding: '8px 6px' }}>
                            {isOpen ? (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {canSync && (
                                  <button
                                    type="button"
                                    disabled={resolvingId === item.id}
                                    onClick={() => void handleResolveItem(item, 'SYNC_FROM_PROVIDER')}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      padding: '4px 8px',
                                      borderRadius: 6,
                                      border: '1px solid #2563eb',
                                      background: 'rgba(37,99,235,0.08)',
                                      color: '#2563eb',
                                      fontSize: 11,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <RefreshCw size={12} /> Đồng bộ từ Provider
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={resolvingId === item.id}
                                  onClick={() => void handleResolveItem(item, 'MARK_RESOLVED')}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '4px 8px',
                                    borderRadius: 6,
                                    border: '1px solid var(--border-subtle)',
                                    background: 'transparent',
                                    fontSize: 11,
                                    cursor: 'pointer',
                                  }}
                                >
                                  <CheckCircle2 size={12} /> Đã xử lý
                                </button>
                                <button
                                  type="button"
                                  disabled={resolvingId === item.id}
                                  onClick={() => void handleResolveItem(item, 'IGNORE')}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '4px 8px',
                                    borderRadius: 6,
                                    border: '1px solid var(--border-subtle)',
                                    background: 'transparent',
                                    fontSize: 11,
                                    cursor: 'pointer',
                                  }}
                                >
                                  <EyeOff size={12} /> Bỏ qua
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {item.discrepancyStatusName === 'MATCHED' ? (
                                  <CheckCircle2 size={12} color="#16a34a" />
                                ) : (
                                  <AlertTriangle size={12} />
                                )}
                                Hoàn tất
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
