import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { notificationsApi } from '../services/notifications.api';
import type {
  NotificationDeliveryItem,
  NotificationPushSubscriptionItem,
  NotificationQuotaSummary,
  NotificationSuppressionItem,
  NotificationTemplateItem,
} from '../types/notifications.types';

export const NotificationChannelsOpsView: React.FC = () => {
  const [quota, setQuota] = useState<NotificationQuotaSummary | null>(null);
  const [templates, setTemplates] = useState<NotificationTemplateItem[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDeliveryItem[]>([]);
  const [suppressions, setSuppressions] = useState<NotificationSuppressionItem[]>([]);
  const [pushSubs, setPushSubs] = useState<NotificationPushSubscriptionItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [tplCode, setTplCode] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplChannel, setTplChannel] = useState('EMAIL');
  const [tplSubject, setTplSubject] = useState('');
  const [tplBody, setTplBody] = useState('');

  const [suppChannel, setSuppChannel] = useState('EMAIL');
  const [suppDest, setSuppDest] = useState('');
  const [pushToken, setPushToken] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, tRes, dRes, sRes, pRes] = await Promise.all([
        notificationsApi.getQuotaSummary().catch(() => null),
        notificationsApi.listTemplates().catch(() => ({ data: [] })),
        notificationsApi.listDeliveries().catch(() => ({ data: [] })),
        notificationsApi.listSuppressions().catch(() => ({ data: [] })),
        notificationsApi.listPushSubscriptions().catch(() => []),
      ]);
      if (qRes) setQuota(qRes);
      setTemplates(tRes.data ?? []);
      setDeliveries(dRes.data ?? []);
      setSuppressions(sRes.data ?? []);
      setPushSubs(pRes ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplCode.trim() || !tplBody.trim()) return;
    await notificationsApi.upsertTemplate({
      code: tplCode.trim(),
      name: tplName.trim() || tplCode.trim(),
      channel: tplChannel,
      subjectTemplate: tplSubject.trim() || null,
      bodyTemplate: tplBody.trim(),
    });
    setTplCode('');
    setTplName('');
    setTplSubject('');
    setTplBody('');
    await loadAll();
  };

  const handleAddSuppression = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suppDest.trim()) return;
    await notificationsApi.addSuppression({
      channel: suppChannel,
      destination: suppDest.trim(),
      reason: 'MANUAL_BLOCK',
    });
    setSuppDest('');
    await loadAll();
  };

  const handleRegisterPush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pushToken.trim()) return;
    await notificationsApi.registerPushSubscription({
      platform: 'WEB_PUSH',
      deviceToken: pushToken.trim(),
      deviceName: 'Web Browser Client',
    });
    setPushToken('');
    await loadAll();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* 1. Quota & Cost Summary */}
      <div className="glass" style={{ padding: 18, borderRadius: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16 }}>
            1. Chi phí & Giới hạn Nhà cung cấp (SMS / Email / Push Quota)
          </h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadAll()}
            disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} /> Làm mới
          </button>
        </div>

        {quota && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
            {quota.channels.map((ch) => (
              <div
                key={ch.channelName}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: 'rgba(15, 23, 42, 0.5)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {ch.channelName} ({ch.providerCode})
                </div>
                <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 6 }}>
                  Hôm nay: <b>{ch.dailySent}</b> gửi ({ch.dailyDelivered} nhận, {ch.dailyFailed}{' '}
                  lỗi, {ch.dailySuppressed} chặn)
                </div>
                {ch.channelName === 'SMS' && (
                  <div style={{ fontSize: 12.5, color: '#FBBF24', marginTop: 4 }}>
                    SMS Segments hôm nay: <b>{ch.dailySegments}</b> / {ch.dailyQuotaLimit} (
                    {ch.dailyUsagePercent}%)
                  </div>
                )}
                <div style={{ fontSize: 12.5, color: '#34D399', marginTop: 4 }}>
                  Chi phí ngày:{' '}
                  <b>
                    {ch.dailyCost.toLocaleString()} {ch.currency}
                  </b>{' '}
                  | Tháng:{' '}
                  <b>
                    {ch.monthlyCost.toLocaleString()} {ch.currency}
                  </b>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Deliveries Tracking & Retry */}
      <div className="glass" style={{ padding: 18, borderRadius: 14 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16 }}>
            2. Theo dõi trạng thái gửi (Queued / Sent / Delivered / Failed / Suppressed)
          </h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await notificationsApi.retryDueDeliveries();
              await loadAll();
            }}
          >
            Chạy Auto-Retry các tin lỗi tạm thời
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Kênh / Provider</th>
                <th>Đích nhận</th>
                <th>Batch</th>
                <th>Trạng thái</th>
                <th>Thử lại</th>
                <th>Segments / Chi phí</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.slice(0, 15).map((d) => (
                <tr key={d.id}>
                  <td>#{d.id}</td>
                  <td>
                    {d.channelName} ({d.providerCode})
                  </td>
                  <td>{d.destination}</td>
                  <td>{d.batchKey ?? '-'}</td>
                  <td>
                    <b>{d.statusName}</b>
                    {d.errorMessage ? ` — ${d.errorMessage}` : ''}
                  </td>
                  <td>
                    {d.attemptCount}/{d.maxAttempts}
                  </td>
                  <td>
                    {d.segmentsCount} seg / {d.estimatedCost} {d.currency}
                  </td>
                  <td>
                    {(d.statusName === 'QUEUED' || d.statusName === 'FAILED') && (
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: 11.5 }}
                        onClick={async () => {
                          await notificationsApi.retryDelivery(d.id);
                          await loadAll();
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {deliveries.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', opacity: 0.65 }}>
                    Chưa có bản ghi gửi kênh ngoài.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Templates & Suppressions & Push Subscriptions */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: 16,
        }}
      >
        <div className="glass" style={{ padding: 18, borderRadius: 14 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>
            3. Quản lý Template ({templates.length})
          </h3>
          <form
            onSubmit={(e) => void handleCreateTemplate(e)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                placeholder="Mã Template (VD: ORDER_CREATED)"
                value={tplCode}
                onChange={(e) => setTplCode(e.target.value)}
              />
              <select
                className="form-input"
                value={tplChannel}
                onChange={(e) => setTplChannel(e.target.value)}
                style={{ maxWidth: 120 }}
              >
                <option value="EMAIL">EMAIL</option>
                <option value="SMS">SMS</option>
                <option value="PUSH">PUSH</option>
              </select>
            </div>
            <input
              className="form-input"
              placeholder="Tiêu đề mẫu (VD: Xin chào {{fullName}})"
              value={tplSubject}
              onChange={(e) => setTplSubject(e.target.value)}
            />
            <textarea
              className="form-input"
              rows={2}
              placeholder="Nội dung mẫu ({{content}})"
              value={tplBody}
              onChange={(e) => setTplBody(e.target.value)}
            />
            <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-start' }}>
              Lưu Template
            </button>
          </form>
          <div style={{ maxHeight: 160, overflowY: 'auto', fontSize: 12 }}>
            {templates.map((t) => (
              <div
                key={t.id}
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid rgba(148,163,184,0.12)',
                }}
              >
                <b>{t.code}</b> ({t.channelName} - {t.locale}): {t.bodyTemplate.slice(0, 70)}...
              </div>
            ))}
          </div>
        </div>

        <div className="glass" style={{ padding: 18, borderRadius: 14 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>
            4. Suppression List ({suppressions.length}) & Push Token ({pushSubs.length})
          </h3>
          <form
            onSubmit={(e) => void handleAddSuppression(e)}
            style={{ display: 'flex', gap: 8, marginBottom: 10 }}
          >
            <select
              className="form-input"
              value={suppChannel}
              onChange={(e) => setSuppChannel(e.target.value)}
              style={{ maxWidth: 110 }}
            >
              <option value="EMAIL">EMAIL</option>
              <option value="SMS">SMS</option>
              <option value="PUSH">PUSH</option>
            </select>
            <input
              className="form-input"
              placeholder="Địa chỉ email / SĐT / Token chặn..."
              value={suppDest}
              onChange={(e) => setSuppDest(e.target.value)}
            />
            <button type="submit" className="btn-secondary">
              Chặn
            </button>
          </form>

          <form
            onSubmit={(e) => void handleRegisterPush(e)}
            style={{ display: 'flex', gap: 8, marginBottom: 10 }}
          >
            <input
              className="form-input"
              placeholder="Đăng ký Push Device Token..."
              value={pushToken}
              onChange={(e) => setPushToken(e.target.value)}
            />
            <button type="submit" className="btn-secondary">
              Đăng ký Push
            </button>
          </form>

          <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 12 }}>
            {suppressions.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '5px 0',
                  borderBottom: '1px solid rgba(148,163,184,0.12)',
                }}
              >
                <span>
                  [{s.channelName}] <b>{s.destination}</b> ({s.reasonName})
                </span>
                {s.isActive && (
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#F87171',
                      cursor: 'pointer',
                    }}
                    onClick={async () => {
                      await notificationsApi.removeSuppression(s.id);
                      await loadAll();
                    }}
                  >
                    Gỡ chặn
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
