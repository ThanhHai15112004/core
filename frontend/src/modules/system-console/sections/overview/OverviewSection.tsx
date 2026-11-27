import React, { useMemo } from 'react';
import { ArrowRight, Boxes, Clock, Database, FileText, LayoutDashboard, RefreshCw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { toneOf } from '@core/theme';
import { useTimeRange } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Button } from '@core/ui/primitives';
import {
  ActivityFeed,
  AlertList,
  HealthGrid,
  KeyValueGrid,
  PageHeader,
  Panel,
  PanelGrid,
  RelativeTime,
  StatGrid,
  StatTile,
  StatusBanner,
  type ActivityItem,
  type AlertItem,
  type HealthGridGroup,
} from '@core/ui/blocks';
import { useConsoleData } from '../../context/console-data-context';
import { useConsoleRoute } from '../../context/console-route-context';
import { resolveSection, sectionDef } from '../../shell/sections';
import { ACTIVITY_MAX_HEIGHT_PX, BACKEND_NO_VALUE, HEALTH_CATEGORIES, KPI_LABEL_KEY, KPI_SKELETON_COUNT, OVERVIEW_CHARTS, OVERVIEW_RANGES } from '../../constants/overview';
import { OverviewChart } from './OverviewChart';

/** Icon của section mà đường dẫn trỏ tới (`database`, `runtimes/api`…). */
const iconOf = (path: string) => {
  const id = resolveSection(path.split(/[/?]/)[0]);
  return id ? sectionDef(id).icon : undefined;
};

/**
 * Tổng quan: trạng thái chung → 6 chỉ số → bảng thành phần + vấn đề → 4 biểu đồ → hoạt động gần đây.
 * Mọi số liệu lấy từ backend; không có dữ liệu thì hiện `—`, không tự điền 0.
 */
