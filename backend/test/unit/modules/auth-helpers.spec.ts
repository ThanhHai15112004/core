import {
  ensureScopesWithinAllowed,
  extractDeviceNameFromUserAgent,
  filterActiveTrustedDevices,
  inferTrustedDeviceName,
  ipv4ToUint32,
  isCallerIpAllowed,
  matchIpv4Cidr,
  MfaChallengeAttemptTracker,
  normalizeAllowedIpList,
  normalizeCallerIp,
  normalizeRecoveryCode,
  normalizeScopesList,
  parseApiClientUsageLogs,
  parseExtendedMfaEnvelope,
  serializeExtendedMfaEnvelope,
  toTrustedDeviceResponse,
} from '../../../src/modules/auth/index.js';

describe('Auth Module Helpers Unit Tests', () => {
  describe('auth-device.helper', () => {
    it('extracts device names accurately from User-Agent strings', () => {
      expect(extractDeviceNameFromUserAgent(null)).toBe('Unknown Device');
      expect(extractDeviceNameFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(
        'iOS Device',
      );
      expect(extractDeviceNameFromUserAgent('Mozilla/5.0 (Linux; Android 14)')).toBe(
        'Android Device',
      );
      expect(extractDeviceNameFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe(
        'Mac',
      );
      expect(extractDeviceNameFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
        'Windows PC',
      );
      expect(extractDeviceNameFromUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
      expect(extractDeviceNameFromUserAgent('CustomAgent/1.0')).toBe('Web Browser');
    });

    it('infers trusted device names accurately from User-Agent strings', () => {
      expect(inferTrustedDeviceName(undefined)).toBe('Trusted Device');
      expect(inferTrustedDeviceName('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('iOS Trusted Device');
      expect(inferTrustedDeviceName('Mozilla/5.0 (Windows NT 10.0)')).toBe(
        'Windows Trusted Browser',
      );
    });
  });

  describe('mfa-envelope.helper', () => {
    it('parses and serializes legacy array and extended MFA envelopes', () => {
      expect(parseExtendedMfaEnvelope(null)).toEqual({ codes: [] });
      expect(parseExtendedMfaEnvelope('["hash1","hash2"]')).toEqual({
        codes: ['hash1', 'hash2'],
      });
      expect(serializeExtendedMfaEnvelope({ codes: ['hash1', 'hash2'] })).toBe('["hash1","hash2"]');

      const extended = {
        codes: ['h1'],
        smsOtpEnabled: true,
        trustedDevices: [
          {
            deviceId: 'dev-1',
            tokenHash: 'th-1',
            deviceName: 'Mac Trusted Browser',
            ipAddress: '127.0.0.1',
            userAgent: 'Mac',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-01T00:00:00.000Z',
            trustedUntil: '2099-01-01T00:00:00.000Z',
          },
        ],
      };
      const serialized = serializeExtendedMfaEnvelope(extended);
      const reparsed = parseExtendedMfaEnvelope(serialized);
      expect(reparsed.smsOtpEnabled).toBe(true);
      expect(reparsed.trustedDevices).toHaveLength(1);
      expect(filterActiveTrustedDevices(reparsed.trustedDevices ?? [])).toHaveLength(1);
      expect(toTrustedDeviceResponse(extended.trustedDevices[0]!)).toEqual({
        deviceId: 'dev-1',
        deviceName: 'Mac Trusted Browser',
        ipAddress: '127.0.0.1',
        userAgent: 'Mac',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: '2026-01-01T00:00:00.000Z',
        trustedUntil: '2099-01-01T00:00:00.000Z',
      });
    });

    it('normalizes recovery codes by stripping hyphens and uppercasing', () => {
      expect(normalizeRecoveryCode(' abcd-1234-efgh ')).toBe('ABCD1234EFGH');
    });
  });

  describe('api-client-security.helper', () => {
    it('validates IPv4 exact, wildcard, and CIDR rules', () => {
      expect(normalizeCallerIp('::ffff:192.168.1.25')).toBe('192.168.1.25');
      expect(ipv4ToUint32('127.0.0.1')).toBe(2130706433);
      expect(matchIpv4Cidr('10.20.30.45', '10.20.30.0/24')).toBe(true);
      expect(matchIpv4Cidr('10.20.31.45', '10.20.30.0/24')).toBe(false);

      expect(isCallerIpAllowed('10.10.1.99', ['10.10.1.*'])).toBe(true);
      expect(isCallerIpAllowed('10.10.2.99', ['10.10.1.*'])).toBe(false);
      expect(isCallerIpAllowed('::ffff:172.16.5.10', ['172.16.0.0/16'])).toBe(true);
    });

    it('normalizes scopes, IPs, and enforces scope boundaries', () => {
      expect(normalizeScopesList([' users.read ', 'users.read', 'files.read'])).toEqual([
        'users.read',
        'files.read',
      ]);
      expect(normalizeAllowedIpList(['::ffff:10.0.0.1', '10.0.0.1'])).toEqual(['10.0.0.1']);
      expect(() =>
        ensureScopesWithinAllowed(['users.read', 'roles.write'], ['users.read']),
      ).toThrow();
      expect(parseApiClientUsageLogs('invalid')).toEqual([]);
    });
  });

  describe('mfa-challenge-attempt.helper', () => {
    it('tracks and clears challenge attempts in L1 memory store', async () => {
      const tracker = new MfaChallengeAttemptTracker(() => null);
      expect(await tracker.getAttempts('ch-1')).toBe(0);
      expect(await tracker.incrementAttempts('ch-1', 0)).toBe(1);
      expect(await tracker.getAttempts('ch-1')).toBe(1);
      await tracker.clearAttempts('ch-1');
      expect(await tracker.getAttempts('ch-1')).toBe(0);
    });
  });
});
