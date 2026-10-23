import React, { useState } from 'react';
import {
  Edit3,
  FolderTree,
  Menu as MenuIcon,
  Plus,
  RefreshCw,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { MENU_POSITION_OPTIONS, MENU_TYPE_OPTIONS } from '../enum/settings.enum';
import type {
  MenuSummary,
  MenuTreeEvaluationResult,
  MenuTreeNodeItem,
} from '../types/settings.types';

interface MenusManagementTabProps {
  menus: MenuSummary[];
  positionFilter: string;
  onPositionFilterChange: (pos: string) => void;
  menuTree: MenuTreeEvaluationResult | null;
  loading: boolean;
  submitting: boolean;
  onCreateMenu: (payload: {
    code: string;
    module?: string;
    name: string;
    position?: string;
    type?: number;
    link?: string | null;
    key?: string | null;
    icon?: string | null;
    numOrder?: number;
    parentCode?: string | null;
  }) => Promise<boolean>;
  onUpdateMenu: (
    code: string,
    payload: {
      name?: string;
      position?: string;
      type?: number;
      link?: string | null;
      key?: string | null;
      icon?: string | null;
      numOrder?: number;
      parentCode?: string | null;
    },
  ) => Promise<boolean>;
  onToggleMenu: (code: string, status: number, cascadeChildren?: boolean) => Promise<void>;
  onDeleteMenu: (code: string) => Promise<void>;
  onInvalidateCache: () => Promise<void>;
}

export const MenusManagementTab: React.FC<MenusManagementTabProps> = ({
  menus,
  positionFilter,
  onPositionFilterChange,
  menuTree,
  submitting,
  onCreateMenu,
  onUpdateMenu,
  onToggleMenu,
  onDeleteMenu,
  onInvalidateCache,
}) => {
  const [editingMenu, setEditingMenu] = useState<MenuSummary | null>(null);
  const [showCreate, setShowCreate] = useState<boolean>(false);

  const [code, setCode] = useState<string>('');
  const [moduleName, setModuleName] = useState<string>('settings');
  const [name, setName] = useState<string>('');
  const [position, setPosition] = useState<string>(positionFilter || 'SIDEBAR');
  const [type, setType] = useState<number>(2); // ITEM
  const [link, setLink] = useState<string>('');
  const [permissionKey, setPermissionKey] = useState<string>('');
  const [icon, setIcon] = useState<string>('Settings');
  const [numOrder, setNumOrder] = useState<number>(10);
  const [parentCode, setParentCode] = useState<string>('');

  const openEdit = (m: MenuSummary) => {
    setEditingMenu(m);
    setShowCreate(false);
    setCode(m.code);
    setModuleName(m.module);
    setName(m.name);
    setPosition(m.position);
    setType(m.type);
    setLink(m.link ?? '');
    setPermissionKey(m.key ?? '');
    setIcon(m.icon ?? '');
    setNumOrder(m.numOrder);
    setParentCode(m.parentCode ?? '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingMenu) {
      const ok = await onUpdateMenu(editingMenu.code, {
        name: name.trim(),
        position,
        type,
        link: link.trim() || null,
        key: permissionKey.trim() || null,
        icon: icon.trim() || null,
        numOrder,
        parentCode: parentCode.trim() || null,
      });
      if (ok) setEditingMenu(null);
    } else {
      const ok = await onCreateMenu({
        code: code.trim(),
        module: moduleName.trim() || 'settings',
        name: name.trim(),
        position,
        type,
        link: link.trim() || null,
        key: permissionKey.trim() || null,
        icon: icon.trim() || null,
        numOrder,
        parentCode: parentCode.trim() || null,
      });
      if (ok) {
        setShowCreate(false);
        setCode('');
        setName('');
      }
    }
  };

  const renderTreeNode = (node: MenuTreeNodeItem, depth = 0): React.ReactNode => (
    <div key={node.code} style={{ marginLeft: `${depth * 18}px`, marginTop: '6px' }}>
      <div
        style={{
          padding: '8px 12px',
          borderRadius: '8px',
          background: node.status === 1 ? 'var(--bg-surface)' : 'var(--bg-surface-elevated)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          opacity: node.status === 1 ? 1 : 0.65,
        }}
      >
        <div>
          <span style={{ fontWeight: 700, fontSize: '13px' }}>{node.name}</span>{' '}
          <code style={{ fontSize: '11.5px', color: 'var(--primary)' }}>({node.code})</code>
          {node.link && (
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginLeft: '6px' }}>
              → {node.link}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span style={authStyles.badgePrimary}>{node.typeName}</span>
          <span style={node.status === 1 ? authStyles.badgeSuccess : authStyles.badgeWarning}>
            #{node.numOrder}
          </span>
        </div>
      </div>
      {node.children?.map((child) => renderTreeNode(child, depth + 1))}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Toolbar */}
      <div
        style={{
          ...authStyles.cardHighlighted,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <MenuIcon size={18} color="var(--primary)" />
          <span style={{ fontWeight: 700, fontSize: '14.5px' }}>Vị trí hiển thị Menu:</span>
          {MENU_POSITION_OPTIONS.map((pos) => (
            <button
              key={pos.value}
              type="button"
              onClick={() => onPositionFilterChange(pos.value)}
              style={
                positionFilter === pos.value ? authStyles.btnPrimary : authStyles.btnSecondary
              }
            >
              {pos.value}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void onInvalidateCache()}
            style={authStyles.btnTeal}
          >
            <RefreshCw size={14} /> Làm mới Cache L1/L2 (v{menuTree?.cacheVersion ?? 1})
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingMenu(null);
              setShowCreate((v) => !v);
            }}
            style={authStyles.btnPrimary}
          >
            <Plus size={14} /> Thêm mục Menu
          </button>
        </div>
      </div>

      {/* Create / Edit Form */}
      {(showCreate || editingMenu) && (
        <form onSubmit={(e) => void handleSave(e)} style={authStyles.card}>
          <div style={authStyles.sectionTitle}>
            {editingMenu ? `Cập nhật Mục Menu: ${editingMenu.code}` : '+ Tạo Mục Menu Điều Hướng Mới'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '12px' }}>
            <div>
              <label style={authStyles.label}>Mã Menu (code) *</label>
              <input
                type="text"
                required
                disabled={Boolean(editingMenu)}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="VD: iam.users"
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Tên hiển thị *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={authStyles.input}
              />
            </div>
            <div>
              <label style={authStyles.label}>Vị trí (Position)</label>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                style={authStyles.input}
              >
                {MENU_POSITION_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={authStyles.label}>Loại mục (Type)</label>
              <select
                value={type}
                onChange={(e) => setType(Number(e.target.value))}
                style={authStyles.input}
              >
                {MENU_TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={authStyles.label}>Đường dẫn (link)</label>
              <input
                type="text"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="/users"
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Quyền yêu cầu (RBAC key)</label>
              <input
                type="text"
                value={permissionKey}
                onChange={(e) => setPermissionKey(e.target.value)}
                placeholder="users.read"
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Mã Menu Cha (parentCode)</label>
              <input
                type="text"
                value={parentCode}
                onChange={(e) => setParentCode(e.target.value)}
                placeholder="Để trống nếu là cấp 1"
                style={authStyles.monoInput}
              />
            </div>
            <div>
              <label style={authStyles.label}>Thứ tự (numOrder) & Icon</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="number"
                  value={numOrder}
                  onChange={(e) => setNumOrder(Number(e.target.value))}
                  style={{ ...authStyles.input, width: '90px' }}
                />
                <input
                  type="text"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder="Icon"
                  style={authStyles.input}
                />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
            <button
              type="button"
              onClick={() => {
                setEditingMenu(null);
                setShowCreate(false);
              }}
              style={authStyles.btnSecondary}
            >
              Hủy
            </button>
            <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
              <Save size={14} /> Lưu mục Menu
            </button>
          </div>
        </form>
      )}

      {/* Split View: Tree Hierarchy Preview + Flat Management Table */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.45fr', gap: '18px', alignItems: 'start' }}>
        <div style={authStyles.card}>
          <div style={authStyles.sectionTitle}>
            <FolderTree size={16} color="var(--primary)" />
            <span>Cây Phân Cấp Menu ({menuTree?.totalItems ?? 0} mục)</span>
          </div>
          <div style={{ marginTop: '10px' }}>
            {menuTree?.items.length ? (
              menuTree.items.map((node) => renderTreeNode(node, 0))
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px 0' }}>
                Chưa có mục menu nào ở vị trí {positionFilter}.
              </div>
            )}
          </div>
        </div>

        <div style={authStyles.card}>
          <div style={authStyles.sectionTitle}>Danh sách Quản trị Mục Menu ({menus.length})</div>
          <div style={{ overflowX: 'auto', marginTop: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={authStyles.tableHeaderCell}>Mã & Tên</th>
                  <th style={authStyles.tableHeaderCell}>Loại / Cấp</th>
                  <th style={authStyles.tableHeaderCell}>Quyền RBAC</th>
                  <th style={authStyles.tableHeaderCell}>Trạng thái</th>
                  <th style={authStyles.tableHeaderCell}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {menus.map((m) => (
                  <tr key={m.code}>
                    <td style={authStyles.tableCell}>
                      <div style={{ fontWeight: 700 }}>{m.name}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--primary)' }}>
                        {m.code} {m.link ? `→ ${m.link}` : ''}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgePrimary}>{m.typeName}</span>{' '}
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        Lv.{m.level} (#{m.numOrder})
                      </span>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {m.key ?? 'Công khai'}
                    </td>
                    <td style={authStyles.tableCell}>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void onToggleMenu(m.code, m.status === 1 ? 0 : 1)}
                        style={{ ...authStyles.btnSecondary, padding: '4px 9px', fontSize: '11.5px' }}
                      >
                        {m.status === 1 ? <ToggleRight size={15} color="var(--secondary)" /> : <ToggleLeft size={15} />}
                        <span>{m.statusName}</span>
                      </button>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => openEdit(m)}
                          style={{ ...authStyles.btnSecondary, padding: '5px 8px' }}
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void onDeleteMenu(m.code)}
                          style={{ ...authStyles.btnDanger, padding: '5px 8px' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

