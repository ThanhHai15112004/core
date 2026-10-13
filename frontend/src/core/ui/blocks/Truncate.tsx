import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { TRUNCATE_LINES_DEFAULT } from '../../constants/ui.constants';

const CLAMP = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4', 6: 'line-clamp-6' } as const;

interface TruncateProps {
  text: string;
  lines?: keyof typeof CLAMP;
  /** Hiện nút "Xem thêm" khi bị cắt (mặc định chỉ có tooltip). */
  expandable?: boolean;
  mono?: boolean;
  className?: string;
}

/** Cắt chữ dài theo số dòng; chỉ hiện "Xem thêm" khi thực sự bị cắt. */
export function Truncate({ text, lines = TRUNCATE_LINES_DEFAULT as keyof typeof CLAMP, expandable, mono, className }: TruncateProps) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines]);

  return (
    <div className={cn('min-w-0', className)}>
      <div ref={ref} title={!expandable && clipped ? text : undefined} className={cn('whitespace-pre-wrap break-words', mono && 'font-mono text-xs', !open && CLAMP[lines])}>
        {text}
      </div>
      {expandable && (clipped || open) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="mt-0.5 text-xs text-info-fg hover:underline"
        >
          {open ? t('ui.action.showLess') : t('ui.action.showMore')}
        </button>
      )}
    </div>
  );
}
