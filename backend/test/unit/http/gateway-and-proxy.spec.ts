import { describe, it, expect } from '@jest/globals';
import { gatewayConfig, type GatewayConfig } from '@packages/config/index.js';
import {
  buildFastifyTrustProxyOption,
  buildServiceRoutingTable,
  evaluateGatewayConsistency,
  isIpInCidr,
  normalizeIp,
  parseForwardedHeader,
  renderHaproxyServiceAcls,
  renderNginxServiceLocations,
  resolveClientIp,
  resolveForwardedContext,
  validateServiceRoutingTable,
  type ServiceRoutingEntry,
  type TrustedProxyPolicy,
} from '@packages/http/index.js';
import { PlatformSecurityService } from '@packages/security/index.js';

describe('Unit: Trusted Proxy, Gateway Consistency, Rate Limit Layering & Service Routing (13.5)', () => {
  describe('Trusted Proxy & Real IP Resolution', () => {
    const privatePolicy: TrustedProxyPolicy = {
      trustMode: 'private',
      trustedCidrs: ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
      maxHops: 2,
      ipHeaders: ['x-forwarded-for', 'forwarded', 'x-real-ip'],
      forwardedPrefixHeader: 'x-forwarded-prefix',
    };

    it('normalizes IPv4-mapped IPv6, bracketed IPv6 and ports', () => {
      expect(normalizeIp('::ffff:192.168.1.25')).toBe('192.168.1.25');
      expect(normalizeIp('203.0.113.10:54321')).toBe('203.0.113.10');
      expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
      expect(normalizeIp('_hidden')).toBeNull();
    });

    it('matches IPv4 and IPv6 CIDRs accurately', () => {
      expect(isIpInCidr('10.24.0.5', '10.0.0.0/8')).toBe(true);
      expect(isIpInCidr('172.17.0.1', '172.16.0.0/12')).toBe(true);
      expect(isIpInCidr('8.8.8.8', '10.0.0.0/8')).toBe(false);
      expect(isIpInCidr('::1', '::1/128')).toBe(true);
      expect(isIpInCidr('fe80::1', 'fe80::/10')).toBe(true);
    });

    it('rejects spoofed X-Forwarded-For when direct peer is untrusted', () => {
      const ctx = resolveForwardedContext(
        {
          socket: { remoteAddress: '198.51.100.44' },
          headers: {
            'x-forwarded-for': '127.0.0.1, 8.8.8.8',
            'x-forwarded-proto': 'https',
            'x-forwarded-prefix': '/admin',
          },
          protocol: 'http',
        },
        privatePolicy,
      );

      expect(ctx.trustedProxy).toBe(false);
      expect(ctx.clientIp).toBe('198.51.100.44');
      expect(ctx.protocol).toBe('http');
      expect(ctx.prefix).toBeNull();
    });

    it('peels X-Forwarded-For right-to-left up to maxHops to defeat left-side spoofing', () => {
      const clientIp = resolveClientIp(
        {
          socket: { remoteAddress: '10.0.0.5' },
          headers: {
            // Attacker injected 1.2.3.4 on the left; real client is 203.0.113.77; internal proxy is 172.16.0.10
            'x-forwarded-for': '1.2.3.4, 203.0.113.77, 172.16.0.10',
          },
        },
        privatePolicy,
      );

      expect(clientIp).toBe('203.0.113.77');
    });

    it('supports RFC 7239 Forwarded header, X-Real-IP fallback and X-Forwarded-* metadata', () => {
      const parsed = parseForwardedHeader('for="[2001:db8::5]:1234";proto=https;host=api.core.dev');
      expect(parsed).toEqual({
        forList: ['2001:db8::5'],
        proto: 'https',
        host: 'api.core.dev',
      });

      const ctx = resolveForwardedContext(
        {
          socket: { remoteAddress: '127.0.0.1' },
          headers: {
            forwarded: 'for=198.51.100.99;proto=https;host=gateway.example.com',
            'x-forwarded-port': '443',
            'x-forwarded-prefix': '/edge/v1/',
          },
        },
        privatePolicy,
      );
      expect(ctx.trustedProxy).toBe(true);
      expect(ctx.clientIp).toBe('198.51.100.99');
      expect(ctx.protocol).toBe('https');
      expect(ctx.host).toBe('gateway.example.com');
      expect(ctx.port).toBe('443');
      expect(ctx.prefix).toBe('/edge/v1');

      const realIpOnly = resolveClientIp(
        {
          socket: { remoteAddress: '::ffff:127.0.0.1' },
          headers: { 'x-real-ip': '203.0.113.9' },
        },
        privatePolicy,
      );
      expect(realIpOnly).toBe('203.0.113.9');
    });

    it('rejects path traversal in X-Forwarded-Prefix and builds Fastify trustProxy option', () => {
      const ctx = resolveForwardedContext(
        {
          socket: { remoteAddress: '127.0.0.1' },
          headers: { 'x-forwarded-prefix': '/api/../secret' },
        },
        privatePolicy,
      );
      expect(ctx.prefix).toBeNull();

      expect(buildFastifyTrustProxyOption({ ...privatePolicy, trustMode: 'off' })).toBe(false);
      expect(
        buildFastifyTrustProxyOption({ ...privatePolicy, trustMode: 'hops', maxHops: 2 }),
      ).toBe(2);
      const fn = buildFastifyTrustProxyOption(privatePolicy);
      expect(typeof fn).toBe('function');
      if (typeof fn === 'function') {
        expect(fn('10.1.2.3', 1)).toBe(true);
        expect(fn('10.1.2.3', 3)).toBe(false);
        expect(fn('8.8.4.4', 1)).toBe(false);
      }
    });
  });

  describe('Gateway & LB Consistency Evaluation', () => {
    it('passes default aligned configuration', () => {
      const cfg = gatewayConfig();
      const report = evaluateGatewayConsistency(cfg, 'development', 'api/v1');
      expect(report.status).toBe('ok');
      expect(report.checks.every((c) => c.status === 'pass')).toBe(true);
    });

    it('detects keepAlive 502 race, headersTimeout race, LB readTimeout conflict, body mismatch and wildcard CIDR', () => {
      const base = gatewayConfig();
      const broken: GatewayConfig = {
        ...base,
        proxy: {
          ...base.proxy,
          trustMode: 'cidr',
          trustedCidrs: ['0.0.0.0/0'],
        },
        timeouts: {
          ...base.timeouts,
          lbKeepAliveTimeoutMs: 60_000,
          apiKeepAliveTimeoutMs: 5_000,
          apiHeadersTimeoutMs: 4_000,
          lbReadTimeoutMs: 15_000,
          apiRequestTimeoutMs: 30_000,
        },
        bodyLimits: {
          ...base.bodyLimits,
          gatewayMaxBodySizeBytes: 10 * 1024 * 1024,
          apiMaxBodySizeBytes: 32 * 1024 * 1024,
        },
        rateLimit: {
          ...base.rateLimit,
          layerMode: 'edge-ip-backend-business',
          skipBackendIpWhenEdgeApplied: false,
        },
      };

      const report = evaluateGatewayConsistency(broken, 'production', 'api/v1');
      expect(report.status).toBe('fail');
      const byId = new Map(report.checks.map((c) => [c.id, c]));
      expect(byId.get('keepalive_alignment')?.status).toBe('fail');
      expect(byId.get('headers_timeout_alignment')?.status).toBe('fail');
      expect(byId.get('read_timeout_alignment')?.status).toBe('fail');
      expect(byId.get('body_limit_alignment')?.status).toBe('warn');
      expect(byId.get('trusted_proxy_safety')?.status).toBe('fail');
      expect(byId.get('rate_limit_layering')?.status).toBe('warn');
    });
  });

  describe('Rate Limit Layering (Gateway Edge vs Backend Business)', () => {
    it('skips IP bucket when skipIpCheck=true while enforcing USER and API buckets', () => {
      const sec = new PlatformSecurityService();
      sec.setDefaultRateLimitRule({
        routePattern: '*',
        windowSeconds: 60,
        maxRequestsPerIp: 1,
        maxRequestsPerUser: 2,
        maxRequestsPerApi: 5,
      });

      // With skipIpCheck=true (edge gateway already handled IP), 2nd call from same IP succeeds for user 101
      const first = sec.checkRateLimit({
        ipAddress: '203.0.113.10',
        userId: 101,
        method: 'GET',
        url: '/api/v1/users',
        skipIpCheck: true,
      });
      const second = sec.checkRateLimit({
        ipAddress: '203.0.113.10',
        userId: 101,
        method: 'GET',
        url: '/api/v1/users',
        skipIpCheck: true,
      });
      const third = sec.checkRateLimit({
        ipAddress: '203.0.113.10',
        userId: 101,
        method: 'GET',
        url: '/api/v1/users',
        skipIpCheck: true,
      });

      expect(first.allowed).toBe(true);
      expect(first.scope).toBe('USER_API');
      expect(second.allowed).toBe(true);
      expect(third.allowed).toBe(false);
      expect(third.violatedDimension).toBe('USER');

      // Without skipIpCheck, IP limit=1 triggers on 2nd request from a fresh IP
      const ipFirst = sec.checkRateLimit({
        ipAddress: '203.0.113.20',
        userId: 202,
        method: 'POST',
        url: '/api/v1/auth/login',
        skipIpCheck: false,
      });
      const ipSecond = sec.checkRateLimit({
        ipAddress: '203.0.113.20',
        userId: 203,
        method: 'POST',
        url: '/api/v1/auth/login',
        skipIpCheck: false,
      });
      expect(ipFirst.allowed).toBe(true);
      expect(ipFirst.scope).toBe('IP_USER_API');
      expect(ipSecond.allowed).toBe(false);
      expect(ipSecond.violatedDimension).toBe('IP');
    });
  });

  describe('Service Extraction Routing Catalog', () => {
    it('builds valid collision-free routing table, supports overrides and renders Nginx/HAProxy configs', () => {
      const table = buildServiceRoutingTable('api/v1', 'identity=http://identity-svc:3010');
      const validation = validateServiceRoutingTable(table);
      expect(validation.valid).toBe(true);
      expect(validation.collisions).toEqual([]);

      const identity = table.find((d) => d.domain === 'identity');
      expect(identity?.upstreamDefault).toBe('http://identity-svc:3010');
      expect(identity?.prefixes).toContain('/api/v1/auth');
      expect(identity?.stripPrefix).toBe(false);

      const nginxSnippet = renderNginxServiceLocations(table.slice(0, 2));
      expect(nginxSnippet).toContain('proxy_pass http://identity-svc:3010;');

      const haproxySnippet = renderHaproxyServiceAcls(table.slice(0, 2));
      expect(haproxySnippet).toContain('acl is_identity path_beg');
    });

    it('detects prefix ownership collisions', () => {
      const colliding: ServiceRoutingEntry[] = [
        {
          domain: 'a',
          serviceName: 'a-svc',
          upstreamDefault: 'http://a:3001',
          prefixes: ['/api/v1/users'],
          stripPrefix: false,
          stability: 'v1-stable',
          description: 'A',
        },
        {
          domain: 'b',
          serviceName: 'b-svc',
          upstreamDefault: 'http://b:3002',
          prefixes: ['/api/v1/users'],
          stripPrefix: false,
          stability: 'v1-stable',
          description: 'B',
        },
      ];
      const res = validateServiceRoutingTable(colliding);
      expect(res.valid).toBe(false);
      expect(res.collisions).toEqual([{ prefix: '/api/v1/users', domains: ['a', 'b'] }]);
    });
  });
});
