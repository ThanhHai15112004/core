import React from 'react';
import { Landmark, Building2, Briefcase, Users, GitFork } from 'lucide-react';
import type { OrganizationStats } from '../types/organizations.types';

interface OrgStatsCardsProps {
  stats: OrganizationStats | null;
}

export const OrgStatsCards: React.FC<OrgStatsCardsProps> = ({ stats }) => {
  const cards = [
    {
      label: 'Tổng số đơn vị tổ chức',
      value: stats?.totalUnits ?? 0,
      sub: `${stats?.activeUnits ?? 0} đang hoạt động · ${stats?.inactiveUnits ?? 0} tạm ngưng`,
      icon: Building2,
      color: 'var(--primary)',
      bg: 'var(--primary-light)',
    },
    {
      label: 'Trụ sở chính & Chi nhánh',
      value: (stats?.byType.headquarters ?? 0) + (stats?.byType.branch ?? 0),
      sub: `${stats?.byType.headquarters ?? 0} Trụ sở (HQ) · ${stats?.byType.branch ?? 0} Chi nhánh`,
      icon: Landmark,
      color: 'var(--secondary)',
      bg: 'var(--secondary-light)',
    },
    {
      label: 'Phòng ban chuyên môn',
      value: stats?.byType.department ?? 0,
      sub: 'Khối / Phòng ban nghiệp vụ',
      icon: Briefcase,
      color: 'var(--accent)',
      bg: 'var(--accent-light)',
    },
    {
      label: 'Đội nhóm / Tổ chuyên môn',
      value: stats?.byType.team ?? 0,
      sub: 'Nhóm thực thi trực thuộc phòng ban',
      icon: Users,
      color: 'var(--status-success)',
      bg: 'var(--status-success-bg)',
    },
    {
      label: 'Độ sâu sơ đồ cây',
      value: `${stats?.maxDepthObserved ?? 0} / ${stats?.maxDepthAllowed ?? 10}`,
      sub: `${stats?.rootUnits ?? 0} nhánh gốc (Root Units)`,
      icon: GitFork,
      color: 'var(--primary)',
      bg: 'var(--primary-light)',
    },
  ];

  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '14px',
        marginBottom: '20px',
      }}
    >
      {cards.map((c) => {
        const IconComp = c.icon;
        return (
          <div
            key={c.label}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '16px 18px',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '11px',
                background: c.bg,
                color: c.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <IconComp size={21} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                {c.label}
              </div>
              <div
                style={{
                  fontSize: '21px',
                  fontWeight: 800,
                  color: 'var(--text-main)',
                  lineHeight: 1.25,
                }}
              >
                {c.value}
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {c.sub}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
};