export const OverviewSection: React.FC = () => {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const { navigate } = useConsoleRoute();
  const { overview, overviewLoading, overviewError, refetchOverview, isOffline, lastSuccessfulSync } = useConsoleData();
  const range = useTimeRange(OVERVIEW_RANGES);

  const health = overview?.overallHealth;
  const healthTone = health ? toneOf(health.status) : 'unknown';

  const groups: HealthGridGroup[] = useMemo(
    () =>
      HEALTH_CATEGORIES.map((category) => ({
        id: category,
        label: t(`ov.map.category.${category}`),
        items: (overview?.healthMap ?? [])
          .filter((i) => i.category === category)
          .map((i) => ({
            id: i.id,
            label: i.name === i.id ? t(`ov.map.item.${i.id}`) : i.name,
            icon: iconOf(i.targetSection),
            tone: toneOf(i.status),
            value: i.metric ?? t(`console.status.${i.status}`),
            detail: [i.subtext, i.secondarySubtext].filter(Boolean).join(' · ') || null,
            onClick: () => navigate(i.targetSection),
          })),
      })),
    [overview?.healthMap, t, navigate],
  );

  const problems: AlertItem[] = (overview?.incidents ?? []).map((i) => ({
    id: i.id,
    tone: toneOf(i.severity),
    title: i.title,
    detail: i.description,
    since: i.startedAt ?? null,
    onInspect: () => navigate(i.targetSection),
  }));

  const activity: ActivityItem[] = (overview?.recentActivities ?? []).map((e) => ({
    id: e.id,
    at: e.time,
    tone: toneOf(e.level),
    title: e.message,
    source: e.source,
  }));

  const kpis = overview?.keyMetrics ?? [];
  const sys = overview?.systemInfo;
  const mig = overview?.migrationStatus;
  const bkp = overview?.backupStatus;

  return (
    <div>
      <PageHeader
        title={t('nav.overview')}
        icon={LayoutDashboard}
        status={health ? { tone: healthTone, label: t(`console.status.${health.status}`) } : undefined}
        actions={
          health && health.uptimeSeconds > 0 ? (
            <Badge variant="outline" className="font-mono">
              {t('ov.page.uptime', { value: f.uptime(health.uptimeSeconds) })}
            </Badge>
          ) : undefined
        }
      />

      {isOffline && (
        <StatusBanner
          tone="crit"
          title={t('ov.offline.title')}
          meta={
            lastSuccessfulSync ? (
              <span>
                {t('ov.page.lastSync', { ago: '' })}
                <RelativeTime value={lastSuccessfulSync} />
              </span>
            ) : (
              t('ov.offline.neverSynced')
            )
          }
        />
      )}

      {!isOffline && !overview && Boolean(overviewError) && (
        <StatusBanner
          tone="crit"
          title={t('ov.page.overviewError')}
          actions={
            <Button size="xs" onClick={refetchOverview}>
              <RefreshCw />
              {t('ui.state.retry')}
            </Button>
          }
        />
      )}

      {health && healthTone !== 'ok' && healthTone !== 'unknown' && !isOffline && (
        <StatusBanner
          tone={healthTone}
          title={health.title}
          meta={t('ov.page.healthyCount', { healthy: health.healthyServices, total: health.totalServices })}
          actions={
            health.actionSection && health.actionLabel ? (
              <Button size="xs" variant="secondary" onClick={() => navigate(health.actionSection!)}>
                {health.actionLabel}
                <ArrowRight />
              </Button>
            ) : undefined
          }
        />
      )}

      <StatGrid columns={6}>
        {kpis.length === 0
          ? Array.from({ length: KPI_SKELETON_COUNT }, (_, i) => <StatTile key={i} label={NO_VALUE} value={NO_VALUE} loading={overviewLoading} />)
          : kpis.map((m) => {
              const empty = m.value === BACKEND_NO_VALUE || m.value === '';
              return (
                <StatTile
                  key={m.id}
                  label={KPI_LABEL_KEY[m.id] ? t(KPI_LABEL_KEY[m.id]) : m.label}
                  value={empty ? NO_VALUE : m.value}
                  unit={empty ? undefined : m.unit}
                  tone={empty ? undefined : toneOf(m.status)}
                  hint={m.trendText || undefined}
                />
              );
            })}
      </StatGrid>

      {sys && (
        <Panel
          className="mb-4"
          title={t('ov.system.title')}
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="xs" variant="ghost" onClick={() => navigate('packages?tab=modules')}>
                <Boxes />
                {t('ov.system.openModules')}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => navigate('database/tables?view=migrations')}>
                <Database />
                {t('ov.system.openMigrations')}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => navigate('logs/explorer?slowOnly=true')}>
                <Clock />
                {t('ov.system.openSlowApis')}
              </Button>
            </div>
          }
        >
          <KeyValueGrid
            columns={4}
            items={[
              { label: t('ov.system.coreVersion'), value: sys.coreVersion, mono: true },
              { label: t('ov.system.projectVersion'), value: `${sys.projectName} · v${sys.projectVersion}`, mono: true },
              { label: t('ov.system.modules'), value: t('ov.system.modulesValue', { enabled: sys.modules.enabled, total: sys.modules.total }), mono: true },
              { label: t('ov.system.commit'), value: sys.deployment.shortCommit ?? NO_VALUE, mono: true },
              {
                label: t('ov.system.image'),
                value: sys.deployment.image
                  ? sys.deployment.imageDigest
                    ? `${sys.deployment.image} (${sys.deployment.imageDigest.slice(0, 19)})`
                    : sys.deployment.image
                  : NO_VALUE,
                mono: true,
              },
              {
                label: t('ov.system.rollout'),
                value: sys.deployment.strategy
                  ? sys.deployment.slot && sys.deployment.slot !== 'default'
                    ? `${sys.deployment.strategy} · ${sys.deployment.slot}`
                    : sys.deployment.strategy
                  : NO_VALUE,
                mono: true,
              },
              { label: t('ov.system.buildTime'), value: sys.deployment.buildTime ? formatTime(sys.deployment.buildTime, true) : NO_VALUE, mono: true },
              {
                label: t('ov.system.migration'),
                value: mig ? (
                  <Badge tone={mig.upToDate ? 'ok' : 'warn'} size="xs">
                    {mig.upToDate
                      ? t('ov.system.migrationSynced', { applied: mig.applied })
                      : t('ov.system.migrationPending', { pending: mig.pending, applied: mig.applied })}
                  </Badge>
                ) : (
                  NO_VALUE
                ),
              },
              {
                label: t('ov.system.backup'),
                value: bkp ? (
                  bkp.lastBackupAt ? (
                    <Badge tone={toneOf(bkp.status)} size="xs">
                      {t(`db.backup.runStatus.${bkp.lastStatus}`)} · <RelativeTime value={bkp.lastBackupAt} />
                    </Badge>
                  ) : (
                    <Badge tone="unknown" size="xs">
                      {t('ov.system.backupNone')}
                    </Badge>
                  )
                ) : (
                  NO_VALUE
                ),
              },
            ]}
          />
        </Panel>
      )}

      <PanelGrid layout="2-1">
        <Panel title={t('ov.page.components')}>
          <HealthGrid groups={groups} />
        </Panel>
        <Panel title={t('ov.page.problems')} actions={problems.length > 0 ? <Badge tone={problems.some((p) => p.tone === 'crit') ? 'crit' : 'warn'}>{problems.length}</Badge> : undefined}>
          <AlertList items={problems} />
        </Panel>
      </PanelGrid>

      <PanelGrid layout={2}>
        {OVERVIEW_CHARTS.map((c) => (
          <OverviewChart key={c.metric} metric={c.metric} color={c.color} range={range} />
        ))}
      </PanelGrid>

      <Panel
        title={t('ov.page.activity')}
        actions={
          <Button size="xs" variant="ghost" onClick={() => navigate('logs/explorer')}>
            <FileText />
            {t('ov.page.allLogs')}
          </Button>
        }
      >
        <ActivityFeed items={activity} maxHeight={ACTIVITY_MAX_HEIGHT_PX} />
      </Panel>
    </div>
  );
};
