import React, { useMemo } from 'react';
import { useLocale } from '../../i18n/index';
import { CodeBlock } from './CodeBlock';

/** Tô màu JSON bằng token theme (không dùng mã màu). */
const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlight(json: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of json.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(json.slice(last, start));
    const [full, str, colon, lit, num] = m;
    const cls = str ? (colon ? 'text-info-fg' : 'text-ok-fg') : lit ? 'text-warn-fg' : num ? 'text-series-2' : '';
    out.push(
      <span key={i++} className={cls}>
        {str ?? full}
      </span>,
    );
    if (str && colon) out.push(colon);
    last = start + full.length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

export function JsonView({ value, maxHeight, className }: { value: unknown; maxHeight?: number | string; className?: string }) {
  const { t } = useLocale();
  const text = useMemo(() => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, 2);
  }, [value]);
  if (!text) return <div className="text-sm text-faint">{t('ui.json.empty')}</div>;
  return (
    <CodeBlock code={text} maxHeight={maxHeight} className={className}>
      {highlight(text)}
    </CodeBlock>
  );
}
