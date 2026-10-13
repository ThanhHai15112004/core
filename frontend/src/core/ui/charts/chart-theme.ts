import type { ThemeTokens } from '../../theme/useThemeTokens';

/** Phần option chung (chữ, lưới, trục, tooltip) dựng từ token theme. */
export function baseOption(tokens: ThemeTokens) {
  return {
    animation: false,
    textStyle: { fontFamily: tokens.fontSans, color: tokens.muted, fontSize: 11 },
    grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      backgroundColor: tokens.chart.tooltipBg,
      borderColor: tokens.chart.tooltipBorder,
      borderWidth: 1,
      padding: [6, 10],
      textStyle: { color: tokens.chart.tooltipText, fontSize: 12, fontFamily: tokens.fontSans },
      extraCssText: 'box-shadow: none; border-radius: 6px;',
    },
  };
}

export function axisStyle(tokens: ThemeTokens) {
  return {
    axisLine: { lineStyle: { color: tokens.border } },
    axisTick: { show: false },
    axisLabel: { color: tokens.chart.axis, fontSize: 11, hideOverlap: true },
    splitLine: { lineStyle: { color: tokens.chart.grid } },
  };
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
