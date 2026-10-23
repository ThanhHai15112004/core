import React from 'react';
import { Search, Filter, Edit3, Plus, Trash2, Building2 } from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { ORG_UNIT_STATUS_OPTIONS, ORG_UNIT_TYPE_OPTIONS } from '../enum/organizations.enum';
import type { OrganizationUnitItem } from '../types/organizations.types';

interface OrgDirectoryTableProps {
  units: OrganizationUnitItem[];
  allUnits: OrganizationUnitItem[];
  selectedUnitId: number | null;
  searchQuery: string;
  onSearchChange: (val: string) => void;
  typeFilter: string;
  onTypeFilterChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
  parentFilter: string;
  onParentFilterChange: (val: string) => void;
  onSelectUnit: (unit: OrganizationUnitItem) => void;
  onAddChildUnit: (parentUnit: OrganizationUnitItem) => void;
  onDeleteUnit: (id: number) => Promise<void>;
}

export const OrgDirectoryTable: React.FC<OrgDirectoryTableProps> = ({
  units,
  allUnits,
  selectedUnitId,
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  parentFilter,
  onParentFilterChange,
  onSelectUnit,
  onAddChildUnit,
  onDeleteUnit,
}) => {
  const unitNameById = new Map<number, string>(allUnits.map((u) => [u.id, `${u.code} — ${u.name}`]));

  return (
    <div style={authStyles.card}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          marginBottom: '14px',
        }}
      >
        <div>
          <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
            <Building2 size={18} color="var(--secondary)" />
            <span>Danh Bạ Đơn Vị, Chi Nhánh & Phòng Ban ({units.length})</span>
          </h3>
          <p style={{ ...authStyles.sectionDesc, margin: '4px 0 0' }}>
            Tra cứu phẳng theo Mã đơn vị, Tên hiển thị, Cấp bậc loại đơn vị, Trạng thái hoạt động
            hoặc Đơn vị cấp trên.
          </p>
        </div>

        {/* Bộ lọc đa chiều */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: '210px' }}>
            <Search
              size={14}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: '10px', top: '11px' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm mã hoặc tên đơn vị..."
              style={{ ...authStyles.input, paddingLeft: '30px' }}
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => onTypeFilterChange(e.target.value)}
            style={{ ...authStyles.input, width: '170px' }}
          >
            <option value="">Mọi loại đơn vị</option>
            {ORG_UNIT_TYPE_OPTIONS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            style={{ ...authStyles.input, width: '165px' }}
          >
            <option value="">Mọi trạng thái</option>
            {ORG_UNIT_STATUS_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>

          <select
            value={parentFilter}
            onChange={(e) => onParentFilterChange(e.target.value)}
            style={{ ...authStyles.input, width: '190px' }}
          >
            <option value="">Mọi đơn vị cha</option>
            <option value="ROOT">-- Chỉ đơn vị gốc (Root) --</option>
            {allUnits.map((u) => (
              <option key={u.id} value={u.id}>
                Cha: {u.code} ({u.name})
              </option>
            ))}
          </select>

          {(searchQuery || typeFilter || statusFilter || parentFilter) && (
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                onTypeFilterChange('');
                onStatusFilterChange('');
                onParentFilterChange('');
              }}
              style={authStyles.btnSecondary}
            >
              <Filter size={13} /> Xóa lọc
            </button>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={authStyles.tableHeaderCell}>ID</th>
              <th style={authStyles.tableHeaderCell}>Mã đơn vị</th>
              <th style={authStyles.tableHeaderCell}>Tên đơn vị / Phòng ban</th>
              <th style={authStyles.tableHeaderCell}>Loại cấp bậc</th>
              <th style={authStyles.tableHeaderCell}>Đơn vị cấp trên (Parent)</th>
              <th style={authStyles.tableHeaderCell}>Trạng thái</th>
              <th style={authStyles.tableHeaderCell}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {units.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{ ...authStyles.tableCell, textAlign: 'center', color: 'var(--text-muted)' }}
                >
                  Không tìm thấy đơn vị nào khớp điều kiện lọc.
                </td>
              </tr>
            ) : (
              units.map((u) => {
                const isSelected = selectedUnitId === u.id;
                return (
                  <tr
                    key={u.id}
                    style={{
                      background: isSelected ? 'var(--primary-light)' : 'transparent',
                    }}
                  >
                    <td
                      style={{
                        ...authStyles.tableCell,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                      }}
                    >
                      #{u.id}
                    </td>
                    <td
                      style={{
                        ...authStyles.tableCell,
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--primary)',
                        fontWeight: 700,
                      }}
                    >
                      {u.code}
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>{u.name}</div>
                      {u.description && (
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          {u.description}
                        </div>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>{u.typeName}</span>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontSize: '12.5px' }}>
                      {u.parentId ? (
                        unitNameById.get(u.parentId) ?? `#${u.parentId}`
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          Đơn vị gốc (Root)
                        </span>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>
                      {u.status === 1 ? (
                        <span style={authStyles.badgeSuccess}>ACTIVE</span>
                      ) : u.status === 2 ? (
                        <span style={authStyles.badgeWarning}>INACTIVE</span>
                      ) : (
                        <span style={authStyles.badgeDanger}>ARCHIVED</span>
                      )}
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => onSelectUnit(u)}
                          style={{
                            ...authStyles.btnSecondary,
                            padding: '5px 9px',
                            fontSize: '12px',
                          }}
                        >
                          <Edit3 size={12} /> Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => onAddChildUnit(u)}
                          style={{
                            ...authStyles.btnSecondary,
                            padding: '5px 9px',
                            fontSize: '12px',
                          }}
                        >
                          <Plus size={12} /> Thêm con
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteUnit(u.id)}
                          style={{
                            ...authStyles.btnDanger,
                            padding: '5px 9px',
                            fontSize: '12px',
                          }}
                        >
                          <Trash2 size={12} /> Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

