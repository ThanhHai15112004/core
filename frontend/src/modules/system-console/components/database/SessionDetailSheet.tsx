import { Cpu, OctagonX, Unplug } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button } from '@core/ui/primitives';
import { CodeBlock, DetailSection, DetailSheet, KeyValueGrid, QueryView, StatusDot } from '@core/ui/blocks';
import type { DbConnectionDetail, DbSession } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { DB_SQL_MAX_HEIGHT_PX, SESSION_TONE } from '../../constants/database';
import { dbKeys } from '../../sections/database/database-keys';
import { sessionSource } from './db-labels';

interface Props {
  id: string | null;
  canCancel: boolean;
  canTerminate: boolean;
  onClose: () => void;
  onCancel: (s: DbSession) => void;
  onTerminate: (s: DbSession) => void;
  navigate: (path: string) => void;
}

/** Chi tiết một session: nguồn, trạng thái, query, transaction, lock đang chờ / đang chặn + Huỷ query / Ngắt session. */
export function SessionDetailSheet({ id, canCancel, canTerminate, onClose, onCancel, onTerminate, navigate }: Props) {
  const { t } = useLocale();
  const query = useLiveQuery(dbKeys.connection(id ?? ''), () => databaseApi.connection(id!), { enabled: Boolean(id), keepPrevious: false });
  const d = query.data;
  const s = d?.session;
  return (
    <DetailSheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={t('db.session.title', { id: id ?? '' })}
      subtitle={s ? sessionSource(s, t) : undefined}
      status={s ? { tone: SESSION_TONE[s.state], label: t(`db.session.status.${s.state}`) } : undefined}
      actions={
        s && d ? (
          <>
            {canCancel && s.query && !s.isSelf && (
              <Button size="sm" disabled={!d.actionsEnabled} onClick={() => onCancel(s)}>
                <OctagonX />
                {t('db.action.cancel')}
              </Button>
            )}
            {canTerminate && !s.isSelf && (
              <Button size="sm" variant="danger-outline" disabled={!d.actionsEnabled} onClick={() => onTerminate(s)}>
                <Unplug />
                {t('db.action.terminate')}
              </Button>
            )}
            {s.runtime && (
              <Button size="sm" variant="ghost" onClick={() => navigate(`runtimes/${s.runtime}`)}>
                <Cpu />
                {t('db.session.openRuntime')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <QueryView query={query}>{(data) => <SessionBody d={data} id={id ?? ''} />}</QueryView>
    </DetailSheet>
  );
}

function SessionBody({ d, id }: { d: DbConnectionDetail; id: string }) {
  const { t } = useLocale();
  const f = useFormat();
  const s = d.session;
  const sec = (v: number | null) => (v === null ? null : f.duration(v * 1000));
  return (
    <>
      {!d.actionsEnabled && <p className="mb-5 rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-info-fg">{t('db.action.disabled')}</p>}
      <DetailSection title={t('db.session.info')}>
        <KeyValueGrid
          items={[
            { label: t('db.session.user'), value: s.user, mono: true },
            { label: t('db.session.program'), value: s.program },
            { label: t('db.session.database'), value: s.database, mono: true },
            { label: t('db.session.client'), value: s.client, mono: true },
            { label: t('db.session.command'), value: s.command, mono: true },
            { label: t('db.session.connectedFor'), value: s.connectedSec === null ? t('db.session.notProvided') : sec(s.connectedSec), mono: s.connectedSec !== null },
            { label: t('db.session.time'), value: f.duration(s.queryMs), mono: true },
            { label: t('db.session.txAge'), value: sec(s.transactionSec), mono: true },
          ]}
        />
      </DetailSection>
      <DetailSection title={t('db.session.query')}>
        {s.query ? <CodeBlock code={s.query} wrap maxHeight={DB_SQL_MAX_HEIGHT_PX} /> : <p className="text-sm text-faint">{t('db.session.noQuery')}</p>}
      </DetailSection>
      {d.transaction && (
        <DetailSection title={t('db.tx.title')}>
          <KeyValueGrid
            columns={3}
            items={[
              { label: t('db.tx.age'), value: f.duration(d.transaction.ageSec * 1000), mono: true },
              { label: t('db.tx.locks'), value: d.transaction.locksHeld === null ? null : f.number(d.transaction.locksHeld), mono: true },
              { label: t('db.tx.isolation'), value: d.transaction.isolation, mono: true },
            ]}
          />
        </DetailSection>
      )}
      {d.waits.length > 0 && (
        <DetailSection title={t('db.locks.title')}>
          <ul className="flex flex-col gap-1.5">
            {d.waits.map((w) => (
              <li key={`${w.waitingSession}-${w.blockingSession}`} className="flex items-start gap-2 text-sm text-fg-2">
                <StatusDot tone={w.waitingSession === id ? 'warn' : 'crit'} className="mt-1.5" />
                <span>
                  {w.waitingSession === id
                    ? t('db.locks.waitsFor', { id: w.blockingSession, object: w.object ?? NO_VALUE })
                    : t('db.locks.blocks', { id: w.waitingSession, object: w.object ?? NO_VALUE })}
                  {w.waitMs !== null && <span className="ml-1.5 font-mono text-xs text-muted">{f.duration(w.waitMs)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}
    </>
  );
}
