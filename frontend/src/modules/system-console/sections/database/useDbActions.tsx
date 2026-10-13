import { useState } from 'react';
import { toast } from 'sonner';
import { useLocale } from '@core/i18n/index';
import { useAppMutation } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { CodeBlock, ConfirmDialog, KeyValueGrid } from '@core/ui/blocks';
import type { DbMigrations, DbSession } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { DB_CONFIRM, DB_SQL_MAX_HEIGHT_PX } from '../../constants/database';
import { sessionSource } from '../../components/database/db-labels';
import { dbKeys } from './database-keys';

type Pending =
  | { kind: 'cancel'; session: DbSession }
  | { kind: 'terminate'; session: DbSession }
  | { kind: 'migrate'; migrations: DbMigrations }
  | null;

/**
 * Thao tác database: Huỷ query, Ngắt session (gõ TERMINATE), Chạy migration (gõ MIGRATE).
 * Mỗi thao tác qua hộp xác nhận chuẩn; xong thì làm mới mọi số liệu database.
 */
export function useDbActions() {
  const { t } = useLocale();
  const f = useFormat();
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);

  const cancel = useAppMutation<DbSession>({
    mutationFn: (s) => databaseApi.cancel(s.id),
    invalidate: [dbKeys.all],
    success: (_, s) => t('db.action.cancelDone', { id: s.id }),
    error: t('db.action.failed'),
    onSuccess: close,
  });
  const terminate = useAppMutation<DbSession>({
    mutationFn: (s) => databaseApi.terminate(s.id, DB_CONFIRM.terminate),
    invalidate: [dbKeys.all],
    success: (_, s) => t('db.action.terminateDone', { id: s.id }),
    error: t('db.action.failed'),
    onSuccess: close,
  });
  const migrate = useAppMutation<void, DbMigrations['lastRun']>({
    mutationFn: () => databaseApi.runMigrations(DB_CONFIRM.migrate),
    invalidate: [dbKeys.all],
    success: false,
    error: t('db.migrations.runFailed'),
    onSuccess: (run) => {
      if (run?.status === 'completed') toast.success(t('db.migrations.done', { count: run.executed.length }));
      else toast.error(t('db.migrations.runFailed'), { description: run?.error ?? undefined });
      close();
    },
  });

  const sessionContext = (s: DbSession) => (
    <>
      <KeyValueGrid
        items={[
          { label: t('db.session.id'), value: `#${s.id}`, mono: true },
          { label: t('db.session.source'), value: sessionSource(s, t) },
          { label: t('db.session.age'), value: f.duration(s.queryMs), mono: true },
        ]}
        columns={3}
      />
      {s.query && <CodeBlock code={s.query} wrap maxHeight={DB_SQL_MAX_HEIGHT_PX} />}
    </>
  );

  const dialog = (() => {
    if (!pending) return null;
    const onOpenChange = (o: boolean) => !o && close();
    if (pending.kind === 'cancel') {
      return (
        <ConfirmDialog
          open
          onOpenChange={onOpenChange}
          title={t('db.modal.cancel.title')}
          impact={[t('db.modal.cancel.warning')]}
          confirmLabel={t('db.modal.cancel.confirm')}
          tone="danger"
          loading={cancel.isPending}
          onConfirm={() => cancel.mutate(pending.session)}
        >
          {sessionContext(pending.session)}
        </ConfirmDialog>
      );
    }
    if (pending.kind === 'terminate') {
      return (
        <ConfirmDialog
          open
          onOpenChange={onOpenChange}
          title={t('db.modal.terminate.title')}
          impact={[t('db.modal.terminate.warning')]}
          confirmLabel={t('db.modal.terminate.confirm')}
          tone="danger"
          typeToConfirm={DB_CONFIRM.terminate}
          loading={terminate.isPending}
          onConfirm={() => terminate.mutate(pending.session)}
        >
          {sessionContext(pending.session)}
        </ConfirmDialog>
      );
    }
    const m = pending.migrations;
    const names = m.items.filter((i) => i.status === 'pending').map((i) => i.name);
    return (
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title={t('db.modal.migrate.title', { count: m.pending })}
        impact={[t('db.modal.migrate.warning'), t('db.modal.migrate.backupUnknown')]}
        confirmLabel={t('db.modal.migrate.confirm')}
        tone="danger"
        typeToConfirm={DB_CONFIRM.migrate}
        loading={migrate.isPending}
        onConfirm={() => migrate.mutate()}
      >
        <KeyValueGrid
          items={[
            { label: t('db.modal.migrate.environment'), value: m.environment.toUpperCase(), mono: true },
            { label: t('db.modal.migrate.database'), value: m.database, mono: true },
          ]}
        />
        <KeyValueGrid
          columns={1}
          items={[
            {
              label: t('db.modal.migrate.pending'),
              value: (
                <ul className="flex flex-col gap-0.5">
                  {names.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ),
              mono: true,
            },
          ]}
        />
      </ConfirmDialog>
    );
  })();

  return {
    dialog,
    requestCancel: (session: DbSession) => setPending({ kind: 'cancel', session }),
    requestTerminate: (session: DbSession) => setPending({ kind: 'terminate', session }),
    requestMigrate: (migrations: DbMigrations) => setPending({ kind: 'migrate', migrations }),
  };
}

export type DbActions = ReturnType<typeof useDbActions>;
