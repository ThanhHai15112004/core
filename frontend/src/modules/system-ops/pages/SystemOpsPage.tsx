import React, { useState, useEffect, useCallback } from 'react';
import type { PackageSummary } from '../types/system-ops.types';
import { PackageStatus } from '../types/system-ops.types';
import { getSystemOpsPackages, executePackageAction } from '../services/system-ops.api';
import { PackageCard } from '../components/PackageCard';
import '../styles/system-ops.css';

export const SystemOpsPage: React.FC = () => {
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadPackages = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getSystemOpsPackages();
      setPackages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể kết nối đến máy chủ Backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const handleExecuteAction = async (packageId: string, actionId: string) => {
    try {
      const result = await executePackageAction(packageId, actionId);
      if (result.success) {
        setNotification({ type: 'success', message: result.message || 'Thao tác thành công!' });
        await loadPackages();
      } else {
        setNotification({ type: 'error', message: result.message || 'Thao tác thất bại!' });
      }
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Lỗi khi thực thi thao tác trên package.',
      });
    }

    setTimeout(() => setNotification(null), 5000);
  };

  const healthyCount = packages.filter((p) => p.statusReport.status === PackageStatus.HEALTHY).length;
  const warningCount = packages.filter(
    (p) => p.statusReport.status === PackageStatus.WARNING || p.statusReport.status === PackageStatus.ERROR,
  ).length;

  return (
    <div className="ops-container">
      {/* Header */}
      <div className="ops-header">
        <div>
          <div className="ops-badge">
            ⚙️ Core Control Panel
          </div>
          <h1 className="ops-title">
            Quản Lý Vận Hành Package (System Ops)
          </h1>
          <p className="ops-subtitle">
            Tự động nhận diện và quản lý các package hạ tầng có trạng thái (Cache, Logging, Messaging...).
          </p>
        </div>

        <button
          onClick={() => void loadPackages()}
          disabled={loading}
          className="btn-secondary ops-refresh-btn"
        >
          {loading ? 'Đang làm mới...' : '🔄 Làm mới dữ liệu'}
        </button>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div
          className={`ops-toast ${
            notification.type === 'success' ? 'ops-toast-success' : 'ops-toast-error'
          }`}
        >
          <span>{notification.type === 'success' ? '✅ ' : '❌ '}{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="ops-toast-close"
          >
            ✕
          </button>
        </div>
      )}

      {/* Overview Stats Bar */}
      <div className="ops-stats-grid">
        <div className="glass ops-stat-card">
          <div className="ops-stat-label">Tổng số Package hoạt động</div>
          <div className="ops-stat-value ops-stat-value-primary">
            {packages.length}
          </div>
        </div>

        <div className="glass ops-stat-card">
          <div className="ops-stat-label">Trạng thái Tốt (Healthy)</div>
          <div className="ops-stat-value ops-stat-value-success">
            {healthyCount}
          </div>
        </div>

        <div className="glass ops-stat-card">
          <div className="ops-stat-label">Cảnh báo / Lỗi</div>
          <div
            className={`ops-stat-value ${
              warningCount > 0 ? 'ops-stat-value-warning' : 'ops-stat-value-idle'
            }`}
          >
            {warningCount}
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="glass ops-error-box">
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
          <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>
            Không thể tải danh sách Package
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '16px' }}>{error}</p>
          <button onClick={() => void loadPackages()} className="btn-primary">
            Thử lại
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !error && packages.length === 0 && (
        <div className="ops-empty-loading">
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>⏳</div>
          <p>Đang tải thông tin các package từ Backend...</p>
        </div>
      )}

      {/* Packages Grid */}
      {!loading && !error && (
        <div className="ops-packages-grid">
          {packages.map((pkg) => (
            <PackageCard key={pkg.packageId} pkg={pkg} onExecuteAction={handleExecuteAction} />
          ))}
        </div>
      )}
    </div>
  );
};
