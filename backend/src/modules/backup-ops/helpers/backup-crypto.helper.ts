import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  BackupEncryptionConfigException,
  BackupIntegrityException,
} from '../exceptions/backup-ops.exceptions.js';

const MAGIC_HEADER = Buffer.from('COREBKP1', 'ascii');
const FORMAT_VERSION = 1;
const FLAG_COMPRESSED = 1 << 0;
const FLAG_ENCRYPTED = 1 << 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const HEADER_LEN = MAGIC_HEADER.length + 2 + SALT_LEN + IV_LEN + AUTH_TAG_LEN; // 52 bytes
const HKDF_INFO = Buffer.from('core-backup-aes-256-gcm-v1', 'utf8');

export const BACKUP_ENCRYPTION_ALGO = 'AES_256_GCM';

export interface EncryptedBackupArtifact {
  readonly artifact: Buffer;
  readonly encrypted: boolean;
  readonly compressed: boolean;
  readonly encryptionAlgorithm: string | null;
  readonly originalSizeBytes: number;
  readonly storedSizeBytes: number;
  readonly plaintextSha256: string;
  readonly artifactSha256: string;
}

/** Dẫn xuất khóa 256-bit bằng HKDF-SHA256 từ secret key cấu hình và salt ngẫu nhiên. */
function deriveKey(secretKey: string, salt: Buffer): Buffer {
  const normalized = secretKey.trim();
  if (!normalized || normalized.length < 16) {
    throw new BackupEncryptionConfigException(
      'BACKUP_ENCRYPTION_KEY must be at least 16 characters when backup encryption is enabled',
    );
  }
  const derived = hkdfSync('sha256', Buffer.from(normalized, 'utf8'), salt, HKDF_INFO, 32);
  return Buffer.from(derived);
}

/** Tính SHA-256 hex digest cho Buffer. */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Đóng gói, nén (gzip) và mã hóa AES-256-GCM cho dữ liệu backup.
 * Định dạng nhị phân tự mô tả:
 * `[8B magic "COREBKP1"][1B version][1B flags][16B salt][12B iv][16B authTag][payload]`
 */
export function encryptBackupPayload(
  plain: Buffer,
  secretKey: string,
  options: { encrypt: boolean; compress: boolean },
): EncryptedBackupArtifact {
  const plaintextSha256 = sha256Hex(plain);
  const compressedBuf = options.compress ? gzipSync(plain, { level: 6 }) : plain;

  let flags = 0;
  if (options.compress) flags |= FLAG_COMPRESSED;

  let salt = Buffer.alloc(SALT_LEN, 0);
  let iv = Buffer.alloc(IV_LEN, 0);
  let authTag = Buffer.alloc(AUTH_TAG_LEN, 0);
  let body: Buffer = compressedBuf;

  if (options.encrypt) {
    flags |= FLAG_ENCRYPTED;
    salt = randomBytes(SALT_LEN);
    iv = randomBytes(IV_LEN);
    const key = deriveKey(secretKey, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const headerPrefix = Buffer.concat([MAGIC_HEADER, Buffer.from([FORMAT_VERSION, flags]), salt, iv]);
    cipher.setAAD(headerPrefix);
    body = Buffer.concat([cipher.update(compressedBuf), cipher.final()]);
    authTag = cipher.getAuthTag();
  }

  const header = Buffer.concat([
    MAGIC_HEADER,
    Buffer.from([FORMAT_VERSION, flags]),
    salt,
    iv,
    authTag,
  ]);
  const artifact = Buffer.concat([header, body]);
  return {
    artifact,
    encrypted: options.encrypt,
    compressed: options.compress,
    encryptionAlgorithm: options.encrypt ? BACKUP_ENCRYPTION_ALGO : null,
    originalSizeBytes: plain.length,
    storedSizeBytes: artifact.length,
    plaintextSha256,
    artifactSha256: sha256Hex(artifact),
  };
}

/**
 * Kiểm tra toàn vẹn SHA-256, giải mã AES-256-GCM và giải nén dữ liệu backup.
 */
export function decryptBackupPayload(
  artifact: Buffer,
  secretKey: string,
  expectedArtifactSha256?: string | null,
  expectedPlaintextSha256?: string | null,
): Buffer {
  if (expectedArtifactSha256) {
    const actualArtifactHash = sha256Hex(artifact);
    if (actualArtifactHash !== expectedArtifactSha256) {
      throw new BackupIntegrityException(
        `Artifact SHA-256 mismatch (expected ${expectedArtifactSha256.slice(0, 12)}..., got ${actualArtifactHash.slice(0, 12)}...)`,
      );
    }
  }

  if (artifact.length < HEADER_LEN) {
    throw new BackupIntegrityException('Backup artifact is truncated or too small');
  }
  if (!artifact.subarray(0, MAGIC_HEADER.length).equals(MAGIC_HEADER)) {
    throw new BackupIntegrityException('Invalid backup artifact magic header');
  }

  const version = artifact[MAGIC_HEADER.length] ?? 0;
  if (version !== FORMAT_VERSION) {
    throw new BackupIntegrityException(`Unsupported backup artifact format version: ${version}`);
  }

  const flags = artifact[MAGIC_HEADER.length + 1] ?? 0;
  const isCompressed = (flags & FLAG_COMPRESSED) !== 0;
  const isEncrypted = (flags & FLAG_ENCRYPTED) !== 0;

  let offset = MAGIC_HEADER.length + 2;
  const salt = artifact.subarray(offset, offset + SALT_LEN);
  offset += SALT_LEN;
  const iv = artifact.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const authTag = artifact.subarray(offset, offset + AUTH_TAG_LEN);
  offset += AUTH_TAG_LEN;
  const ciphertext = artifact.subarray(offset);

  let decoded: Buffer;
  if (isEncrypted) {
    const key = deriveKey(secretKey, salt);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      const headerPrefix = artifact.subarray(0, MAGIC_HEADER.length + 2 + SALT_LEN + IV_LEN);
      decipher.setAAD(headerPrefix);
      decipher.setAuthTag(authTag);
      decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      throw new BackupIntegrityException(
        `Backup decryption failed: ${err instanceof Error ? err.message : 'invalid key or corrupted payload'}`,
      );
    }
  } else {
    decoded = ciphertext;
  }

  let plain: Buffer;
  try {
    plain = isCompressed ? gunzipSync(decoded) : decoded;
  } catch (err) {
    throw new BackupIntegrityException(
      `Backup decompression failed: ${err instanceof Error ? err.message : 'corrupted gzip stream'}`,
    );
  }

  if (expectedPlaintextSha256) {
    const actualPlainHash = sha256Hex(plain);
    if (actualPlainHash !== expectedPlaintextSha256) {
      throw new BackupIntegrityException(
        `Plaintext SHA-256 mismatch (expected ${expectedPlaintextSha256.slice(0, 12)}..., got ${actualPlainHash.slice(0, 12)}...)`,
      );
    }
  }

  return plain;
}
