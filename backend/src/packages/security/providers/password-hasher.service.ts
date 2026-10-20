import {
  createHash,
  pbkdf2 as pbkdf2Cb,
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';

const scryptAsync = promisify(scryptCb);
const pbkdf2Async = promisify(pbkdf2Cb);

const SCRYPT_KEYLEN = 64;
const PBKDF2_KEYLEN = 64;
const SALT_BYTES = 16;
const PBKDF2_SHA512_ITERATIONS = 100_000;
const PBKDF2_SHA256_ITERATIONS = 210_000;

export const PASSWORD_HASH_ALGORITHMS = ['SCRYPT', 'PBKDF2_SHA512', 'PBKDF2_SHA256'] as const;

export type PasswordHashAlgorithm = (typeof PASSWORD_HASH_ALGORITHMS)[number];

@Injectable()
export class PasswordHasherService {
  private defaultAlgorithm: PasswordHashAlgorithm = 'SCRYPT';

  /** Lấy thuật toán băm mật khẩu mặc định hiện hành */
  public getDefaultAlgorithm(): PasswordHashAlgorithm {
    return this.defaultAlgorithm;
  }

  /** Cập nhật thuật toán băm mật khẩu mặc định (được đồng bộ từ SecuritySettingsService) */
  public setDefaultAlgorithm(algorithm: PasswordHashAlgorithm): void {
    if (PASSWORD_HASH_ALGORITHMS.includes(algorithm)) {
      this.defaultAlgorithm = algorithm;
    }
  }

  /** Băm mật khẩu theo thuật toán được chọn (`SCRYPT` | `PBKDF2_SHA512` | `PBKDF2_SHA256`) */
  public async hash(plainPassword: string, algorithm?: PasswordHashAlgorithm): Promise<string> {
    const algo = algorithm ?? this.defaultAlgorithm;
    const salt = randomBytes(SALT_BYTES).toString('hex');

    if (algo === 'PBKDF2_SHA512') {
      const derived = await pbkdf2Async(
        plainPassword,
        salt,
        PBKDF2_SHA512_ITERATIONS,
        PBKDF2_KEYLEN,
        'sha512',
      );
      return `pbkdf2_sha512$${PBKDF2_SHA512_ITERATIONS}$${salt}$${derived.toString('hex')}`;
    }

    if (algo === 'PBKDF2_SHA256') {
      const derived = await pbkdf2Async(
        plainPassword,
        salt,
        PBKDF2_SHA256_ITERATIONS,
        PBKDF2_KEYLEN,
        'sha256',
      );
      return `pbkdf2_sha256$${PBKDF2_SHA256_ITERATIONS}$${salt}$${derived.toString('hex')}`;
    }

    const derivedKey = (await scryptAsync(plainPassword, salt, SCRYPT_KEYLEN)) as Buffer;
    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  /** Alias tương thích cho `hash()` */
  public async hashPassword(
    plainPassword: string,
    algorithm?: PasswordHashAlgorithm,
  ): Promise<string> {
    return this.hash(plainPassword, algorithm);
  }

  /** Kiểm tra mật khẩu đầu vào khớp với chuỗi băm đã lưu (tự nhận diện thuật toán, chống Timing Attack) */
  public async verify(plainPassword: string, storedHash: string): Promise<boolean> {
    if (!plainPassword || !storedHash) {
      return false;
    }

    const parts = storedHash.split('$');
    const prefix = parts[0];

    try {
      if (prefix === 'scrypt' && parts.length === 3) {
        const [, salt, keyHex] = parts;
        if (!salt || !keyHex) return false;
        const storedBuffer = Buffer.from(keyHex, 'hex');
        const derivedBuffer = (await scryptAsync(
          plainPassword,
          salt,
          storedBuffer.length,
        )) as Buffer;
        if (storedBuffer.length !== derivedBuffer.length) return false;
        return timingSafeEqual(storedBuffer, derivedBuffer);
      }

      if ((prefix === 'pbkdf2_sha512' || prefix === 'pbkdf2_sha256') && parts.length === 4) {
        const [, iterStr, salt, keyHex] = parts;
        const iterations = Number(iterStr);
        if (!salt || !keyHex || !Number.isFinite(iterations) || iterations < 1000) {
          return false;
        }
        const digest = prefix === 'pbkdf2_sha512' ? 'sha512' : 'sha256';
        const storedBuffer = Buffer.from(keyHex, 'hex');
        const derivedBuffer = await pbkdf2Async(
          plainPassword,
          salt,
          iterations,
          storedBuffer.length,
          digest,
        );
        if (storedBuffer.length !== derivedBuffer.length) return false;
        return timingSafeEqual(storedBuffer, derivedBuffer);
      }

      return false;
    } catch {
      return false;
    }
  }

  /** Alias tương thích cho `verify()` */
  public async verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
    return this.verify(plainPassword, storedHash);
  }

  /** Kiểm tra xem chuỗi băm hiện tại có khác với thuật toán mặc định đang cấu hình hay không */
  public needsRehash(storedHash: string, targetAlgorithm?: PasswordHashAlgorithm): boolean {
    const algo = targetAlgorithm ?? this.defaultAlgorithm;
    if (algo === 'SCRYPT') return !storedHash.startsWith('scrypt$');
    if (algo === 'PBKDF2_SHA512') return !storedHash.startsWith('pbkdf2_sha512$');
    if (algo === 'PBKDF2_SHA256') return !storedHash.startsWith('pbkdf2_sha256$');
    return false;
  }

  /** Tạo mã băm SHA-256 một chiều phục vụ lưu trữ Refresh Token, Reset Token, OTP và Recovery Codes */
  public sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  /** So sánh hai chuỗi băm theo thời gian hằng số (Constant-Time Compare) để chống Timing Attack */
  public safeEqualHex(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b || a.length !== b.length) {
      return false;
    }
    try {
      const bufA = Buffer.from(a, 'utf8');
      const bufB = Buffer.from(b, 'utf8');
      if (bufA.length !== bufB.length) return false;
      return timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  /** Sinh chuỗi token ngẫu nhiên an toàn mật mã học (Base64URL) */
  public generateRandomToken(byteLength = 32): string {
    return randomBytes(byteLength).toString('base64url');
  }

  /** Sinh mã OTP số gồm N chữ số (mặc định 6 chữ số) phục vụ xác thực qua Email/SMS */
  public generateNumericOtp(digits = 6): string {
    const safeDigits = Math.max(4, Math.min(10, Math.trunc(digits)));
    const max = 10 ** safeDigits;
    const num = randomInt(0, max);
    return String(num).padStart(safeDigits, '0');
  }

  /**
   * Sinh mật khẩu gợi ý mạnh an toàn mật mã học theo các biến setting chính sách mật khẩu
   * (độ dài tối thiểu, chữ hoa, chữ số, ký tự đặc biệt và loại trừ danh sách mật khẩu bị cấm)
   */
  public generateSuggestedPassword(options?: {
    length?: number | undefined;
    minLength?: number | undefined;
    requireUppercase?: boolean | undefined;
    requireNumbers?: boolean | undefined;
    requireSpecialChars?: boolean | undefined;
    disallowedPasswords?: readonly string[] | undefined;
  }): string {
    const minLen = Math.max(6, options?.minLength ?? 8);
    const targetLen = Math.max(minLen, Math.min(64, options?.length ?? Math.max(12, minLen)));
    const requireUppercase = options?.requireUppercase ?? true;
    const requireNumbers = options?.requireNumbers ?? true;
    const requireSpecialChars = options?.requireSpecialChars ?? true;
    const disallowed = new Set(
      (options?.disallowedPasswords ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean),
    );

    const lowerChars = 'abcdefghijkmnopqrstuvwxyz';
    const upperChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const numberChars = '23456789';
    const specialChars = '!@#$%^&*_-+=?';

    let pool = lowerChars;
    if (requireUppercase) pool += upperChars;
    if (requireNumbers) pool += numberChars;
    if (requireSpecialChars) pool += specialChars;

    for (let attempt = 0; attempt < 10; attempt++) {
      const chars: string[] = [];
      chars.push(lowerChars[randomInt(0, lowerChars.length)]!);
      if (requireUppercase) {
        chars.push(upperChars[randomInt(0, upperChars.length)]!);
      }
      if (requireNumbers) {
        chars.push(numberChars[randomInt(0, numberChars.length)]!);
      }
      if (requireSpecialChars) {
        chars.push(specialChars[randomInt(0, specialChars.length)]!);
      }

      while (chars.length < targetLen) {
        chars.push(pool[randomInt(0, pool.length)]!);
      }

      // Fisher-Yates shuffle bằng randomInt an toàn mật mã học
      for (let i = chars.length - 1; i > 0; i--) {
        const j = randomInt(0, i + 1);
        const tmp = chars[i]!;
        chars[i] = chars[j]!;
        chars[j] = tmp;
      }

      const candidate = chars.join('');
      const lowerCandidate = candidate.toLowerCase();
      const isDisallowed = [...disallowed].some(
        (banned) => lowerCandidate === banned || lowerCandidate.includes(banned),
      );
      if (!isDisallowed) {
        return candidate;
      }
    }

    return ` Sec#${randomBytes(6).toString('hex')}!9A`.trim();
  }
}
