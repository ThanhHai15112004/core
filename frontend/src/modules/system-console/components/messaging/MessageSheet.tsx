import { useState } from 'react';
import { Eye, EyeOff, FileText, RotateCcw, Trash2, Zap } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { cn } from '@core/lib/cn';
import { TONE_CLASS } from '@core/theme';
import { Button } from '@core/ui/primitives';
import { CodeBlock, CopyButton, DetailSection, DetailSheet, JsonView, KeyValueGrid, QueryView, RelativeTime, StatusBanner, StatusDot } from '@core/ui/blocks';
import type { MessageDetail } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { DETAIL_CODE_HEIGHT_PX, LIFECYCLE_TONE, MESSAGE_CONTENT_TYPE, MESSAGE_STATUS_TONE } from '../../constants/messaging';
import { idemKey } from '../../utils/messaging-format';
import { messagingKeys } from '../../sections/messaging/messaging-keys';
import type { ActionTarget, MessageAction } from '../../sections/messaging/useMessageActions';

interface Props {
  messageId: string | null;
  queue: string | null;
  onClose: () => void;
  onAction: (action: MessageAction, target: ActionTarget) => void;
  onOpenChannel: (channel: string) => void;
  onOpenConsumer: (consumer: string) => void;
  navigate: (path: string) => void;
}

const logsPath = (correlationId: string) => `logs/explorer?correlationId=${encodeURIComponent(correlationId)}`;

/**
 * Chi tiết message: trạng thái, vòng đời (publish → nhận → lỗi → retry → dead letter…), lỗi & stack, metadata,
 * payload (đã che, chỉ tải khi bấm), Retry / Replay / Discard theo trạng thái và cấu hình môi trường.
 */
