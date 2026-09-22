import React, { useState } from 'react';
import { Check, Copy, EyeOff, Trash2 } from 'lucide-react';
import type { KeyDetail } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { usePolling } from '../../hooks/usePolling';
import { DbDrawer } from '../database/DbDrawer';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatTtl } from '../../utils/cache-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Chi tiết key: metadata (type, TTL, kích thước, encoding), xem trước value đã che, Copy / Delete. */
export const KeyDrawer: React.FC<{
  cacheKey: string;
  reloadKey: number;
  onClose: () => void;
  onDelete: (d: KeyDetail) => void;
  onOpenNamespace: (ns: string) => void;
}> = ({ cacheKey, reloadKey, onClose, onDelete, onOpenNamespace }) => {
  const { t, locale } = useLocale();
  const { data, error } = usePolling(() => cacheApi.key(cacheKey), `${cacheKey}:${reloadKey}`, 15_000);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(data?.fullKey ?? cacheKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <DbDrawer
      title={<code className="cache-key-title">{cacheKey}</code>}
      meta={data ? t('cache.key.meta', { type: data.type.toUpperCase() }) : undefined}
      onClose={onClose}
    >
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {data && (
        <>
          <dl className="db-stat-grid">
            <div>
              <dt>{t('cache.key.type')}</dt>
              <dd>{data.type.toUpperCase()}</dd>
            </div>
            <div>
              <dt>{t('cache.key.ttl')}</dt>
              <dd>{data.ttlMs === null ? t('cache.ttl.none') : formatTtl(data.ttlMs)}</dd>
            </div>
            <div>
              <dt>{t('cache.key.size')}</dt>
              <dd className={data.large ? 'is-warn' : ''}>{formatBytes(data.bytes)}</dd>
            </div>
            <div>
              <dt>{t('cache.key.length')}</dt>
              <dd>{data.length === null ? NO_VALUE : formatCompact(data.length, locale)}</dd>
            </div>
            <div>
              <dt>{t('cache.key.encoding')}</dt>
              <dd>{data.encoding ?? NO_VALUE}</dd>
            </div>
            <div>
              <dt>{t('cache.key.namespace')}</dt>
              <dd>
                <button type="button" className="ov-link" onClick={() => onOpenNamespace(data.namespace)}>
                  <code>{data.namespace}</code>
                </button>
              </dd>
            </div>
          </dl>
          {data.large && <p className="scp-alert-warning">{t('cache.key.largeWarning')}</p>}
          <div className="cache-drawer-actions">
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : t('cache.key.copy')}
            </button>
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-danger"
              disabled={!data.actionsEnabled}
              title={!data.actionsEnabled ? t('cache.action.disabled') : undefined}
              onClick={() => onDelete(data)}
            >
              <Trash2 size={13} /> {t('cache.key.delete')}
            </button>
          </div>
          <h4>{t('cache.key.value')}</h4>
          {data.value.state === 'hidden' ? (
            <div className="cache-value-hidden">
              <EyeOff size={16} />
              <span>
                <strong>••••••••••••</strong>
                <small>{t(`cache.key.hidden.${data.value.reason}`)}</small>
              </span>
            </div>
          ) : (
            <>
              <pre className="tr-code cache-value">
                {typeof data.value.sample.value === 'string' ? data.value.sample.value : JSON.stringify(data.value.sample.value, null, 2)}
              </pre>
              <p className="pf-chart-note">
                {[
                  data.value.redacted ? t('cache.key.redacted') : '',
                  data.value.sample.truncated
                    ? data.value.sample.kind === 'entries' && data.value.sample.total !== null
                      ? t('cache.key.truncatedItems', { total: formatCompact(data.value.sample.total, locale) })
                      : t('cache.key.truncated')
                    : '',
                  t('cache.key.previewNote'),
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            </>
          )}
          <p className="pf-chart-note">
            {t('cache.key.fullKey')}: <code>{data.fullKey}</code>
          </p>
        </>
      )}
    </DbDrawer>
  );
};
