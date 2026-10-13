import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@core/lib/cn';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { TONE_CLASS, toneOf } from '@core/theme';
import { Badge, Button } from '@core/ui/primitives';
import { RelativeTime, StatusDot, UsageBar } from '@core/ui/blocks';
import type { RuntimeSummary, RuntimeThresholds } from '../../types/runtime.types';
import { RUNTIME_ICON, RUNTIME_METRICS, RUNTIME_SHORTCUTS, USAGE_FULL_PERCENT } from '../../constants/runtime-metrics';
import { RuntimeActions } from './RuntimeActions';
import { memoryUsedMb, metricTone, useMetricFormat } from './runtime-view';

interface RuntimeCardProps {
  runtime: RuntimeSummary;
  thresholds: RuntimeThresholds;
  onOpen: () => void;
  navigate: (path: string) => void;
}

/** Thẻ gọn một runtime: trạng thái + lý do, CPU / RAM so với ngưỡng, uptime, restart, metric riêng, thao tác. */
export function RuntimeCard({ runtime: rt, thresholds, onOpen, navigate }: RuntimeCardProps) {
  const { t } = useLocale();
  const f = useFormat();
  const metric = useMetricFormat();
  const Icon = RUNTIME_ICON[rt.id];
  const tone = toneOf(rt.status);
  const r = rt.resources;
  const reason = rt.reasons[0]?.message;
  const alert = tone === 'warn' || tone === 'crit';

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      aria-label={t('rt.list.open', { name: rt.name })}
      className={cn(
        '@container group flex min-w-0 cursor-pointer flex-col gap-3 rounded-lg border bg-panel p-3 text-left transition-colors hover:border-border-strong hover:bg-panel-2',
        alert ? TONE_CLASS[tone].border : 'border-border',
      )}
    >
      <header className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{rt.name}</h3>
        <Badge tone={tone}>
          <StatusDot tone={tone} size="xs" pulse={rt.status === 'starting' || rt.status === 'restarting' || rt.status === 'stopping'} />
          {t(`rt.status.${rt.status}`)}
        </Badge>
        <ChevronRight className="size-4 shrink-0 text-faint group-hover:text-muted" />
      </header>

      {reason && alert && <p className={cn('-mt-1 truncate text-xs', TONE_CLASS[tone].fg)} title={reason}>{reason}</p>}

      <div className="flex flex-col gap-1.5">
        <UsageBar label={t('rt.metric.cpu')} percent={r ? r.cpuPercent : null} thresholds={{ warn: thresholds.cpuPercent, crit: USAGE_FULL_PERCENT }} />
        <UsageBar label={t('rt.metric.memory')} percent={r?.memoryPercent ?? null} thresholds={{ warn: thresholds.memoryPercent, crit: USAGE_FULL_PERCENT }} />
        <div className="pl-22 font-mono text-2xs tabular-nums text-faint">
          {r ? `${f.mb(memoryUsedMb(r))} / ${f.mb(r.memoryLimitMb)} · ${t(`rt.memorySource.${r.memoryLimitSource}`)}` : t('rt.noTelemetry')}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border pt-2.5 text-xs @md:grid-cols-3">
        <Cell label={t('rt.metric.uptime')} value={f.uptime(rt.uptimeSec)} />
        <Cell label={t('rt.metric.restartCount')} value={f.number(rt.restartCount)} sub={rt.lastRestartAt ? <RelativeTime value={rt.lastRestartAt} /> : undefined} />
        {RUNTIME_METRICS[rt.id]
          .filter((m) => m.card)
          .map((m) => {
            const mt = metricTone(m, rt.metrics[m.key]);
            return <Cell key={m.key} label={t(`rt.metric.${m.key}`)} value={metric(rt, m.key, m)} valueClass={mt ? TONE_CLASS[mt].fg : undefined} />;
          })}
      </dl>

      <footer className="mt-auto flex flex-wrap items-center gap-1.5">
        <RuntimeActions runtime={rt} />
        <span className="flex-1" />
        {RUNTIME_SHORTCUTS[rt.id].map((s) => (
          <Button
            key={s.key}
            size="xs"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              navigate(s.path);
            }}
          >
            {t(`rt.shortcut.${s.key}`)}
          </Button>
        ))}
      </footer>
    </article>
  );
}

function Cell({ label, value, sub, valueClass }: { label: string; value: string; sub?: ReactNode; valueClass?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted">{label}</dt>
      <dd className={cn('truncate font-mono tabular-nums text-fg', valueClass)}>
        {value}
        {sub && <span className="ml-1.5 font-sans text-2xs text-faint">{sub}</span>}
      </dd>
    </div>
  );
}
