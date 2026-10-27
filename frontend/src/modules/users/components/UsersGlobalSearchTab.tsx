import React, { useState } from 'react';
import {
  Activity,
  Database,
  HelpCircle,
  Layers,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { USER_STATUS_META } from '../enum/users.enum';
import type {
  OrganizationOptionSummary,
  RegisteredSearchableEntity,
  SearchIndexLagReport,
  SearchQueryResult,
  SearchSyncHistoryItem,
  ZeroResultKeywordStat,
} from '../types/users.types';

export interface UsersGlobalSearchTabProps {
  readonly submitting: boolean;
  readonly searchableEntities: readonly RegisteredSearchableEntity[];
  readonly organizationOptions: readonly OrganizationOptionSummary[];
  readonly searchResult: SearchQueryResult | null;
  readonly lastSyncResult: SearchSyncHistoryItem | null;
  readonly indexLagReport: SearchIndexLagReport | null;
  readonly zeroResultKeywords: readonly ZeroResultKeywordStat[];
  readonly onSearchGlobal: (filter: {
    keyword: string;
    entityCode?: string;
    status?: number | '';
    organizationUnitId?: number | '';
    includeStale?: boolean;
  }) => Promise<void>;
  readonly onSyncIndex: (options: { async?: boolean }) => Promise<void>;
  readonly onRebuildIndex: (options: {
    module?: string;
    entityType?: string;
    async?: boolean;
  }) => Promise<void>;
  readonly onRefreshSearchTelemetry: () => Promise<void>;
}

export const UsersGlobalSearchTab: React.FC<UsersGlobalSearchTabProps> = ({
  submitting,
  searchableEntities,
  organizationOptions,
  searchResult,
  lastSyncResult,
  indexLagReport,
  zeroResultKeywords,
  onSearchGlobal,
  onSyncIndex,
  onRebuildIndex,
  onRefreshSearchTelemetry,
}) => {
  const [keyword, setKeyword] = useState<string>('');
  const [selectedEntityCode, setSelectedEntityCode] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<number | ''>('');
  const [organizationUnitId, setOrganizationUnitId] = useState<number | ''>('');
  const [includeStale, setIncludeStale] = useState<boolean>(true);
  const [runQueueAsync, setRunQueueAsync] = useState<boolean>(false);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSearchGlobal({
      keyword,
      ...(selectedEntityCode ? { entityCode: selectedEntityCode } : {}),
      status: statusFilter,
      organizationUnitId,
      includeStale,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Top Card: Global Search Provider & Index Sync/Rebuild Controls (Mục 8.5.1 - 8.5.6) */}
      <div style={authStyles.cardHighlighted}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3 style={{ ...authStyles.sectionTitle, marginBottom: '4px' }}>
              <Search size={17} /> Tìm kiếm Toàn hệ thống qua Search Provider dùng chung (Mục 8.5)
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Hỗ trợ tìm bằng Database cho dự án nhỏ (8.5.2) hoặc Elasticsearch / OpenSearch khi dữ
              liệu lớn (8.5.3), đồng bộ qua Queue (8.5.4), Rebuild Index (8.5.5) và tự động lọc theo
              Data Scope (8.5.6).
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={runQueueAsync}
                onChange={(e) => setRunQueueAsync(e.target.checked)}
              />
              Chạy qua Queue (8.5.4)
            </label>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onSyncIndex({ async: runQueueAsync })}
              style={authStyles.btnSecondary}
            >
              <RefreshCw size={14} /> Đồng bộ Search Index (8.5.4)
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() =>
                void onRebuildIndex({
                  module: 'users',
                  entityType: 'user',
                  async: runQueueAsync,
                })
              }
              style={authStyles.btnTeal}
            >
              <RotateCcw size={14} /> Tạo lại toàn bộ Index (Rebuild — 8.5.5)
            </button>
          </div>
        </div>

        {/* Registered Searchable Entities Badges (Mục 8.5.1) */}
        {searchableEntities.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              marginBottom: '14px',
            }}
          >
            {searchableEntities.map((ent) => (
              <span key={ent.code} style={authStyles.badgePrimary}>
                <Layers size={12} /> {ent.name} (<code>{ent.code}</code> • Trường:{' '}
                {ent.searchableFields.join(', ')})
              </span>
            ))}
          </div>
        )}

        {/* Last Sync / Rebuild Status Banner */}
        {lastSyncResult && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              fontSize: '12px',
              marginBottom: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <span>
              Thao tác gần nhất: <strong>{lastSyncResult.operation}</strong> • Driver:{' '}
              <code>{lastSyncResult.driverUsed}</code> • Chế độ:{' '}
              <strong>{lastSyncResult.executionMode}</strong>
            </span>
            <span>
              Đã đánh chỉ mục: <strong>{lastSyncResult.indexedCount}</strong> tài liệu • Trạng thái:{' '}
              <span style={authStyles.badgeSuccess}>{lastSyncResult.status}</span>
            </span>
          </div>
        )}

        {/* Global Search Filter Form */}
        <form onSubmit={(e) => void handleSearchSubmit(e)}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.8fr 1fr 1fr 1fr auto',
              gap: '10px',
              alignItems: 'end',
            }}
          >
            <div>
              <label style={authStyles.label}>Từ khóa tìm kiếm toàn hệ thống</label>
              <input
                type="text"
                placeholder="Nhập họ tên, username, email, SĐT, mã nhân viên, chức danh..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                style={authStyles.input}
              />
            </div>

            <div>
              <label style={authStyles.label}>Loại thực thể (8.5.1)</label>
              <select
                value={selectedEntityCode}
                onChange={(e) => setSelectedEntityCode(e.target.value)}
                style={authStyles.input}
              >
                <option value="">-- Tất cả thực thể --</option>
                {searchableEntities.map((ent) => (
                  <option key={ent.code} value={ent.code}>
                    {ent.name} ({ent.entityType})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={authStyles.label}>Trạng thái</label>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value === '' ? '' : Number(e.target.value))
                }
                style={authStyles.input}
              >
                <option value="">-- Tất cả --</option>
                {Object.values(USER_STATUS_META).map((st) => (
                  <option key={st.code} value={st.code}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={authStyles.label}>Đơn vị (Data Scope 8.5.6)</label>
              <select
                value={organizationUnitId}
                onChange={(e) =>
                  setOrganizationUnitId(e.target.value === '' ? '' : Number(e.target.value))
                }
                style={authStyles.input}
              >
                <option value="">-- Mọi đơn vị được phép --</option>
                {organizationOptions.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
              <Search size={15} /> Tìm kiếm
            </button>
          </div>

          <div style={{ marginTop: '8px' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={includeStale}
                onChange={(e) => setIncludeStale(e.target.checked)}
              />
              Bao gồm cả bản ghi có độ trễ Index (hiển thị cảnh báo Stale — Mục 8.5.7)
            </label>
          </div>
        </form>
      </div>

      {/* Search Results Card (Mục 8.5.2, 8.5.3, 8.5.6, 8.5.7) */}
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '12px',
          }}
        >
          <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
            <ShieldCheck size={16} /> Kết quả Tìm kiếm đã áp dụng Quyền & Data Scope (Mục 8.5.6)
          </h3>

          {searchResult && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={authStyles.badgePrimary}>
                <Database size={12} /> Driver: {searchResult.driverUsed}
              </span>
              <span style={authStyles.badgeSuccess}>Tổng kết quả: {searchResult.total}</span>
              <span
                style={
                  searchResult.staleHitCount > 0
                    ? authStyles.badgeWarning
                    : authStyles.badgePrimary
                }
              >
                Độ trễ tối đa: {searchResult.maxIndexLagMs} ms (Stale: {searchResult.staleHitCount})
              </span>
            </div>
          )}
        </div>

        {!searchResult ? (
          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
            Nhập từ khóa và nhấn Tìm kiếm để truy vấn qua Search Provider dùng chung.
          </p>
        ) : searchResult.hits.length === 0 ? (
          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--status-warning)' }}>
            Không tìm thấy kết quả nào khớp với từ khóa &ldquo;{searchResult.keyword}&rdquo;. Từ
            khóa này đã được ghi nhận vào thống kê Zero-Result Keywords (Mục 8.5.8).
          </p>
        ) : (
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Tài liệu / Thực thể</th>
                  <th style={authStyles.tableHeaderCell}>Trường khớp (Highlights)</th>
                  <th style={authStyles.tableHeaderCell}>Data Scope (Đơn vị / Owner)</th>
                  <th style={authStyles.tableHeaderCell}>Điểm & Độ trễ Index (8.5.7)</th>
                </tr>
              </thead>
              <tbody>
                {searchResult.hits.map((hit) => (
                  <tr key={hit.documentKey}>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>{hit.title}</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        {hit.subtitle} • <code>{hit.documentKey}</code>
                      </div>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                      {hit.matchedHighlights.length > 0 ? (
                        hit.matchedHighlights.map((hl, i) => (
                          <span
                            key={i}
                            style={{ ...authStyles.badgePrimary, marginRight: '4px' }}
                          >
                            {hl}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Khớp toàn văn</span>
                      )}
                    </td>
                    <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                      OrgUnit: <strong>{hit.organizationUnitId ?? '—'}</strong> • Owner:{' '}
                      <strong>#{hit.ownerId ?? hit.id}</strong>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={authStyles.badgeSuccess}>Score: {hit.score}</span>
                        <span
                          style={
                            hit.isStale ? authStyles.badgeWarning : authStyles.badgePrimary
                          }
                        >
                          {hit.isStale ? `STALE (${hit.indexLagMs}ms)` : `Fresh (${hit.indexLagMs}ms)`}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom Grid: Index Lag Telemetry (Mục 8.5.7) & Zero-Result Keywords (Mục 8.5.8) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))',
          gap: '18px',
        }}
      >
        {/* Index Lag Monitor (Mục 8.5.7) */}
        <div style={authStyles.card}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '10px',
            }}
          >
            <div>
              <h3 style={{ ...authStyles.sectionTitle, marginBottom: '2px' }}>
                <Activity size={16} /> Theo dõi Độ trễ cập nhật Search Index (Mục 8.5.7)
              </h3>
              <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
                Phát hiện sớm các bản ghi tìm kiếm bị cũ (<code>sourceUpdatedAt &gt; indexedAt</code>).
              </p>
            </div>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onRefreshSearchTelemetry()}
              style={authStyles.btnSecondary}
            >
              <RefreshCw size={13} /> Kiểm tra
            </button>
          </div>

          {!indexLagReport ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
              Đang tải thông tin độ trễ Search Index...
            </p>
          ) : (
            <div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <div
                  style={{
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tổng tài liệu</div>
                  <div style={{ fontSize: '16px', fontWeight: 800 }}>
                    {indexLagReport.totalIndexedDocuments}
                  </div>
                </div>
                <div
                  style={{
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    background:
                      indexLagReport.staleDocumentCount > 0
                        ? 'var(--status-warning-bg)'
                        : 'var(--status-success-bg)',
                    color:
                      indexLagReport.staleDocumentCount > 0
                        ? 'var(--status-warning)'
                        : 'var(--status-success)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '11px' }}>Bản ghi bị cũ (Stale)</div>
                  <div style={{ fontSize: '16px', fontWeight: 800 }}>
                    {indexLagReport.staleDocumentCount}
                  </div>
                </div>
                <div
                  style={{
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Độ trễ TB</div>
                  <div style={{ fontSize: '16px', fontWeight: 800 }}>
                    {indexLagReport.averageLagMs} ms
                  </div>
                </div>
                <div
                  style={{
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Độ trễ Max</div>
                  <div style={{ fontSize: '16px', fontWeight: 800 }}>
                    {indexLagReport.maxLagMs} ms
                  </div>
                </div>
              </div>

              {indexLagReport.items.length > 0 && (
                <div style={{ maxHeight: '190px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={authStyles.tableHeaderCell}>Tài liệu</th>
                        <th style={authStyles.tableHeaderCell}>Độ trễ (Lag)</th>
                        <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {indexLagReport.items.slice(0, 15).map((item) => (
                        <tr key={item.documentKey}>
                          <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                            <strong>{item.title}</strong> (<code>{item.documentKey}</code>)
                          </td>
                          <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                            {item.lagMs} ms / Ngưỡng: {item.staleThresholdMs} ms
                          </td>
                          <td style={authStyles.tableCell}>
                            <span
                              style={
                                item.isStale ? authStyles.badgeWarning : authStyles.badgeSuccess
                              }
                            >
                              {item.isStale ? 'STALE (Cần đồng bộ)' : 'FRESH'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Zero-Result Keywords Statistics (Mục 8.5.8) */}
        <div style={authStyles.card}>
          <div style={{ marginBottom: '10px' }}>
            <h3 style={{ ...authStyles.sectionTitle, marginBottom: '2px' }}>
              <HelpCircle size={16} /> Thống kê Từ khóa Không có Kết quả (Mục 8.5.8)
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Ghi nhận các từ khóa người dùng tìm kiếm nhưng trả về 0 kết quả để tối ưu đồng nghĩa &
              chỉ mục.
            </p>
          </div>

          {zeroResultKeywords.length === 0 ? (
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)' }}>
              Chưa có từ khóa nào bị 0 kết quả.
            </p>
          ) : (
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={authStyles.tableHeaderCell}>Từ khóa (Sample / Normalized)</th>
                    <th style={authStyles.tableHeaderCell}>Số lượt tìm</th>
                    <th style={authStyles.tableHeaderCell}>Module</th>
                    <th style={authStyles.tableHeaderCell}>Lần tìm gần nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {zeroResultKeywords.map((kw) => (
                    <tr key={kw.normalizedKeyword}>
                      <td style={authStyles.tableCell}>
                        <strong>{kw.sampleKeyword}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Chuẩn hóa: <code>{kw.normalizedKeyword}</code>
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgeWarning}>{kw.searchCount} lượt</span>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        {kw.modules.join(', ') || 'users'}
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        {new Date(kw.lastSearchedAt).toLocaleString('vi-VN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
