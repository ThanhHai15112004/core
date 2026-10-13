import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { cn } from '@core/lib/cn';
import { Button, Input } from '@core/ui/primitives';

/** Tìm theo Job ID / Correlation ID / Request ID / Idempotency key / `field=value` / tên loại job (bấm Tìm hoặc Enter). */
export function JobSearchBox({ value, onSubmit, className }: { value: string; onSubmit: (q: string) => void; className?: string }) {
  const { t } = useLocale();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <form
      role="search"
      className={cn('flex min-w-0 gap-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text.trim());
      }}
    >
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('jobs.search.placeholder')}
          aria-label={t('jobs.search.placeholder')}
          spellCheck={false}
          className="h-8 pl-8 pr-8 font-mono"
        />
        {text && (
          <button
            type="button"
            onClick={() => {
              setText('');
              onSubmit('');
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-faint hover:text-fg"
            aria-label={t('ui.action.clear')}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <Button type="submit" variant="primary" size="md">
        {t('jobs.search.submit')}
      </Button>
    </form>
  );
}
