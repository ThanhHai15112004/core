import React from 'react';
import { cn } from '../../lib/cn';
import { CopyButton } from './CopyButton';

interface CodeBlockProps {
  code: string;
  /** Xuống dòng thay vì cuộn ngang. */
  wrap?: boolean;
  maxHeight?: number | string;
  copy?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/** Khối mã / stack trace / payload (nền code của theme, có nút sao chép). */
export function CodeBlock({ code, wrap, maxHeight = 360, copy = true, className, children }: CodeBlockProps) {
  return (
    <div className={cn('group relative rounded-md border border-border bg-code-bg', className)}>
      {copy && (
        <div className="absolute right-1.5 top-1.5 opacity-60 group-hover:opacity-100">
          <CopyButton value={code} />
        </div>
      )}
      <pre className={cn('overflow-auto p-3 pr-10 font-mono text-xs leading-relaxed text-code', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')} style={{ maxHeight }}>
        {children ?? code}
      </pre>
    </div>
  );
}
