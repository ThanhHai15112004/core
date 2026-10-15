import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { SecretService } from './secret.service.js';

export const DB_ENCRYPTION_ALGORITHMS = [
  'AES_256_GCM',
  'CHACHA20_POLY1305',
  'AES_256_CBC_HMAC',
] as const;

export type DbEncryptionAlgorithm = (typeof DB_ENCRYPTION_ALGORITHMS)[number];

const ENCRYPTED_PREFIX = 'enc:v1:';
const FALLBACK_DEV_MASTER_SECRET = 'core-default-db-field-encryption-master-key-2026';

/**
 * Dịch vụ Mã hóa Trường Dữ liệu Nhạy cảm xuống Database (Encrypt-at-Rest):
 * Hỗ trợ 3 thuật toán AEAD / Encrypt-then-MAC:
 * 1. `AES_256_GCM` (Mặc định - NIST AEAD 256-bit, IV 12 bytes, AuthTag 16 bytes)
 * 2. `CHACHA20_POLY1305` (RFC 8439 AEAD 256-bit, IV 12 bytes, AuthTag 16 bytes)
 * 3. `AES_256_CBC_HMAC` (AES-256-CBC IV 16 bytes + HMAC-SHA256 Encrypt-then-MAC)
 *
 * Định dạng lưu trữ tự mô tả: `enc:v1:<ALGO>:<ivHex>:<tagOrMacHex>:<cipherHex>`
 * giúp giải mã chính xác dữ liệu cũ ngay cả khi Admin chuyển đổi thuật toán mặc định.
 */
@Injectable()
export class FieldEncryptionService {
  private defaultAlgorithm: DbEncryptionAlgorithm = 'AES_256_GCM';

  constructor(
    @Optional() private readonly configService?: CoreConfigService,
    @Optional() private readonly secretService?: SecretService,
  ) {}

  /** Lấy thuật toán mã hóa DB mặc định hiện hành */
  public getDefaultAlgorithm(): DbEncryptionAlgorithm {
    return this.defaultAlgorithm;
  }

  /** Cập nhật thuật toán mã hóa DB mặc định (được đồng bộ từ SecuritySettingsService) */
  public setDefaultAlgorithm(algorithm: DbEncryptionAlgorithm): void {
    if (DB_ENCRYPTION_ALGORITHMS.includes(algorithm)) {
      this.defaultAlgorithm = algorithm;
    }
  }

  /** Kiểm tra một chuỗi có đang ở định dạng đã mã hóa `enc:v1:...` hay không */
  public isEncrypted(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
  }

  /** Mã hóa chuỗi nhạy cảm trước khi lưu xuống DB */
  public encrypt(plainText: string, algorithm?: DbEncryptionAlgorithm): string {
    if (!plainText) {
      return plainText;
    }

    const algo = algorithm ?? this.defaultAlgorithm;
    const { encKey, macKey } = this.deriveKeys();

    if (algo === 'AES_256_GCM') {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encKey, iv);
      const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return `${ENCRYPTED_PREFIX}${algo}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    if (algo === 'CHACHA20_POLY1305') {
      const iv = randomBytes(12);
      const cipher = createCipheriv('chacha20-poly1305', encKey, iv, { authTagLength: 16 });
      const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return `${ENCRYPTED_PREFIX}${algo}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    // AES_256_CBC_HMAC (Encrypt-then-MAC)
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', encKey, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const mac = createHmac('sha256', macKey).update(iv).update(encrypted).digest();
    return `${ENCRYPTED_PREFIX}AES_256_CBC_HMAC:${iv.toString('hex')}:${mac.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Giải mã chuỗi nhạy cảm đọc từ DB.
   * Nếu chuỗi chưa mã hóa (dữ liệu lịch sử trước khi bật mã hóa), trả về nguyên bản để tương thích ngược.
   */
  public decrypt(payload: string): string {
    if (!payload || !payload.startsWith(ENCRYPTED_PREFIX)) {
      return payload;
    }

    const body = payload.slice(ENCRYPTED_PREFIX.length);
    const parts = body.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted field format');
    }

    const [algo, ivHex, tagOrMacHex, cipherHex] = parts as [
      DbEncryptionAlgorithm,
      string,
      string,
      string,
    ];
    const iv = Buffer.from(ivHex, 'hex');
    const tagOrMac = Buffer.from(tagOrMacHex, 'hex');
    const encrypted = Buffer.from(cipherHex, 'hex');
    const { encKey, macKey } = this.deriveKeys();

    if (algo === 'AES_256_GCM') {
      const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
      decipher.setAuthTag(tagOrMac);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    }

    if (algo === 'CHACHA20_POLY1305') {
      const decipher = createDecipheriv('chacha20-poly1305', encKey, iv, { authTagLength: 16 });
      decipher.setAuthTag(tagOrMac);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    }

    if (algo === 'AES_256_CBC_HMAC') {
      const expectedMac = createHmac('sha256', macKey).update(iv).update(encrypted).digest();
      if (expectedMac.length !== tagOrMac.length || !timingSafeEqual(expectedMac, tagOrMac)) {
        throw new Error('Encrypted field HMAC verification failed');
      }
      const decipher = createDecipheriv('aes-256-cbc', encKey, iv);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    }

    throw new Error(`Unsupported DB encryption algorithm: ${String(algo)}`);
  }

  /** Dẫn xuất cặp khóa 256-bit (Encryption Key & MAC Key) độc lập từ SecretService / CoreConfigService */
  private deriveKeys(): { encKey: Buffer; macKey: Buffer } {
    const rawSecret = this.configService?.auth.jwt.accessSecret || FALLBACK_DEV_MASTER_SECRET;

    const encKey = createHash('sha256').update(`core:db:enc:v1:${rawSecret}`, 'utf8').digest();
    const macKey = createHash('sha256').update(`core:db:mac:v1:${rawSecret}`, 'utf8').digest();

    return { encKey, macKey };
  }
}
