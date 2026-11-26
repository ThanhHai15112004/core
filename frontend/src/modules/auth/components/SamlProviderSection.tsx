import React, { useState } from 'react';
import { Download, FileCode2, Plus, ShieldCheck, Upload } from 'lucide-react';
import { authStyles } from './auth-ui.styles';
import { federatedIdentityApi } from '../services/federated-identity.api';
import type {
  SamlBindingType,
  SamlCertificateStatus,
  SamlMetadataImportResult,
} from '../types/federated-identity.types';

export interface SamlDraftCertificate {
  readonly id?: string;
  readonly label?: string | null;
  readonly pem: string;
  readonly fingerprint256?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly status: SamlCertificateStatus;
  readonly graceEndsAt?: string | null;
}

export interface SamlEditorState {
  readonly spEntityId: string;
  readonly acsUrl: string;
  readonly nameIdFormat: string;
  readonly idpEntityId: string;
  readonly idpSsoUrl: string;
  readonly idpSsoBinding: SamlBindingType;
  readonly wantAssertionsSigned: boolean;
  readonly authnRequestsSigned: boolean;
  readonly allowIdpInitiated: boolean;
  readonly clockSkewSeconds: number;
  readonly idpCertificates: readonly SamlDraftCertificate[];
  readonly emailAttribute: string;
  readonly nameAttribute: string;
  readonly firstNameAttribute: string;
  readonly lastNameAttribute: string;
  readonly groupsAttribute: string;
  readonly requireEmail: boolean;
  readonly requiredAttributesText: string;
}

interface SamlProviderSectionProps {
  providerCode: string;
  busy: boolean;
  state: SamlEditorState;
  onChange: (patch: Partial<SamlEditorState>) => void;
  onImportMetadata: (
    providerCode: string,
    payload: {
      metadataXml?: string;
      metadataUrl?: string;
      mergeCertificates?: boolean;
      transitionGraceDays?: number;
    },
  ) => Promise<SamlMetadataImportResult | null>;
}

