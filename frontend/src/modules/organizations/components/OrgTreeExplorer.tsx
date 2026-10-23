import React, { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Landmark,
  Building2,
  Briefcase,
  Users,
  Plus,
  Edit3,
  FolderTree,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import type { OrganizationTreeNode, OrganizationUnitItem } from '../types/organizations.types';

interface OrgTreeExplorerProps {
  treeNodes: OrganizationTreeNode[];
  selectedUnitId: number | null;
  onSelectUnit: (unit: OrganizationUnitItem) => void;
  onAddChildUnit: (parentUnit: OrganizationUnitItem | null) => void;
}

export const OrgTreeExplorer: React.FC<OrgTreeExplorerProps> = ({
  treeNodes,
  selectedUnitId,
  onSelectUnit,
  onAddChildUnit,
}) => {
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());

  const toggleNode = (id: number) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setCollapsedIds(new Set());

  const collapseAll = () => {
    const allIds = new Set<number>();
    const walk = (nodes: OrganizationTreeNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) {
          allIds.add(n.id);
          walk(n.children);
        }
      }
    };
    walk(treeNodes);
    setCollapsedIds(allIds);
  };

  const resolveUnitIcon = (type: number) => {
    switch (type) {
      case 1:
        return <Landmark size={15} color="var(--primary)" />;
      case 2:
        return <Building2 size={15} color="var(--secondary)" />;
      case 3:
        return <Briefcase size={15} color="var(--accent)" />;
      case 4:
      default:
        return <Users size={15} color="var(--status-success)" />;
    }
  };

  const renderTreeNode = (node: OrganizationTreeNode) => {
    const isCollapsed = collapsedIds.has(node.id);
    const isSelected = selectedUnitId === node.id;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.id} style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            marginLeft: `${(node.depth - 1) * 22}px`,
            marginBottom: '4px',
            borderRadius: 'var(--radius-sm)',
            background: isSelected ? 'var(--primary-light)' : 'var(--bg-surface-elevated)',
            border: isSelected
              ? '1px solid var(--primary)'
              : '1px solid var(--border-color)',
            transition: 'var(--transition-fast)',
          }}
        >
          <div
            onClick={() => onSelectUnit(node)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              flex: 1,
              minWidth: 0,
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleNode(node.id);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  padding: '2px',
                }}
              >
                {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
            ) : (
              <span style={{ width: '19px', display: 'inline-block' }} />
            )}

            {resolveUnitIcon(node.type)}

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text-main)' }}>
                  {node.name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11.5px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--primary)',
                    fontWeight: 600,
                  }}
                >
                  {node.code}
                </span>
                <span style={authStyles.badgePrimary}>{node.typeName}</span>
                {node.status !== 1 && (
                  <span style={node.status === 2 ? authStyles.badgeWarning : authStyles.badgeDanger}>
                    {node.statusName}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                  marginTop: '2px',
                }}
              >
                Path: {node.path} · Cấp {node.depth}
                {node.descendantCount > 0
                  ? ` · ${node.childrenCount} trực tiếp / ${node.descendantCount} tổng đơn vị con`
                  : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => onAddChildUnit(node)}
              style={{
                ...authStyles.btnSecondary,
                padding: '5px 9px',
                fontSize: '11.5px',
              }}
              title={`Thêm đơn vị con trực thuộc ${node.name}`}
            >
              <Plus size={12} /> Thêm con
            </button>
            <button
              type="button"
              onClick={() => onSelectUnit(node)}
              style={{
                ...authStyles.btnPrimary,
                padding: '5px 9px',
                fontSize: '11.5px',
              }}
              title="Chỉnh sửa đơn vị này"
            >
              <Edit3 size={12} /> Sửa
            </button>
          </div>
        </div>

        {hasChildren && !isCollapsed && (
          <div>{node.children.map((child) => renderTreeNode(child))}</div>
        )}
      </div>
    );
  };

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
            <FolderTree size={18} color="var(--primary)" />
            <span>Sơ Đồ Cây Phân Cấp Tổ Chức (Hierarchy Tree Explorer)</span>
          </h3>
          <p style={{ ...authStyles.sectionDesc, margin: '4px 0 0' }}>
            Hiển thị trực quan quan hệ Cha — Con (`parentId`), đường dẫn phân cấp (`path`) và độ
            sâu từng nhánh.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button type="button" onClick={expandAll} style={authStyles.btnSecondary}>
            Mở rộng tất cả
          </button>
          <button type="button" onClick={collapseAll} style={authStyles.btnSecondary}>
            Thu gọn tất cả
          </button>
          <button
            type="button"
            onClick={() => onAddChildUnit(null)}
            style={authStyles.btnTeal}
          >
            <Plus size={14} /> Tạo đơn vị gốc (Root)
          </button>
        </div>
      </div>

      {treeNodes.length === 0 ? (
        <div
          style={{
            padding: '32px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          Chưa có đơn vị tổ chức nào hoặc chưa đăng nhập tài khoản có quyền{' '}
          <code>organizations.read</code>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {treeNodes.map((rootNode) => renderTreeNode(rootNode))}
        </div>
      )}
    </div>
  );
};

