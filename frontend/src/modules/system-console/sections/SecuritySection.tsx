import React, { useState } from 'react';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatCard } from '../components/common/StatCard';
import { StatusPill } from '../components/common/StatusPill';

export const SecuritySection: React.FC = () => {
  const [tokenInput, setTokenInput] = useState('');
  const [decodedToken, setDecodedToken] = useState<{
    header?: Record<string, unknown>;
    payload?: Record<string, unknown>;
    isExpired?: boolean;
    error?: string;
  } | null>(null);

  const securityHeaders = [
    { name: 'X-Content-Type-Options', value: 'nosniff', status: 'pass', description: 'Prevents MIME-sniffing vulnerabilities' },
    { name: 'X-Frame-Options', value: 'SAMEORIGIN', status: 'pass', description: 'Mitigates clickjacking attacks' },
    { name: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains', status: 'pass', description: 'Enforces HTTPS traffic' },
    { name: 'Content-Security-Policy (CSP)', value: "default-src 'self'", status: 'pass', description: 'Restricts script and resource injection' },
    { name: 'CORS Headers', value: 'Allowed Origins: Explicit whitelisting', status: 'pass', description: 'Blocks unauthorized cross-origin requests' },
  ];

  const handleDecode = (tokenStr: string) => {
    setTokenInput(tokenStr);
    if (!tokenStr.trim()) {
      setDecodedToken(null);
      return;
    }

    try {
      const parts = tokenStr.trim().split('.');
      if (parts.length !== 3) {
        setDecodedToken({ error: 'Invalid JWT format (must have 3 dot-separated segments).' });
        return;
      }

      const decodeBase64 = (str: string) => {
        const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(
          atob(base64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join(''),
        );
        return JSON.parse(json);
      };

      const header = decodeBase64(parts[0] || '');
      const payload = decodeBase64(parts[1] || '');

      let isExpired = false;
      if (typeof payload['exp'] === 'number') {
        isExpired = Date.now() >= payload['exp'] * 1000;
      }

      setDecodedToken({ header, payload, isExpired });
    } catch (e: unknown) {
      setDecodedToken({ error: `Decode failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const handleGenerateSample = () => {
    // Generate sample valid JWT (signed dummy)
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
    const nowSec = Math.floor(Date.now() / 1000);
    const payloadObj = {
      sub: 'usr_core_admin_01',
      username: 'thanhhai',
      role: 'super_admin',
      permissions: ['ops:read', 'ops:write', 'system:manage'],
      iat: nowSec,
      exp: nowSec + 3600,
      iss: 'core-api-gateway',
    };
    const payload = btoa(JSON.stringify(payloadObj)).replace(/=/g, '');
    const sig = 'signature_mock_for_validation_inspection_only';
    handleDecode(`${header}.${payload}.${sig}`);
  };

  return (
    <div>
      <SectionHeader
        title="Security, Authentication & Token Governance"
        description="Inspect security headers, global guards, JWT configuration policies, and test token payload validity."
      />

      {/* 4 Stat Cards */}
      <div className="overview-grid-4">
        <StatCard
          title="JWT Sign Algorithm"
          value="HS256"
          icon="🔑"
          subtext="HMAC with SHA-256 (or RS256 ready)"
        />

        <StatCard
          title="Access Token TTL"
          value="1 Hour"
          icon="⏳"
          subtext="3,600 seconds sliding expiry"
        />

        <StatCard
          title="Refresh Token TTL"
          value="7 Days"
          icon="🔄"
          subtext="Stored with Redis session validation"
        />

        <StatCard
          title="Security Headers"
          value="5 Active"
          icon="🛡️"
          subtext={<StatusPill status="healthy" label="Hardened" />}
        />
      </div>

      {/* Security Headers Panel */}
      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span>🛡️ Fastify HTTP Security Headers</span>
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
            @fastify/helmet integration
          </span>
        </div>

        <div style={{ border: '1px solid var(--scp-border-subtle)', borderRadius: '8px', overflow: 'hidden' }}>
          <table className="scp-table">
            <thead>
              <tr>
                <th>Header Directive</th>
                <th>Enforced Value</th>
                <th>Protection Purpose</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {securityHeaders.map((h) => (
                <tr key={h.name}>
                  <td style={{ fontWeight: 600 }}>{h.name}</td>
                  <td>
                    <span className="code-badge">{h.value}</span>
                  </td>
                  <td style={{ color: 'var(--scp-text-secondary)', fontSize: '0.8rem' }}>{h.description}</td>
                  <td>
                    <StatusPill status="healthy" label="ACTIVE" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive JWT Debugger / Token Tester */}
      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span>🔍 Interactive JWT Token Decoder & Tester</span>
          </h3>
          <button
            type="button"
            className="scp-btn scp-btn-sm scp-btn-secondary"
            onClick={handleGenerateSample}
          >
            Load Sample Token
          </button>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--scp-text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
            Paste JWT Token:
          </label>
          <textarea
            rows={3}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
            value={tokenInput}
            onChange={(e) => handleDecode(e.target.value)}
            style={{
              width: '100%',
              padding: '0.65rem',
              borderRadius: '6px',
              border: '1px solid var(--scp-border-subtle)',
              backgroundColor: 'var(--scp-bg-surface-subtle)',
              color: 'var(--scp-text-primary)',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        {decodedToken && (
          <div style={{ marginTop: '1rem' }}>
            {decodedToken.error ? (
              <div style={{ color: 'var(--scp-danger)', fontSize: '0.85rem' }}>
                ⚠️ {decodedToken.error}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                {/* Header */}
                <div style={{ border: '1px solid var(--scp-border-subtle)', borderRadius: '8px', padding: '0.75rem', backgroundColor: 'var(--scp-bg-surface-subtle)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--scp-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                    Algorithm & Token Type (Header)
                  </div>
                  <pre style={{ margin: 0, fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--scp-primary-text)' }}>
                    {JSON.stringify(decodedToken.header, null, 2)}
                  </pre>
                </div>

                {/* Payload */}
                <div style={{ border: '1px solid var(--scp-border-subtle)', borderRadius: '8px', padding: '0.75rem', backgroundColor: 'var(--scp-bg-surface-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--scp-text-muted)', textTransform: 'uppercase' }}>
                      Payload Data (Claims)
                    </span>
                    <StatusPill
                      status={decodedToken.isExpired ? 'error' : 'healthy'}
                      label={decodedToken.isExpired ? 'EXPIRED' : 'VALID'}
                    />
                  </div>
                  <pre style={{ margin: 0, fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--scp-text-primary)' }}>
                    {JSON.stringify(decodedToken.payload, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
