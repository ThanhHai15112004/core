import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { PackageSummary } from '../../types/console.types';
import { StatusPill } from './StatusPill';
import { resolvePackageIcon } from '../../constants/console.constants';
import { X, AlertTriangle, Check, Copy } from 'lucide-react';
import { useLocale } from '../../../../core/i18n/index';

interface DetailDrawerProps {
  pkg: PackageSummary | null;
  onClose: () => void;
  onExecuteAction: (packageId: string, actionId: string) => void;
}

export const DetailDrawer: React.FC<DetailDrawerProps> = ({ pkg, onClose, onExecuteAction }) => {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  if (!pkg || typeof document === 'undefined') return null;

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(pkg, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="detail-drawer">
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.4rem' }}>{resolvePackageIcon(pkg)}</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--scp-text-primary)' }}>
                {pkg.displayName}
              </h3>
              <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--scp-text-muted)' }}>
                ID: {pkg.packageId}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--scp-text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body">
          {/* Status and Category */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', alignItems: 'center' }}>
            <StatusPill status={pkg.statusReport.status} />
            <span className="code-badge">{pkg.category}</span>
          </div>

          {/* Summary */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--scp-text-muted)', textTransform: 'uppercase' }}>
              {t('console.drawer.summary')}
            </label>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: 'var(--scp-text-secondary)', lineHeight: 1.5 }}>
              {pkg.statusReport.summary}
            </p>
          </div>

          {/* Metrics Table */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--scp-text-muted)', textTransform: 'uppercase' }}>
              {t('console.drawer.metrics', { count: Object.keys(pkg.statusReport.metrics).length })}
            </label>
            <div style={{ marginTop: '0.5rem', border: '1px solid var(--scp-border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
              <table className="scp-table">
                <tbody>
                  {Object.entries(pkg.statusReport.metrics).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ fontWeight: 600, width: '40%', color: 'var(--scp-text-secondary)' }}>{k}</td>
                      <td>
                        <span className="code-badge" style={{ wordBreak: 'break-all' }}>
                          {String(v)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {Object.keys(pkg.statusReport.metrics).length === 0 && (
                    <tr>
                      <td colSpan={2} style={{ textAlign: 'center', color: 'var(--scp-text-muted)' }}>
                        {t('console.drawer.noMetrics')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions list */}
          {pkg.actions.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--scp-text-muted)', textTransform: 'uppercase' }}>
                {t('console.drawer.actions', { count: pkg.actions.length })}
              </label>
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {pkg.actions.map((act) => (
                  <div
                    key={act.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.65rem 0.75rem',
                      borderRadius: '8px',
                      border: '1px solid var(--scp-border-subtle)',
                      backgroundColor: 'var(--scp-bg-surface-subtle)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.825rem', color: 'var(--scp-text-primary)' }}>
                        {act.label}
                      </div>
                      {act.description && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
                          {act.description}
                        </div>
                      )}
                    </div>
                    <button
                      className={`scp-btn scp-btn-sm ${act.isDanger ? 'scp-btn-danger' : 'scp-btn-primary'}`}
                      onClick={() => onExecuteAction(pkg.packageId, act.id)}
                    >
                      {act.isDanger ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <AlertTriangle size={13} />
                          <span>{t('console.drawer.execute')}</span>
                        </span>
                      ) : (
                        t('console.drawer.run')
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw JSON viewer */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--scp-text-muted)', textTransform: 'uppercase' }}>
                {t('console.drawer.rawJson')}
              </label>
              <button
                className="scp-btn scp-btn-sm scp-btn-secondary"
                onClick={handleCopyJson}
              >
                {copied ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--scp-success)' }}>
                    <Check size={13} />
                    <span>{t('console.drawer.copied')}</span>
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Copy size={13} />
                    <span>{t('console.drawer.copyJson')}</span>
                  </span>
                )}
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                padding: '0.75rem',
                borderRadius: '8px',
                backgroundColor: 'var(--scp-terminal-bg)',
                color: 'var(--scp-terminal-text)',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                overflowX: 'auto',
                maxHeight: '260px',
              }}
            >
              {JSON.stringify(pkg, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};
