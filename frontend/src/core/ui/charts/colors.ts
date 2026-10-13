import type { ThemeTokens } from '../../theme/useThemeTokens';
import type { Tone } from '../../theme/tone';

/** Màu biểu đồ khai báo bằng tên ngữ nghĩa — giá trị thật lấy từ token theme. */
export type ChartColor = Tone | `series-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}` | `level-${'fatal' | 'error' | 'warn' | 'info' | 'debug'}` | 'muted';

export function resolveColor(tokens: ThemeTokens, color: ChartColor | undefined, index: number): string {
  if (!color) return tokens.series[index % tokens.series.length];
  if (color === 'muted') return tokens.muted;
  if (color.startsWith('series-')) return tokens.series[(Number(color.slice(7)) - 1) % tokens.series.length];
  if (color.startsWith('level-')) return tokens.level[color.slice(6) as keyof ThemeTokens['level']];
  return tokens.tone[color as Tone];
}
