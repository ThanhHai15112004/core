import { CheckCircle2, FileText, X, XCircle } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Button } from '@core/ui/primitives';
import { RelativeTime, StatusBanner } from '@core/ui/blocks';
import type { MessagingOverview, MessagingTest } from '../../types/messaging.types';
import { MESSAGING_HEALTH_TONE } from '../../constants/messaging';

/** Messaging không khoẻ: lý do + lần publish / kiểm tra thành công cuối + số lần kiểm tra lỗi. Khoẻ → không hiện. */
export function HealthBanner({ data }: { data: MessagingOverview }) {
  const { t } = useLocale();
  const f = useFormat();
  const { health, provider } = data;
  if (health.status === 'healthy') return null;
  const tone = MESSAGING_HEALTH_TONE[health.status];
  return (
    <StatusBanner
      tone={tone}
      title={t(`messaging.health.${health.status}`)}
      reasons={health.reasons.map((r) => ({ id: `${r.code}-${r.message}`, text: r.message }))}
      description={
        <span className="flex flex-wrap gap-x-3">
          <span className="font-mono text-xs">
            {provider.endpoint}
            {health.pingMs !== null && ` · ${f.duration(health.pingMs)}`}
          </span>
          {health.lastPublishAt && (
            <span>
              {t('messaging.health.lastPublish')} <RelativeTime value={health.lastPublishAt} />
            </span>
          )}
          {health.lastSuccessAt && (
            <span>
              {t('messaging.health.lastSuccess')} <RelativeTime value={health.lastSuccessAt} />
            </span>
          )}
          {health.state !== 'connected' && health.failures > 0 && <span>{t('messaging.health.attempts', { count: health.failures })}</span>}
        </span>
      }
    />
  );
}

/** Kết quả Test Broker: connect → publish → consume → ack (thời gian từng bước, lỗi chỉ rõ bước). */
export function TestResultBanner({ result, onClose, onOpenLogs }: { result: MessagingTest; onClose: () => void; onOpenLogs: () => void }) {
  const { t } = useLocale();
  const f = useFormat();
  return (
    <StatusBanner
      tone={result.ok ? 'ok' : 'crit'}
      title={
        result.ok
          ? t('messaging.test.ok', { ms: f.duration(result.roundTripMs ?? result.totalMs) })
          : t('messaging.test.fail', { step: result.failedStep ? t(`messaging.test.step.${result.failedStep}`) : '' })
      }
      reasons={result.steps.map((s) => ({
        id: s.step,
        text: (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {s.ok ? <CheckCircle2 className="size-3.5 text-ok" /> : <XCircle className="size-3.5 text-crit" />}
            <span>{t(`messaging.test.step.${s.step}`)}</span>
            {s.ms !== null && <span className="font-mono text-xs text-muted">{f.duration(s.ms)}</span>}
            {s.error && <span className="text-crit-fg">{s.error}</span>}
          </span>
        ),
      }))}
      actions={
        <>
          {!result.ok && (
            <Button size="xs" onClick={onOpenLogs}>
              <FileText />
              {t('messaging.message.logs')}
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label={t('messaging.test.dismiss')}>
            <X />
          </Button>
        </>
      }
    />
  );
}
