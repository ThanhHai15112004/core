import React, { useState } from 'react';
import { Check, Copy, Download, Eye, EyeOff, Link2, Lock, Trash2 } from 'lucide-react';
import type { ObjectDetail, ObjectPreview } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { usePolling } from '../../hooks/usePolling';
import { SIGNED_URL_TTLS } from '../../constants/storage';
import { DbDrawer } from '../database/DbDrawer';
import { formatBytes } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/**
 * Chi tiết object: metadata (không tự tải nội dung), version, retention; thao tác Copy key, Download,
 * Signed URL, Preview (chỉ khi bấm), Delete — mỗi nút theo capability và env của backend.
 */
export const ObjectDrawer: React.FC<{
  objectKey: string;
  reloadKey: number;
  onClose: () => void;
  onDelete: (d: ObjectDetail, versionId?: string) => void;
  onOpenContainer: (c: string) => void;
}> = ({ objectKey, reloadKey, onClose, onDelete, onOpenContainer }) => {
  const { t, formatTime } = useLocale();
  const { data, error } = usePolling(() => storageApi.object(objectKey), `${objectKey}:${reloadKey}`, 60_000);
  const [copied, setCopied] = useState<string | null>(null);
  const [ttl, setTtl] = useState<number>(SIGNED_URL_TTLS[0]);
  const [signed, setSigned] = useState<{ url: string; expiresAt: string } | null>(null);
  const [preview, setPreview] = useState<ObjectPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const copy = (text: string, id: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };
  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const date = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString()} ${formatTime(Date.parse(iso), true)}` : NO_VALUE);
  const s = data?.settings;
  const retained = Boolean(data?.retention?.active);

  return (
    <DbDrawer
      title={<code className="cache-key-title">{objectKey}</code>}
      meta={data ? `${t(`storage.kind.${data.kind}`)} · ${formatBytes(data.size)}` : undefined}
      onClose={onClose}
    >
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {data && s && (
        <>
          <dl className="db-stat-grid">
            <div>
              <dt>{t('storage.object.size')}</dt>
              <dd className={data.large ? 'is-warn' : ''}>{formatBytes(data.size)}</dd>
            </div>
            <div>
              <dt>{t('storage.object.contentType')}</dt>
              <dd>{data.contentType ?? NO_VALUE}</dd>
            </div>
            <div>
              <dt>{t('storage.object.container')}</dt>
              <dd>
                <button type="button" className="ov-link" onClick={() => onOpenContainer(data.container)}>
                  <code>{data.container}</code>
                </button>
              </dd>
            </div>
            <div>
              <dt>{t('storage.object.modified')}</dt>
              <dd>{date(data.lastModified)}</dd>
            </div>
            <div>
              <dt>{t('storage.object.created')}</dt>
              <dd>{date(data.createdAt)}</dd>
            </div>
            {data.etag && (
              <div>
                <dt>ETag</dt>
                <dd>
                  <code>{data.etag}</code>
                </dd>
              </div>
            )}
            {data.storageClass && (
              <div>
                <dt>{t('storage.object.storageClass')}</dt>
                <dd>{data.storageClass}</dd>
              </div>
            )}
            {data.versionId && (
              <div>
                <dt>{t('storage.object.version')}</dt>
                <dd>
                  <code>{data.versionId}</code>
                </dd>
              </div>
            )}
            {data.checksum && (
              <div>
                <dt>Checksum</dt>
                <dd>
                  <code>{data.checksum}</code>
                </dd>
              </div>
            )}
          </dl>
          {data.large && <p className="scp-alert-warning">{t('storage.object.largeWarning')}</p>}
          {retained && data.retention && (
            <p className="scp-alert-warning">
              <Lock size={13} />{' '}
              {data.retention.legalHold
                ? t('storage.object.legalHold')
                : t('storage.object.retention', { mode: data.retention.mode ?? '', until: date(data.retention.retainUntil) })}
            </p>
          )}

          <div className="cache-drawer-actions">
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => copy(data.key, 'key')}>
              {copied === 'key' ? <Check size={13} /> : <Copy size={13} />} {copied === 'key' ? t('console.drawer.copied') : t('storage.object.copyKey')}
            </button>
            {s.download && (
              <a className="scp-btn scp-btn-sm scp-btn-secondary" href={storageApi.downloadUrl(data.key)} download>
                <Download size={13} /> {t('storage.object.download')}
              </a>
            )}
            {s.preview && data.previewable && (
              <button
                type="button"
                className="scp-btn scp-btn-sm scp-btn-secondary"
                disabled={busy === 'preview'}
                onClick={() => void run('preview', async () => setPreview(await storageApi.preview(data.key)))}
              >
                <Eye size={13} /> {t('storage.object.preview')}
              </button>
            )}
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-danger"
              disabled={!s.delete || retained}
              title={!s.delete ? t('storage.action.deleteDisabled') : retained ? t('storage.object.retentionBlocked') : undefined}
              onClick={() => onDelete(data)}
            >
              <Trash2 size={13} /> {data.versions ? t('storage.object.deleteCurrent') : t('storage.object.delete')}
            </button>
          </div>
          {actionError && <p className="scp-alert scp-alert-danger">{actionError}</p>}

          {s.signedUrl && (
            <div className="st-signed">
              <h4>
                <Link2 size={13} /> {t('storage.object.signedTitle')}
              </h4>
              <div className="st-signed-row">
                <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} aria-label={t('storage.object.expiresIn')}>
                  {SIGNED_URL_TTLS.filter((x) => x <= s.signedUrlMaxSec).map((x) => (
                    <option key={x} value={x}>
                      {t(`storage.object.ttl.${x}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="scp-btn scp-btn-sm scp-btn-secondary"
                  disabled={busy === 'signed'}
                  onClick={() => void run('signed', async () => setSigned(await storageApi.signedUrl(data.key, ttl)))}
                >
                  {t('storage.object.generate')}
                </button>
              </div>
              {signed && (
                <div className="st-signed-result">
                  <span>{t('storage.object.signedDone', { time: date(signed.expiresAt) })}</span>
                  <button type="button" className="ov-link" onClick={() => copy(signed.url, 'url')}>
                    {copied === 'url' ? <Check size={12} /> : <Copy size={12} />} {copied === 'url' ? t('console.drawer.copied') : t('storage.object.copyUrl')}
                  </button>
                </div>
              )}
            </div>
          )}

          <h4>{t('storage.object.content')}</h4>
          {preview ? (
            preview.kind === 'image' ? (
              <img className="st-preview-img" src={`data:${preview.contentType};base64,${preview.base64}`} alt={data.key} />
            ) : (
              <>
                <pre className="tr-code cache-value">{preview.text}</pre>
                <p className="pf-chart-note">
                  {[preview.redacted ? t('cache.key.redacted') : '', preview.truncated ? t('storage.object.previewTruncated') : ''].filter(Boolean).join(' ')}
                </p>
              </>
            )
          ) : (
            <div className="cache-value-hidden">
              <EyeOff size={16} />
              <span>
                <strong>{t('storage.object.metadataOnly')}</strong>
                <small>
                  {data.sensitive
                    ? t('storage.object.hidden.sensitive')
                    : !s.preview
                      ? t('storage.object.hidden.disabled')
                      : !data.previewable
                        ? t('storage.object.hidden.unsupported')
                        : t('storage.object.hidden.click')}
                </small>
              </span>
            </div>
          )}

          {data.versions && (
            <>
              <h4>{t('storage.object.versions', { count: data.versions.length })}</h4>
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead>
                    <tr>
                      <th>{t('storage.object.version')}</th>
                      <th>{t('storage.object.size')}</th>
                      <th>{t('storage.object.modified')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.versions.map((v) => (
                      <tr key={v.versionId}>
                        <td>
                          <code>{v.versionId.slice(0, 12)}</code>
                          {v.isLatest && <span className="pf-chip ov-tone-ok cache-chip">{t('storage.object.current')}</span>}
                          {v.deleteMarker && <span className="pf-chip ov-tone-warn cache-chip">{t('storage.object.deleteMarker')}</span>}
                        </td>
                        <td>{v.deleteMarker ? NO_VALUE : formatBytes(v.size)}</td>
                        <td>{date(v.lastModified)}</td>
                        <td className="db-actions-cell">
                          <button
                            type="button"
                            className="rt-icon-btn is-danger"
                            disabled={!s.delete || retained}
                            title={t('storage.object.deleteVersion')}
                            aria-label={t('storage.object.deleteVersion')}
                            onClick={() => onDelete(data, v.versionId)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </DbDrawer>
  );
};
