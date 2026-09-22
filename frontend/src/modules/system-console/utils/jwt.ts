export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  isExpired: boolean;
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Giải mã header/payload JWT ở client. KHÔNG xác minh chữ ký.
 * Ném `'format'` khi sai cấu trúc, `'decode'` khi không parse được.
 */
export function decodeJwt(token: string): DecodedJwt {
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new Error('format');

  try {
    const header = JSON.parse(decodeBase64Url(parts[0]!)) as Record<string, unknown>;
    const payload = JSON.parse(decodeBase64Url(parts[1]!)) as Record<string, unknown>;
    const exp = payload['exp'];
    return { header, payload, isExpired: typeof exp === 'number' && exp < Date.now() / 1000 };
  } catch {
    throw new Error('decode');
  }
}
