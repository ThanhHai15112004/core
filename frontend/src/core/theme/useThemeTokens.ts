import { useMemo } from 'react';
import { useTheme, type Theme } from './theme-context';
import type { Tone } from './tone';

export const SERIES_COUNT = 8;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug'] as const;
export type LogLevelToken = (typeof LOG_LEVELS)[number];

/** Giá trị màu thật đọc từ CSS variables — dùng cho thư viện vẽ (ECharts) không hiểu `var(--x)`. */
export interface ThemeTokens {
  bg: string;
  panel: string;
  panel2: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  muted: string;
  faint: string;
  primary: string;
  tone: Record<Tone, string>;
  toneBg: Record<Tone, string>;
  level: Record<LogLevelToken, string>;
  series: string[];
  chart: { grid: string; axis: string; tooltipBg: string; tooltipBorder: string; tooltipText: string };
  fontSans: string;
  fontMono: string;
}

function read(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

export function readThemeTokens(el: Element = document.documentElement): ThemeTokens {
  const s = getComputedStyle(el);
  const v = (n: string) => read(s, `--ui-${n}`);
  const tones: Tone[] = ['ok', 'warn', 'crit', 'info', 'unknown'];
  return {
    bg: v('bg'),
    panel: v('panel'),
    panel2: v('panel-2'),
    border: v('border'),
    borderStrong: v('border-strong'),
    text: v('text'),
    text2: v('text-2'),
    muted: v('muted'),
    faint: v('faint'),
    primary: v('primary'),
    tone: Object.fromEntries(tones.map((t) => [t, v(t)])) as Record<Tone, string>,
    toneBg: Object.fromEntries(tones.map((t) => [t, v(`${t}-bg`)])) as Record<Tone, string>,
    level: Object.fromEntries(LOG_LEVELS.map((l) => [l, v(`level-${l}`)])) as Record<LogLevelToken, string>,
    series: Array.from({ length: SERIES_COUNT }, (_, i) => v(`series-${i + 1}`)),
    chart: {
      grid: v('chart-grid'),
      axis: v('chart-axis'),
      tooltipBg: v('chart-tooltip-bg'),
      tooltipBorder: v('chart-tooltip-border'),
      tooltipText: v('chart-tooltip-text'),
    },
    fontSans: read(s, '--font-sans'),
    fontMono: read(s, '--font-mono'),
  };
}

/** Đọc token của một theme cụ thể qua phần tử tạm mang `data-theme` — không phụ thuộc thời điểm `<html>` đổi attribute. */
export function tokensForTheme(theme: Theme): ThemeTokens {
  const probe = document.createElement('div');
  probe.dataset.theme = theme;
  probe.hidden = true;
  document.body.appendChild(probe);
  try {
    return readThemeTokens(probe);
  } finally {
    probe.remove();
  }
}

/** Token màu hiện hành; tính lại khi đổi theme. */
export function useThemeTokens(): ThemeTokens {
  const { theme } = useTheme();
  return useMemo(() => tokensForTheme(theme), [theme]);
}
