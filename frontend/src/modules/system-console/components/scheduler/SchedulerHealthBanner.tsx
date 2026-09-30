import React from 'react';
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, HelpCircle, PauseCircle } from 'lucide-react';
import type { SchedulerOverview } from '../../types/scheduler.types';
import { SCHEDULER_TONE } from '../../constants/scheduler';
import { useLocale } from '../../../../core/i18n/index';

const ICONS = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  down: AlertOctagon,
  paused: PauseCircle,
  unknown: HelpCircle,
} as const;

/**
 * ● Healthy / ⚠ Degraded / ✕ Down / ○ Paused / ? Unknown + lý do (bấm → task). Down (mất heartbeat) → dẫn sang
 * Runtime; Console không tự khởi động scheduler.
 */
export const SchedulerHealthBanner: React.FC<{
  data: SchedulerOverview;
  now: number;
  onOpenTask: (taskId: string) => void;
  onInspectRuntime: () => void;
}> = ({ data, now, onOpenTask, onInspectRuntime }) => {
  const { t, formatRelative, formatTime } = useLocale();
  const { health, timezone } = data;
  const Icon = ICONS[health.status];
  const env = ['production', 'staging', 'development'].includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment;
  return (
    <section className={`pf-status db-health ov-tone-${SCHEDULER_TONE[health.status]}`} role="status">
      <Icon size={22} className="pf-status-icon" />
      <div className="db-health-body">
        <strong>{t(`sch.health.${health.status}`)}</strong>
        <span className="db-health-meta">
          {t('sch.subtitleShort')} · {env} · {t('sch.tz.label')}: <code>{timezone.schedule}</code> ({timezone.scheduleOffset})
          {timezone.runtime && timezone.runtime !== timezone.schedule && (
            <>
              {' '}
              · {t('sch.tz.runtime')}: <code>{timezone.runtime}</code>
            </>
          )}
          {' · '}
          {health.lastHeartbeatAt
            ? t('sch.health.heartbeat', { time: formatRelative(new Date(health.lastHeartbeatAt), now) })
            : t('sch.health.noHeartbeatYet')}
          {' · '}
          {t('cache.health.checked', { time: formatTime(Date.parse(data.generatedAt), true) })}
        </span>
        {health.reasons.length > 0 && (
          <ul className="db-health-reasons">
            {health.reasons.map((r) => (
              <li key={`${r.code}-${r.message}`}>
                {r.taskId ? (
                  <button type="button" className="ov-link" onClick={() => onOpenTask(r.taskId!)}>
                    {r.message}
                  </button>
                ) : (
                  r.message
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {(health.status === 'down' || health.status === 'paused') && (
        <div className="db-health-test">
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={onInspectRuntime}>
            {t('sch.health.inspectRuntime')} <ArrowRight size={13} />
          </button>
        </div>
      )}
    </section>
  );
};
