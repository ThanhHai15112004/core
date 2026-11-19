import React, { useState } from 'react';
import {
  Copy,
  Edit3,
  KeyRound,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { inboundWebhooksApi } from '../services/inbound-webhooks.api';
import type {
  InboundWebhookAuthType,
  InboundWebhookProviderItem,
  InboundWebhookSignatureFormat,
} from '../types/inbound-webhooks.types';

interface InboundWebhookProvidersPanelProps {
  providers: readonly InboundWebhookProviderItem[];
  revealedSecret: { providerName: string; signingSecret: string } | null;
  onClearRevealedSecret: () => void;
  onRevealSecret: (data: { providerName: string; signingSecret: string }) => void;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const InboundWebhookProvidersPanel: React.FC<InboundWebhookProvidersPanelProps> = ({
  providers,
  revealedSecret,
  onClearRevealedSecret,
  onRevealSecret,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [providerCode, setProviderCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [authType, setAuthType] = useState<InboundWebhookAuthType>('HMAC_SHA256');
  const [signingSecret, setSigningSecret] = useState('');
  const [signatureHeader, setSignatureHeader] = useState('x-webhook-signature');
  const [signaturePrefix, setSignaturePrefix] = useState('v1=');
  const [signatureFormat, setSignatureFormat] =
    useState<InboundWebhookSignatureFormat>('TIMESTAMP_DOT_BODY');
  const [timestampHeader, setTimestampHeader] = useState('x-webhook-timestamp');
  const [requireTimestamp, setRequireTimestamp] = useState(true);
  const [toleranceSec, setToleranceSec] = useState('300');
  const [eventIdHeader, setEventIdHeader] = useState('x-webhook-id');
  const [eventIdPayloadPath, setEventIdPayloadPath] = useState('id');
  const [eventTypeHeader, setEventTypeHeader] = useState('x-webhook-event');
  const [eventTypePayloadPath, setEventTypePayloadPath] = useState('type');
  const [sensitiveFieldsInput, setSensitiveFieldsInput] = useState('');
  const [maxRetries, setMaxRetries] = useState('3');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setProviderCode('');
    setName('');
    setDescription('');
    setAuthType('HMAC_SHA256');
    setSigningSecret('');
    setSignatureHeader('x-webhook-signature');
    setSignaturePrefix('v1=');
    setSignatureFormat('TIMESTAMP_DOT_BODY');
    setTimestampHeader('x-webhook-timestamp');
    setRequireTimestamp(true);
    setToleranceSec('300');
    setEventIdHeader('x-webhook-id');
    setEventIdPayloadPath('id');
    setEventTypeHeader('x-webhook-event');
    setEventTypePayloadPath('type');
    setSensitiveFieldsInput('');
    setMaxRetries('3');
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (p: InboundWebhookProviderItem) => {
    setEditingId(p.id);
    setProviderCode(p.providerCode);
    setName(p.name);
    setDescription(p.description ?? '');
    setAuthType(p.authType);
    setSigningSecret('');
    setSignatureHeader(p.signatureHeader);
    setSignaturePrefix(p.signaturePrefix ?? '');
    setSignatureFormat(p.signatureFormat);
    setTimestampHeader(p.timestampHeader);
    setRequireTimestamp(p.requireTimestamp);
    setToleranceSec(String(p.toleranceSec));
    setEventIdHeader(p.eventIdHeader);
    setEventIdPayloadPath(p.eventIdPayloadPath ?? '');
    setEventTypeHeader(p.eventTypeHeader);
    setEventTypePayloadPath(p.eventTypePayloadPath ?? '');
    setSensitiveFieldsInput(p.sensitiveFields.join(', '));
    setMaxRetries(String(p.maxRetries));
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onFeedback(null);
    setSubmitting(true);

    try {
      const sensitiveFields = sensitiveFieldsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const commonPayload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        authType,
        signatureHeader: signatureHeader.trim(),
        signaturePrefix: signaturePrefix.length ? signaturePrefix : null,
        signatureFormat,
        timestampHeader: timestampHeader.trim(),
        requireTimestamp,
        toleranceSec: Number(toleranceSec) || 300,
        eventIdHeader: eventIdHeader.trim(),
        eventIdPayloadPath: eventIdPayloadPath.trim() || null,
        eventTypeHeader: eventTypeHeader.trim(),
        eventTypePayloadPath: eventTypePayloadPath.trim() || null,
        sensitiveFields,
        maxRetries: Number(maxRetries) >= 0 ? Number(maxRetries) : 3,
      };

      if (editingId) {
        const updated = await inboundWebhooksApi.updateProvider(editingId, commonPayload);
        onFeedback(`Đã cập nhật Inbound Provider "${updated.name}".`);
      } else {
        const created = await inboundWebhooksApi.createProvider({
          ...commonPayload,
          providerCode: providerCode.trim().toLowerCase(),
          ...(signingSecret.trim() ? { signingSecret: signingSecret.trim() } : {}),
        });
        onRevealSecret({
          providerName: created.name,
          signingSecret: created.signingSecret,
        });
        onFeedback(`Đã tạo Inbound Provider "${created.name}" (${created.providerCode}).`);
      }

      setShowForm(false);
      resetForm();
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Lưu Inbound Provider thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePause = async (p: InboundWebhookProviderItem) => {
    onError(null);
    onFeedback(null);
    try {
      const nextStatus = p.statusName === 'ACTIVE' ? 2 : 1;
      await inboundWebhooksApi.updateProvider(p.id, {
        status: nextStatus,
        reason: nextStatus === 2 ? 'Paused from UI' : 'Activated from UI',
      });
      onFeedback(
        nextStatus === 2
          ? `Đã tạm dừng Inbound Provider "${p.name}".`
          : `Đã kích hoạt lại Inbound Provider "${p.name}".`,
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể đổi trạng thái Provider');
    }
  };

  const handleRotateSecret = async (p: InboundWebhookProviderItem) => {
    if (
      !window.confirm(
        `Xoay khóa bí mật xác thực cho Inbound Provider "${p.name}"? Khóa cũ sẽ ngừng hợp lệ ngay.`,
      )
    ) {
      return;
    }
    onError(null);
    onFeedback(null);
    try {
      const rotated = await inboundWebhooksApi.rotateSecret(p.id, {
        reason: 'Rotated from UI',
      });
      onRevealSecret({
        providerName: rotated.name,
        signingSecret: rotated.signingSecret,
      });
      onFeedback(`Đã xoay secret mới cho "${rotated.name}".`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể xoay secret');
    }
  };

  const handleSimulate = async (p: InboundWebhookProviderItem) => {
    onError(null);
    onFeedback(null);
    try {
      const res = await inboundWebhooksApi.simulateWebhook(p.id, {
        eventType: 'webhook.simulated',
        payload: {
          source: 'admin-ui',
          customerEmail: 'customer@example.com',
          secretToken: 'should-be-redacted',
          amount: 100000,
        },
      });
      onFeedback(
        `Đã gửi giả lập thành công sự kiện ${res.generatedEventId} vào ${p.providerCode} (Event #${res.receiveResult.eventId}, trạng thái ${res.receiveResult.statusName}).`,
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể giả lập webhook');
    }
  };

  const handleDelete = async (p: InboundWebhookProviderItem) => {
    if (!window.confirm(`Xóa Inbound Provider "${p.name}" (${p.providerCode})?`)) return;
    onError(null);
    onFeedback(null);
    try {
      await inboundWebhooksApi.deleteProvider(p.id);
      onFeedback(`Đã xóa Inbound Provider "${p.name}".`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể xóa Provider');
    }
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {revealedSecret && (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: '1px solid rgba(217,119,6,0.4)',
            background: 'rgba(217,119,6,0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              Signing Secret của &ldquo;{revealedSecret.providerName}&rdquo; (chỉ hiển thị một lần)
            </div>
            <code
              style={{
                display: 'inline-block',
                marginTop: 6,
                padding: '4px 8px',
                borderRadius: 6,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                fontSize: 12,
              }}
            >
              {revealedSecret.signingSecret}
            </code>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(revealedSecret.signingSecret)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Copy size={13} /> Sao chép
            </button>
            <button
              type="button"
              onClick={onClearRevealedSecret}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: 6,
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                cursor: 'pointer',
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Tổng số: <strong>{providers.length}</strong> Inbound Webhook Providers
        </div>
        <button
          type="button"
          onClick={openCreateForm}
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
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <Plus size={14} /> Tạo Inbound Provider
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{
            padding: 16,
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {editingId ? `Cập nhật Provider #${editingId}` : 'Thêm Inbound Webhook Provider'}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Mã Provider (slug) *</span>
              <input
                required
                disabled={Boolean(editingId)}
                value={providerCode}
                onChange={(e) => setProviderCode(e.target.value)}
                placeholder="stripe / github / sepay"
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Tên hiển thị *</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stripe Payments"
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Phương thức xác thực</span>
              <select
                value={authType}
                onChange={(e) => setAuthType(e.target.value as InboundWebhookAuthType)}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              >
                <option value="HMAC_SHA256">HMAC_SHA256</option>
                <option value="HMAC_SHA512">HMAC_SHA512</option>
                <option value="STATIC_TOKEN">STATIC_TOKEN</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Định dạng ký</span>
              <select
                value={signatureFormat}
                onChange={(e) =>
                  setSignatureFormat(e.target.value as InboundWebhookSignatureFormat)
                }
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              >
                <option value="TIMESTAMP_DOT_BODY">TIMESTAMP_DOT_BODY</option>
                <option value="RAW_BODY">RAW_BODY</option>
              </select>
            </label>
          </div>

          {!editingId && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Signing Secret / Token (để trống để hệ thống tự sinh ngẫu nhiên)</span>
              <input
                value={signingSecret}
                onChange={(e) => setSigningSecret(e.target.value)}
                placeholder="Tùy chọn nhập secret từ nhà cung cấp ngoài (>= 8 ký tự)"
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 10,
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Signature / Token Header</span>
              <input
                value={signatureHeader}
                onChange={(e) => setSignatureHeader(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Prefix chữ ký (vd: v1=, sha256=)</span>
              <input
                value={signaturePrefix}
                onChange={(e) => setSignaturePrefix(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Timestamp Header</span>
              <input
                value={timestampHeader}
                onChange={(e) => setTimestampHeader(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Dung sai thời gian (giây)</span>
              <input
                type="number"
                min={10}
                max={86400}
                value={toleranceSec}
                onChange={(e) => setToleranceSec(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 10,
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Event ID Header</span>
              <input
                value={eventIdHeader}
                onChange={(e) => setEventIdHeader(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Event ID Payload Path</span>
              <input
                value={eventIdPayloadPath}
                onChange={(e) => setEventIdPayloadPath(e.target.value)}
                placeholder="id"
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Event Type Header</span>
              <input
                value={eventTypeHeader}
                onChange={(e) => setEventTypeHeader(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Event Type Payload Path</span>
              <input
                value={eventTypePayloadPath}
                onChange={(e) => setEventTypePayloadPath(e.target.value)}
                placeholder="type"
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr auto',
              gap: 10,
              alignItems: 'end',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Field nhạy cảm cần che thêm (phân cách bằng dấu phẩy)</span>
              <input
                value={sensitiveFieldsInput}
                onChange={(e) => setSensitiveFieldsInput(e.target.value)}
                placeholder="cardFingerprint, bankAccount, customer.taxCode"
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Max Retries (Queue)</span>
              <input
                type="number"
                min={0}
                max={9}
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, paddingBottom: 6 }}>
              <input
                type="checkbox"
                checked={requireTimestamp}
                onChange={(e) => setRequireTimestamp(e.target.checked)}
              />
              <span>Bắt buộc Timestamp</span>
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <span>Mô tả</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả tích hợp nhà cung cấp ngoài"
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {submitting ? 'Đang lưu...' : editingId ? 'Lưu cập nhật' : 'Tạo Provider'}
            </button>
          </div>
        </form>
      )}

      <div
        style={{
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          overflowX: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ padding: 12 }}>Provider &amp; Endpoint URL</th>
              <th style={{ padding: 12 }}>Xác thực &amp; Chống Replay</th>
              <th style={{ padding: 12 }}>Secret Prefix</th>
              <th style={{ padding: 12 }}>Trạng thái</th>
              <th style={{ padding: 12 }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {providers.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Chưa có Inbound Webhook Provider nào.
                </td>
              </tr>
            ) : (
              providers.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: 12 }}>
                    <div style={{ fontWeight: 700 }}>
                      {p.name} (<code>{p.providerCode}</code>)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        POST {p.receivePath}
                      </code>
                      <button
                        type="button"
                        title="Sao chép endpoint URL"
                        onClick={() =>
                          void navigator.clipboard?.writeText(
                            `${window.location.origin}${p.receivePath}`,
                          )
                        }
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '2px 5px',
                          borderRadius: 4,
                          border: '1px solid var(--border-subtle)',
                          background: 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <Copy size={11} />
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: 12 }}>
                    <div>
                      <strong>{p.authType}</strong> ({p.signatureFormat})
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Sig: <code>{p.signatureHeader}</code> • Window: {p.toleranceSec}s
                    </div>
                  </td>
                  <td style={{ padding: 12 }}>
                    <code>{p.signingSecretPrefix}</code>
                  </td>
                  <td style={{ padding: 12 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background:
                          p.statusName === 'ACTIVE'
                            ? 'rgba(5,150,105,0.12)'
                            : 'rgba(217,119,6,0.12)',
                        color: p.statusName === 'ACTIVE' ? '#059669' : '#d97706',
                      }}
                    >
                      {p.statusName}
                    </span>
                  </td>
                  <td style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        disabled={p.statusName !== 'ACTIVE'}
                        onClick={() => void handleSimulate(p)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: 'transparent',
                          fontSize: 11,
                          cursor: p.statusName === 'ACTIVE' ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <Send size={12} /> Giả lập
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTogglePause(p)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: 'transparent',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        {p.statusName === 'ACTIVE' ? (
                          <>
                            <Pause size={12} /> Tạm dừng
                          </>
                        ) : (
                          <>
                            <Play size={12} /> Kích hoạt
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditForm(p)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: 'transparent',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        <Edit3 size={12} /> Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRotateSecret(p)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: 'transparent',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        <KeyRound size={12} /> Rotate
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(p)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: '1px solid rgba(220,38,38,0.3)',
                          color: '#dc2626',
                          background: 'transparent',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={12} /> Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
