import React, { useState } from 'react';
import { Plus, Server, ShieldCheck, Trash2 } from 'lucide-react';
import { paymentsApi } from '../services/payments.api';
import {
  formatMinorMoney,
  type PaymentCallbackItem,
  type PaymentDriverCode,
  type PaymentDriverMetadata,
  type PaymentProviderItem,
} from '../types/payments.types';

interface PaymentProvidersPanelProps {
  drivers: readonly PaymentDriverMetadata[];
  providers: readonly PaymentProviderItem[];
  callbacks: readonly PaymentCallbackItem[];
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const PaymentProvidersPanel: React.FC<PaymentProvidersPanelProps> = ({
  drivers,
  providers,
  callbacks,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [providerCode, setProviderCode] = useState('sandbox');
  const [driverCode, setDriverCode] = useState<PaymentDriverCode>('sandbox');
  const [displayName, setDisplayName] = useState('Sandbox Default Gateway');
  const [isDefault, setIsDefault] = useState(true);
  const [supportsPartialRefund, setSupportsPartialRefund] = useState(true);
  const [secretJson, setSecretJson] = useState('{"webhookSecret":"whsec_sandbox_demo_2026"}');
  const [configJson, setConfigJson] = useState('{}');
  const [saving, setSaving] = useState(false);

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onFeedback(null);
    setSaving(true);
    try {
      const secrets = JSON.parse(secretJson || '{}') as Record<string, string>;
      const config = JSON.parse(configJson || '{}') as Record<string, unknown>;
      await paymentsApi.createProvider({
        providerCode,
        driverCode,
        displayName,
        isEnabled: true,
        isDefault,
        supportsPartialRefund,
        config,
        secrets,
      });
      onFeedback(`Đã tạo cổng thanh toán "${providerCode}" (${driverCode}).`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể tạo cổng thanh toán');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProvider = async (p: PaymentProviderItem) => {
    onError(null);
    try {
      await paymentsApi.deleteProvider(p.id);
      onFeedback(`Đã xóa cổng "${p.providerCode}".`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể xóa cổng thanh toán');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Supported drivers + Quick create */}
      <form
        onSubmit={(e) => void handleCreateProvider(e)}
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
          <Server size={18} />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Đăng ký cổng thanh toán (Sandbox / VNPay / MoMo / Stripe)
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Mã cổng (providerCode)</span>
            <input
              value={providerCode}
              onChange={(e) => setProviderCode(e.target.value)}
              required
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Driver</span>
            <select
              value={driverCode}
              onChange={(e) => setDriverCode(e.target.value as PaymentDriverCode)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            >
              {(drivers.length > 0
                ? drivers
                : [
                    { driverCode: 'sandbox', displayName: 'Sandbox' },
                    { driverCode: 'vnpay', displayName: 'VNPay' },
                    { driverCode: 'momo', displayName: 'MoMo' },
                    { driverCode: 'stripe', displayName: 'Stripe' },
                  ]
              ).map((d) => (
                <option key={d.driverCode} value={d.driverCode}>
                  {d.displayName} ({d.driverCode})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Tên hiển thị</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Config JSON (vd tmnCode / partnerCode)</span>
            <textarea
              rows={2}
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: 12 }}
            />
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span>Secrets JSON (mã hóa AES-256-GCM)</span>
            <textarea
              rows={2}
              value={secretJson}
              onChange={(e) => setSecretJson(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: 12 }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Đặt làm mặc định
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={supportsPartialRefund}
              onChange={(e) => setSupportsPartialRefund(e.target.checked)}
            />
            Hỗ trợ hoàn tiền một phần
          </label>

          <button
            type="submit"
            disabled={saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus size={14} /> {saving ? 'Đang lưu...' : 'Thêm cổng thanh toán'}
          </button>
        </div>
      </form>

      {/* Providers List */}
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
        <strong style={{ fontSize: 14 }}>Cổng thanh toán đã cấu hình ({providers.length})</strong>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '6px' }}>Mã cổng</th>
                <th style={{ padding: '6px' }}>Driver</th>
                <th style={{ padding: '6px' }}>Tiền tệ</th>
                <th style={{ padding: '6px' }}>Hoàn 1 phần</th>
                <th style={{ padding: '6px' }}>Trạng thái</th>
                <th style={{ padding: '6px' }}>Xóa</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '6px' }}>
                    <strong>{p.providerCode}</strong> {p.isDefault ? '★' : ''}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.displayName}</div>
                  </td>
                  <td style={{ padding: '6px' }}>{p.driverCode}</td>
                  <td style={{ padding: '6px' }}>{p.allowedCurrencies.join(', ')}</td>
                  <td style={{ padding: '6px' }}>{p.supportsPartialRefund ? 'Có' : 'Không'}</td>
                  <td style={{ padding: '6px' }}>{p.statusName}</td>
                  <td style={{ padding: '6px' }}>
                    <button
                      type="button"
                      onClick={() => void handleDeleteProvider(p)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#dc2626',
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Callback Logs */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={16} />
          <strong style={{ fontSize: 14 }}>Lịch sử Callback đã kiểm tra & che dữ liệu nhạy cảm</strong>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '6px' }}>Callback UID</th>
                <th style={{ padding: '6px' }}>Provider / Mã GD</th>
                <th style={{ padding: '6px' }}>Kết quả xác minh</th>
                <th style={{ padding: '6px' }}>Số tiền báo cáo</th>
                <th style={{ padding: '6px' }}>Lý do / Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {callbacks.map((cb) => (
                <tr key={cb.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '6px', fontFamily: 'monospace', fontSize: 11 }}>
                    {cb.callbackUid}
                  </td>
                  <td style={{ padding: '6px' }}>
                    {cb.providerCode} • {cb.paymentCode || '—'}
                  </td>
                  <td style={{ padding: '6px', fontWeight: 700 }}>
                    {cb.verificationStatusName} ({cb.signatureValid ? 'Sig OK' : 'Sig FAIL'})
                  </td>
                  <td style={{ padding: '6px' }}>
                    {formatMinorMoney(cb.reportedAmount, cb.reportedCurrency)}
                  </td>
                  <td style={{ padding: '6px', color: 'var(--text-muted)' }}>
                    {cb.rejectionReason || 'Hợp lệ'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
