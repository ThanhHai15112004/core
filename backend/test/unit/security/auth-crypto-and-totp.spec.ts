import { describe, it, expect } from '@jest/globals';
import { CoreConfigService } from '@packages/config/index.js';
import {
  FieldEncryptionService,
  PasswordHasherService,
  TokenService,
  TotpService,
  parseDurationSeconds,
  type IUserIdentityResolver,
} from '@packages/security/index.js';
import {
  HCMC_ORGANIZATION_UNITS,
  PRIVILEGED_ACCOUNTS,
  PRIVILEGED_DEFAULT_PASSWORD,
} from '../../../src/database/seeders/iam-master.seeder.js';
import {
  REGULAR_USER_DEFAULT_PASSWORD,
  generateRealisticUsersDataset,
} from '../../../src/database/seeders/iam-thousand-users.seeder.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

describe('Unit: Security Package — PasswordHasher, FieldEncryption, TotpService, TokenService & Seeders', () => {
  const passwordHasher = new PasswordHasherService();
  const totpService = new TotpService();

  it('PasswordHasherService: hỗ trợ đa thuật toán (SCRYPT, PBKDF2_SHA512, PBKDF2_SHA256), needsRehash, OTP số và SHA-256', async () => {
    const plain = '!P@ssw0rd#';
    const hashScrypt = await passwordHasher.hash(plain, 'SCRYPT');
    const hashPbkdf2Sha512 = await passwordHasher.hash(plain, 'PBKDF2_SHA512');
    const hashPbkdf2Sha256 = await passwordHasher.hash(plain, 'PBKDF2_SHA256');

    expect(hashScrypt.startsWith('scrypt$')).toBe(true);
    expect(hashPbkdf2Sha512.startsWith('pbkdf2_sha512$')).toBe(true);
    expect(hashPbkdf2Sha256.startsWith('pbkdf2_sha256$')).toBe(true);

    expect(await passwordHasher.verify(plain, hashScrypt)).toBe(true);
    expect(await passwordHasher.verify(plain, hashPbkdf2Sha512)).toBe(true);
    expect(await passwordHasher.verify(plain, hashPbkdf2Sha256)).toBe(true);
    expect(await passwordHasher.verify('WrongPass#2026', hashScrypt)).toBe(false);
    expect(await passwordHasher.verify(plain, 'invalid-hash-format')).toBe(false);

    expect(passwordHasher.needsRehash(hashScrypt, 'SCRYPT')).toBe(false);
    expect(passwordHasher.needsRehash(hashScrypt, 'PBKDF2_SHA512')).toBe(true);
    expect(passwordHasher.needsRehash(hashPbkdf2Sha512, 'PBKDF2_SHA512')).toBe(false);

    const otp = passwordHasher.generateNumericOtp(6);
    expect(otp).toMatch(/^\d{6}$/);

    const digest1 = passwordHasher.sha256('sample-token');
    const digest2 = passwordHasher.sha256('sample-token');
    expect(digest1).toHaveLength(64);
    expect(digest1).toBe(digest2);
  });

  it('FieldEncryptionService: mã hóa & giải mã AEAD xuống DB với AES_256_GCM, CHACHA20_POLY1305 và AES_256_CBC_HMAC', () => {
    applyTestEnv({
      JWT_ACCESS_SECRET: 'test-access-secret-key-2026',
    });
    const config = new CoreConfigService();
    const fieldEncryption = new FieldEncryptionService(config);
    const plainSecret = 'JBSWY3DPEHPK3PXP';

    for (const algo of ['AES_256_GCM', 'CHACHA20_POLY1305', 'AES_256_CBC_HMAC'] as const) {
      const cipher = fieldEncryption.encrypt(plainSecret, algo);
      expect(fieldEncryption.isEncrypted(cipher)).toBe(true);
      expect(cipher.startsWith(`enc:v1:${algo}:`)).toBe(true);
      expect(cipher).not.toContain(plainSecret);
      expect(fieldEncryption.decrypt(cipher)).toBe(plainSecret);
    }

    // Dữ liệu plaintext legacy vẫn đọc được bình thường
    expect(fieldEncryption.decrypt('PLAIN_LEGACY_SECRET')).toBe('PLAIN_LEGACY_SECRET');
  });

  it('IAM Seeders: Đơn vị TP.HCM (1 chi nhánh), 10 TK đặc quyền (!P@ssw0rd#) & 1.000 TK thường (Abcd@454647#) đều @gmail.com và tên thật', () => {
    expect(PRIVILEGED_DEFAULT_PASSWORD).toBe('!P@ssw0rd#');
    expect(REGULAR_USER_DEFAULT_PASSWORD).toBe('Abcd@454647#');

    // Chỉ có 1 chi nhánh ở TP.HCM (BRANCH_HCM)
    const branches = HCMC_ORGANIZATION_UNITS.filter((u) => u.type === 'BRANCH');
    expect(branches).toHaveLength(1);
    expect(branches[0]?.code).toBe('BRANCH_HCM');

    // Tất cả tài khoản đặc quyền đều dùng @gmail.com
    expect(PRIVILEGED_ACCOUNTS.length).toBeGreaterThanOrEqual(10);
    for (const pUser of PRIVILEGED_ACCOUNTS) {
      expect(pUser.email.endsWith('@gmail.com')).toBe(true);
    }

    // Sinh 1.000 người dùng ngẫu nhiên tên tiếng Việt thật, không có user1/user2, 100% @gmail.com
    const dataset = generateRealisticUsersDataset(1000);
    expect(dataset).toHaveLength(1000);
    const emails = new Set<string>();
    const usernames = new Set<string>();

    for (const u of dataset) {
      expect(u.email.endsWith('@gmail.com')).toBe(true);
      expect(u.username).not.toMatch(/^user\d+$/i);
      expect(u.fullName.split(' ').length).toBeGreaterThanOrEqual(3);
      emails.add(u.email);
      usernames.add(u.username);
    }

    expect(emails.size).toBe(1000);
    expect(usernames.size).toBe(1000);
  });

  it('TotpService: sinh secret Base32, tạo otpauth URI, tạo & xác minh mã TOTP 6 số và Recovery Codes', () => {
    const secret = totpService.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    const uri = totpService.buildOtpAuthUri({
      secret,
      accountName: 'admin@core.local',
      issuer: 'CoreApp',
    });
    expect(uri).toContain('otpauth://totp/CoreApp:admin%40core.local');
    expect(uri).toContain(`secret=${secret}`);

    const fixedTimestamp = 1_760_000_000_000;
    const code = totpService.generateCode(secret, fixedTimestamp);
    expect(code).toMatch(/^\d{6}$/);

    // Khớp tại đúng thời điểm và trong cửa sổ ±1 bước (30s)
    expect(totpService.verifyCode(secret, code, { timestampMs: fixedTimestamp })).toBe(true);
    expect(totpService.verifyCode(secret, code, { timestampMs: fixedTimestamp + 25_000 })).toBe(
      true,
    );
    // Quá cửa sổ thời gian (cách 5 phút) -> từ chối
    expect(totpService.verifyCode(secret, code, { timestampMs: fixedTimestamp + 300_000 })).toBe(
      false,
    );
    expect(totpService.verifyCode(secret, '000000', { timestampMs: fixedTimestamp })).toBe(false);

    const recoveryCodes = totpService.generateRecoveryCodes(8);
    expect(recoveryCodes).toHaveLength(8);
    for (const rc of recoveryCodes) {
      expect(rc).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });

  it('TokenService: ký và xác thực Access Token, Refresh Token, MFA Challenge Token và IUserIdentityResolver', async () => {
    applyTestEnv({
      JWT_ACCESS_SECRET: 'test-access-secret-key-2026',
      JWT_REFRESH_SECRET: 'test-refresh-secret-key-2026',
      JWT_ACCESS_EXPIRATION: '15m',
      JWT_REFRESH_EXPIRATION: '7d',
    });

    expect(parseDurationSeconds('15m', 60)).toBe(900);
    expect(parseDurationSeconds('2h', 60)).toBe(7200);
    expect(parseDurationSeconds('7d', 60)).toBe(604_800);

    const config = new CoreConfigService();
    const resolver: IUserIdentityResolver = {
      resolveIdentity: async (payload) => ({
        id: payload.sub,
        email: 'resolved@core.local',
        ...(payload.sid ? { sessionId: payload.sid } : {}),
        roles: ['admin'],
        permissions: ['users.read', 'users.manage'],
      }),
    };

    const tokenService = new TokenService(config, undefined, resolver);

    const accessToken = await tokenService.signAccessToken({
      sub: 'user-123',
      sid: 'sess-456',
      roles: ['admin'],
    });

    const verifiedAccess = await tokenService.verify(accessToken);
    expect(verifiedAccess).not.toBeNull();
    expect(verifiedAccess?.sub).toBe('user-123');
    expect(verifiedAccess?.sid).toBe('sess-456');
    expect(verifiedAccess?.type).toBe('access');

    // Token bị sửa chữ ký -> từ chối
    expect(await tokenService.verify(`${accessToken}tampered`)).toBeNull();

    // Refresh token không được chấp nhận như Access token
    const refreshToken = await tokenService.signRefreshToken({
      sub: 'user-123',
      sid: 'sess-456',
    });
    expect(await tokenService.verify(refreshToken)).toBeNull();
    const verifiedRefresh = await tokenService.verifyRefreshToken(refreshToken);
    expect(verifiedRefresh?.sub).toBe('user-123');
    expect(verifiedRefresh?.sid).toBe('sess-456');

    // MFA Challenge token
    const mfaToken = await tokenService.signMfaChallengeToken({
      sub: 'user-123',
      methods: ['TOTP', 'EMAIL_OTP'],
    });
    expect(await tokenService.verify(mfaToken)).toBeNull();
    const verifiedMfa = await tokenService.verifyMfaChallengeToken(mfaToken);
    expect(verifiedMfa?.sub).toBe('user-123');

    // Validate user qua IUserIdentityResolver
    const identity = await tokenService.validateUser(verifiedAccess!);
    expect(identity?.email).toBe('resolved@core.local');
    expect(identity?.permissions).toContain('users.manage');
  });
});
