import { describe, expect, it } from '@jest/globals';
import {
  MAX_RAW_BODY_CAPTURE_BYTES,
  configureFastifyEmptyJsonBodyParser,
} from '@packages/http/index.js';
import {
  INBOUND_WEBHOOK_AUTH_TYPE,
  INBOUND_WEBHOOK_REJECTION_REASON,
  INBOUND_WEBHOOK_SIGNATURE_FORMAT,
} from '../../../src/modules/inbound-webhooks/enum/inbound-webhooks.enum.js';
import {
  extractEventType,
  extractExternalEventId,
  extractNestedString,
  normalizeAndValidateHeaderName,
  normalizeIncomingHeaders,
} from '../../../src/modules/inbound-webhooks/helpers/inbound-webhook-extractor.helper.js';
import {
  redactAndSerializeInboundPayload,
  redactInboundHeaders,
} from '../../../src/modules/inbound-webhooks/helpers/inbound-webhook-redaction.helper.js';
import {
  computeInboundHmacSignature,
  generateInboundWebhookSecret,
  maskInboundWebhookSecret,
  parseInboundWebhookTimestamp,
  validateInboundWebhookTimestamp,
  verifyInboundWebhookAuth,
} from '../../../src/modules/inbound-webhooks/helpers/inbound-webhook-signature.helper.js';

