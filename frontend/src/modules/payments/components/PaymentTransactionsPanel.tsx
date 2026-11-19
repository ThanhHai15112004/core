import React, { useState } from 'react';
import { CheckCircle2, CreditCard, RotateCcw, Send, XCircle } from 'lucide-react';
import { paymentsApi } from '../services/payments.api';
import {
  formatMinorMoney,
  type PaymentProviderItem,
  type PaymentTransactionItem,
} from '../types/payments.types';

interface PaymentTransactionsPanelProps {
  providers: readonly PaymentProviderItem[];
  transactions: readonly PaymentTransactionItem[];
  selectedTransaction: PaymentTransactionItem | null;
  providerFilter: string;
  onProviderFilterChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
  onSelectTransaction: (id: number) => Promise<void>;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const PaymentTransactionsPanel: React.FC<PaymentTransactionsPanelProps> = ({
  providers,
  transactions,
  selectedTransaction,
  providerFilter,
  onProviderFilterChange,
  statusFilter,
  onStatusFilterChange,
  onSelectTransaction,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [providerCode, setProviderCode] = useState('');
  const [merchantOrderRef, setMerchantOrderRef] = useState(() => `ORD-${Date.now().toString().slice(-6)}`);
  const [idempotencyKey, setIdempotencyKey] = useState(() => `idem-${Date.now()}`);
  const [amount, setAmount] = useState('150000');
  const [currency, setCurrency] = useState('VND');
  const [description, setDescription] = useState('Thanh toán đơn hàng kiểm thử');
  const [creating, setCreating] = useState(false);

  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('Khách yêu cầu hoàn tiền');
  const [refundIdempotencyKey, setRefundIdempotencyKey] = useState(() => `rfd-idem-${Date.now()}`);
  const [busyAction, setBusyAction] = useState(false);

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onFeedback(null);
    setCreating(true);
    try {
      const res = await paymentsApi.createPayment(
        {
          ...(providerCode ? { providerCode } : {}),
          merchantOrderRef,
          amount: Number(amount),
          currency,
          description,
        },
        idempotencyKey,
      );
      onFeedback(
        res.idempotentReplay
          ? `Idempotency Replay: trả lại giao dịch cũ ${res.transaction.paymentCode}.`
          : `Đã tạo giao dịch ${res.transaction.paymentCode} (${res.transaction.statusName}).`,
      );
      await onRefresh();
      await onSelectTransaction(res.transaction.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể tạo giao dịch thanh toán');
    } finally {
      setCreating(false);
    }
  };

  const handleSimulateCallback = async (
    tx: PaymentTransactionItem,
    opts: { status: number; amount?: number; tamperSignature?: boolean },
  ) => {
    setBusyAction(true);
    onError(null);
    onFeedback(null);
    try {
      const res = await paymentsApi.simulateSandboxCallback(tx.id, opts);
      onFeedback(
        `Callback ${res.verificationStatusName}${res.duplicate ? ' (Duplicate)' : ''} • Trạng thái mới: ${res.transaction?.statusName ?? '—'}`,
      );
      await onRefresh();
      await onSelectTransaction(tx.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Callback bị từ chối');
      await onRefresh();
      await onSelectTransaction(tx.id);
    } finally {
      setBusyAction(false);
    }
  };

  const handleRefund = async (tx: PaymentTransactionItem) => {
    setBusyAction(true);
    onError(null);
    onFeedback(null);
    try {
      const parsedAmount = refundAmount.trim() ? Number(refundAmount) : undefined;
      const res = await paymentsApi.refundPayment(
        tx.id,
        {
          ...(parsedAmount !== undefined ? { amount: parsedAmount } : {}),
          reason: refundReason,
        },
        refundIdempotencyKey,
      );
      onFeedback(
        `${res.idempotentReplay ? '[Idempotent Replay] ' : ''}Hoàn tiền ${res.refund.refundType}: ${formatMinorMoney(res.refund.amount, res.refund.currency)} → ${res.transaction.statusName}`,
      );
      setRefundIdempotencyKey(`rfd-idem-${Date.now()}`);
      setRefundAmount('');
      await onRefresh();
      await onSelectTransaction(tx.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể hoàn tiền');
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Create Payment Form */}
      <form
        onSubmit={(e) => void handleCreatePayment(e)}
        style={{
          padding: 16,
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CreditCard size={18} />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Khởi tạo yêu cầu thanh toán dùng chung (Test Idempotency)
          </h2>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
          }}
        >
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Provider (trống = mặc định)</span>
            <select
              value={providerCode}
              onChange={(e) => setProviderCode(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            >
              <option value="">Cổng mặc định</option>
              {providers.map((p) => (
                <option key={p.id} value={p.providerCode}>
                  {p.displayName} ({p.providerCode})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Mã đơn hàng (merchantOrderRef)</span>
            <input
              value={merchantOrderRef}
              onChange={(e) => setMerchantOrderRef(e.target.value)}
              required
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Số tiền (minor units)</span>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Tiền tệ</span>
            <input
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              required
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Idempotency-Key</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                required
                style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
              <button
                type="button"
                onClick={() => setIdempotencyKey(`idem-${Date.now()}`)}
                style={{ padding: '0 8px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 11, cursor: 'pointer' }}
              >
                Mới
              </button>
            </div>
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Mô tả</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
        </div>

        <div>
          <button
            type="submit"
            disabled={creating}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Send size={14} /> {creating ? 'Đang gửi...' : 'Tạo giao dịch thanh toán'}
          </button>
        </div>
      </form>

      {/* Transactions List + Detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'start' }}>
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'grid',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>Danh sách giao dịch</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={providerFilter}
                onChange={(e) => onProviderFilterChange(e.target.value)}
                style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
              >
                <option value="">Tất cả Provider</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.providerCode}>
                    {p.providerCode}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => onStatusFilterChange(e.target.value)}
                style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12 }}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="1">PENDING</option>
                <option value="3">SUCCEEDED</option>
                <option value="4">FAILED</option>
                <option value="7">PARTIALLY_REFUNDED</option>
                <option value="8">REFUNDED</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '6px' }}>Mã GD</th>
                  <th style={{ padding: '6px' }}>Provider</th>
                  <th style={{ padding: '6px' }}>Số tiền</th>
                  <th style={{ padding: '6px' }}>Đã hoàn</th>
                  <th style={{ padding: '6px' }}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    onClick={() => void onSelectTransaction(tx.id)}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      background:
                        selectedTransaction?.id === tx.id ? 'rgba(37,99,235,0.07)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '7px 6px' }}>
                      <div style={{ fontWeight: 700 }}>{tx.paymentCode}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {tx.merchantOrderRef}
                      </div>
                    </td>
                    <td style={{ padding: '7px 6px' }}>{tx.providerCode}</td>
                    <td style={{ padding: '7px 6px' }}>{formatMinorMoney(tx.amount, tx.currency)}</td>
                    <td style={{ padding: '7px 6px' }}>
                      {formatMinorMoney(tx.refundedAmount, tx.currency)}
                    </td>
                    <td style={{ padding: '7px 6px', fontWeight: 700 }}>{tx.statusName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Transaction Detail */}
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
          {!selectedTransaction ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Chọn một giao dịch để xem chi tiết, giả lập callback hoặc hoàn tiền.
            </div>
          ) : (
            <>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {selectedTransaction.paymentCode} ({selectedTransaction.statusName})
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Order: {selectedTransaction.merchantOrderRef} • Idempotency:{' '}
                  <code>{selectedTransaction.idempotencyKey}</code>
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Tổng tiền: <strong>{formatMinorMoney(selectedTransaction.amount, selectedTransaction.currency)}</strong>{' '}
                  • Đã hoàn: <strong>{formatMinorMoney(selectedTransaction.refundedAmount, selectedTransaction.currency)}</strong>{' '}
                  • Còn hoàn được: <strong>{formatMinorMoney(selectedTransaction.refundableAmount, selectedTransaction.currency)}</strong>
                </div>
              </div>

              {selectedTransaction.driverCode === 'sandbox' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleSimulateCallback(selectedTransaction, { status: 3 })}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid #16a34a',
                      background: 'rgba(22,163,74,0.08)',
                      color: '#15803d',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <CheckCircle2 size={12} /> Callback Thành công
                  </button>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleSimulateCallback(selectedTransaction, { status: 4 })}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid #dc2626',
                      background: 'rgba(220,38,38,0.08)',
                      color: '#dc2626',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <XCircle size={12} /> Callback Thất bại
                  </button>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() =>
                      void handleSimulateCallback(selectedTransaction, {
                        status: 3,
                        amount: Math.max(1, selectedTransaction.amount - 1),
                      })
                    }
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Test Lệch tiền
                  </button>
                </div>
              )}

              {/* Refund form */}
              {(selectedTransaction.status === 3 || selectedTransaction.status === 7) && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <strong style={{ fontSize: 12 }}>Hoàn tiền (Toàn phần / Một phần)</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <input
                      type="number"
                      min={1}
                      max={selectedTransaction.refundableAmount}
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      placeholder={`Trống = toàn phần (${selectedTransaction.refundableAmount})`}
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: 12 }}
                    />
                    <input
                      value={refundIdempotencyKey}
                      onChange={(e) => setRefundIdempotencyKey(e.target.value)}
                      placeholder="Refund Idempotency Key"
                      style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: 12 }}
                    />
                  </div>
                  <input
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Lý do hoàn tiền"
                    style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: 12 }}
                  />
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleRefund(selectedTransaction)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '7px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: '#d97706',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <RotateCcw size={13} /> Thực hiện hoàn tiền
                  </button>
                </div>
              )}

              {/* Refunds & Callbacks history */}
              <div style={{ fontSize: 12 }}>
                <strong>Lịch sử hoàn tiền ({selectedTransaction.refunds?.length ?? 0})</strong>
                {(selectedTransaction.refunds ?? []).map((r) => (
                  <div
                    key={r.id}
                    style={{
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border-subtle)',
                      fontSize: 11,
                    }}
                  >
                    {r.refundCode} • {r.refundType} • {formatMinorMoney(r.amount, r.currency)} •{' '}
                    <strong>{r.statusName}</strong>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12 }}>
                <strong>Lịch sử Callback ({selectedTransaction.callbacks?.length ?? 0})</strong>
                {(selectedTransaction.callbacks ?? []).map((cb) => (
                  <div
                    key={cb.id}
                    style={{
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border-subtle)',
                      fontSize: 11,
                    }}
                  >
                    {cb.callbackUid} • <strong>{cb.verificationStatusName}</strong> • Sig:{' '}
                    {cb.signatureValid ? 'OK' : 'FAIL'}
                    {cb.rejectionReason ? ` • ${cb.rejectionReason}` : ''}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
