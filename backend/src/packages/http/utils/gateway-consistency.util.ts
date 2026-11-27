import type { GatewayConfig } from '@packages/config/index.js';
import { buildServiceRoutingTable, validateServiceRoutingTable } from './service-routing.util.js';

export type ConsistencyCheckStatus = 'pass' | 'warn' | 'fail';

export interface GatewayConsistencyCheck {
  readonly id: string;
  readonly status: ConsistencyCheckStatus;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface GatewayConsistencyReport {
  readonly status: 'ok' | 'warn' | 'fail';
  readonly checks: readonly GatewayConsistencyCheck[];
}

const UNSAFE_WILDCARD_CIDRS = new Set(['0.0.0.0/0', '::/0', '*']);

/**
 * Đánh giá tính nhất quán cấu hình giữa Load Balancer / API Gateway và Fastify Backend:
 * - Chống lỗi 502 do keep-alive race (`apiKeepAliveTimeoutMs > lbKeepAliveTimeoutMs`).
 * - Chống race timeout đọc header của Node.js (`apiHeadersTimeoutMs > apiKeepAliveTimeoutMs`).
 * - Đảm bảo LB không cắt kết nối trước thời hạn xử lý của API (`lbReadTimeoutMs >= apiRequestTimeoutMs`).
 * - Đồng bộ giới hạn kích thước request body và chính sách Trusted Proxy / Rate Limit Layering.
 */
export function evaluateGatewayConsistency(
  cfg: GatewayConfig,
  env: string,
  apiPrefix = 'api/v1',
): GatewayConsistencyReport {
  const checks: GatewayConsistencyCheck[] = [];
  const { timeouts, bodyLimits, proxy, rateLimit, gateway } = cfg;

  // 1. Keep-Alive alignment (ngăn 502 khi LB tái sử dụng socket vừa bị backend đóng)
  const keepAliveOk =
    timeouts.apiKeepAliveTimeoutMs === 0 ||
    timeouts.apiKeepAliveTimeoutMs > timeouts.lbKeepAliveTimeoutMs;
  checks.push({
    id: 'keepalive_alignment',
    status: keepAliveOk ? 'pass' : 'fail',
    message: keepAliveOk
      ? `API keep-alive (${timeouts.apiKeepAliveTimeoutMs}ms) > LB keep-alive (${timeouts.lbKeepAliveTimeoutMs}ms)`
      : `API keep-alive (${timeouts.apiKeepAliveTimeoutMs}ms) must exceed LB keep-alive (${timeouts.lbKeepAliveTimeoutMs}ms) to prevent 502 race`,
    details: {
      apiKeepAliveTimeoutMs: timeouts.apiKeepAliveTimeoutMs,
      lbKeepAliveTimeoutMs: timeouts.lbKeepAliveTimeoutMs,
    },
  });

  // 2. Node HTTP headersTimeout > keepAliveTimeout
  const headersOk =
    timeouts.apiHeadersTimeoutMs === 0 ||
    timeouts.apiHeadersTimeoutMs > timeouts.apiKeepAliveTimeoutMs;
  checks.push({
    id: 'headers_timeout_alignment',
    status: headersOk ? 'pass' : 'fail',
    message: headersOk
      ? `API headersTimeout (${timeouts.apiHeadersTimeoutMs}ms) > keepAliveTimeout (${timeouts.apiKeepAliveTimeoutMs}ms)`
      : `API headersTimeout (${timeouts.apiHeadersTimeoutMs}ms) must exceed keepAliveTimeout (${timeouts.apiKeepAliveTimeoutMs}ms)`,
    details: {
      apiHeadersTimeoutMs: timeouts.apiHeadersTimeoutMs,
      apiKeepAliveTimeoutMs: timeouts.apiKeepAliveTimeoutMs,
    },
  });

  // 3. LB read/send timeout >= API request timeout
  const readTimeoutOk =
    timeouts.apiRequestTimeoutMs === 0 ||
    (timeouts.lbReadTimeoutMs >= timeouts.apiRequestTimeoutMs &&
      timeouts.lbSendTimeoutMs >= timeouts.apiRequestTimeoutMs);
  checks.push({
    id: 'read_timeout_alignment',
    status: readTimeoutOk ? 'pass' : 'fail',
    message: readTimeoutOk
      ? `LB read/send (${timeouts.lbReadTimeoutMs}ms/${timeouts.lbSendTimeoutMs}ms) >= API request timeout (${timeouts.apiRequestTimeoutMs}ms)`
      : `LB read/send timeout (${timeouts.lbReadTimeoutMs}ms/${timeouts.lbSendTimeoutMs}ms) is shorter than API request timeout (${timeouts.apiRequestTimeoutMs}ms)`,
    details: {
      lbReadTimeoutMs: timeouts.lbReadTimeoutMs,
      lbSendTimeoutMs: timeouts.lbSendTimeoutMs,
      apiRequestTimeoutMs: timeouts.apiRequestTimeoutMs,
    },
  });

  // 4. Body size parity (Gateway vs Backend & JSON parser <= max body)
  if (bodyLimits.apiJsonBodyLimitBytes > bodyLimits.apiMaxBodySizeBytes) {
    checks.push({
      id: 'body_limit_alignment',
      status: 'fail',
      message: `API JSON body limit (${bodyLimits.apiJsonBodyLimitBytes}B) exceeds API max body size (${bodyLimits.apiMaxBodySizeBytes}B)`,
      details: bodyLimits,
    });
  } else if (bodyLimits.gatewayMaxBodySizeBytes !== bodyLimits.apiMaxBodySizeBytes) {
    checks.push({
      id: 'body_limit_alignment',
      status: 'warn',
      message: `Gateway max body (${bodyLimits.gatewayMaxBodySizeBytes}B) differs from API max body (${bodyLimits.apiMaxBodySizeBytes}B)`,
      details: bodyLimits,
    });
  } else {
    checks.push({
      id: 'body_limit_alignment',
      status: 'pass',
      message: `Gateway and API max body size aligned at ${bodyLimits.apiMaxBodySizeBytes} bytes`,
      details: bodyLimits,
    });
  }

  // 5. Trusted proxy safety
  const hasWildcardCidr = proxy.trustedCidrs.some((c) =>
    UNSAFE_WILDCARD_CIDRS.has(c.trim().toLowerCase()),
  );
  if (hasWildcardCidr) {
    checks.push({
      id: 'trusted_proxy_safety',
      status: 'fail',
      message:
        'PROXY_TRUSTED_CIDRS contains wildcard (0.0.0.0/0, ::/0 or *) — allows X-Forwarded-For spoofing',
      details: { trustMode: proxy.trustMode, trustedCidrs: proxy.trustedCidrs },
    });
  } else if (env === 'production' && proxy.trustMode === 'off') {
    checks.push({
      id: 'trusted_proxy_safety',
      status: 'warn',
      message:
        'PROXY_TRUST_MODE=off in production — real client IP from LB/Gateway headers will be ignored',
      details: { trustMode: proxy.trustMode },
    });
  } else {
    checks.push({
      id: 'trusted_proxy_safety',
      status: 'pass',
      message: `Trusted proxy mode="${proxy.trustMode}" (maxHops=${proxy.maxHops}, cidrs=${proxy.trustedCidrs.length})`,
      details: { trustMode: proxy.trustMode, maxHops: proxy.maxHops },
    });
  }

  // 6. Rate limit layering
  const overlapWarning =
    rateLimit.layerMode === 'edge-ip-backend-business' && !rateLimit.skipBackendIpWhenEdgeApplied;
  checks.push({
    id: 'rate_limit_layering',
    status: overlapWarning ? 'warn' : 'pass',
    message: overlapWarning
      ? 'RATE_LIMIT_LAYER_MODE=edge-ip-backend-business with RATE_LIMIT_SKIP_BACKEND_IP_ON_EDGE=false may cause overlapping IP throttling'
      : `Rate limit layering mode="${rateLimit.layerMode}" (skipBackendIpOnEdge=${String(rateLimit.skipBackendIpWhenEdgeApplied)})`,
    details: {
      layerMode: rateLimit.layerMode,
      skipBackendIpWhenEdgeApplied: rateLimit.skipBackendIpWhenEdgeApplied,
    },
  });

  // 7. Service routing integrity
  const routingEntries = buildServiceRoutingTable(apiPrefix, gateway.serviceRoutingOverrides);
  const routingValidation = validateServiceRoutingTable(routingEntries);
  checks.push({
    id: 'service_routing_integrity',
    status: routingValidation.valid ? 'pass' : 'fail',
    message: routingValidation.valid
      ? `Service routing table valid (${routingEntries.length} logical service domains, 0 prefix collisions)`
      : `Detected ${routingValidation.collisions.length} prefix collision(s) in service routing table`,
    details: {
      domains: routingEntries.length,
      collisions: routingValidation.collisions,
    },
  });

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');

  return {
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'ok',
    checks,
  };
}
