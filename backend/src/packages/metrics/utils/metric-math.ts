/** Làm tròn số đo để hiển thị. */
export const round = (n: number, digits = 2): number => Number(n.toFixed(digits));

/** % thay đổi; `null` khi thiếu dữ liệu hoặc mốc bằng 0. */
export function changePercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round(((current - previous) / previous) * 100, 1);
}
