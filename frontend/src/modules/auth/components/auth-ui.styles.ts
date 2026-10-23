import type React from 'react';

/**
 * Bộ style chuẩn hóa cho Module Auth dựa trên biến CSS Theme (Light & Dark Mode):
 * - Light: Primary #2563EB, Secondary #14B8A6, Light blue #EFF6FF, Accent #F59E0B, Background #FFFFFF, Text #0F172A
 * - Dark:  Background #0B1120, Surface #151E2E, Primary #3B82F6, Secondary #2DD4BF, Accent #FBBF24, Text #F1F5F9
 */
export const authStyles = {
  card: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: '22px',
    boxShadow: 'var(--shadow-card)',
  } satisfies React.CSSProperties,

  cardHighlighted: {
    background: 'linear-gradient(180deg, var(--bg-light-blue) 0%, var(--bg-surface) 100%)',
    border: '1px solid var(--border-hover)',
    borderRadius: 'var(--radius-md)',
    padding: '22px',
    boxShadow: 'var(--shadow-card)',
  } satisfies React.CSSProperties,

  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--text-main)',
    margin: '0 0 6px',
  } satisfies React.CSSProperties,

  sectionDesc: {
    fontSize: '13px',
    color: 'var(--text-muted)',
    margin: '0 0 18px',
    lineHeight: 1.5,
  } satisfies React.CSSProperties,

  label: {
    display: 'block',
    fontSize: '12.5px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '6px',
  } satisfies React.CSSProperties,

  input: {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-primary)',
    color: 'var(--text-main)',
    fontSize: '13.5px',
    outline: 'none',
    transition: 'border-color 0.15s ease',
  } satisfies React.CSSProperties,

  monoInput: {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-primary)',
    color: 'var(--text-main)',
    fontSize: '13px',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
  } satisfies React.CSSProperties,

  btnPrimary: {
    background: 'var(--primary)',
    color: '#ffffff',
    border: '1px solid var(--primary)',
    borderRadius: 'var(--radius-sm)',
    padding: '9px 16px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    transition: 'var(--transition-fast)',
  } satisfies React.CSSProperties,

  btnSecondary: {
    background: 'var(--bg-surface-elevated)',
    color: 'var(--text-main)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    transition: 'var(--transition-fast)',
  } satisfies React.CSSProperties,

  btnTeal: {
    background: 'var(--secondary)',
    color: '#ffffff',
    border: '1px solid var(--secondary)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
  } satisfies React.CSSProperties,

  btnAccent: {
    background: 'var(--accent)',
    color: '#0f172a',
    border: '1px solid var(--accent)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
  } satisfies React.CSSProperties,

  btnDanger: {
    background: 'var(--status-danger-bg)',
    color: 'var(--status-danger)',
    border: '1px solid rgba(239, 68, 68, 0.35)',
    borderRadius: 'var(--radius-sm)',
    padding: '7px 12px',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
  } satisfies React.CSSProperties,

  badgePrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '3px 9px',
    borderRadius: '999px',
    fontSize: '11.5px',
    fontWeight: 700,
    background: 'var(--primary-light)',
    color: 'var(--primary)',
    border: '1px solid var(--border-hover)',
  } satisfies React.CSSProperties,

  badgeSuccess: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '3px 9px',
    borderRadius: '999px',
    fontSize: '11.5px',
    fontWeight: 700,
    background: 'var(--status-success-bg)',
    color: 'var(--status-success)',
  } satisfies React.CSSProperties,

  badgeWarning: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '3px 9px',
    borderRadius: '999px',
    fontSize: '11.5px',
    fontWeight: 700,
    background: 'var(--status-warning-bg)',
    color: 'var(--status-warning)',
  } satisfies React.CSSProperties,

  badgeDanger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '3px 9px',
    borderRadius: '999px',
    fontSize: '11.5px',
    fontWeight: 700,
    background: 'var(--status-danger-bg)',
    color: 'var(--status-danger)',
  } satisfies React.CSSProperties,

  codeBox: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface-elevated)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-main)',
    wordBreak: 'break-all',
  } satisfies React.CSSProperties,

  tableHeaderCell: {
    textAlign: 'left',
    padding: '10px 12px',
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--bg-surface-elevated)',
  } satisfies React.CSSProperties,

  tableCell: {
    padding: '11px 12px',
    fontSize: '13px',
    color: 'var(--text-main)',
    borderBottom: '1px solid var(--border-color)',
    verticalAlign: 'middle',
  } satisfies React.CSSProperties,
};

export const authCardStyle = authStyles.card;
export const authInputStyle = authStyles.input;
export const authLabelStyle = authStyles.label;
export const authBtnPrimaryStyle = authStyles.btnPrimary;
export const authBtnSecondaryStyle = authStyles.btnSecondary;
export const authBtnDangerStyle = authStyles.btnDanger;

export const authBadgeStyle = (color: string, bg: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '3px 9px',
  borderRadius: '999px',
  fontSize: '11.5px',
  fontWeight: 700,
  color,
  background: bg,
});


