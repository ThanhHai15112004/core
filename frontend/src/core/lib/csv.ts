export type CsvCell = string | number | null | undefined;

/** Chuỗi CSV từ header + các dòng (escape dấu phẩy / ngoặc kép / xuống dòng). */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const escape = (v: CsvCell) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(escape).join(',')).join('\n');
}

/** Tải file CSV (UTF-8 BOM để Excel đọc đúng tiếng Việt). */
export function downloadCsv(filename: string, header: string[], rows: CsvCell[][]): void {
  const url = URL.createObjectURL(new Blob([`﻿${toCsv(header, rows)}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
