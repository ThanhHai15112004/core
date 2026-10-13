import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import type { LogLevel } from '../../types/logs.types';
import { useLocale } from '../../../../core/i18n/index';

export const LevelChip: React.FC<{ level: LogLevel }> = ({ level }) => <span className={`lg-level lg-level-${level}`}>{level.toUpperCase()}</span>;

export const CopyButton: React.FC<{ value: string; label: string; small?: boolean }> = ({ value, label, small = true }) => {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`scp-btn ${small ? 'scp-btn-sm' : ''} scp-btn-secondary`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : label}
    </button>
  );
};

/** Khối thu gọn được (stack trace mặc định đóng để không rối). */
export const Collapsible: React.FC<{ title: string; copy?: string; copyLabel?: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title,
  copy,
  copyLabel,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="lg-collapsible">
      <div className="lg-collapsible-head">
        <button type="button" className="ov-link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {title}
        </button>
        {copy && copyLabel && <CopyButton value={copy} label={copyLabel} />}
      </div>
      {open && children}
    </div>
  );
};

/** Thanh ngang đơn giản (phân bố level, nguồn log). */
export const ShareBar: React.FC<{ percent: number | null; tone?: string }> = ({ percent, tone = 'info' }) => (
  <span className="lg-bar" aria-hidden="true">
    <span className={`lg-bar-fill lg-bar-${tone}`} style={{ width: `${Math.max(percent ?? 0, percent ? 1 : 0)}%` }} />
  </span>
);

/** Sparkline nhỏ bằng SVG (số lần theo thời gian). */
export const MiniSpark: React.FC<{ values: number[]; tone?: 'crit' | 'warn' | 'info' }> = ({ values, tone = 'crit' }) => {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const w = 80;
  const h = 20;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
  return (
    <svg className={`lg-spark lg-spark-${tone}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" strokeWidth="1.5" />
    </svg>
  );
};
