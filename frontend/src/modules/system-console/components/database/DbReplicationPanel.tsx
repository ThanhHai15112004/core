import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import type { Tone } from '@core/theme';
import { Badge } from '@core/ui/primitives';
import { KeyValueGrid, Panel } from '@core/ui/blocks';
import type { DbReplicationOverview } from '../../types/database.types';

const STATUS_TONE: Record<DbReplicationOverview['status'], Tone> = {
  disabled: 'unknown',
  healthy: 'ok',
  lagging: 'warn',
  fallback_active: 'warn',
  unavailable: 'crit',
};

/** Bảng trạng thái Primary / Read Replica, độ trễ đồng bộ và thống kê định tuyến. */
export function DbReplicationPanel({ replication }: { replication?: DbReplicationOverview }) {
  const { t } = useLocale();
  const f = useFormat();

  if (!replication) {
    return null;
  }

  const lagToneClass =
    replication.lagMs === null
      ? undefined
      : replication.lagMs >= replication.thresholds.lagCritMs
        ? 'text-crit-fg'
        : replication.lagMs >= replication.thresholds.lagWarnMs
          ? 'text-warn-fg'
          : undefined;

  const replicaLabel = replication.replicas.length
    ? replication.replicas.map((r) => `${r.host}:${r.port}`).join(', ')
    : t('db.replication.unconfigured');

  return (
    <Panel
      title={t('db.replication.title')}
      hint={t('db.replication.hint')}
      actions={<Badge tone={STATUS_TONE[replication.status]}>{t(`db.replication.status.${replication.status}`)}</Badge>}
    >
      <div className="flex flex-col gap-3">
        <KeyValueGrid
          items={[
            { label: t('db.replication.primary'), value: `${replication.primary.host}:${replication.primary.port}`, mono: true },
            { label: t('db.replication.replicas'), value: replicaLabel, mono: replication.replicas.length > 0 },
            {
              label: t('db.replication.lag'),
              value:
                replication.lagMs === null ? (
                  NO_VALUE
                ) : (
                  <span className={lagToneClass}>{f.duration(replication.lagMs)}</span>
                ),
              mono: true,
            },
            {
              label: t('db.replication.circuitState'),
              value: t(`db.replication.circuit.${replication.circuitState}`),
            },
          ]}
        />
        <div className="border-t border-border pt-3">
          <KeyValueGrid
            items={[
              { label: t('db.replication.replicaReads'), value: f.number(replication.routing.replicaReads), mono: true },
              { label: t('db.replication.primaryReads'), value: f.number(replication.routing.primaryReads), mono: true },
              { label: t('db.replication.reportReads'), value: f.number(replication.routing.reportReplicaReads), mono: true },
              { label: t('db.replication.rawReads'), value: f.number(replication.routing.readAfterWritePrimaryReads), mono: true },
              { label: t('db.replication.fallbacks'), value: f.number(replication.routing.fallbackCount), mono: true },
            ]}
          />
        </div>
      </div>
    </Panel>
  );
}
