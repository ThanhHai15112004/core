import React from 'react';
import { Briefcase, CalendarClock, Database, GitBranch, Globe, Layers, Mail, ShieldCheck } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button } from '@core/ui/primitives';
import {
  CodeBlock,
  CopyButton,
  DetailSection,
  DetailSheet,
  JsonView,
  KeyValueGrid,
  LevelBadge,
  QueryView,
  type KeyValueItem,
  type LogLevel as BadgeLevel,
} from '@core/ui/blocks';
import type { LogDetail, LogRow } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { DEPENDENCY_SECTION } from '../../constants/logs';
import { browserTimeZone, contextPath, logDateTime } from '../../utils/logs-format';
import { logsKeys } from '../../sections/logs/logs-keys';
import { LogTable } from './LogTable';

interface Props {
  logId: string | null;
  onClose: () => void;
  onOpenLog: (id: string) => void;
  onTrace: (id: string) => void;
  onError: (fingerprint: string) => void;
  navigate: (path: string) => void;
}

/**
 * Chi tiết một log: nội dung đầy đủ, ngữ cảnh (runtime, request / job / message / execution), metadata (đã che ở
 * backend), stack trace, các log ngay trước / sau trên cùng instance và lối tắt sang màn liên quan.
 */
export function LogDetailSheet({ logId, onClose, onOpenLog, onTrace, onError, navigate }: Props) {
  const { t } = useLocale();
  const query = useLiveQuery(logsKeys.entry(logId ?? ''), () => logsApi.entry(logId!), { tier: 'static', enabled: Boolean(logId), keepPrevious: false });
  const d = query.data;
  return (
    <DetailSheet
      open={Boolean(logId)}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={
        d ? (
          <span className="flex items-center gap-2">
            <LevelBadge level={d.level as BadgeLevel} />
            <span className="font-mono text-sm font-normal text-fg-2">{logDateTime(d.at)}</span>
          </span>
        ) : (
          t('logs.detail.title')
        )
      }
      subtitle={d ? `${browserTimeZone()} · ${d.runtime ?? ''}${d.instance ? ` · ${d.instance}` : ''}` : undefined}
    >
      <QueryView query={query}>{(data) => <DetailBody d={data} onOpenLog={onOpenLog} onTrace={onTrace} onError={onError} navigate={navigate} />}</QueryView>
    </DetailSheet>
  );
}

