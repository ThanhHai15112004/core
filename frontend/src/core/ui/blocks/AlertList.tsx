import { useState } from 'react';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { TONE_CLASS, type Tone } from '../../theme/tone';
import { StatusDot } from './StatusDot';
import { RelativeTime } from './RelativeTime';

export interface AlertItem {
  id: string;
  tone: Tone;
  title: string;
  detail?: string | null;
  /** Thời điểm bắt đầu (ISO). */
  since?: string | null;
  onInspect?: () => void;
}

interface AlertListProps {
  items: AlertItem[];
  /** Các kiểm tra đang đạt — gom thành một dòng xanh, bấm để xem. */
  okChecks?: string[];
  emptyMessage?: string;
  className?: string;
}

/** Danh sách vấn đề hiện tại, nặng nhất lên trước; các kiểm tra đạt thu gọn. */
export function AlertList({ items, okChecks = [], emptyMessage, className }: AlertListProps) {
  const { t } = useLocale();
  const [showOk, setShowOk] = useState(false);
  return (
    <div className={cn('flex flex-col', className)}>
      {items.length === 0 && (
        <div className="flex items-center gap-2 py-2 text-sm text-ok-fg">
          <CheckCircle2 className="size-4" />
          {emptyMessage ?? t('ui.alerts.none')}
        </div>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {items.map((a) => {
          const body = (
            <>
              <StatusDot tone={a.tone} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm font-medium', TONE_CLASS[a.tone].fg)}>{a.title}</div>
                {a.detail && <div className="mt-0.5 break-words text-xs text-muted">{a.detail}</div>}
              </div>
              {a.since && <RelativeTime value={a.since} className="shrink-0 text-xs text-faint" />}
              {a.onInspect && <ChevronRight className="mt-0.5 size-4 shrink-0 text-faint" />}
            </>
          );
          return (
            <li key={a.id}>
              {a.onInspect ? (
                <button type="button" onClick={a.onInspect} className="flex w-full items-start gap-2.5 rounded-md px-1 py-2 text-left hover:bg-panel-2">
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2.5 px-1 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {okChecks.length > 0 && (
        <div className="mt-1 border-t border-border pt-2">
          <button type="button" onClick={() => setShowOk((s) => !s)} className="flex items-center gap-2 text-xs text-ok-fg hover:underline">
            <CheckCircle2 className="size-3.5" />
            {t('ui.alerts.okChecks', { count: okChecks.length })}
          </button>
          {showOk && (
            <ul className="mt-1.5 flex flex-col gap-1 pl-5 text-xs text-muted">
              {okChecks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
