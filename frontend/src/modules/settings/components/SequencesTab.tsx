import React, { useState } from 'react';
import { Edit3, Eye, Hash, Play, Plus, Save, Search } from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import {
  SEQUENCE_DATE_FORMAT_OPTIONS,
  SEQUENCE_RESET_POLICY_OPTIONS,
} from '../enum/settings.enum';
import type {
  SequenceGeneratedResult,
  SequencePreviewResult,
  SequenceRuleSummary,
} from '../types/settings.types';

interface SequencesTabProps {
  sequences: SequenceRuleSummary[];
  search: string;
  onSearchChange: (q: string) => void;
  preview: SequencePreviewResult | null;
  lastGenerated: SequenceGeneratedResult | SequenceGeneratedResult[] | null;
  loading: boolean;
  submitting: boolean;
  onPreviewSequence: (payload: {
    key?: string;
    prefix?: string;
    suffix?: string;
    separator?: string;
    dateFormat?: number;
    paddingLength?: number;
    startValue?: number;
    step?: number;
    resetPolicy?: number;
    scopeByUnit?: boolean;
    unitCode?: string | null;
  }) => Promise<void>;
  onUpdateSequenceRule: (
    key: string,
    payload: {
      name?: string;
      prefix?: string;
      suffix?: string;
      separator?: string;
      dateFormat?: number;
      paddingLength?: number;
      resetPolicy?: number;
      scopeByUnit?: boolean;
      reason?: string | null;
    },
  ) => Promise<boolean>;
  onCreateSequenceRule: (payload: {
    key: string;
    module?: string;
    name: string;
    prefix?: string;
    suffix?: string;
    separator?: string;
    dateFormat?: number;
    paddingLength?: number;
    resetPolicy?: number;
    scopeByUnit?: boolean;
  }) => Promise<boolean>;
  onGenerateNext: (
    key: string,
    payload?: { count?: number; unitCode?: string | null },
  ) => Promise<void>;
}

