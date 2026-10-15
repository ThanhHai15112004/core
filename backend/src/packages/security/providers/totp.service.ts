import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Mã hóa Buffer sang chuỗi Base32 chuẩn RFC 4648 */
export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | (buffer[i] ?? 0);
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31] ?? '';
  }

  return output;
}

/** Giải mã chuỗi Base32 chuẩn RFC 4648 sang Buffer */
export function decodeBase32(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i] ?? '';
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export interface VerifyTotpOptions {
  readonly timestampMs?: number;
  readonly window?: number;
  readonly stepSeconds?: number;
  readonly digits?: number;
}

@Injectable()
export class TotpService {
  /** Sinh khóa bí mật TOTP định dạng Base32 (mặc định 20 bytes = 160 bits theo chuẩn RFC 6238) */
  public generateSecret(byteLength = 20): string {
    return encodeBase32(randomBytes(byteLength));
  }

  /** Tạo đường dẫn chuẩn otpauth:// để ứng dụng Google Authenticator / Authy quét mã QR */
  public buildOtpAuthUri(params: {
    secret: string;
    accountName: string;
    issuer?: string;
    digits?: number;
    period?: number;
  }): string {
    const issuer = params.issuer ?? 'CorePlatform';
    const digits = params.digits ?? DEFAULT_DIGITS;
    const period = params.period ?? DEFAULT_STEP_SECONDS;
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(params.accountName)}`;
    const query = new URLSearchParams({
      secret: params.secret,
      issuer,
      algorithm: 'SHA1',
      digits: String(digits),
      period: String(period),
    });
    return `otpauth://totp/${label}?${query.toString()}`;
  }

  /** Tính mã TOTP 6 chữ số tại thời điểm cụ thể theo chuẩn RFC 6238 (HMAC-SHA1) */
  public generateCode(
    secret: string,
    timestampMs: number = Date.now(),
    stepSeconds: number = DEFAULT_STEP_SECONDS,
    digits: number = DEFAULT_DIGITS,
  ): string {
    const counter = Math.floor(timestampMs / 1000 / stepSeconds);
    return this.generateHotp(secret, counter, digits);
  }

  /** Xác thực mã TOTP người dùng nhập với cửa sổ dung sai thời gian (mặc định ±1 bước = ±30s) */
  public verifyCode(secret: string, code: string, options: VerifyTotpOptions = {}): boolean {
    const normalizedCode = code.trim();
    const digits = options.digits ?? DEFAULT_DIGITS;
    if (!/^\d+$/.test(normalizedCode) || normalizedCode.length !== digits) {
      return false;
    }

    const timestampMs = options.timestampMs ?? Date.now();
    const stepSeconds = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
    const window = options.window ?? 1;
    const currentCounter = Math.floor(timestampMs / 1000 / stepSeconds);

    try {
      const codeBuf = Buffer.from(normalizedCode, 'utf8');
      for (let offset = -window; offset <= window; offset++) {
        const candidate = this.generateHotp(secret, currentCounter + offset, digits);
        const candidateBuf = Buffer.from(candidate, 'utf8');
        if (codeBuf.length === candidateBuf.length && timingSafeEqual(codeBuf, candidateBuf)) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Sinh danh sách mã khôi phục dự phòng (Recovery Codes) dạng XXXX-XXXX */
  public generateRecoveryCodes(count = 8): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const raw = randomBytes(8);
      let part1 = '';
      let part2 = '';
      for (let j = 0; j < 4; j++) {
        part1 += RECOVERY_ALPHABET[(raw[j] ?? 0) % RECOVERY_ALPHABET.length] ?? 'A';
        part2 += RECOVERY_ALPHABET[(raw[j + 4] ?? 0) % RECOVERY_ALPHABET.length] ?? 'A';
      }
      codes.push(`${part1}-${part2}`);
    }
    return codes;
  }

  /** Thuật toán HOTP RFC 4226 tạo mã số từ secret Base32 và counter 64-bit */
  private generateHotp(secret: string, counter: number, digits: number): string {
    const key = decodeBase32(secret);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

    const hmac = createHmac('sha1', key).update(counterBuffer).digest();
    const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
    const binary =
      (((hmac[offset] ?? 0) & 0x7f) << 24) |
      (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
      (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
      ((hmac[offset + 3] ?? 0) & 0xff);

    const otp = binary % 10 ** digits;
    return String(otp).padStart(digits, '0');
  }
}
