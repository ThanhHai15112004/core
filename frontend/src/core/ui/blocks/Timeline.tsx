import React from 'react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { TONE_CLASS, type Tone } from '../../theme/tone';
import { StatusDot } from './StatusDot';
import { PanelState } from './PanelState';

export interface TimelineItem {
  id: string;
  tone: Tone;
  title: React.ReactNode;
  /** Thời điểm đã định dạng (cột trái). */
  time?: React.ReactNode;
  /** Dòng phụ dưới tiêu đề (lỗi, người thực hiện…). */
  detail?: React.ReactNode;
  /** Khoảng cách so với bước trước (vd. "2.1 s") — hiện trên đường nối phía trên bước này. */
  gap?: React.ReactNode;
  /** Bước đang diễn ra (chấm nhấp nháy). */
  current?: boolean;
}

interface TimelineProps {
  items: TimelineItem[];
  emptyMessage?: string;
  className?: string;
}

/** Dòng thời gian theo thứ tự (vòng đời, các lần thử): thời điểm · chấm theo tông · nội dung, khoảng cách giữa các bước. */
export function Timeline({ items, emptyMessage, className }: TimelineProps) {
  const { t } = useLocale();
  if (items.length === 0) return <PanelState status="empty" compact message={emptyMessage ?? t('ui.state.empty')} />;
  const last = items.length - 1;
  return (
    <ol className={cn('flex flex-col', className)}>
      {items.map((item, i) => (
        <li key={item.id}>
          {i > 0 && item.gap !== undefined && item.gap !== null && item.gap !== '' && (
            <div className="grid grid-cols-[5.5rem_1rem_minmax(0,1fr)] gap-x-2">
              <span />
              <span className="flex justify-center">
                <span className="w-px bg-border" />
              </span>
              <span className="py-1 font-mono text-2xs tabular-nums text-faint">{item.gap}</span>
            </div>
          )}
          <div className="grid grid-cols-[5.5rem_1rem_minmax(0,1fr)] gap-x-2">
            <span className="truncate pt-0.5 text-right font-mono text-xs tabular-nums text-muted">{item.time}</span>
            <span className="relative flex justify-center">
              {last > 0 && <span className={cn('absolute w-px bg-border', i === 0 ? 'bottom-0 top-2' : i === last ? 'top-0 h-2' : 'inset-y-0')} aria-hidden="true" />}
              <StatusDot tone={item.tone} pulse={item.current} className="relative mt-1.5" />
            </span>
            <div className="min-w-0 pb-3">
              <div className={cn('text-sm', item.current ? 'font-semibold text-fg' : 'text-fg', (item.tone === 'crit' || item.tone === 'warn') && TONE_CLASS[item.tone].fg)}>
                {item.title}
              </div>
              {item.detail && <div className="mt-0.5 break-words text-xs text-muted">{item.detail}</div>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
