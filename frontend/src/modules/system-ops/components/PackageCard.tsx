import React, { useState } from 'react';
import type { PackageSummary, PackageActionDescriptor } from '../types/system-ops.types';
import { PackageStatus, PackageCategory } from '../types/system-ops.types';
import {
  CATEGORY_ICON_CONFIG,
  STATUS_THEME_CONFIG,
} from '../constants/system-ops.constants';

interface PackageCardProps {
  pkg: PackageSummary;
  onExecuteAction: (packageId: string, actionId: string) => Promise<void>;
}

export const PackageCard: React.FC<PackageCardProps> = ({ pkg, onExecuteAction }) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const icon = CATEGORY_ICON_CONFIG[pkg.category as PackageCategory] || '🧩';
  const statusTheme =
    STATUS_THEME_CONFIG[pkg.statusReport.status as PackageStatus] ||
    STATUS_THEME_CONFIG[PackageStatus.IDLE];

  const handleActionClick = async (action: PackageActionDescriptor) => {
    if (action.isDanger) {
      const confirm = window.confirm(
        `CẢNH BÁO NGUY HIỂM: Bạn có chắc chắn muốn thực hiện hành động "${action.label}" trên package [${pkg.displayName}]?`,
      );
      if (!confirm) return;
    }

    try {
      setLoadingAction(action.id);
      await onExecuteAction(pkg.packageId, action.id);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="glass ops-pkg-card">
      <div>
        {/* Header: Icon, Name & Status Badge */}
        <div className="ops-pkg-header">
          <div className="ops-pkg-title-area">
            <span className="ops-pkg-icon">{icon}</span>
            <div>
              <h3 className="ops-pkg-title">{pkg.displayName}</h3>
              <span className="ops-pkg-id">ID: {pkg.packageId}</span>
            </div>
          </div>

          <span className={`ops-status-badge ${statusTheme.className}`}>
            ● {statusTheme.label}
          </span>
        </div>

        {/* Summary text */}
        <p className="ops-pkg-summary">{pkg.statusReport.summary}</p>

        {/* Metrics Grid */}
        {Object.keys(pkg.statusReport.metrics).length > 0 && (
          <div className="ops-metrics-box">
            {Object.entries(pkg.statusReport.metrics).map(([key, val]) => (
              <div key={key}>
                <div className="ops-metric-label">{key}</div>
                <div className="ops-metric-value">{String(val)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions Section */}
      {pkg.actions.length > 0 && (
        <div className="ops-actions-container">
          {pkg.actions.map((action) => {
            const isLoading = loadingAction === action.id;
            const btnVariantClass = action.isDanger
              ? 'ops-action-btn-danger'
              : 'ops-action-btn-normal';

            return (
              <button
                key={action.id}
                disabled={isLoading}
                onClick={() => handleActionClick(action)}
                className={`ops-action-btn ${btnVariantClass}`}
              >
                {isLoading ? 'Đang thực thi...' : action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