describe('Phase 10.3 — Inbound Webhooks Security, Signature, Replay & Redaction', () => {
  describe('Secret generation, HMAC & Static Token verification', () => {
    it('generates whin_ secret and masks prefix safely', () => {
      const secret = generateInboundWebhookSecret();
      expect(secret.startsWith('whin_')).toBe(true);
      expect(secret.length).toBe(69);
      const masked = maskInboundWebhookSecret(secret);
      expect(masked).toContain('••••••••');
      expect(masked.length).toBeLessThan(20);
    });

    it('verifies HMAC-SHA256 TIMESTAMP_DOT_BODY and rejects tampered body or wrong secret', () => {
      const secret = generateInboundWebhookSecret();
      const rawBody = '{"id":"evt_1","type":"payment.paid","amount":1000}';
      const ts = 1_760_000_000;
      const sig = computeInboundHmacSignature({
        rawBody,
        secret,
        algorithm: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
        format: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
        timestampSec: ts,
        prefix: 'v1=',
      });

      expect(
        verifyInboundWebhookAuth({
          authType: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
          rawBody,
          secret,
          signatureHeaderName: 'x-webhook-signature',
          signatureHeaderValue: sig,
          signaturePrefix: 'v1=',
          signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
          timestampSec: ts,
        }),
      ).toEqual({ valid: true, reason: null });

      expect(
        verifyInboundWebhookAuth({
          authType: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
          rawBody: `${rawBody} `,
          secret,
          signatureHeaderName: 'x-webhook-signature',
          signatureHeaderValue: sig,
          signaturePrefix: 'v1=',
          signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
          timestampSec: ts,
        }),
      ).toEqual({ valid: false, reason: INBOUND_WEBHOOK_REJECTION_REASON.INVALID_SIGNATURE });

      expect(
        verifyInboundWebhookAuth({
          authType: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
          rawBody,
          secret: 'wrong-secret',
          signatureHeaderName: 'x-webhook-signature',
          signatureHeaderValue: sig,
          signaturePrefix: 'v1=',
          signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
          timestampSec: ts,
        }),
      ).toEqual({ valid: false, reason: INBOUND_WEBHOOK_REJECTION_REASON.INVALID_SIGNATURE });
    });

    it('verifies HMAC-SHA512 RAW_BODY and Stripe-style t=...,v1=... signature header', () => {
      const secret = 'whsec_test_512_key';
      const rawBody = '{"event":"order.completed"}';
      const sig512 = computeInboundHmacSignature({
        rawBody,
        secret,
        algorithm: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA512,
        format: INBOUND_WEBHOOK_SIGNATURE_FORMAT.RAW_BODY,
        prefix: 'sha512=',
      });

      expect(
        verifyInboundWebhookAuth({
          authType: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA512,
          rawBody,
          secret,
          signatureHeaderName: 'x-hub-signature-512',
          signatureHeaderValue: sig512,
          signaturePrefix: 'sha512=',
          signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.RAW_BODY,
        }),
      ).toEqual({ valid: true, reason: null });

      const ts = 1_760_000_123;
      const stripeSig = computeInboundHmacSignature({
        rawBody,
        secret,
        algorithm: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
        format: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
        timestampSec: ts,
        prefix: '',
      });
      expect(
        verifyInboundWebhookAuth({
          authType: INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
          rawBody,
          secret,
          signatureHeaderName: 'stripe-signature',
          signatureHeaderValue: `t=${ts},v1=${stripeSig}`,
          signaturePrefix: 'v1=',
          signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
          timestampSec: ts,
        }),
      ).toEqual({ valid: true, reason: null });
    });

    it('verifies STATIC_TOKEN for both Bearer Authorization and custom token header', () => {
      const token = 'super-static-webhook-token-123';

      expect(
        verifyInboundWebhookAuth({
          authType: INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN,
          rawBody: '{}',
          secret: token,
          signatureHeaderName: 'authorization',
          signatureHeaderValue: `Bearer ${token}`,
          signaturePrefix: null,
          signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.RAW_BODY,
        }),
      ).toEqual({ valid: true, reason: null });

      expect(
        verifyInboundWebhookAuth({
          authType: INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN,
          rawBody: '{}',
          secret: token,
          signatureHeaderName: 'x-api-token',
          signatureHeaderValue: `Apikey ${token}`,
          signaturePrefix: 'Apikey ',
          signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.RAW_BODY,
        }),
      ).toEqual({ valid: true, reason: null });

      expect(
        verifyInboundWebhookAuth({
          authType: INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN,
          rawBody: '{}',
          secret: token,
          signatureHeaderName: 'x-api-token',
          signatureHeaderValue: 'Apikey wrong-token',
          signaturePrefix: 'Apikey ',
          signatureFormat: INBOUND_WEBHOOK_SIGNATURE_FORMAT.RAW_BODY,
        }),
      ).toEqual({ valid: false, reason: INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TOKEN });
    });
  });

  describe('Timestamp parsing & anti-replay tolerance checks', () => {
    it('parses unix seconds, unix milliseconds, and ISO-8601 strings', () => {
      expect(parseInboundWebhookTimestamp('1760000000')).toBe(1_760_000_000);
      expect(parseInboundWebhookTimestamp(1_760_000_000_123)).toBe(1_760_000_000);
      expect(parseInboundWebhookTimestamp('2026-01-01T00:00:00.000Z')).toBe(
        Math.trunc(Date.parse('2026-01-01T00:00:00.000Z') / 1000),
      );
      expect(parseInboundWebhookTimestamp('not-a-timestamp')).toBeNull();
      expect(parseInboundWebhookTimestamp('')).toBeNull();
    });

    it('rejects missing, invalid, expired, and far-future timestamps', () => {
      const nowSec = 1_760_000_000;

      expect(
        validateInboundWebhookTimestamp({
          rawTimestamp: undefined,
          toleranceSec: 300,
          nowSec,
          required: true,
        }),
      ).toEqual({
        valid: false,
        timestampSec: null,
        reason: INBOUND_WEBHOOK_REJECTION_REASON.MISSING_TIMESTAMP,
      });

      expect(
        validateInboundWebhookTimestamp({
          rawTimestamp: 'invalid-ts',
          toleranceSec: 300,
          nowSec,
          required: true,
        }),
      ).toEqual({
        valid: false,
        timestampSec: null,
        reason: INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TIMESTAMP,
      });

      expect(
        validateInboundWebhookTimestamp({
          rawTimestamp: nowSec - 301,
          toleranceSec: 300,
          nowSec,
          required: true,
        }),
      ).toEqual({
        valid: false,
        timestampSec: nowSec - 301,
        reason: INBOUND_WEBHOOK_REJECTION_REASON.TIMESTAMP_EXPIRED,
      });

      expect(
        validateInboundWebhookTimestamp({
          rawTimestamp: nowSec + 301,
          toleranceSec: 300,
          nowSec,
          required: true,
        }),
      ).toEqual({
        valid: false,
        timestampSec: nowSec + 301,
        reason: INBOUND_WEBHOOK_REJECTION_REASON.TIMESTAMP_EXPIRED,
      });

      expect(
        validateInboundWebhookTimestamp({
          rawTimestamp: nowSec - 299,
          toleranceSec: 300,
          nowSec,
          required: true,
        }),
      ).toEqual({
        valid: true,
        timestampSec: nowSec - 299,
        reason: null,
      });
    });
  });

  describe('Header & payload extraction + prototype pollution guard', () => {
    it('prioritizes headers and falls back to nested payload path safely', () => {
      const headers = normalizeIncomingHeaders({
        'X-Webhook-Id': ['evt_hdr_1'],
        'Content-Type': 'application/json',
      });
      const payload = { id: 'evt_body_2', data: { object: { id: 'ch_123' } }, type: 'charge.paid' };

      expect(
        extractExternalEventId(headers, payload, {
          eventIdHeader: 'x-webhook-id',
          eventIdPayloadPath: 'id',
        }),
      ).toBe('evt_hdr_1');

      expect(
        extractExternalEventId({}, payload, {
          eventIdHeader: 'x-webhook-id',
          eventIdPayloadPath: 'data.object.id',
        }),
      ).toBe('ch_123');

      expect(
        extractEventType({}, payload, {
          eventTypeHeader: 'x-webhook-event',
          eventTypePayloadPath: 'type',
        }),
      ).toBe('charge.paid');

      expect(extractNestedString(payload, '__proto__.polluted')).toBeNull();
      expect(extractNestedString(payload, 'constructor.prototype')).toBeNull();
      expect(() => normalizeAndValidateHeaderName('x-valid-header')).not.toThrow();
      expect(() => normalizeAndValidateHeaderName('bad\nheader')).toThrow();
    });
  });

  describe('Redaction & Fastify rawBody capture', () => {
    it('redacts sensitive headers, secret keys, custom provider fields, and optional PII', () => {
      const headers = redactInboundHeaders(
        {
          authorization: 'Bearer abc',
          'x-custom-sig': 'v1=secret',
          'x-webhook-id': 'evt_1',
          'content-type': 'application/json',
        },
        ['x-custom-sig'],
      );
      expect(headers['authorization']).toBe('••••••••');
      expect(headers['x-custom-sig']).toBe('••••••••');
      expect(headers['x-webhook-id']).toBe('evt_1');

      const samplePayload = {
        id: 'evt_1',
        apiKey: 'sk_live_999',
        customer: {
          email: 'alice@example.com',
          phone: '0912345678',
          taxCode: 'TAX-SECRET-1',
        },
        payment: {
          creditCard: '4111111111111111',
          cvv: '999',
          amount: 250000,
        },
      };

      const defaultRedacted = redactAndSerializeInboundPayload(samplePayload, {
        extraSensitiveFields: ['customer.taxCode'],
        maskPiiInPayload: false,
        maxStoredPayloadBytes: 65_536,
      });
      expect(defaultRedacted.truncated).toBe(false);
      const parsedDefault = JSON.parse(defaultRedacted.json) as typeof samplePayload;
      expect(parsedDefault.apiKey).toBe('[REDACTED]');
      expect(parsedDefault.customer.taxCode).toBe('[REDACTED]');
      expect(parsedDefault.payment.creditCard).toBe('[REDACTED]');
      expect(parsedDefault.payment.cvv).toBe('[REDACTED]');
      expect(parsedDefault.payment.amount).toBe(250000);
      expect(parsedDefault.customer.email).toBe('alice@example.com');
      expect(parsedDefault.customer.phone).toBe('0912345678');

      const piiMasked = redactAndSerializeInboundPayload(samplePayload, {
        extraSensitiveFields: ['customer.taxCode'],
        maskPiiInPayload: true,
        maxStoredPayloadBytes: 65_536,
      });
      const parsedPii = JSON.parse(piiMasked.json) as typeof samplePayload;
      expect(parsedPii.customer.email).toBe('al***@example.com');
      expect(parsedPii.customer.phone).toBe('091****678');

      const oversized = redactAndSerializeInboundPayload(
        { blob: 'x'.repeat(5000) },
        { maxStoredPayloadBytes: 1024 },
      );
      expect(oversized.truncated).toBe(true);
      expect(Buffer.byteLength(oversized.json, 'utf8')).toBeLessThanOrEqual(1024);
      const parsedSummary = JSON.parse(oversized.json) as {
        _truncated: boolean;
        originalBytes: number;
      };
      expect(parsedSummary._truncated).toBe(true);
      expect(parsedSummary.originalBytes).toBeGreaterThan(5000);
    });

    it('captures exact rawBody in Fastify application/json parser up to MAX_RAW_BODY_CAPTURE_BYTES', () => {
      const parsers = new Map<
        string,
        (
          req: { rawBody?: string },
          body: unknown,
          done: (err: Error | null, val?: unknown) => void,
        ) => void
      >();
      const fakeFastify = {
        removeContentTypeParser: (ct: string) => {
          parsers.delete(ct);
        },
        addContentTypeParser: (
          ct: string,
          _opts: unknown,
          fn: (
            req: { rawBody?: string },
            body: unknown,
            done: (err: Error | null, val?: unknown) => void,
          ) => void,
        ) => {
          parsers.set(ct, fn);
        },
      };

      configureFastifyEmptyJsonBodyParser(fakeFastify);
      const jsonParser = parsers.get('application/json');
      expect(jsonParser).toBeDefined();

      const reqSmall: { rawBody?: string } = {};
      const rawJsonWithWhitespace = '{\n  "id": "evt_raw",\n  "amount": 100\n}';
      let parsedOut: unknown = null;
      jsonParser!(reqSmall, rawJsonWithWhitespace, (err, val) => {
        expect(err).toBeNull();
        parsedOut = val;
      });
      expect(reqSmall.rawBody).toBe(rawJsonWithWhitespace);
      expect(parsedOut).toEqual({ id: 'evt_raw', amount: 100 });

      const reqLarge: { rawBody?: string } = {};
      const largeJson = JSON.stringify({ data: 'a'.repeat(MAX_RAW_BODY_CAPTURE_BYTES + 100) });
      jsonParser!(reqLarge, largeJson, (err) => {
        expect(err).toBeNull();
      });
      expect(reqLarge.rawBody).toBeUndefined();
    });
  });
});
