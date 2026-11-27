import type { ProxyTrustMode, TrustedProxyPolicy } from '@packages/kernel/index.js';
import { env } from './env.js';

export type RateLimitLayerMode = 'backend-only' | 'edge-ip-backend-business' | 'gateway-only';

const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};

const booleanOr = (key: string, fallback: boolean): boolean => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.boolean(key);
};

const csvList = (raw: string): string[] =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const VALID_TRUST_MODES = new Set<ProxyTrustMode>(['off', 'loopback', 'private', 'cidr', 'hops']);
const VALID_RATE_LIMIT_MODES = new Set<RateLimitLayerMode>([
  'backend-only',
  'edge-ip-backend-business',
  'gateway-only',
]);

const DEFAULT_PRIVATE_CIDRS = [
  '127.0.0.0/8',
  '::1/128',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
] as const;

const DEFAULT_LOOPBACK_CIDRS = ['127.0.0.0/8', '::1/128'] as const;

function parseTrustMode(nodeEnv: string): ProxyTrustMode {
  const raw = env('PROXY_TRUST_MODE', false).trim().toLowerCase() as ProxyTrustMode;
  if (raw && VALID_TRUST_MODES.has(raw)) {
    return raw;
  }
  return nodeEnv === 'production' ? 'private' : 'loopback';
}

function parseRateLimitLayerMode(nodeEnv: string): RateLimitLayerMode {
  const raw = env('RATE_LIMIT_LAYER_MODE', false).trim().toLowerCase() as RateLimitLayerMode;
  if (raw && VALID_RATE_LIMIT_MODES.has(raw)) {
    return raw;
  }
  return nodeEnv === 'production' ? 'edge-ip-backend-business' : 'backend-only';
}

/** Cấu hình đồng bộ Load Balancer, Reverse Proxy và API Gateway (Phase 13.5). */
export const gatewayConfig = () => {
  const nodeEnv = env('NODE_ENV', false) || 'development';
  const trustMode = parseTrustMode(nodeEnv);
  const rawCidrs = env('PROXY_TRUSTED_CIDRS', false);
  const parsedCidrs = csvList(rawCidrs);
  const trustedCidrs =
    parsedCidrs.length > 0
      ? parsedCidrs
      : trustMode === 'private'
        ? [...DEFAULT_PRIVATE_CIDRS]
        : trustMode === 'loopback'
          ? [...DEFAULT_LOOPBACK_CIDRS]
          : [];

  const rawIpHeaders = env('PROXY_TRUSTED_IP_HEADERS', false);
  const parsedIpHeaders = csvList(rawIpHeaders.toLowerCase());
  const ipHeaders =
    parsedIpHeaders.length > 0 ? parsedIpHeaders : ['x-forwarded-for', 'forwarded', 'x-real-ip'];

  const proxy: TrustedProxyPolicy = {
    trustMode,
    trustedCidrs,
    maxHops: Math.max(1, numberOr('PROXY_MAX_HOPS', 1)),
    ipHeaders,
    forwardedPrefixHeader:
      env('PROXY_FORWARDED_PREFIX_HEADER', false).trim().toLowerCase() || 'x-forwarded-prefix',
  };

  const apiKeepAliveTimeoutMs = Math.max(0, numberOr('API_KEEP_ALIVE_TIMEOUT_MS', 65_000));
  const apiHeadersTimeoutMs = Math.max(0, numberOr('API_HEADERS_TIMEOUT_MS', 70_000));

  const timeouts = {
    lbConnectTimeoutMs: Math.max(0, numberOr('LB_CONNECT_TIMEOUT_MS', 10_000)),
    lbSendTimeoutMs: Math.max(0, numberOr('LB_SEND_TIMEOUT_MS', 60_000)),
    lbReadTimeoutMs: Math.max(0, numberOr('LB_READ_TIMEOUT_MS', 60_000)),
    lbKeepAliveTimeoutMs: Math.max(0, numberOr('LB_KEEP_ALIVE_TIMEOUT_MS', 60_000)),
    apiConnectionTimeoutMs: Math.max(0, numberOr('API_CONNECTION_TIMEOUT_MS', 10_000)),
    apiRequestTimeoutMs: Math.max(0, numberOr('API_REQUEST_TIMEOUT_MS', 30_000)),
    apiKeepAliveTimeoutMs,
    apiHeadersTimeoutMs,
  };

  const apiMaxBodySizeBytes = Math.max(1024, numberOr('API_MAX_BODY_SIZE_BYTES', 32 * 1024 * 1024));
  const bodyLimits = {
    gatewayMaxBodySizeBytes: Math.max(
      1024,
      numberOr('GATEWAY_MAX_BODY_SIZE_BYTES', 32 * 1024 * 1024),
    ),
    apiMaxBodySizeBytes,
    apiJsonBodyLimitBytes: Math.max(1024, numberOr('API_JSON_BODY_LIMIT_BYTES', 16 * 1024 * 1024)),
    maxParamLength: Math.max(64, numberOr('API_MAX_PARAM_LENGTH', 1024)),
  };

  const rawSensitiveRoutes = env('RATE_LIMIT_SENSITIVE_IP_ROUTES', false);
  const parsedSensitiveRoutes = csvList(rawSensitiveRoutes);

  const rateLimit = {
    layerMode: parseRateLimitLayerMode(nodeEnv),
    gatewaySourceHeader:
      env('GATEWAY_RATE_LIMIT_HEADER', false).trim().toLowerCase() || 'x-ratelimit-source',
    gatewaySourceValue:
      env('GATEWAY_RATE_LIMIT_SOURCE_VALUE', false).trim().toLowerCase() || 'gateway',
    skipBackendIpWhenEdgeApplied: booleanOr('RATE_LIMIT_SKIP_BACKEND_IP_ON_EDGE', true),
    alwaysEnforceIpRoutes:
      parsedSensitiveRoutes.length > 0
        ? parsedSensitiveRoutes
        : [
            '/auth/login',
            '/auth/forgot-password',
            '/auth/reset-password',
            '/auth/otp',
            '/auth/mfa',
          ],
    gatewayEdgeRps: Math.max(1, numberOr('GATEWAY_RATE_LIMIT_RPS', 30)),
    gatewayEdgeBurst: Math.max(0, numberOr('GATEWAY_RATE_LIMIT_BURST', 50)),
  };

  const gateway = {
    vendor: env('GATEWAY_VENDOR', false).trim().toLowerCase() || 'generic',
    sharedSecretHeader: env('GATEWAY_SHARED_SECRET_HEADER', false).trim().toLowerCase(),
    sharedSecret: env('GATEWAY_SHARED_SECRET', false),
    serviceRoutingOverrides: env('GATEWAY_SERVICE_ROUTING_OVERRIDES', false),
    strictConsistencyCheck: booleanOr('GATEWAY_STRICT_CONSISTENCY_CHECK', false),
  };

  return {
    proxy,
    timeouts,
    bodyLimits,
    rateLimit,
    gateway,
  };
};

export type GatewayConfig = ReturnType<typeof gatewayConfig>;