export const SequencesTab: React.FC<SequencesTabProps> = ({
  sequences,
  search,
  onSearchChange,
  preview,
  lastGenerated,
  loading,
  submitting,
  onPreviewSequence,
  onUpdateSequenceRule,
  onCreateSequenceRule,
  onGenerateNext,
}) => {
  const [editingSeq, setEditingSeq] = useState<SequenceRuleSummary | null>(null);
  const [showCreate, setShowCreate] = useState<boolean>(false);

  // Shared builder state for preview / edit / create
  const [key, setKey] = useState<string>('crm.invoice_code');
  const [moduleName, setModuleName] = useState<string>('crm');
  const [name, setName] = useState<string>('Mã Hóa Đơn');
  const [prefix, setPrefix] = useState<string>('INV');
  const [suffix, setSuffix] = useState<string>('');
  const [separator, setSeparator] = useState<string>('-');
  const [dateFormat, setDateFormat] = useState<number>(3); // YYYYMM
  const [paddingLength, setPaddingLength] = useState<number>(5);
  const [resetPolicy, setResetPolicy] = useState<number>(3); // MONTHLY
  const [scopeByUnit, setScopeByUnit] = useState<boolean>(false);
  const [sampleUnitCode, setSampleUnitCode] = useState<string>('HN');

  const openEditRule = (seq: SequenceRuleSummary) => {
    setEditingSeq(seq);
    setShowCreate(false);
    setKey(seq.key);
    setModuleName(seq.module);
    setName(seq.name);
    setPrefix(seq.prefix);
    setSuffix(seq.suffix);
    setSeparator(seq.separator);
    setDateFormat(seq.dateFormat);
    setPaddingLength(seq.paddingLength);
    setResetPolicy(seq.resetPolicy);
    setScopeByUnit(seq.scopeByUnit);
  };

  const handleTriggerPreview = () => {
    void onPreviewSequence({
      key,
      prefix,
      suffix,
      separator,
      dateFormat,
      paddingLength,
      resetPolicy,
      scopeByUnit,
      unitCode: scopeByUnit ? sampleUnitCode : null,
    });
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSeq) {
      const ok = await onUpdateSequenceRule(editingSeq.key, {
        name,
        prefix,
        suffix,
        separator,
        dateFormat,
        paddingLength,
        resetPolicy,
        scopeByUnit,
      });
      if (ok) setEditingSeq(null);
    } else if (showCreate) {
      const ok = await onCreateSequenceRule({
        key: key.trim(),
        module: moduleName.trim() || 'settings',
        name: name.trim(),
        prefix,
        suffix,
        separator,
        dateFormat,
        paddingLength,
        resetPolicy,
        scopeByUnit,
      });
      if (ok) setShowCreate(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Interactive Sequence Builder & Preview Sandbox */}
      <form onSubmit={(e) => void handleSaveRule(e)} style={authStyles.cardHighlighted}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={authStyles.sectionTitle}>
            <Hash size={17} color="var(--primary)" />
            <span>
              {editingSeq
                ? `Chỉnh sửa Quy tắc Sinh mã: ${editingSeq.key}`
                : showCreate
                  ? 'Tạo Quy tắc Sinh mã Tự động Mới'
                  : 'Trình Thiết Kế & Xem Trước Mẫu Sinh Mã (Không tăng bộ đếm thật)'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handleTriggerPreview}
              disabled={submitting}
              style={authStyles.btnTeal}
            >
              <Eye size={14} /> Xem trước 3 số tiếp theo
            </button>
            {!showCreate && !editingSeq && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                style={authStyles.btnPrimary}
              >
                <Plus size={14} /> Tạo quy tắc mới
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          <div>
            <label style={authStyles.label}>Khóa quy tắc (key)</label>
            <input
              type="text"
              disabled={Boolean(editingSeq)}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>Tên hiển thị</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={authStyles.input}
            />
          </div>
          <div>
            <label style={authStyles.label}>Tiền tố (Prefix)</label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              style={authStyles.monoInput}
            />
          </div>
          <div>
            <label style={authStyles.label}>Ký tự phân cách & Hậu tố</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                placeholder="-"
                style={{ ...authStyles.monoInput, width: '70px' }}
              />
              <input
                type="text"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                placeholder="Hậu tố"
                style={authStyles.monoInput}
              />
            </div>
          </div>

          <div>
            <label style={authStyles.label}>Định dạng Ngày tháng (DateFormat)</label>
            <select
              value={dateFormat}
              onChange={(e) => setDateFormat(Number(e.target.value))}
              style={authStyles.input}
            >
              {SEQUENCE_DATE_FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={authStyles.label}>Độ dài đệm số 0 (Padding Length)</label>
            <input
              type="number"
              min={1}
              max={12}
              value={paddingLength}
              onChange={(e) => setPaddingLength(Number(e.target.value))}
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Chính sách Reset Bộ đếm</label>
            <select
              value={resetPolicy}
              onChange={(e) => setResetPolicy(Number(e.target.value))}
              style={authStyles.input}
            >
              {SEQUENCE_RESET_POLICY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={authStyles.label}>Phạm vi Đơn vị (scopeByUnit)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <input
                type="checkbox"
                checked={scopeByUnit}
                onChange={(e) => setScopeByUnit(e.target.checked)}
              />
              <span style={{ fontSize: '12.5px' }}>Tách bộ đếm theo Đơn vị</span>
              {scopeByUnit && (
                <input
                  type="text"
                  value={sampleUnitCode}
                  onChange={(e) => setSampleUnitCode(e.target.value)}
                  placeholder="UnitCode"
                  style={{ ...authStyles.monoInput, width: '80px', padding: '5px 8px' }}
                />
              )}
            </div>
          </div>
        </div>

        {(editingSeq || showCreate) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
            <button
              type="button"
              onClick={() => {
                setEditingSeq(null);
                setShowCreate(false);
              }}
              style={authStyles.btnSecondary}
            >
              Hủy
            </button>
            <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
              <Save size={14} /> {editingSeq ? 'Lưu cập nhật' : 'Tạo quy tắc'}
            </button>
          </div>
        )}

        {preview && (
          <div
            style={{
              marginTop: '14px',
              padding: '12px 14px',
              borderRadius: '8px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Mẫu kết xuất: </span>
              <code style={{ fontWeight: 700, color: 'var(--primary)' }}>
                {preview.resolvedTemplate}
              </code>{' '}
              <span style={authStyles.badgePrimary}>Kỳ: {preview.periodKey}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>3 mã dự kiến:</span>
              {preview.nextThreeSamples.map((s) => (
                <span key={s} style={authStyles.badgeSuccess}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {lastGenerated && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px 14px',
              borderRadius: '8px',
              background: 'var(--status-success-bg)',
              color: 'var(--status-success)',
              fontWeight: 700,
              fontSize: '13px',
            }}
          >
            Mã vừa cấp phát thật:{' '}
            <code>
              {Array.isArray(lastGenerated)
                ? lastGenerated.map((g) => g.code).join(', ')
                : lastGenerated.code}
            </code>
          </div>
        )}
      </form>

      {/* Sequences List Table */}
      <div style={authStyles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={authStyles.sectionTitle}>
            Danh sách Quy tắc Sinh Mã Tự động ({sequences.length})
          </div>
          <div style={{ position: 'relative', width: '280px' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Tìm quy tắc sinh mã..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{ ...authStyles.input, paddingLeft: '32px' }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Khóa & Tên quy tắc</th>
                <th style={authStyles.tableHeaderCell}>Mẫu (Template)</th>
                <th style={authStyles.tableHeaderCell}>Mã mẫu (Sample)</th>
                <th style={authStyles.tableHeaderCell}>Chính sách Reset</th>
                <th style={authStyles.tableHeaderCell}>Bộ đếm hiện tại</th>
                <th style={authStyles.tableHeaderCell}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center', padding: '24px' }}>
                    Đang tải danh sách quy tắc sinh mã...
                  </td>
                </tr>
              ) : (
                sequences.map((seq) => (
                  <tr key={seq.key}>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>{seq.name}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--primary)', fontWeight: 600 }}>
                        {seq.key}
                      </div>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {seq.resolvedTemplate}
                    </td>
                    <td style={authStyles.tableCell}>
                      <code style={{ ...authStyles.codeBox, padding: '4px 8px', fontWeight: 700, color: 'var(--secondary)' }}>
                        {seq.samplePreview}
                      </code>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>{seq.resetPolicyName}</span>
                      {seq.scopeByUnit && (
                        <span style={{ ...authStyles.badgeWarning, marginLeft: '6px' }}>
                          Theo Đơn vị
                        </span>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>
                        #{seq.currentCounterValue}{' '}
                        <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 400 }}>
                          (Kỳ: {seq.currentPeriodKey})
                        </span>
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => openEditRule(seq)}
                          style={{ ...authStyles.btnSecondary, padding: '5px 10px', fontSize: '12px' }}
                        >
                          <Edit3 size={13} /> Sửa
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void onGenerateNext(seq.key, { count: 1 })}
                          style={{ ...authStyles.btnTeal, padding: '5px 10px', fontSize: '12px' }}
                        >
                          <Play size={12} /> Cấp mã
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

