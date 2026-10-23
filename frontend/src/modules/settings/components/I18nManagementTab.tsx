import React, { useState } from 'react';
import { Check, Clock, Globe, Languages, Plus, Save, Search } from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { I18N_SUB_TAB, type I18nSubTabId } from '../enum/settings.enum';
import type {
  I18nLocaleSummary,
  I18nTimezoneSummary,
  I18nTranslationSummary,
} from '../types/settings.types';

interface I18nManagementTabProps {
  locales: I18nLocaleSummary[];
  timezones: I18nTimezoneSummary[];
  translations: I18nTranslationSummary[];
  localeFilter: string;
  onLocaleFilterChange: (loc: string) => void;
  search: string;
  onSearchChange: (q: string) => void;
  loading: boolean;
  submitting: boolean;
  onUpdateLocale: (
    code: string,
    payload: { isDefault?: boolean; status?: number; dateFormat?: string; currencyCode?: string },
  ) => Promise<void>;
  onUpdateTimezone: (
    code: string,
    payload: { isDefault?: boolean; status?: number },
  ) => Promise<void>;
  onUpsertTranslation: (payload: {
    locale: string;
    namespace: string;
    key: string;
    value: string;
    description?: string | null;
  }) => Promise<boolean>;
}

export const I18nManagementTab: React.FC<I18nManagementTabProps> = ({
  locales,
  timezones,
  translations,
  localeFilter,
  onLocaleFilterChange,
  search,
  onSearchChange,
  submitting,
  onUpdateLocale,
  onUpdateTimezone,
  onUpsertTranslation,
}) => {
  const [subTab, setSubTab] = useState<I18nSubTabId>(I18N_SUB_TAB.LOCALES);

  // Translation upsert form
  const [trLocale, setTrLocale] = useState<string>(localeFilter || 'vi');
  const [trNamespace, setTrNamespace] = useState<string>('common');
  const [trKey, setTrKey] = useState<string>('');
  const [trValue, setTrValue] = useState<string>('');
  const [trDesc, setTrDesc] = useState<string>('');

  const handleSaveTranslation = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onUpsertTranslation({
      locale: trLocale.trim(),
      namespace: trNamespace.trim(),
      key: trKey.trim(),
      value: trValue.trim(),
      description: trDesc.trim() || null,
    });
    if (ok) {
      setTrKey('');
      setTrValue('');
      setTrDesc('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Sub-navigation */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          padding: '6px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          width: 'fit-content',
        }}
      >
        <button
          type="button"
          onClick={() => setSubTab(I18N_SUB_TAB.LOCALES)}
          style={
            subTab === I18N_SUB_TAB.LOCALES
              ? authStyles.btnPrimary
              : { ...authStyles.btnSecondary, border: 'none', background: 'transparent' }
          }
        >
          <Globe size={14} /> Ngôn ngữ ({locales.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab(I18N_SUB_TAB.TIMEZONES)}
          style={
            subTab === I18N_SUB_TAB.TIMEZONES
              ? authStyles.btnPrimary
              : { ...authStyles.btnSecondary, border: 'none', background: 'transparent' }
          }
        >
          <Clock size={14} /> Múi giờ IANA ({timezones.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab(I18N_SUB_TAB.TRANSLATIONS)}
          style={
            subTab === I18N_SUB_TAB.TRANSLATIONS
              ? authStyles.btnPrimary
              : { ...authStyles.btnSecondary, border: 'none', background: 'transparent' }
          }
        >
          <Languages size={14} /> Từ điển Dịch Động ({translations.length})
        </button>
      </div>

      {/* 1. Locales Table */}
      {subTab === I18N_SUB_TAB.LOCALES && (
        <div style={authStyles.card}>
          <div style={authStyles.sectionTitle}>
            Danh mục Ngôn ngữ Hỗ trợ (i18n_locales)
          </div>
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Mã / BCP47</th>
                  <th style={authStyles.tableHeaderCell}>Tên ngôn ngữ</th>
                  <th style={authStyles.tableHeaderCell}>Định dạng Ngày / Tiền tệ</th>
                  <th style={authStyles.tableHeaderCell}>Mặc định</th>
                  <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                  <th style={authStyles.tableHeaderCell}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {locales.map((loc) => (
                  <tr key={loc.code}>
                    <td style={authStyles.tableCell}>
                      <code style={{ fontWeight: 700, color: 'var(--primary)' }}>{loc.code}</code>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        {loc.bcp47Tag} ({loc.direction.toUpperCase()})
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>{loc.nativeName}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{loc.name}</div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                        {loc.dateFormat} · {loc.currencyCode}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      {loc.isDefault ? (
                        <span style={authStyles.badgeSuccess}>
                          <Check size={12} /> Mặc định
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void onUpdateLocale(loc.code, { isDefault: true })}
                          style={{ ...authStyles.btnSecondary, padding: '4px 9px', fontSize: '11.5px' }}
                        >
                          Đặt mặc định
                        </button>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={loc.status === 1 ? authStyles.badgeSuccess : authStyles.badgeWarning}>
                        {loc.statusName}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      <button
                        type="button"
                        disabled={submitting || loc.isDefault}
                        onClick={() =>
                          void onUpdateLocale(loc.code, { status: loc.status === 1 ? 0 : 1 })
                        }
                        style={{ ...authStyles.btnSecondary, padding: '5px 10px', fontSize: '12px' }}
                      >
                        {loc.status === 1 ? 'Tắt' : 'Bật'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Timezones Table */}
      {subTab === I18N_SUB_TAB.TIMEZONES && (
        <div style={authStyles.card}>
          <div style={authStyles.sectionTitle}>Danh mục Múi giờ Chuẩn IANA (i18n_timezones)</div>
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Mã IANA</th>
                  <th style={authStyles.tableHeaderCell}>Tên hiển thị</th>
                  <th style={authStyles.tableHeaderCell}>UTC Offset / Khu vực</th>
                  <th style={authStyles.tableHeaderCell}>Mặc định</th>
                  <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {timezones.map((tz) => (
                  <tr key={tz.code}>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary)' }}>
                      {tz.code}
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 600 }}>{tz.labels?.vi ?? tz.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{tz.name}</div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>{tz.utcOffset}</span>{' '}
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{tz.region}</span>
                    </td>
                    <td style={authStyles.tableCell}>
                      {tz.isDefault ? (
                        <span style={authStyles.badgeSuccess}>
                          <Check size={12} /> Mặc định
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void onUpdateTimezone(tz.code, { isDefault: true })}
                          style={{ ...authStyles.btnSecondary, padding: '4px 9px', fontSize: '11.5px' }}
                        >
                          Đặt mặc định
                        </button>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={tz.status === 1 ? authStyles.badgeSuccess : authStyles.badgeWarning}>
                        {tz.statusName}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Translations Dictionary */}
      {subTab === I18N_SUB_TAB.TRANSLATIONS && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <form onSubmit={(e) => void handleSaveTranslation(e)} style={authStyles.cardHighlighted}>
            <div style={authStyles.sectionTitle}>
              <Plus size={16} color="var(--primary)" />
              <span>Thêm / Ghi đè Bản dịch Đa ngôn ngữ (Upsert i18n_translations)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 0.8fr 1.2fr 1.5fr auto', gap: '10px', alignItems: 'end', marginTop: '10px' }}>
              <div>
                <label style={authStyles.label}>Locale</label>
                <select
                  value={trLocale}
                  onChange={(e) => setTrLocale(e.target.value)}
                  style={authStyles.input}
                >
                  {locales.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.code} ({l.nativeName})
                    </option>
                  ))}
                  {locales.length === 0 && (
                    <>
                      <option value="vi">vi</option>
                      <option value="en">en</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label style={authStyles.label}>Namespace *</label>
                <input
                  type="text"
                  required
                  value={trNamespace}
                  onChange={(e) => setTrNamespace(e.target.value)}
                  placeholder="common, auth, errors..."
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>Khóa từ điển (key) *</label>
                <input
                  type="text"
                  required
                  value={trKey}
                  onChange={(e) => setTrKey(e.target.value)}
                  placeholder="VD: validation.required"
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>Nội dung bản dịch (value) *</label>
                <input
                  type="text"
                  required
                  value={trValue}
                  onChange={(e) => setTrValue(e.target.value)}
                  placeholder="Nhập chuỗi dịch..."
                  style={authStyles.input}
                />
              </div>
              <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
                <Save size={14} /> Lưu từ điển
              </button>
            </div>
          </form>

          <div style={authStyles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px', flexWrap: 'wrap' }}>
              <div style={authStyles.sectionTitle}>
                Từ điển Dịch Thuật ({translations.length} mục)
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <select
                  value={localeFilter}
                  onChange={(e) => onLocaleFilterChange(e.target.value)}
                  style={{ ...authStyles.input, width: '150px' }}
                >
                  <option value="">Tất cả ngôn ngữ</option>
                  <option value="vi">Tiếng Việt (vi)</option>
                  <option value="en">English (en)</option>
                </select>
                <div style={{ position: 'relative', width: '260px' }}>
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
                    placeholder="Tìm khóa hoặc nội dung dịch..."
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    style={{ ...authStyles.input, paddingLeft: '32px' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={authStyles.tableHeaderCell}>Locale</th>
                    <th style={authStyles.tableHeaderCell}>Namespace</th>
                    <th style={authStyles.tableHeaderCell}>Khóa (Key)</th>
                    <th style={authStyles.tableHeaderCell}>Bản dịch (Value)</th>
                    <th style={authStyles.tableHeaderCell}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {translations.map((tr) => (
                    <tr key={`${tr.locale}:${tr.namespace}:${tr.key}`}>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgePrimary}>{tr.locale}</span>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)' }}>
                        {tr.namespace}
                      </td>
                      <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--primary)' }}>
                        {tr.key}
                      </td>
                      <td style={authStyles.tableCell}>{tr.value}</td>
                      <td style={authStyles.tableCell}>
                        <button
                          type="button"
                          onClick={() => {
                            setTrLocale(tr.locale);
                            setTrNamespace(tr.namespace);
                            setTrKey(tr.key);
                            setTrValue(tr.value);
                          }}
                          style={{ ...authStyles.btnSecondary, padding: '4px 9px', fontSize: '11.5px' }}
                        >
                          Sửa nhanh
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

