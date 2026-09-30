import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useLocale } from '../../../../core/i18n/index';

/** Tìm theo Job ID / Correlation ID / Request ID / Idempotency key / `field=value` / tên loại job. */
export const JobSearchBox: React.FC<{
  value: string;
  onSubmit: (q: string) => void;
  autoFocus?: boolean;
}> = ({ value, onSubmit, autoFocus }) => {
  const { t } = useLocale();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <form
      className="job-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text.trim());
      }}
    >
      <Search size={15} aria-hidden="true" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('jobs.search.placeholder')}
        aria-label={t('jobs.search.placeholder')}
        {...(autoFocus ? { autoFocus: true } : {})}
      />
      {text && (
        <button
          type="button"
          className="rt-icon-btn"
          aria-label={t('common.close')}
          onClick={() => {
            setText('');
            onSubmit('');
          }}
        >
          <X size={13} />
        </button>
      )}
      <button type="submit" className="scp-btn scp-btn-sm scp-btn-primary">
        {t('jobs.search.submit')}
      </button>
    </form>
  );
};
