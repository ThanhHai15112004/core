import { cn } from '@core/lib/cn';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { LOG_LEVEL_CLASS } from '@core/ui/blocks';
import type { LogsOverview } from '../../types/logs.types';
import { LEVEL_RAIL } from '../../constants/logs';

interface LevelRailProps {
  /** Giá trị bộ lọc `level` hiện tại. */
  value: string | undefined;
  onChange: (level: string | undefined) => void;
  /** Số log theo level — null = ẩn số (đang có bộ lọc khác nên số không còn khớp). */
  levels: LogsOverview['levels'] | null;
  hint?: string;
}

/** Cột chọn level bên trái Explorer (kiểu log-viewer): mỗi level một dòng, kèm số log; số 0 hiện mờ. */
export function LevelRail({ value, onChange, levels, hint }: LevelRailProps) {
  const { t } = useLocale();
  const f = useFormat();
  const countOf = (level: string) => {
    if (!levels) return null;
    const parts = level.split(',');
    return levels.filter((l) => parts.includes(l.level)).reduce((sum, l) => sum + l.count, 0);
  };
  const total = levels ? levels.reduce((s, l) => s + l.count, 0) : null;
  const items = [{ id: 'all', level: undefined as string | undefined, label: t('logs.rail.all'), count: total }, ...LEVEL_RAIL.map((r) => ({ id: r.id, level: r.level as string | undefined, label: r.id.toUpperCase(), count: countOf(r.level) }))];

  return (
    <nav aria-label={t('logs.rail.title')} className="flex flex-col gap-1 rounded-lg border border-border bg-panel p-2">
      <div className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-faint">{t('logs.rail.title')}</div>
      {items.map((it) => {
        const active = (value ?? undefined) === it.level;
        const zero = it.count === 0;
        return (
          <button
            key={it.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(it.level)}
            className={cn(
              'flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors',
              active ? 'bg-panel-3 text-fg' : 'text-fg-2 hover:bg-panel-2',
              zero && !active && 'opacity-50',
            )}
          >
            <span className={cn('size-2 shrink-0 rounded-full border', it.id === 'all' ? 'border-border-strong bg-panel-3' : LOG_LEVEL_CLASS[it.id as keyof typeof LOG_LEVEL_CLASS])} />
            <span className="flex-1 text-left">{it.label}</span>
            {it.count !== null && <span className="font-mono text-xs tabular-nums text-muted">{f.compact(it.count)}</span>}
          </button>
        );
      })}
      {hint && <p className="px-2 pt-1 text-2xs text-faint">{hint}</p>}
    </nav>
  );
}
