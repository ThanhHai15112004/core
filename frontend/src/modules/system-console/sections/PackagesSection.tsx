import React, { useState, useMemo } from 'react';
import type { PackageSummary, PackageActionDescriptor } from '../types/console.types';
import { useConsoleData } from '../context/ConsoleDataContext';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatusPill } from '../components/common/StatusPill';
import { EmptyState } from '../components/common/EmptyState';
import { DetailDrawer } from '../components/common/DetailDrawer';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { resolvePackageIcon } from '../constants/console.constants';
import { Search, Boxes } from 'lucide-react';

interface PackagesSectionProps {
  initialSelectedPackageId?: string | null;
  onClearSelectedPackageId?: () => void;
}

export const PackagesSection: React.FC<PackagesSectionProps> = ({
  initialSelectedPackageId,
  onClearSelectedPackageId,
}) => {
  const { packages, executeAction, refresh, isRefreshing } = useConsoleData();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeDrawerPkg, setActiveDrawerPkg] = useState<PackageSummary | null>(() => {
    if (initialSelectedPackageId) {
      return packages.find((p) => p.packageId === initialSelectedPackageId) || null;
    }
    return null;
  });

  const [confirmModalState, setConfirmModalState] = useState<{
    isOpen: boolean;
    pkgId: string;
    pkgName: string;
    action: PackageActionDescriptor | null;
  }>({
    isOpen: false,
    pkgId: '',
    pkgName: '',
    action: null,
  });

  const [executingActionId, setExecutingActionId] = useState<string | null>(null);

  // Filter categories
  const categories = useMemo(() => {
    const set = new Set(packages.map((p) => p.category));
    return ['all', ...Array.from(set)];
  }, [packages]);

  // Filtered packages
  const filteredPackages = useMemo(() => {
    return packages.filter((pkg) => {
      const matchCategory = selectedCategory === 'all' || pkg.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchQuery =
        !q ||
        pkg.displayName.toLowerCase().includes(q) ||
        pkg.packageId.toLowerCase().includes(q) ||
        pkg.statusReport.summary.toLowerCase().includes(q);
      return matchCategory && matchQuery;
    });
  }, [packages, selectedCategory, searchQuery]);

  const handleActionClick = (pkg: PackageSummary, action: PackageActionDescriptor) => {
    if (action.isDanger) {
      setConfirmModalState({
        isOpen: true,
        pkgId: pkg.packageId,
        pkgName: pkg.displayName,
        action,
      });
    } else {
      triggerExecution(pkg.packageId, action.id);
    }
  };

  const triggerExecution = async (packageId: string, actionId: string) => {
    try {
      setExecutingActionId(actionId);
      await executeAction(packageId, actionId);
    } finally {
      setExecutingActionId(null);
      setConfirmModalState((prev) => ({ ...prev, isOpen: false }));
    }
  };

  const handleCloseDrawer = () => {
    setActiveDrawerPkg(null);
    if (onClearSelectedPackageId) {
      onClearSelectedPackageId();
    }
  };

  return (
    <div>
      <SectionHeader
        title="Manageable Packages"
        description="Inspect and control registered framework infrastructure packages implementing the ManageablePackage contract."
        actions={
          <button
            type="button"
            className="scp-btn scp-btn-secondary scp-btn-sm"
            onClick={() => refresh()}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh Packages'}
          </button>
        }
      />

      {/* Filter and Search Bar */}
      <div className="packages-filter-bar">
        <div className="filter-pill-group">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`filter-pill-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat.toUpperCase()}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Filter by name, ID or status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: '0.45rem 0.85rem',
            borderRadius: '6px',
            border: '1px solid var(--scp-border-subtle)',
            backgroundColor: 'var(--scp-bg-surface)',
            color: 'var(--scp-text-primary)',
            fontSize: '0.825rem',
            width: '240px',
            outline: 'none',
          }}
        />
      </div>

      {/* Packages Grid */}
      {filteredPackages.length > 0 ? (
        <div className="packages-grid">
          {filteredPackages.map((pkg) => (
            <div key={pkg.packageId} className="package-card">
              {/* Header */}
              <div className="package-card-header">
                <div className="package-info">
                  <div className="package-icon-box">{resolvePackageIcon(pkg)}</div>
                  <div>
                    <h4 className="package-title">{pkg.displayName}</h4>
                    <div className="package-id">packageId: {pkg.packageId}</div>
                  </div>
                </div>
                <StatusPill status={pkg.statusReport.status} />
              </div>

              {/* Summary */}
              <p className="package-summary">{pkg.statusReport.summary}</p>

              {/* Metrics Mini Preview */}
              {Object.keys(pkg.statusReport.metrics).length > 0 && (
                <div className="package-metrics-mini">
                  {Object.entries(pkg.statusReport.metrics)
                    .slice(0, 4)
                    .map(([key, val]) => (
                      <div key={key} className="metric-mini-item">
                        <span className="metric-mini-label">{key}</span>
                        <span className="metric-mini-val">{String(val)}</span>
                      </div>
                    ))}
                </div>
              )}

              {/* Actions Footer */}
              <div className="package-card-actions">
                <button
                  type="button"
                  className="scp-btn scp-btn-sm scp-btn-secondary"
                  onClick={() => setActiveDrawerPkg(pkg)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <Search size={13} />
                  <span>Inspect Details</span>
                </button>

                {pkg.actions.map((act) => {
                  const isExecuting = executingActionId === act.id;
                  return (
                    <button
                      key={act.id}
                      type="button"
                      disabled={isExecuting}
                      className={`scp-btn scp-btn-sm ${act.isDanger ? 'scp-btn-danger' : 'scp-btn-primary'}`}
                      onClick={() => handleActionClick(pkg, act)}
                      title={act.description || act.label}
                    >
                      {isExecuting ? 'Running...' : act.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Boxes size={36} style={{ color: 'var(--scp-text-muted)' }} />}
          title="No packages found"
          description={
            searchQuery
              ? `No packages match your search filter "${searchQuery}".`
              : 'There are currently no manageable packages registered with the System Ops module.'
          }
          action={
            searchQuery ? (
              <button
                type="button"
                className="scp-btn scp-btn-secondary scp-btn-sm"
                onClick={() => setSearchQuery('')}
              >
                Clear Search
              </button>
            ) : undefined
          }
        />
      )}

      {/* Detail Slide Drawer */}
      <DetailDrawer
        pkg={activeDrawerPkg}
        onClose={handleCloseDrawer}
        onExecuteAction={(pkgId, actId) => {
          const p = packages.find((x) => x.packageId === pkgId);
          const a = p?.actions.find((x) => x.id === actId);
          if (p && a) handleActionClick(p, a);
        }}
      />

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModalState.isOpen}
        title={`Dangerous Action: ${confirmModalState.action?.label}`}
        message={`Are you sure you want to execute "${confirmModalState.action?.label}" on package [${confirmModalState.pkgName}]?\n\nDescription: ${confirmModalState.action?.description || 'This operation may affect active runtime state.'}`}
        confirmText="Confirm & Execute"
        isDanger={true}
        isLoading={executingActionId === confirmModalState.action?.id}
        onConfirm={() => {
          if (confirmModalState.action) {
            triggerExecution(confirmModalState.pkgId, confirmModalState.action.id);
          }
        }}
        onCancel={() => setConfirmModalState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
