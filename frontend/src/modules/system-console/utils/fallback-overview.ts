import type { HealthMapItem, KeyMetricItem, OverviewData } from '../types/console.types';

type Translate = (path: string, params?: Record<string, string | number>) => string;

interface FallbackInput {
  t: Translate;
  isOffline: boolean;
  apiBaseUrl: string;
  lastUpdated: Date;
  lastSuccessfulSync: Date | null;
}

const NO_VALUE = '--';

/* Chỉ giữ id/khung hiển thị; không có giá trị nào được đoán. */
const METRIC_IDS: Array<Pick<KeyMetricItem, 'id' | 'unit'>> = [
  { id: 'req_sec', unit: 'req/s' },
  { id: 'p95_lat', unit: 'ms' },
  { id: 'err_rate' },
  { id: 'cpu_load' },
  { id: 'mem_usage' },
  { id: 'alerts_count' },
];

const HEALTH_MAP_SKELETON: Array<Pick<HealthMapItem, 'id' | 'category' | 'targetSection' | 'icon'>> = [
  { id: 'runtime-api', category: 'runtime', targetSection: 'runtime', icon: 'globe' },
  { id: 'runtime-worker', category: 'runtime', targetSection: 'worker', icon: 'cpu' },
  { id: 'runtime-scheduler', category: 'runtime', targetSection: 'scheduler', icon: 'clock' },
  { id: 'infra-db', category: 'infrastructure', targetSection: 'database', icon: 'database' },
  { id: 'infra-cache', category: 'infrastructure', targetSection: 'cache', icon: 'zap' },
  { id: 'infra-storage', category: 'infrastructure', targetSection: 'packages', icon: 'hard-drive' },
  { id: 'gov-security', category: 'governance', targetSection: 'security', icon: 'shield-check' },
];

/**
 * Overview hiển thị khi không lấy được `/ops/overview`.
 * Mọi thành phần ở trạng thái `unknown` và không có số liệu — không hiển thị dữ liệu giả.
 */
export function buildFallbackOverview({
  t,
  isOffline,
  apiBaseUrl,
  lastUpdated,
  lastSuccessfulSync,
}: FallbackInput): OverviewData {
  const noData = t('console.fallback.noData');

  return {
    environment: null,
    lastUpdated,
    isOffline,
    lastSuccessfulSync,
    overallHealth: isOffline
      ? {
          status: 'down',
          title: t('console.fallback.offlineTitle'),
          message: t('console.fallback.offlineMessage', { url: apiBaseUrl }),
          healthyServices: 0,
          totalServices: 0,
          uptimeSeconds: 0,
          actionLabel: t('overview.retryConnection'),
          actionSection: 'overview',
        }
      : {
          status: 'degraded',
          title: t('console.fallback.overviewUnavailableTitle'),
          message: t('console.fallback.overviewUnavailableMessage'),
          healthyServices: 0,
          totalServices: 0,
          uptimeSeconds: 0,
        },
    keyMetrics: METRIC_IDS.map((m) => ({
      ...m,
      label: m.id,
      value: NO_VALUE,
      trendText: noData,
      trendDirection: 'neutral',
      trendIsGood: true,
      status: 'normal',
    })),
    healthMap: HEALTH_MAP_SKELETON.map((item) => ({
      ...item,
      name: item.id,
      status: item.id === 'runtime-api' && isOffline ? 'down' : 'unknown',
      subtext: noData,
    })),
    incidents: isOffline
      ? [
          {
            id: 'alert-offline',
            severity: 'critical',
            title: t('console.fallback.offlineTitle'),
            description: t('console.fallback.offlineMessage', { url: apiBaseUrl }),
            startedAgo: lastSuccessfulSync ? lastSuccessfulSync.toLocaleTimeString() : NO_VALUE,
            targetSection: 'overview',
            actionLabel: t('overview.retryConnection'),
          },
        ]
      : [],
    infraSnapshots: [],
    recentActivities: [],
  };
}
