import React, { useState } from 'react';
import {
  Plus,
  Play,
  Pause,
  RotateCcw,
  KeyRound,
  Trash2,
  Send,
  Edit3,
  AlertTriangle,
  Copy,
  X,
} from 'lucide-react';
import { webhooksApi } from '../services/webhooks.api';
import type {
  WebhookEndpointItem,
  WebhookEventCatalogItem,
} from '../types/webhooks.types';

interface WebhookEndpointsPanelProps {
  endpoints: readonly WebhookEndpointItem[];
  eventsCatalog: readonly WebhookEventCatalogItem[];
  revealedSecret: { endpointName: string; signingSecret: string } | null;
  onClearRevealedSecret: () => void;
  onRevealSecret: (data: { endpointName: string; signingSecret: string }) => void;
  onRefresh: () => Promise<void>;
  onError: (msg: string | null) => void;
  onFeedback: (msg: string | null) => void;
}

export const WebhookEndpointsPanel: React.FC<WebhookEndpointsPanelProps> = ({
  endpoints,
  eventsCatalog,
  revealedSecret,
  onClearRevealedSecret,
  onRevealSecret,
  onRefresh,
  onError,
  onFeedback,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [customEventInput, setCustomEventInput] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('10000');
  const [maxRetries, setMaxRetries] = useState('5');
  const [failureThreshold, setFailureThreshold] = useState('10');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setUrl('');
    setSelectedEvents([]);
    setCustomEventInput('');
    setTimeoutMs('10000');
    setMaxRetries('5');
    setFailureThreshold('10');
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (ep: WebhookEndpointItem) => {
    setEditingId(ep.id);
    setName(ep.name);
    setDescription(ep.description ?? '');
    setUrl(ep.url);
    setSelectedEvents([...ep.events]);
    setCustomEventInput('');
    setTimeoutMs(String(ep.timeoutMs));
    setMaxRetries(String(ep.maxRetries));
    setFailureThreshold(String(ep.failureThreshold));
    setShowForm(true);
  };

  const toggleCatalogEvent = (eventName: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventName) ? prev.filter((e) => e !== eventName) : [...prev, eventName],
    );
  };

  const addCustomEvent = () => {
    const clean = customEventInput.trim().toLowerCase();
    if (!clean) return;
    if (!selectedEvents.includes(clean)) {
      setSelectedEvents((prev) => [...prev, clean]);
    }
    setCustomEventInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    onFeedback(null);

    if (selectedEvents.length === 0) {
      onError('Vui lòng chọn hoặc nhập ít nhất 1 sự kiện đăng ký.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        url: url.trim(),
        events: selectedEvents,
        timeoutMs: Number(timeoutMs) || 10000,
        maxRetries: Number(maxRetries) >= 0 ? Number(maxRetries) : 5,
        failureThreshold: Number(failureThreshold) || 10,
      };

      if (editingId) {
        const updated = await webhooksApi.updateEndpoint(editingId, payload);
        onFeedback(`Đã cập nhật Webhook Endpoint "${updated.name}".`);
      } else {
        const created = await webhooksApi.createEndpoint(payload);
        onRevealSecret({
          endpointName: created.name,
          signingSecret: created.signingSecret,
        });
        onFeedback(`Đã tạo Webhook Endpoint "${created.name}" thành công.`);
      }

      setShowForm(false);
      resetForm();
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Lưu Webhook Endpoint thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePause = async (ep: WebhookEndpointItem) => {
    onError(null);
    onFeedback(null);
    try {
      if (ep.statusName === 'ACTIVE') {
        await webhooksApi.updateEndpoint(ep.id, { status: 2, reason: 'Paused from UI' });
        onFeedback(`Đã tạm dừng endpoint "${ep.name}".`);
      } else {
        await webhooksApi.reactivateEndpoint(ep.id, 'Reactivated from UI');
        onFeedback(`Đã kích hoạt lại endpoint "${ep.name}".`);
      }
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể đổi trạng thái endpoint');
    }
  };

  const handleRotateSecret = async (ep: WebhookEndpointItem) => {
    if (!window.confirm(`Xoay Signing Secret cho endpoint "${ep.name}"? Secret cũ sẽ hết hiệu lực ngay.`)) {
      return;
    }
    onError(null);
    onFeedback(null);
    try {
      const rotated = await webhooksApi.rotateSecret(ep.id);
      onRevealSecret({
        endpointName: rotated.name,
        signingSecret: rotated.signingSecret,
      });
      onFeedback(`Đã xoay secret mới cho "${rotated.name}".`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể xoay secret');
    }
  };

  const handleSendTest = async (ep: WebhookEndpointItem) => {
    onError(null);
    onFeedback(null);
    const firstConcreteEvent =
      ep.events.find((evt) => evt !== '*' && !evt.endsWith('.*')) ?? 'webhook.test';
    try {
      const delivery = await webhooksApi.sendTestEvent(ep.id, {
        eventName: firstConcreteEvent,
        payload: {
          message: `Test webhook event from UI for ${ep.name}`,
          triggeredAt: new Date().toISOString(),
        },
      });
      onFeedback(
        `Đã đẩy sự kiện test "${delivery.eventName}" vào Queue (Delivery #${delivery.id}).`,
      );
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể gửi sự kiện test');
    }
  };

  const handleDelete = async (ep: WebhookEndpointItem) => {
    if (!window.confirm(`Xóa Webhook Endpoint "${ep.name}"?`)) return;
    onError(null);
    onFeedback(null);
    try {
      await webhooksApi.deleteEndpoint(ep.id);
      onFeedback(`Đã xóa endpoint "${ep.name}".`);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Không thể xóa endpoint');
    }
  };

  const renderStatusBadge = (ep: WebhookEndpointItem) => {
    const colorMap: Record<WebhookEndpointItem['statusName'], { bg: string; color: string; label: string }> = {
      ACTIVE: { bg: 'rgba(5,150,105,0.12)', color: '#059669', label: 'ACTIVE' },
      PAUSED: { bg: 'rgba(217,119,6,0.12)', color: '#d97706', label: 'PAUSED' },
      AUTO_DISABLED: { bg: 'rgba(220,38,38,0.12)', color: '#dc2626', label: 'AUTO_DISABLED' },
    };
    const cfg = colorMap[ep.statusName];
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          background: cfg.bg,
          color: cfg.color,
        }}
      >
        {cfg.label}
      </span>
    );
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Banner hiển thị Secret 1 lần */}
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
              Signing Secret của &ldquo;{revealedSecret.endpointName}&rdquo; (chỉ hiển thị một lần)
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

      {/* Thanh hành động */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Tổng số: <strong>{endpoints.length}</strong> Webhook Endpoints
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
          <Plus size={14} /> Tạo Webhook Endpoint
        </button>
      </div>

      {/* Form Tạo / Sửa */}
      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{
            padding: 18,
            borderRadius: 12,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {editingId ? `Cập nhật Endpoint #${editingId}` : 'Tạo Webhook Endpoint mới'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Tên Endpoint *</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: CRM User Sync"
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Target URL (HTTPS, chống SSRF) *</span>
              <input
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://partner.example.com/webhooks"
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <span>Mô tả</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ghi chú mục đích tích hợp"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Timeout (ms)</span>
              <input
                type="number"
                min={1000}
                max={60000}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Số lần retry tối đa</span>
              <input
                type="number"
                min={0}
                max={9}
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Ngưỡng tự khóa (lỗi liên tiếp)</span>
              <input
                type="number"
                min={2}
                max={100}
                value={failureThreshold}
                onChange={(e) => setFailureThreshold(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            <span>Chọn sự kiện đăng ký ({selectedEvents.length} đã chọn) *</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                value={customEventInput}
                onChange={(e) => setCustomEventInput(e.target.value)}
                placeholder="Nhập sự kiện tùy chỉnh (vd: payment.completed, user.*)"
                style={{
                  flex: 1,
                  minWidth: 240,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                }}
              />
              <button
                type="button"
                onClick={addCustomEvent}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-subtle, rgba(37,99,235,0.08))',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                + Thêm sự kiện
              </button>
            </div>
            {selectedEvents.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {selectedEvents.map((evt) => (
                  <span
                    key={evt}
                    onClick={() => toggleCatalogEvent(evt)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      background: 'rgba(37,99,235,0.12)',
                      color: '#2563eb',
                      cursor: 'pointer',
                    }}
                  >
                    {evt} ×
                  </span>
                ))}
              </div>
            )}
            <div
              style={{
                maxHeight: 160,
                overflowY: 'auto',
                padding: 10,
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 6,
              }}
            >
              {eventsCatalog.map((item) => (
                <label
                  key={item.eventName}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(item.eventName)}
                    onChange={() => toggleCatalogEvent(item.eventName)}
                  />
                  <span>{item.eventName}</span>
                </label>
              ))}
            </div>
          </div>

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
              {submitting ? 'Đang lưu...' : editingId ? 'Lưu cập nhật' : 'Tạo Endpoint'}
            </button>
          </div>
        </form>
      )}

      {/* Bảng Endpoints */}
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
              <th style={{ padding: 12 }}>Endpoint</th>
              <th style={{ padding: 12 }}>Sự kiện</th>
              <th style={{ padding: 12 }}>Secret Prefix</th>
              <th style={{ padding: 12 }}>Trạng thái &amp; Lỗi</th>
              <th style={{ padding: 12 }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Chưa có Webhook Endpoint nào.
                </td>
              </tr>
            ) : (
              endpoints.map((ep) => (
                <tr key={ep.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: 12 }}>
                    <div style={{ fontWeight: 700 }}>{ep.name}</div>
                    <div style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{ep.url}</div>
                    {ep.description && (
                      <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{ep.description}</div>
                    )}
                  </td>
                  <td style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {ep.events.map((evt) => (
                        <span
                          key={evt}
                          style={{
                            padding: '2px 6px',
                            borderRadius: 6,
                            background: 'var(--bg-subtle, rgba(148,163,184,0.15))',
                            fontSize: 11,
                          }}
                        >
                          {evt}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: 12 }}>
                    <code>{ep.signingSecretPrefix}</code>
                  </td>
                  <td style={{ padding: 12 }}>
                    <div>{renderStatusBadge(ep)}</div>
                    <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11 }}>
                      Lỗi liên tiếp: {ep.consecutiveFailures}/{ep.failureThreshold} • Retry max: {ep.maxRetries}
                    </div>
                    {ep.statusName === 'AUTO_DISABLED' && ep.disabledReason && (
                      <div
                        style={{
                          marginTop: 4,
                          color: '#dc2626',
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <AlertTriangle size={12} /> {ep.disabledReason}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        title="Gửi sự kiện test"
                        disabled={ep.statusName !== 'ACTIVE'}
                        onClick={() => void handleSendTest(ep)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: 'transparent',
                          fontSize: 11,
                          cursor: ep.statusName === 'ACTIVE' ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <Send size={12} /> Test
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTogglePause(ep)}
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
                        {ep.statusName === 'ACTIVE' ? (
                          <>
                            <Pause size={12} /> Tạm dừng
                          </>
                        ) : (
                          <>
                            {ep.statusName === 'AUTO_DISABLED' ? <RotateCcw size={12} /> : <Play size={12} />}
                            {ep.statusName === 'AUTO_DISABLED' ? 'Mở khóa' : 'Kích hoạt'}
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditForm(ep)}
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
                        onClick={() => void handleRotateSecret(ep)}
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
                        onClick={() => void handleDelete(ep)}
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
