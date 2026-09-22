import React, { useState } from 'react';
import { Key, RefreshCw, ShieldCheck, Search, AlertTriangle, Lock } from 'lucide-react';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatCard } from '../components/common/StatCard';
import { StatusPill } from '../components/common/StatusPill';
import { usePackage } from '../hooks/usePackage';
import { decodeJwt, type DecodedJwt } from '../utils/jwt';
import { useLocale } from '../../../core/i18n/index';

const NO_VALUE = '--';

const jsonBoxStyle: React.CSSProperties = {
  border: '1px solid var(--scp-border-subtle)',
  borderRadius: '8px',
  padding: '0.75rem',
  backgroundColor: 'var(--scp-bg-surface-subtle)',
};

const jsonLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 700,
  color: 'var(--scp-text-muted)',
  textTransform: 'uppercase',
};

export const SecuritySection: React.FC = () => {
  const { t } = useLocale();
  const { pkg, metric } = usePackage('security');
  const [tokenInput, setTokenInput] = useState('');
  const [decoded, setDecoded] = useState<DecodedJwt | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const isSkeleton = metric('tokenVerification') === 'skeleton';

  const handleDecode = (value: string) => {
    setTokenInput(value);
    setDecoded(null);
    setDecodeError(null);
    if (!value.trim()) return;

    try {
      setDecoded(decodeJwt(value));
    } catch (err) {
      setDecodeError(
        err instanceof Error && err.message === 'format'
          ? t('console.security.decoder.invalidFormat')
          : t('console.security.decoder.decodeFailed'),
      );
    }
  };

  return (
    <div>
      <SectionHeader title={t('console.security.title')} description={t('console.security.description')} />

      {isSkeleton && (
        <div className="scp-alert scp-alert-danger" role="alert">
          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={16} />
            <span>{t('console.security.skeletonTitle')}</span>
          </strong>
          <p style={{ margin: '0.25rem 0 0' }}>{pkg?.statusReport.summary}</p>
        </div>
      )}

      <div className="overview-grid-4">
        <StatCard
          title={t('console.security.accessTtl')}
          value={String(metric('accessExpiration') ?? NO_VALUE)}
          icon={<Key size={18} />}
          subtext="JWT_ACCESS_EXPIRATION"
        />
        <StatCard
          title={t('console.security.refreshTtl')}
          value={String(metric('refreshExpiration') ?? NO_VALUE)}
          icon={<RefreshCw size={18} />}
          subtext="JWT_REFRESH_EXPIRATION"
        />
        <StatCard
          title={t('console.security.secretDriver')}
          value={String(metric('secretDriver') ?? NO_VALUE).toUpperCase()}
          icon={<Lock size={18} />}
          subtext="SECRET_DRIVER"
        />
        <StatCard
          title={t('console.security.authGuard')}
          value={metric('globalAuthGuard') ? t('console.common.enabled') : NO_VALUE}
          icon={<ShieldCheck size={18} />}
          subtext={
            <StatusPill
              status={isSkeleton ? 'warning' : 'healthy'}
              label={isSkeleton ? t('console.security.verificationSkeleton') : t('console.common.enabled')}
            />
          }
        />
      </div>

      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Search size={16} />
              <span>{t('console.security.decoder.title')}</span>
            </span>
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
            {t('console.security.decoder.clientOnly')}
          </span>
        </div>

        <label
          htmlFor="jwt-input"
          style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--scp-text-secondary)', display: 'block', marginBottom: '0.4rem' }}
        >
          {t('console.security.decoder.inputLabel')}
        </label>
        <textarea
          id="jwt-input"
          className="scp-textarea"
          rows={3}
          placeholder="eyJhbGciOi..."
          value={tokenInput}
          onChange={(e) => handleDecode(e.target.value)}
        />

        {decodeError && (
          <div style={{ marginTop: '1rem', color: 'var(--scp-danger)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={15} />
            <span>{decodeError}</span>
          </div>
        )}

        {decoded && (
          <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
            <div style={jsonBoxStyle}>
              <div style={{ ...jsonLabelStyle, marginBottom: '0.5rem' }}>{t('console.security.decoder.header')}</div>
              <pre className="scp-json">{JSON.stringify(decoded.header, null, 2)}</pre>
            </div>
            <div style={jsonBoxStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={jsonLabelStyle}>{t('console.security.decoder.payload')}</span>
                <StatusPill
                  status={decoded.isExpired ? 'error' : 'warning'}
                  label={decoded.isExpired ? t('console.security.decoder.expired') : t('console.security.decoder.notVerified')}
                />
              </div>
              <pre className="scp-json">{JSON.stringify(decoded.payload, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