export function MessageSheet({ messageId, queue, onClose, onAction, onOpenChannel, onOpenConsumer, navigate }: Props) {
  const { t } = useLocale();
  const query = useLiveQuery(messagingKeys.message(messageId ?? '', queue), () => messagingApi.message(messageId!, queue ?? undefined), {
    enabled: Boolean(messageId),
    keepPrevious: false,
  });
  const d = query.data;
  return (
    <DetailSheet
      open={Boolean(messageId)}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={<span className="font-mono text-sm">{messageId}</span>}
      subtitle={d ? `${d.channel} · ${d.queue}` : undefined}
      status={d ? { tone: MESSAGE_STATUS_TONE[d.status], label: t(`messaging.status.${d.status}`) } : undefined}
      actions={
        d ? (
          <>
            <CopyButton value={d.id} label={t('messaging.message.copyId')} size="xs" />
            {d.correlationId && (
              <Button size="sm" onClick={() => navigate(logsPath(d.correlationId!))}>
                <FileText />
                {t('messaging.message.openLogs')}
              </Button>
            )}
            {d.status === 'retrying' && d.settings.retry && (
              <Button size="sm" onClick={() => onAction('retry', d)}>
                <Zap />
                {t('messaging.action.retry')}
              </Button>
            )}
            {d.status === 'dead_letter' && d.settings.replay && (
              <Button size="sm" onClick={() => onAction('replay', d)}>
                <RotateCcw />
                {t('messaging.action.replay')}
              </Button>
            )}
            {d.status === 'dead_letter' && d.settings.discard && (
              <Button size="sm" variant="danger-outline" onClick={() => onAction('discard', d)}>
                <Trash2 />
                {t('messaging.action.discard')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <QueryView query={query}>{(data) => <Body key={`${data.queue}:${data.id}`} d={data} onOpenChannel={onOpenChannel} onOpenConsumer={onOpenConsumer} />}</QueryView>
    </DetailSheet>
  );
}

function Body({ d, onOpenChannel, onOpenConsumer }: { d: MessageDetail } & Pick<Props, 'onOpenChannel' | 'onOpenConsumer'>) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const stamp = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString()} ${formatTime(iso, true)}` : null);
  const link = (text: string, onClick: () => void) => (
    <button key={text} type="button" className="mr-2 font-mono text-xs text-info-fg hover:underline" onClick={onClick}>
      {text}
    </button>
  );
  const atRisk = d.status === 'dead_letter' || d.status === 'retrying';

  return (
    <>
      {d.malformed && <StatusBanner tone="crit" title={t('messaging.message.malformed')} />}
      {d.large && <StatusBanner tone="warn" title={t('messaging.message.largeWarning', { size: f.bytes(d.size) })} />}
      {atRisk && <StatusBanner tone={d.idempotent === true ? 'ok' : 'warn'} title={t(`messaging.idempotent.hint.${idemKey(d.idempotent)}`)} />}

      <DetailSection title={t('messaging.detail.summary')}>
        <KeyValueGrid
          columns={3}
          items={[
            { key: 'channel', label: t('messaging.message.channel'), value: link(d.channel, () => onOpenChannel(d.channel)) },
            { key: 'queue', label: t('messaging.message.queue'), value: d.queue, mono: true },
            { key: 'producer', label: t('messaging.message.producer'), value: d.producer ? t(`rt.name.${d.producer}`) : null },
            { key: 'consumer', label: t('messaging.message.consumer'), value: d.consumers.length ? d.consumers.map((c) => link(c, () => onOpenConsumer(c))) : null },
            { key: 'published', label: t('messaging.message.published'), value: stamp(d.publishedAt), mono: true },
            { key: 'attempts', label: t('messaging.message.attempts'), value: <span className={cn(d.attempts > 1 && 'text-warn-fg')}>{`${d.attempts} / ${d.maxAttempts}`}</span>, mono: true },
            { key: 'duration', label: t('messaging.message.duration'), value: d.durationMs === null ? null : f.duration(d.durationMs), mono: true },
            { key: 'wait', label: t('messaging.message.wait'), value: d.waitMs === null ? null : f.duration(d.waitMs), mono: true },
            { key: 'size', label: t('messaging.message.size'), value: <span className={cn(d.large && 'text-warn-fg')}>{f.bytes(d.size)}</span>, mono: true },
            ...(d.nextAttemptAt ? [{ key: 'next', label: t('messaging.message.nextAttempt'), value: <RelativeTime value={d.nextAttemptAt} /> }] : []),
            { key: 'corr', label: t('messaging.message.correlationId'), value: d.correlationId, mono: true },
          ]}
        />
      </DetailSection>

      <DetailSection title={t('messaging.lifecycle.title')}>
        <ol className="flex flex-col">
          {d.lifecycle.map((e, i) => {
            const prev = d.lifecycle[i - 1];
            const gap = prev ? Date.parse(e.at) - Date.parse(prev.at) : null;
            const tone = LIFECYCLE_TONE[e.type];
            return (
              <li key={`${e.at}-${e.type}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
                {i < d.lifecycle.length - 1 && <span className="absolute bottom-0 left-[5px] top-4 w-px bg-border" aria-hidden="true" />}
                <StatusDot tone={tone} className="mt-1.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn('text-sm font-medium', tone === 'crit' || tone === 'warn' ? TONE_CLASS[tone].fg : 'text-fg')}>
                      {t(`messaging.lifecycle.${e.type}`, {
                        runtime: e.runtime ? t(`rt.name.${e.runtime}`) : NO_NAME,
                        consumer: e.consumer ?? NO_NAME,
                        attempt: e.attempt ?? '',
                        delay: e.delayMs === null ? '' : f.duration(e.delayMs),
                      })}
                    </span>
                    {e.ms !== null && <span className="font-mono text-xs text-muted">{f.duration(e.ms)}</span>}
                  </div>
                  <div className="font-mono text-2xs text-faint">
                    {formatTime(e.at, true)}
                    {gap !== null && gap >= 0 && ` · +${f.duration(gap)}`}
                  </div>
                  {e.error && <div className="mt-0.5 break-words text-xs text-crit-fg">{e.error}</div>}
                </div>
              </li>
            );
          })}
        </ol>
        {d.lifecycle.length <= 1 && <p className="mt-1 text-xs text-faint">{t('messaging.lifecycle.onlyPublished')}</p>}
      </DetailSection>

      {d.error && (
        <DetailSection title={t('messaging.message.lastError')}>
          <CodeBlock code={d.error} wrap maxHeight={DETAIL_CODE_HEIGHT_PX} />
          {d.stacktrace.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted hover:text-fg">{t('messaging.message.stacktrace', { count: d.stacktrace.length })}</summary>
              <CodeBlock code={d.stacktrace.at(-1) ?? ''} maxHeight={DETAIL_CODE_HEIGHT_PX} className="mt-1.5" />
            </details>
          )}
        </DetailSection>
      )}

      <DetailSection title={t('messaging.message.metadata')}>
        <KeyValueGrid
          items={[
            { key: 'id', label: t('messaging.message.id'), value: d.id, mono: true },
            { key: 'key', label: t('messaging.message.key'), value: d.channel, mono: true },
            { key: 'ct', label: t('messaging.message.contentType'), value: MESSAGE_CONTENT_TYPE, mono: true },
            {
              key: 'policy',
              label: t('messaging.message.retryPolicy'),
              value: d.backoff
                ? t('messaging.message.backoff', { type: d.backoff.type, delay: f.duration(d.backoff.delayMs), max: d.maxAttempts })
                : t('messaging.message.noRetry', { max: d.maxAttempts }),
            },
            { key: 'processed', label: t('messaging.message.processed'), value: stamp(d.processedAt), mono: true },
            { key: 'finished', label: t('messaging.message.finished'), value: stamp(d.finishedAt), mono: true },
          ]}
        />
      </DetailSection>

      <PayloadSection d={d} />
    </>
  );
}

/** Ký hiệu khi vòng đời thiếu tên runtime / consumer. */
const NO_NAME = '?';

/** Payload đã che — chỉ tải khi bấm (mỗi lần xem được ghi audit). */
function PayloadSection({ d }: { d: MessageDetail }) {
  const { t } = useLocale();
  const [shown, setShown] = useState(false);
  const query = useLiveQuery(messagingKeys.payload(d.id, d.queue), () => messagingApi.payload(d.id, d.queue), { tier: 'static', enabled: shown, keepPrevious: false });
  return (
    <DetailSection
      title={t('messaging.payload.title')}
      actions={
        d.settings.payload ? (
          <Button size="xs" onClick={() => setShown((s) => !s)}>
            {shown ? <EyeOff /> : <Eye />}
            {shown ? t('messaging.payload.hide') : t('messaging.payload.show')}
          </Button>
        ) : undefined
      }
    >
      {!d.settings.payload ? (
        <p className="text-xs text-faint">{t('messaging.payload.disabled')}</p>
      ) : shown ? (
        <QueryView query={query} skeleton="block">
          {(p) => (
            <>
              <JsonView value={p.payload} maxHeight={DETAIL_CODE_HEIGHT_PX} />
              <p className="mt-1.5 text-xs text-faint">{t(p.redacted ? 'messaging.payload.redacted' : 'messaging.payload.note')}</p>
            </>
          )}
        </QueryView>
      ) : null}
    </DetailSection>
  );
}
