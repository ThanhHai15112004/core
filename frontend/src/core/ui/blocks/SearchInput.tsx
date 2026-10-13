import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { inputClass } from '../primitives/input';

const DEBOUNCE_MS = 250;

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Chờ người dùng ngừng gõ (ms) trước khi báo thay đổi. */
  debounceMs?: number;
  className?: string;
}

/** Ô tìm kiếm có debounce + nút xoá. */
export function SearchInput({ value, onChange, placeholder, debounceMs = DEBOUNCE_MS, className }: SearchInputProps) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const id = setTimeout(() => onChange(draft), debounceMs);
    return () => clearTimeout(id);
  }, [draft, value, onChange, debounceMs]);
  return (
    <div className={cn('relative min-w-40', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder ?? t('ui.action.search')}
        aria-label={placeholder ?? t('ui.action.search')}
        className={cn(inputClass, 'pl-8 pr-7 [&::-webkit-search-cancel-button]:hidden')}
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-faint hover:text-fg"
          aria-label={t('ui.action.clear')}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