function DetailBody({ d, onOpenLog, onTrace, onError, navigate }: { d: LogDetail } & Omit<Props, 'logId' | 'onClose'>) {
  const { t, formatRelative } = useLocale();
  const f = useFormat();
  const l = d.links;
  const traceId = l.correlationId ?? d.requestId ?? d.jobId;
  const code = (v: string | null | undefined) => (v ? <span className="font-mono text-xs">{v}</span> : null);
  const withNote = (main: React.ReactNode, note: string | null | undefined) => (
    <>
      {main}
      {note && <div className="text-xs text-muted">{note}</div>}
    </>
  );

  const context: KeyValueItem[] = [
    { label: t('logs.detail.source'), value: d.runtime },
    { label: t('logs.detail.instance'), value: code(d.instance) },
    { label: t('logs.detail.module'), value: d.module },
    ...(d.correlationId ? [{ label: t('logs.ctx.correlation'), value: code(d.correlationId) }] : []),
    ...(d.requestId
      ? [{ label: t('logs.ctx.request'), value: withNote(code(d.requestId), l.request?.route ? `${l.request.method ?? ''} ${l.request.route} ${l.request.status ?? ''}` : null) }]
      : []),
    ...(d.jobId ? [{ label: t('logs.ctx.job'), value: withNote(code(d.jobId), l.job?.type ?? d.jobType) }] : []),
    ...(d.messageId && d.messageId !== d.jobId ? [{ label: t('logs.ctx.message'), value: code(d.messageId) }] : []),
    ...(d.executionId ? [{ label: t('logs.ctx.execution'), value: withNote(code(d.executionId), l.execution?.taskId) }] : []),
    ...(d.userId ? [{ label: t('logs.ctx.user'), value: code(d.userId) }] : []),
    ...(d.route ? [{ label: t('logs.detail.endpoint'), value: code(d.route) }] : []),
    ...(d.status !== null ? [{ label: t('logs.detail.status'), value: String(d.status), mono: true }] : []),
    ...(d.errorType ? [{ label: t('logs.detail.errorType'), value: code(d.errorType) }] : []),
    ...(d.errorCode ? [{ label: t('logs.detail.errorCode'), value: code(d.errorCode) }] : []),
    ...(d.durationMs !== null ? [{ label: t('logs.detail.duration'), value: f.duration(d.durationMs), mono: true }] : []),
  ];

  /** Theo thời gian: cũ hơn → log này → mới hơn (bảng hiển thị mới nhất trên cùng). */
  const sequence: LogRow[] = [...d.after, d, ...d.before];

  return (
    <>
      <DetailSection title={t('logs.col.message')} actions={<CopyButton value={d.id} label={t('logs.detail.copyId')} size="xs" />}>
        <CodeBlock code={d.message} wrap maxHeight={240} />
      </DetailSection>

      <div className="mb-5 flex flex-wrap gap-2">
        {traceId && (
          <Button size="sm" variant="primary" onClick={() => onTrace(traceId)}>
            <GitBranch />
            {t('logs.detail.viewTrace')}
          </Button>
        )}
        {l.request && (
          <Button size="sm" onClick={() => navigate(contextPath('request', l.request!.id))}>
            <Globe />
            {t('logs.detail.openRequest')}
          </Button>
        )}
        {l.job && (
          <Button size="sm" onClick={() => navigate(contextPath('job', l.job!.id, l.job!.queue))}>
            <Briefcase />
            {t('logs.detail.openJob')}
          </Button>
        )}
        {l.execution && (
          <Button size="sm" onClick={() => navigate(contextPath('execution', l.execution!.id))}>
            <CalendarClock />
            {t('logs.detail.openExecution')}
          </Button>
        )}
        {l.message && (
          <Button size="sm" onClick={() => navigate(`messaging/messages/${encodeURIComponent(l.message!.id)}`)}>
            <Mail />
            {t('logs.detail.openMessage')}
          </Button>
        )}
        {l.dependency && (
          <Button size="sm" onClick={() => navigate(DEPENDENCY_SECTION[l.dependency!]!)}>
            <Database />
            {t('logs.detail.openDependency', { name: t(`logs.dependency.${l.dependency}`) })}
          </Button>
        )}
        {d.group && (
          <Button size="sm" onClick={() => onError(d.group!.fingerprint)}>
            <Layers />
            {t('logs.detail.openGroup', { count: d.group.count })}
          </Button>
        )}
      </div>

      {d.group && (
        <p className="mb-5 text-sm text-fg-2">
          {t('logs.detail.groupNote', { count: f.compact(d.group.count), first: d.group.firstSeen ? formatRelative(d.group.firstSeen) : NO_VALUE })}
        </p>
      )}

      <DetailSection title={t('logs.detail.context')}>
        <KeyValueGrid items={context} />
      </DetailSection>

      {d.detailsHidden && <p className="mb-5 rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-info-fg">{t('logs.detail.hidden')}</p>}

      {d.metadata && (
        <DetailSection title={t('logs.detail.metadata')}>
          <JsonView value={d.metadata} maxHeight={320} />
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="size-3.5 text-ok" />
            {t('logs.detail.redactedNote')}
          </p>
        </DetailSection>
      )}

      {d.stack && (
        <DetailSection title={t('logs.detail.stack')}>
          <CodeBlock code={d.stack} maxHeight={320} />
        </DetailSection>
      )}

      {sequence.length > 1 && (
        <DetailSection title={t('logs.detail.sequence')}>
          <p className="mb-2 text-xs text-muted">{t('logs.detail.sequenceNote', { instance: d.instance ?? NO_VALUE })}</p>
          <div className="overflow-hidden rounded-md border border-border">
            <LogTable rows={sequence} onOpen={(id) => id !== d.id && onOpenLog(id)} activeId={d.id} />
          </div>
        </DetailSection>
      )}
    </>
  );
}
