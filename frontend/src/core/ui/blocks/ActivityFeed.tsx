import { useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { TONES, type Tone } from '../../theme/tone';
import { ToggleGroup, ToggleGroupItem } from '../primitives/toggle-group';
import { StatusDot } from './StatusDot';
import { RelativeTime } from './RelativeTime';
import { PanelState } from './PanelState';

export interface ActivityItem {
  id: string;
  /** ISO time. */
  at: string;
  tone: Tone;
  title: string;
  detail?: string | null;
  /** Nhóm để lọc (vd. "error", "event", "operation") — nhãn đã dịch qua `kinds`. */
  kind?: string;
  source?: string | null;
  onClick?: () => void;
}

interface ActivityFeedProps {
  items: ActivityItem[];
  /** Bộ lọc theo loại: id → nhãn đã dịch. */
  kinds?: Record<string, string>;
  emptyMessage?: string;
  maxHeight?: number | string;
  className?: string;
}

const ALL = '__all__';

/** Dòng thời gian hoạt động (sự kiện, lỗi, thao tác) mới nhất lên đầu, lọc theo loại / mức. */
export function ActivityFeed({ items, kinds, emptyMessage, maxHeight, className }: ActivityFeedProps) {
  const { t } = useLocale();
  const [kind, setKind] = useState(ALL);
  const [tone, setTone] = useState<string>(ALL);
  const presentTones = useMemo(() => TONES.filter((x) => items.some((i) => i.tone === x)), [items]);
  const shown = useMemo(
    () =>
      items
        .filter((i) => (kind === ALL || i.kind === kind) && (tone === ALL || i.tone === tone))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    [items, kind, tone],
  );

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {(kinds || presentTones.length > 1) && (
        <div className="flex flex-wrap items-center gap-2">
          {kinds && (
            <ToggleGroup type="single" value={kind} onValueChange={(v) => setKind(v || ALL)} className="flex-wrap">
              <ToggleGroupItem value={ALL}>{t('ui.feed.all')}</ToggleGroupItem>
              {Object.entries(kinds).map(([id, label]) => (
                <ToggleGroupItem key={id} value={id}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          {presentTones.length > 1 && (
            <ToggleGroup type="single" value={tone} onValueChange={(v) => setTone(v || ALL)} className="flex-wrap">
              <ToggleGroupItem value={ALL}>{t('ui.feed.all')}</ToggleGroupItem>
              {presentTones.map((x) => (
                <ToggleGroupItem key={x} value={x} aria-label={t(`ui.status.${x}`)}>
                  <StatusDot tone={x} size="xs" />
                  {t(`ui.status.${x}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <PanelState status="empty" compact message={emptyMessage ?? t('ui.feed.empty')} />
      ) : (
        <ol className="flex flex-col overflow-y-auto" style={maxHeight !== undefined ? { maxHeight } : undefined}>
          {shown.map((item) => {
            const body = (
              <>
                <span className="flex w-4 shrink-0 justify-center pt-1.5">
                  <StatusDot tone={item.tone} size="xs" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{item.title}</span>
                    <RelativeTime value={item.at} className="shrink-0 text-xs text-faint" />
                  </div>
                  {(item.detail || item.source || (kinds && item.kind)) && (
                    <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                      {kinds && item.kind && <span className="text-faint">{kinds[item.kind] ?? item.kind}</span>}
                      {item.source && <span className="font-mono">{item.source}</span>}
                      {item.detail && <span className="min-w-0 break-words">{item.detail}</span>}
                    </div>
                  )}
                </div>
              </>
            );
            return (
              <li key={item.id} className="border-b border-border last:border-b-0">
                {item.onClick ? (
                  <button type="button" onClick={item.onClick} className="flex w-full gap-2 px-1 py-2 text-left hover:bg-panel-2">
                    {body}
                  </button>
                ) : (
                  <div className="flex gap-2 px-1 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
