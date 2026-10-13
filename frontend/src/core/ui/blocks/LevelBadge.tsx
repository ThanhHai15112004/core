import { cn } from '../../lib/cn';
import { LOG_LEVEL_CLASS, type LogLevel } from './log-level';


/** Nhãn log level — màu theo token level của theme. */
export function LevelBadge({ level, label, className }: { level: LogLevel; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-12 shrink-0 items-center justify-center rounded-sm border px-1.5 font-mono text-2xs font-semibold uppercase',
        LOG_LEVEL_CLASS[level] ?? LOG_LEVEL_CLASS.info,
        className,
      )}
    >
      {label ?? level}
    </span>
  );
}