export const SamlProviderSection: React.FC<SamlProviderSectionProps> = ({
  providerCode,
  busy,
  state,
  onChange,
  onImportMetadata,
}) => {
  const [metadataXml, setMetadataXml] = useState('');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [mergeCerts, setMergeCerts] = useState(true);
  const [transitionGraceDays, setTransitionGraceDays] = useState(7);
  const [newCertPem, setNewCertPem] = useState('');
  const [newCertLabel, setNewCertLabel] = useState('');
  const [spMetadataPreview, setSpMetadataPreview] = useState('');
  const [spMetadataErr, setSpMetadataErr] = useState('');

  const handleLoadSpMetadata = async () => {
    setSpMetadataErr('');
    try {
      const xml = await federatedIdentityApi.fetchSamlSpMetadataXml(providerCode);
      setSpMetadataPreview(xml);
    } catch (err) {
      setSpMetadataErr(err instanceof Error ? err.message : 'Không thể tải SP Metadata XML');
    }
  };

  const handleImport = async () => {
    if (!metadataXml.trim() && !metadataUrl.trim()) return;
    await onImportMetadata(providerCode, {
      ...(metadataXml.trim() ? { metadataXml: metadataXml.trim() } : {}),
      ...(metadataUrl.trim() ? { metadataUrl: metadataUrl.trim() } : {}),
      mergeCertificates: mergeCerts,
      transitionGraceDays,
    });
    setMetadataXml('');
  };

  const handleAddManualCert = () => {
    const clean = newCertPem.trim();
    if (!clean) return;
    onChange({
      idpCertificates: [
        ...state.idpCertificates,
        {
          label: newCertLabel.trim() || null,
          pem: clean,
          status: 'ACTIVE',
          graceEndsAt: null,
        },
      ],
    });
    setNewCertPem('');
    setNewCertLabel('');
  };

  const handleUpdateCertStatus = (idx: number, status: SamlCertificateStatus) => {
    const graceEndsAt =
      status === 'TRANSITIONING'
        ? new Date(Date.now() + transitionGraceDays * 86_400_000).toISOString()
        : null;
    const next = state.idpCertificates.map((c, i) =>
      i === idx ? { ...c, status, graceEndsAt } : c,
    );
    onChange({ idpCertificates: next });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Service Provider Info & Metadata Export */}
      <div
        style={{
          padding: '10px',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FileCode2 size={15} />
            <span>Service Provider (SP) &amp; Metadata Export</span>
          </strong>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleLoadSpMetadata()}
              style={authStyles.btnSecondary}
            >
              <Download size={13} />
              <span>Xem / Xuất SP Metadata XML</span>
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <label style={authStyles.label}>SP Entity ID</label>
            <input
              type="text"
              value={state.spEntityId}
              onChange={(e) => onChange({ spEntityId: e.target.value })}
              placeholder={federatedIdentityApi.getSamlMetadataUrl(providerCode)}
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>ACS URL (Assertion Consumer Service)</label>
            <input
              type="text"
              value={state.acsUrl}
              onChange={(e) => onChange({ acsUrl: e.target.value })}
              placeholder={federatedIdentityApi.getSamlAcsUrl(providerCode)}
              style={authStyles.monoInput}
            />
          </div>
        </div>

        {spMetadataErr && (
          <span style={{ fontSize: '12px', color: 'var(--status-danger)' }}>{spMetadataErr}</span>
        )}
        {spMetadataPreview && (
          <textarea
            rows={5}
            readOnly
            value={spMetadataPreview}
            style={{ ...authStyles.monoInput, fontSize: '11.5px' }}
          />
        )}
      </div>

      {/* Import IdP Metadata */}
      <div
        style={{
          padding: '10px',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Upload size={15} />
          <span>Nhập IdP Metadata (XML hoặc URL)</span>
        </strong>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px', alignItems: 'end' }}>
          <div>
            <label style={authStyles.label}>IdP Metadata URL (tùy chọn)</label>
            <input
              type="text"
              value={metadataUrl}
              onChange={(e) => setMetadataUrl(e.target.value)}
              placeholder="https://idp.company.com/app/saml/metadata"
              style={authStyles.monoInput}
            />
          </div>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', paddingBottom: '6px' }}>
            <input
              type="checkbox"
              checked={mergeCerts}
              onChange={(e) => setMergeCerts(e.target.checked)}
            />
            <span>Chuyển tiếp Cert cũ ({transitionGraceDays}d)</span>
          </label>
          <button
            type="button"
            disabled={busy || (!metadataXml.trim() && !metadataUrl.trim())}
            onClick={() => void handleImport()}
            style={authStyles.btnTeal}
          >
            <Upload size={13} />
            <span>Import Metadata</span>
          </button>
        </div>
        <div>
          <label style={authStyles.label}>Hoặc dán trực tiếp IdP Metadata XML</label>
          <textarea
            rows={3}
            value={metadataXml}
            onChange={(e) => setMetadataXml(e.target.value)}
            placeholder="<md:EntityDescriptor ...>"
            style={authStyles.monoInput}
          />
        </div>
      </div>

      {/* IdP Connection Settings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div>
          <label style={authStyles.label}>IdP Entity ID (Issuer)</label>
          <input
            type="text"
            value={state.idpEntityId}
            onChange={(e) => onChange({ idpEntityId: e.target.value })}
            placeholder="https://idp.company.com/entity"
            style={authStyles.monoInput}
          />
        </div>
        <div>
          <label style={authStyles.label}>IdP SingleSignOnService URL</label>
          <input
            type="text"
            value={state.idpSsoUrl}
            onChange={(e) => onChange({ idpSsoUrl: e.target.value })}
            placeholder="https://idp.company.com/sso/saml"
            style={authStyles.monoInput}
          />
        </div>
        <div>
          <label style={authStyles.label}>Binding</label>
          <select
            value={state.idpSsoBinding}
            onChange={(e) => onChange({ idpSsoBinding: e.target.value as SamlBindingType })}
            style={authStyles.input}
          >
            <option value="HTTP-REDIRECT">HTTP-Redirect</option>
            <option value="HTTP-POST">HTTP-POST</option>
          </select>
        </div>
        <div>
          <label style={authStyles.label}>Clock Skew cho phép (giây, 0–300)</label>
          <input
            type="number"
            min={0}
            max={300}
            value={state.clockSkewSeconds}
            onChange={(e) => onChange({ clockSkewSeconds: Number(e.target.value) || 0 })}
            style={authStyles.input}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12.5px' }}>
        <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={state.wantAssertionsSigned}
            onChange={(e) => onChange({ wantAssertionsSigned: e.target.checked })}
          />
          <span>Bắt buộc ký từng SAML Assertion</span>
        </label>
        <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={state.allowIdpInitiated}
            onChange={(e) => onChange({ allowIdpInitiated: e.target.checked })}
          />
          <span>Cho phép IdP-initiated SSO (không có InResponseTo)</span>
        </label>
      </div>

      {/* IdP Certificates + Rotation */}
      <div
        style={{
          padding: '10px',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={15} />
            <span>Chứng thư số IdP (X.509) &amp; Certificate Rotation</span>
          </strong>
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Grace (ngày):</span>
            <input
              type="number"
              min={1}
              max={90}
              value={transitionGraceDays}
              onChange={(e) => setTransitionGraceDays(Math.max(1, Number(e.target.value) || 7))}
              style={{ ...authStyles.input, width: '64px', padding: '4px 6px' }}
            />
          </label>
        </div>

        {state.idpCertificates.map((cert, idx) => (
          <div
            key={`${cert.fingerprint256 ?? idx}-${idx}`}
            style={{
              padding: '8px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              fontSize: '12px',
            }}
          >
            <div>
              <div>
                <strong>{cert.label || cert.id || `Cert #${idx + 1}`}</strong>{' '}
                <code>{cert.fingerprint256?.slice(0, 20) || 'Pending inspect'}</code>
              </div>
              {cert.validTo && (
                <div style={{ color: 'var(--text-muted)', fontSize: '11.5px' }}>
                  Hết hạn: {new Date(cert.validTo).toLocaleDateString()}
                  {cert.graceEndsAt
                    ? ` · Chuyển tiếp tới: ${new Date(cert.graceEndsAt).toLocaleDateString()}`
                    : ''}
                </div>
              )}
            </div>
            <select
              value={cert.status}
              onChange={(e) =>
                handleUpdateCertStatus(idx, e.target.value as SamlCertificateStatus)
              }
              style={{ ...authStyles.input, width: 'auto', padding: '4px 8px' }}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="TRANSITIONING">TRANSITIONING</option>
              <option value="REVOKED">REVOKED</option>
            </select>
          </div>
        ))}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'end' }}>
          <div>
            <label style={authStyles.label}>Thêm Certificate PEM mới (cho Rotation)</label>
            <input
              type="text"
              value={newCertLabel}
              onChange={(e) => setNewCertLabel(e.target.value)}
              placeholder="Nhãn cert (vd: Okta 2027)"
              style={{ ...authStyles.input, marginBottom: '4px' }}
            />
            <textarea
              rows={2}
              value={newCertPem}
              onChange={(e) => setNewCertPem(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE----- ..."
              style={authStyles.monoInput}
            />
          </div>
          <button type="button" onClick={handleAddManualCert} style={authStyles.btnSecondary}>
            <Plus size={13} />
            <span>Thêm Cert</span>
          </button>
        </div>
      </div>

      {/* Attribute Mapping + Validation */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
        <div>
          <label style={authStyles.label}>Attr Email</label>
          <input
            type="text"
            value={state.emailAttribute}
            onChange={(e) => onChange({ emailAttribute: e.target.value })}
            style={authStyles.monoInput}
          />
        </div>
        <div>
          <label style={authStyles.label}>Attr Họ tên</label>
          <input
            type="text"
            value={state.nameAttribute}
            onChange={(e) => onChange({ nameAttribute: e.target.value })}
            style={authStyles.monoInput}
          />
        </div>
        <div>
          <label style={authStyles.label}>Attr Nhóm</label>
          <input
            type="text"
            value={state.groupsAttribute}
            onChange={(e) => onChange({ groupsAttribute: e.target.value })}
            style={authStyles.monoInput}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignItems: 'center' }}>
        <div>
          <label style={authStyles.label}>Required Attributes (phân cách dấu phẩy)</label>
          <input
            type="text"
            value={state.requiredAttributesText}
            onChange={(e) => onChange({ requiredAttributesText: e.target.value })}
            placeholder="email, department"
            style={authStyles.monoInput}
          />
        </div>
        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12.5px', paddingTop: '14px' }}>
          <input
            type="checkbox"
            checked={state.requireEmail}
            onChange={(e) => onChange({ requireEmail: e.target.checked })}
          />
          <span>Bắt buộc Email hợp lệ trong SAML Assertion</span>
        </label>
      </div>
    </div>
  );
};
