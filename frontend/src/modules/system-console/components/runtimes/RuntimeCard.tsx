import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { RuntimeAction, RuntimeSummary } from '../../types/runtime.types';
import type { PendingCommand } from '../../hooks/useRuntimeCommand';
import { RUNTIME_METRICS, RUNTIME_SHORTCUTS } from '../../constants/runtime-metrics';
import { formatMb, formatMetric, formatUptime, percent } from '../../utils/runtime-format';
import { ConsoleIcon } from '../common/ConsoleIcon';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import { RuntimeActions } from './RuntimeActions';
import { toneOf } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

const ICON: Record<string, string> = { api: 'globe', worker: 'cpu', scheduler: 'clock' };

interface RuntimeCardProps {
  runtime: RuntimeSummary;
  now: number;
  pending: PendingCommand | null;
  onNavigate: (path: string) => void;
  onAction: (runtime: RuntimeSummary, action: RuntimeAction) => void;
}

/** Card giám sát: trạng thái + lý do, tài nguyên chung, metric riêng theo runtime, thao tác. */
export const RuntimeCard: React.FC<RuntimeCardProps> = ({ runtime, now, pending, onNavigate, onAction }) => {
  const { t, formatRelative } = useLocale();
  const r = runtime.resources;
  const reason = runtime.reasons[0]?.message;
  const cardMetrics = RUNTIME_METRICS[runtime.id].filter((m) => m.card);

  const renderMetric = (key: string, unit?: string, kind?: 'time') => {
    const value = runtime.metrics[key];
    if (kind === 'time') return typeof value === 'string' ? formatRelative(value, now) : '--';
    return formatMetric(value, unit);
  };

  return (
    <article className={`rt-card ov-tone-${toneOf(runtime.status)}`} aria-labelledby={`rt-card-${runtime.id}`}>
      <header className="rt-card-head">
        <h3 id={`rt-card-${runtime.id}`}>
          <ConsoleIcon name={ICON[runtime.id] ?? 'server'} size={16} />
          {runtime.name}
        </h3>
        <RuntimeStatusBadge status={runtime.status} />
      </header>

      {reason && <p className={`rt-card-reason is-${runtime.status}`}>{reason}</p>}

      {r ? (
        <dl className="rt-kv">
          <div>
            <dt>{t('rt.metric.cpu')}</dt>
            <dd>{percent(r.cpuPercent)}</dd>
          </div>
          <div>
            <dt>{t('rt.metric.memory')}</dt>
            <dd>
              {formatMb(r.rssMb)}
              {r.memoryLimitSource === 'cgroup' && r.memoryLimitMb ? ` / ${formatMb(r.memoryLimitMb)}` : ''}
            </dd>
          </div>
          <div>
            <dt>{t('rt.metric.uptime')}</dt>
            <dd>{formatUptime(runtime.uptimeSec)}</dd>
          </div>
        </dl>
      ) : (
        <p className="rt-card-empty">{t('rt.noTelemetry')}</p>
      )}

      {r && (
        <dl className="rt-kv rt-kv-specific">
          {cardMetrics.map((m) => (
            <div key={m.key}>
              <dt>{t(`rt.metric.${m.key}`)}</dt>
              <dd>{renderMetric(m.key, m.unit, m.kind)}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="rt-card-meta">
        {t('rt.lastRestart')}: {runtime.lastRestartAt ? formatRelative(runtime.lastRestartAt, now) : t('rt.never')}
      </p>

      <footer className="rt-card-foot">
        <button type="button" className="scp-btn scp-btn-sm scp-btn-primary" onClick={() => onNavigate(`runtimes/${runtime.id}`)}>
          {t('rt.inspect')} <ArrowRight size={13} />
        </button>
        {RUNTIME_SHORTCUTS[runtime.id].map((s) => (
          <button key={s.key} type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onNavigate(s.path(runtime.id))}>
            {t(`rt.shortcut.${s.key}`)}
          </button>
        ))}
        <RuntimeActions runtime={runtime} pending={pending} variant="menu" onAction={(a) => onAction(runtime, a)} />
      </footer>
    </article>
  );
};
