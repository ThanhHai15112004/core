import type { UseQueryResult } from '@tanstack/react-query';
import { useLocale } from '@core/i18n/index';
import { Panel, PanelGrid, QueryView } from '@core/ui/blocks';
import type { PerformanceOverview } from '../../types/performance.types';
import { BottleneckList } from '../../components/performance/BottleneckList';
import { ComponentTable } from '../../components/performance/ComponentPerf';
import { LatencyBreakdown, ThroughputFlow } from '../../components/performance/PerfPanels';
import type { PerformancePage } from './usePerformancePage';

/** Điểm nghẽn & Thành phần: danh sách nghẽn chi tiết → bảng thành phần (drawer) → phân rã latency + luồng xử lý. */
export function PerfBottlenecksTab({ page, overview }: { page: PerformancePage; overview: UseQueryResult<PerformanceOverview> }) {
  const { t } = useLocale();
  return (
    <QueryView query={overview}>
      {(d) => (
        <>
          <Panel title={t('perf.bottlenecks.title')} hint={t('perf.bottlenecks.hint', { minutes: d.settings.windowMin })} className="mb-4">
            <BottleneckList bottlenecks={d.bottlenecks} windowMin={d.settings.windowMin} onInspect={page.navigate} />
          </Panel>
          <Panel title={t('perf.components.title')} flush className="mb-4">
            <ComponentTable rows={d.components} activeId={page.item} onOpen={page.openItem} />
          </Panel>
          <PanelGrid>
            <Panel title={t('perf.breakdown.title')} hint={t('perf.breakdown.hint')}>
              <LatencyBreakdown breakdown={d.breakdown} dbActive={d.telemetry.database === 'active'} />
            </Panel>
            <Panel title={t('perf.throughput.title')} hint={t('perf.throughput.hint')}>
              <ThroughputFlow throughput={d.throughput} />
            </Panel>
          </PanelGrid>
        </>
      )}
    </QueryView>
  );
}
