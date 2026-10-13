import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { Button } from '@core/ui/primitives';
import { AlertList, Panel, PanelGrid, QueryView, StatusBanner } from '@core/ui/blocks';
import type { PerformanceOverview } from '../../types/performance.types';
import { LEVEL_TONE, OVERVIEW_BOTTLENECKS, SEVERITY_TONE } from '../../constants/performance';
import { PerfKpis } from '../../components/performance/PerfKpis';
import { PerfTimeline } from '../../components/performance/PerfTimeline';
import { ResourceTable } from '../../components/performance/ResourceTable';
import { BudgetList, CapacityList } from '../../components/performance/PerfPanels';
import type { PerformancePage } from './usePerformancePage';

/** Tổng quan: trạng thái (khi có vấn đề, lý do chi tiết ở panel Điểm nghẽn) → 6 KPI → diễn biến + điểm nghẽn → tài nguyên runtime → mục tiêu & mức dùng. */
export function PerfOverviewTab({ page, overview }: { page: PerformancePage; overview: UseQueryResult<PerformanceOverview> }) {
  const { t } = useLocale();
  const data = overview.data;
  const level = data?.status.level;

  return (
    <>
      {data && level && level !== 'normal' && (
        <StatusBanner
          tone={LEVEL_TONE[level]}
          title={t(`perf.level.${level}`)}
          description={level === 'unknown' ? t('perf.levelHint.unknown') : undefined}
          meta={data.status.reasons.length > 0 ? t('perf.bottlenecks.count', { count: data.status.reasons.length }) : undefined}
          actions={
            data.bottlenecks.length > 0 ? (
              <Button size="xs" variant="secondary" onClick={() => page.go('bottlenecks')}>
                {t('perf.bottlenecks.viewAll')}
                <ArrowRight />
              </Button>
            ) : undefined
          }
        />
      )}

      <PerfKpis data={data} loading={overview.isPending} />

      <PanelGrid layout="2-1">
        <PerfTimeline filters={page.filters} setFilters={page.setFilters} />
        <Panel
          title={t('perf.bottlenecks.title')}
          hint={data ? t('perf.bottlenecks.hint', { minutes: data.settings.windowMin }) : undefined}
          actions={
            <Button size="xs" variant="ghost" onClick={() => page.go('bottlenecks')}>
              {t('perf.bottlenecks.viewAll')}
              <ArrowRight />
            </Button>
          }
        >
          <QueryView query={overview} compact>
            {(d) => (
              <AlertList
                emptyMessage={t('perf.bottlenecks.none', { minutes: d.settings.windowMin })}
                items={d.bottlenecks.slice(0, OVERVIEW_BOTTLENECKS).map((b) => ({
                  id: b.id,
                  tone: SEVERITY_TONE[b.severity],
                  title: b.title,
                  detail: b.message,
                  since: b.since,
                  onInspect: () => page.go('bottlenecks'),
                }))}
              />
            )}
          </QueryView>
        </Panel>
      </PanelGrid>

      <Panel title={t('perf.resources.title')} hint={t('perf.resources.hint')} flush className="mb-4">
        <QueryView query={overview} compact>
          {(d) => <ResourceTable resources={d.resources} thresholds={d.settings.thresholds} onOpen={(id) => page.navigate(`runtimes/${id}`)} />}
        </QueryView>
      </Panel>

      <PanelGrid>
        <Panel title={t('perf.budgets.title')} hint={t('perf.budgets.hint')}>
          <QueryView query={overview} compact>
            {(d) => <BudgetList budgets={d.budgets} />}
          </QueryView>
        </Panel>
        <Panel title={t('perf.capacity.title')} hint={t('perf.capacity.hint')}>
          <QueryView query={overview} compact>
            {(d) => <CapacityList capacity={d.capacity} />}
          </QueryView>
        </Panel>
      </PanelGrid>
    </>
  );
}
