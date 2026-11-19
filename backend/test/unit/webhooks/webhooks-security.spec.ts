import { describe, expect, it } from '@jest/globals';
import { BadRequestAppException } from '@packages/kernel/index.js';
import {
  assertWebhookUrlSafe,
  isBlockedIpAddress,
  validateWebhookUrlSsrf,
  type WebhookDnsLookupFn,
} from '../../../src/modules/webhooks/helpers/webhook-ssrf.helper.js';
import {
  generateWebhookSigningSecret,
  maskWebhookSigningSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../../../src/modules/webhooks/helpers/webhook-signature.helper.js';
import {
  collectWebhookEventCatalog,
  isValidWebhookEventPattern,
  matchesWebhookEvent,
} from '../../../src/modules/webhooks/helpers/webhook-event-matcher.helper.js';
import {
  normalizeAndValidateCustomHeaders,
  redactWebhookHeaders,
  sanitizeWebhookResponseSnippet,
} from '../../../src/modules/webhooks/helpers/webhook-redaction.helper.js';

const publicDnsLookup: WebhookDnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

describe('Phase 10.2 — Webhooks Security, SSRF, Signing & Matching', () => {
  describe('SSRF URL & IP Protection', () => {
    it('blocks non-https URLs by default and allows http only when allowHttpInDev=true with public IP', async () => {
      const httpDefault = await validateWebhookUrlSsrf('http://hooks.partner.com/events', {
        dnsLookup: publicDnsLookup,
      });
      expect(httpDefault.safe).toBe(false);

      const ftpBlocked = await validateWebhookUrlSsrf('ftp://hooks.partner.com/events', {
        allowHttpInDev: true,
        dnsLookup: publicDnsLookup,
      });
      expect(ftpBlocked.safe).toBe(false);

      const httpDev = await validateWebhookUrlSsrf('http://hooks.partner.com/events', {
        allowHttpInDev: true,
        dnsLookup: publicDnsLookup,
      });
      expect(httpDev.safe).toBe(true);

      // Even in dev mode, localhost and loopback IPs remain strictly blocked
      const localhostDev = await validateWebhookUrlSsrf('http://localhost:8080/hook', {
        allowHttpInDev: true,
      });
      expect(localhostDev.safe).toBe(false);
    });

    it('blocks embedded credentials, internal hostnames, and single-label service names', async () => {
      const urls = [
        'https://user:secret@hooks.partner.com/events',
        'https://localhost/webhook',
        'https://LOCALHOST./webhook',
        'https://service.local/webhook',
        'https://internal-api.internal/webhook',
        'https://metadata.google.internal/computeMetadata/v1/',
        'https://host.docker.internal:3000/hook',
        'https://redis/hook',
      ];

      for (const target of urls) {
        const res = await validateWebhookUrlSsrf(target, { dnsLookup: publicDnsLookup });
        expect(res.safe).toBe(false);
      }
    });

    it('blocks private IPv4, loopback, link-local metadata, CGNAT, and IPv6/mapped/NAT64 ranges', async () => {
      const blockedIps = [
        '127.0.0.1',
        '127.12.34.56',
        '10.0.0.1',
        '172.16.0.1',
        '172.31.255.254',
        '192.168.1.10',
        '169.254.169.254',
        '100.64.0.5',
        '0.0.0.0',
        '224.0.0.1',
        '::1',
        '::',
        'fc00::1',
        'fd12:3456:789a::1',
        'fe80::1',
        'ff02::1',
        '::ffff:127.0.0.1',
        '::ffff:169.254.169.254',
        '::ffff:7f00:1',
        '64:ff9b::10.0.0.1',
      ];

      for (const ip of blockedIps) {
        expect(isBlockedIpAddress(ip).blocked).toBe(true);
      }

      const publicIps = [
        '93.184.216.34',
        '8.8.8.8',
        '172.32.0.1',
        '2606:2800:220:1:248:1893:25c8:1946',
      ];
      for (const ip of publicIps) {
        expect(isBlockedIpAddress(ip).blocked).toBe(false);
      }
    });

    it('blocks DNS rebinding / domains resolving to private IP or mixed public+private IPs', async () => {
      const mixedLookup: WebhookDnsLookupFn = async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.10.0.5', family: 4 },
      ];
      const res = await validateWebhookUrlSsrf('https://rebind.attacker.com/hook', {
        dnsLookup: mixedLookup,
      });
      expect(res.safe).toBe(false);
      expect(res.reason).toContain('10.10.0.5');

      await expect(
        assertWebhookUrlSafe('https://rebind.attacker.com/hook', { dnsLookup: mixedLookup }),
      ).rejects.toBeInstanceOf(BadRequestAppException);
    });

    it('blocks when DNS lookup fails or returns empty', async () => {
      const failingLookup: WebhookDnsLookupFn = async () => {
        throw new Error('ENOTFOUND');
      };
      const failed = await validateWebhookUrlSsrf('https://missing.example.com/hook', {
        dnsLookup: failingLookup,
      });
      expect(failed.safe).toBe(false);

      const empty = await validateWebhookUrlSsrf('https://empty.example.com/hook', {
        dnsLookup: async () => [],
      });
      expect(empty.safe).toBe(false);
    });

    it('allows valid HTTPS URL resolving to public IPv4 and public IPv6', async () => {
      const res = await assertWebhookUrlSafe('https://hooks.partner.com/v1/events', {
        dnsLookup: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
        ],
      });
      expect(res).toBe('https://hooks.partner.com/v1/events');
    });
  });

  describe('HMAC-SHA256 Signing & Secret Masking', () => {
    it('generates prefixed secret, masks it safely, and verifies HMAC-SHA256 signatures with timestamp tolerance', () => {
      const secret = generateWebhookSigningSecret();
      expect(secret.startsWith('whsec_')).toBe(true);
      expect(secret.length).toBeGreaterThan(40);

      const masked = maskWebhookSigningSecret(secret);
      expect(masked).toMatch(/^whsec_[a-f0-9]{4}••••••••$/);
      expect(masked).not.toBe(secret);

      const body = JSON.stringify({ id: 'evt_1', event: 'user.created', data: { userId: 42 } });
      const ts = 1_760_000_000;
      const signed = signWebhookPayload(body, secret, ts);

      expect(signed.timestamp).toBe(ts);
      expect(signed.signature).toMatch(/^v1=[a-f0-9]{64}$/);

      expect(
        verifyWebhookSignature({
          rawBody: body,
          signatureHeader: signed.signature,
          timestampHeader: signed.timestamp,
          secret,
          toleranceSec: 300,
          nowSec: ts + 60,
        }),
      ).toBe(true);

      // Tampered payload
      expect(
        verifyWebhookSignature({
          rawBody: `${body} `,
          signatureHeader: signed.signature,
          timestampHeader: signed.timestamp,
          secret,
          toleranceSec: 300,
          nowSec: ts + 60,
        }),
      ).toBe(false);

      // Wrong secret
      expect(
        verifyWebhookSignature({
          rawBody: body,
          signatureHeader: signed.signature,
          timestampHeader: signed.timestamp,
          secret: 'whsec_wrong_secret',
          toleranceSec: 300,
          nowSec: ts + 60,
        }),
      ).toBe(false);

      // Expired timestamp outside tolerance window
      expect(
        verifyWebhookSignature({
          rawBody: body,
          signatureHeader: signed.signature,
          timestampHeader: signed.timestamp,
          secret,
          toleranceSec: 300,
          nowSec: ts + 301,
        }),
      ).toBe(false);
    });
  });

  describe('Event Matching, Catalog & Redaction', () => {
    it('validates and matches exact, prefix wildcard, and global wildcard patterns', () => {
      expect(isValidWebhookEventPattern('user.created')).toBe(true);
      expect(isValidWebhookEventPattern('payment.completed')).toBe(true);
      expect(isValidWebhookEventPattern('user.*')).toBe(true);
      expect(isValidWebhookEventPattern('*')).toBe(true);
      expect(isValidWebhookEventPattern('Invalid Event!')).toBe(false);

      expect(matchesWebhookEvent(['user.created', 'payment.completed'], 'user.created')).toBe(true);
      expect(matchesWebhookEvent(['user.created'], 'user.updated')).toBe(false);
      expect(matchesWebhookEvent(['user.*'], 'user.updated')).toBe(true);
      expect(matchesWebhookEvent(['user.*'], 'users.created')).toBe(false);
      expect(matchesWebhookEvent(['*'], 'payment.completed')).toBe(true);
    });

    it('collects declared events from module manifests', () => {
      const catalog = collectWebhookEventCatalog();
      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.some((c) => c.eventName === 'user.created' && c.module === 'users')).toBe(
        true,
      );
    });

    it('blocks forbidden custom headers and redacts sensitive headers and body snippets', () => {
      expect(() => normalizeAndValidateCustomHeaders({ 'X-Webhook-Signature': 'tamper' })).toThrow(
        BadRequestAppException,
      );
      expect(() => normalizeAndValidateCustomHeaders({ Host: 'evil.local' })).toThrow(
        BadRequestAppException,
      );

      const safeHeaders = normalizeAndValidateCustomHeaders({ 'X-Partner-Id': 'acme-01' });
      expect(safeHeaders).toEqual({ 'X-Partner-Id': 'acme-01' });

      const redacted = redactWebhookHeaders({
        'X-Partner-Id': 'acme-01',
        'X-Webhook-Signature': 'v1=abcdef',
        Authorization: 'Bearer secret-token',
      });
      expect(redacted['X-Partner-Id']).toBe('acme-01');
      expect(redacted['X-Webhook-Signature']).toBe('••••••••');
      expect(redacted['Authorization']).toBe('••••••••');

      const snippet = sanitizeWebhookResponseSnippet(
        '{"ok":false,"token":"supersecret","msg":"' + 'a'.repeat(100) + '"}',
        40,
      );
      expect(snippet).not.toContain('supersecret');
      expect(snippet).toContain('[truncated]');
    });
  });
});
