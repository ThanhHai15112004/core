import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { ActivityFeed, Panel, QueryView } from '@core/ui/blocks';
import { performanceApi } from '../../services/performance.api';
import { EVENTS_MAX_HEIGHT_PX, SEVERITY_TONE } from '../../constants/performance';
import { perfKeys } from './performance-keys';
import type { PerformancePage } from './usePerformancePage';

/** Sự kiện: điểm nghẽn bắt đầu / hồi phục và sự kiện runtime (khởi động, crash, dừng). Bấm → màn liên quan. */
export function PerfEventsTab({ page }: { page: PerformancePage }) {
  const { t } = useLocale();
  const events = useLiveQuery(perfKeys.events(page.range), () => performanceApi.events(page.range));
  return (
    <Panel title={t('perf.events.title')} hint={t('perf.events.hint')}>
      <QueryView query={events}>
        {(list) => (
          <ActivityFeed
            kinds={{ performance: t('perf.events.kind.performance'), runtime: t('perf.events.kind.runtime') }}
            emptyMessage={t('perf.events.empty')}
            maxHeight={EVENTS_MAX_HEIGHT_PX}
            items={list.map((e) => ({
              id: e.id,
              at: e.at,
              tone: SEVERITY_TONE[e.severity],
              title: e.title,
              detail: e.message,
              kind: e.source,
              onClick: e.target ? () => page.navigate(e.target!) : undefined,
            }))}
          />
        )}
      </QueryView>
    </Panel>
  );
}
