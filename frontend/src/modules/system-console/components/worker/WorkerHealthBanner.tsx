import React from 'react';
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, HelpCircle, PauseCircle, RefreshCw } from 'lucide-react';
import type { WorkerOverview } from '../../types/worker.types';
import { BACKGROUND_TONE } from '../../constants/worker';
import { formatDuration } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

const ICONS = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  down: AlertOctagon,
  paused: PauseCircle,
  recovering: RefreshCw,
  unknown: HelpCircle,
} as const;

/**
 * Trạng thái tổng của background processing (● Healthy / ⚠ Degraded / ✕ Down / ○ Paused / ↻ Recovering) + lý do
 * theo từng queue. Down vì không có worker → dẫn sang Runtime (Console không tự start worker).
 */
export const WorkerHealthBanner: React.FC<{
  data: WorkerOverview;
  now: number;
  onOpenQueue: (queue: string) => void;
  onInspectWorkers: () => void;
  onInspectRuntime: () => void;
}> = ({ data, now, onOpenQueue, onInspectWorkers, onInspectRuntime }) => {
  const { t, formatRelative, formatTime } = useLocale();
  const { health, provider } = data;
  const Icon = ICONS[health.status];
  const env = ['production', 'staging', 'development'].includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment;
  const noWorkers = health.reasons.some((r) => r.code === 'NO_WORKERS' || r.code.startsWith('NO_WORKER'));
  const queueProblems = new Set(health.reasons.map((r) => r.queue).filter(Boolean)).size;
  return (
    <section className={`pf-status db-health ov-tone-${BACKGROUND_TONE[health.status]}`} role="status">
      <Icon size={22} className="pf-status-icon" />
      <div className="db-health-body">
        <strong>{t(`wq.health.${health.status}`)}</strong>
        <span className="db-health-meta">
          {t('wq.subtitleShort')} · {env} · {provider.product} ({provider.backend}) · <code>{provider.endpoint}</code>
          {health.pingMs !== null && ` · ping ${formatDuration(health.pingMs)}`}
          {' · '}
          {t('cache.health.checked', { time: formatTime(Date.parse(data.generatedAt), true) })}
        </span>
        {health.status === 'degraded' && queueProblems > 0 && <p className="db-health-last">{t('wq.health.queuesNeedAttention', { count: queueProblems })}</p>}
        {health.reasons.length > 0 && (
          <ul className="db-health-reasons">
            {health.reasons.map((r) => (
              <li key={`${r.code}-${r.message}`}>
                {r.queue ? (
                  <button type="button" className="ov-link" onClick={() => onOpenQueue(r.queue!)}>
                    {r.message}
                  </button>
                ) : (
                  r.message
                )}
              </li>
            ))}
          </ul>
        )}
        {health.status !== 'healthy' && health.lastWorkerSeenAt && (
          <p className="db-health-last">{t('wq.health.lastWorkerSeen', { time: formatRelative(new Date(health.lastWorkerSeenAt), now) })}</p>
        )}
      </div>
      {(health.status === 'down' || noWorkers) && (
        <div className="db-health-test">
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={noWorkers ? onInspectWorkers : onInspectRuntime}>
            {t(noWorkers ? 'wq.health.inspectWorkers' : 'wq.health.inspectRuntime')} <ArrowRight size={13} />
          </button>
        </div>
      )}
    </section>
  );
};
