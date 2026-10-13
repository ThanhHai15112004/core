import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@core/lib/cn';
import { useLocale } from '@core/i18n/index';
import { TONE_CLASS } from '@core/theme';
import { Badge, Button } from '@core/ui/primitives';
import { RelativeTime } from '@core/ui/blocks';
import type { Bottleneck } from '../../types/performance.types';
import { SEVERITY_TONE } from '../../constants/performance';
import { shortRoute, usePerfFormat } from './perf-format';

interface BottleneckListProps {
  bottlenecks: Bottleneck[];
  windowMin: number;
  onInspect: (target: string) => void;
}

/** Điểm nghẽn đang có: giá trị hiện tại / nền / ngưỡng, bắt đầu từ lúc nào, endpoint bị ảnh hưởng, nút sang màn xử lý. */
export function BottleneckList({ bottlenecks, windowMin, onInspect }: BottleneckListProps) {
  const { t } = useLocale();
  const fmt = usePerfFormat();
  if (bottlenecks.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-ok-fg">
        <CheckCircle2 className="size-4" />
        {t('perf.bottlenecks.none', { minutes: windowMin })}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {bottlenecks.map((b) => {
        const tone = SEVERITY_TONE[b.severity];
        return (
          <li key={b.id} className={cn('rounded-md border border-l-2 border-border bg-panel-2 p-3', TONE_CLASS[tone].border)}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={tone}>{t(`perf.severity.${b.severity}`)}</Badge>
              <span className="min-w-0 flex-1 text-sm font-semibold text-fg">{b.title}</span>
              <Button size="xs" variant="ghost" onClick={() => onInspect(b.target)}>
                {t(`perf.bottlenecks.inspect.${b.component}`)}
                <ArrowRight />
              </Button>
            </div>
            <p className="mt-1 text-sm text-fg-2">{b.message}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              {[
                { k: 'current', v: <span className={TONE_CLASS[tone].fg}>{fmt(b.value, b.unit)}</span> },
                { k: 'baseline', v: fmt(b.baseline, b.unit) },
                { k: 'threshold', v: fmt(b.threshold, b.unit) },
                { k: 'since', v: b.since ? <RelativeTime value={b.since} /> : t('perf.bottlenecks.sinceUnknown') },
              ].map((x) => (
                <div key={x.k} className="min-w-0">
                  <dt className="text-muted">{t(`perf.bottlenecks.${x.k}`)}</dt>
                  <dd className="truncate font-mono tabular-nums text-fg">{x.v}</dd>
                </div>
              ))}
            </dl>
            {b.impact.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted">{t(b.rule === 'DB_LATENCY' ? 'perf.bottlenecks.impactDb' : 'perf.bottlenecks.impact')}</span>
                {b.impact.map((i) => (
                  <Badge key={i.routeId} variant="outline" className="font-mono">
                    {i.method} {shortRoute(i.route)} · {fmt(i.valueMs, 'ms')}
                  </Badge>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
