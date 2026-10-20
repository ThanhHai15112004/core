/**
 * Định dạng dung lượng byte sang đơn vị đọc được (B, KB, MB, GB, TB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/**
 * Che địa chỉ Email để hiển thị an toàn trên giao diện và log (vd: `ng***@gmail.com`).
 */
export function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return '***';
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}***@${domain}`;
}

/**
 * Che số điện thoại để hiển thị an toàn trên giao diện và log (vd: `091****678`).
 */
export function maskPhone(phone: string): string {
  const cleaned = phone.trim();
  if (cleaned.length <= 4) return '***';
  return `${cleaned.slice(0, 3)}****${cleaned.slice(-3)}`;
}
