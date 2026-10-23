/**
 * Tiện ích phân tích User-Agent và định danh thiết bị nội bộ cho module Auth
 */

/** Suy đoán tên thiết bị ngắn gọn cho phiên đăng nhập từ chuỗi User-Agent */
export function extractDeviceNameFromUserAgent(userAgent?: string | null): string {
  if (!userAgent) return 'Unknown Device';
  if (/iPhone|iPad|iOS/i.test(userAgent)) return 'iOS Device';
  if (/Android/i.test(userAgent)) return 'Android Device';
  if (/Macintosh|Mac OS/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Web Browser';
}

/** Suy đoán tên thiết bị tin cậy (Trusted Device) từ chuỗi User-Agent */
export function inferTrustedDeviceName(userAgent?: string | null): string {
  if (!userAgent) return 'Trusted Device';
  if (/iPhone|iPad|iOS/i.test(userAgent)) return 'iOS Trusted Device';
  if (/Android/i.test(userAgent)) return 'Android Trusted Device';
  if (/Macintosh|Mac OS/i.test(userAgent)) return 'Mac Trusted Browser';
  if (/Windows/i.test(userAgent)) return 'Windows Trusted Browser';
  if (/Linux/i.test(userAgent)) return 'Linux Trusted Browser';
  return 'Trusted Browser';
}
