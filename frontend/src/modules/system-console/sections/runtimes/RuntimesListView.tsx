import React, { useMemo, useState } from 'react';
import { ArrowRight, WifiOff } from 'lucide-react';
import type { RuntimeAction, RuntimeSummary } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { usePolling } from '../../hooks/usePolling';
import { useRuntimeCommand } from '../../hooks/useRuntimeCommand';
import { useConsoleRoute } from '../../context/console-route-context';
import { RuntimeHealthSummary } from '../../components/runtimes/RuntimeHealthSummary';
import { RuntimeAlerts } from '../../components/runtimes/RuntimeAlerts';
import { RuntimeCard } from '../../components/runtimes/RuntimeCard';
import { ResourceUsageTable } from '../../components/runtimes/ResourceUsageTable';
import { RuntimePerformancePanel } from '../../components/runtimes/RuntimePerformancePanel';
import { RuntimeEventsList } from '../../components/runtimes/RuntimeEventsList';
import { ResourceDistribution } from '../../components/runtimes/ResourceDistribution';
import { RuntimeComparisonTable } from '../../components/runtimes/RuntimeComparisonTable';
import { CliRuntimePanel } from '../../components/runtimes/CliRuntimePanel';
import { RuntimeActionModal, type ModalAction } from '../../components/runtimes/RuntimeActionModal';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';

const EVENTS_LIMIT = 12;

/** Runtime Operations Monitor: sức khỏe → tài nguyên → card → hiệu năng → sự kiện → so sánh → CLI. */
export const RuntimesListView: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const { navigate } = useConsoleRoute();
  const now = useNow();
  const overview = usePolling(() => runtimesApi.overview(), 'runtimes');
  const events = usePolling(() => runtimesApi.events(EVENTS_LIMIT), 'runtime-events');
  const [modal, setModal] = useState<{ runtime: RuntimeSummary; action: ModalAction } | null>(null);
  const reloadAll = () => {
    void overview.reload();
    void events.reload();
  };
  const { run, pending } = useRuntimeCommand(reloadAll);

  const data = overview.data;
  const runtimes = useMemo(() => data?.runtimes ?? [], [data]);
  const names = useMemo(() => Object.fromEntries(runtimes.map((r) => [r.id, r.name])), [runtimes]);

  const handleAction = (runtime: RuntimeSummary, action: RuntimeAction) => {
    if (action === 'start') void run(runtime.id, 'start');
    else setModal({ runtime, action });
  };

  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">{t('nav.runtimes')}</h1>
          <p className="ov-page-subtitle">
            {data
              ? t('rt.list.headline', {
                  running: data.summary.running,
                  warnings: data.summary.warnings,
                  down: data.summary.down,
                })
              : t('rt.list.subtitle')}
          </p>
        </div>
        <span className="ov-page-updated">
          {t('ov.page.autoUpdated')}{' · '}
          <time>{overview.lastUpdated ? formatRelative(overview.lastUpdated, now) : '--'}</time>
        </span>
      </header>

      {overview.error && !data && (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('ov.offline.title')}</h2>
            <p>{overview.error.message}</p>
          </div>
        </section>
      )}

      {data && !data.telemetry.available && (
        <div className="scp-alert scp-alert-danger" role="alert">
          <strong>{t('rt.noTelemetry')}</strong> — {data.telemetry.reason}
        </div>
      )}

      <RuntimeHealthSummary summary={data?.summary ?? null} />
      {data && <RuntimeAlerts runtimes={runtimes} now={now} onNavigate={navigate} />}

      <div className="rt-card-grid">
        {runtimes.map((r) => (
          <RuntimeCard key={r.id} runtime={r} now={now} pending={pending} onNavigate={navigate} onAction={handleAction} />
        ))}
      </div>

      {data && <ResourceUsageTable runtimes={runtimes} thresholds={data.thresholds} />}
      <RuntimePerformancePanel names={names} />

      <div className="ov-split">
        <RuntimeEventsList
          events={events.data}
          title={t('rt.events.title')}
          footer={
            <button type="button" className="ov-link" onClick={() => navigate('logs')}>
              {t('timeline.openLogViewer')} <ArrowRight size={13} />
            </button>
          }
        />
        <ResourceDistribution runtimes={runtimes} />
      </div>

      {data && <RuntimeComparisonTable runtimes={runtimes} onNavigate={navigate} />}
      <CliRuntimePanel cli={data?.cli ?? null} now={now} />

      {modal && (
        <RuntimeActionModal
          runtime={modal.runtime}
          action={modal.action}
          onCancel={() => setModal(null)}
          onConfirm={(options) => {
            const { runtime, action } = modal;
            setModal(null);
            void run(runtime.id, action, options);
          }}
        />
      )}
    </div>
  );
};
