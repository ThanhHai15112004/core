import { normalizeApiPrefix } from './api-version.util.js';

export interface ServiceRoutingEntry {
  readonly domain: string;
  readonly serviceName: string;
  readonly upstreamDefault: string;
  readonly prefixes: readonly string[];
  readonly stripPrefix: false;
  readonly stability: 'v1-stable';
  readonly description: string;
}

export interface ServiceRoutingCollision {
  readonly prefix: string;
  readonly domains: readonly string[];
}

export interface ServiceRoutingValidationResult {
  readonly valid: boolean;
  readonly collisions: readonly ServiceRoutingCollision[];
}

interface RawRoutingDefinition {
  readonly domain: string;
  readonly serviceName: string;
  readonly upstreamDefault: string;
  readonly segments: readonly string[];
  readonly description: string;
}

const CORE_SERVICE_DOMAINS: readonly RawRoutingDefinition[] = [
  {
    domain: 'health',
    serviceName: 'health-service',
    upstreamDefault: 'http://backend:3005',
    segments: ['health'],
    description: 'Liveness, readiness & LB health probes',
  },
  {
    domain: 'identity',
    serviceName: 'identity-service',
    upstreamDefault: 'http://backend:3005',
    segments: [
      'auth',
      'users',
      'roles',
      'permissions',
      'sessions',
      'credentials',
      'mfa',
      'machine-identities',
      'federated-identity',
    ],
    description: 'Authentication, RBAC, users, sessions, MFA & machine identities',
  },
  {
    domain: 'organization',
    serviceName: 'organization-service',
    upstreamDefault: 'http://backend:3005',
    segments: ['organizations', 'organization-members'],
    description: 'Organization hierarchy & membership management',
  },
  {
    domain: 'platform',
    serviceName: 'platform-service',
    upstreamDefault: 'http://backend:3005',
    segments: [
      'codes',
      'settings',
      'feature-flags',
      'localization',
      'sequences',
      'navigation',
      'custom-fields',
      'audit',
    ],
    description: 'Dynamic codes, settings, feature flags, i18n, sequences & menus',
  },
  {
    domain: 'files',
    serviceName: 'files-service',
    upstreamDefault: 'http://backend:3005',
    segments: ['files'],
    description: 'Media library, chunked upload & storage links',
  },
  {
    domain: 'communications',
    serviceName: 'communications-service',
    upstreamDefault: 'http://backend:3005',
    segments: ['notifications', 'notification-delivery', 'templates', 'comments', 'calendar'],
    description: 'Notifications, templates, comments & calendar',
  },
  {
    domain: 'workflows',
    serviceName: 'workflows-service',
    upstreamDefault: 'http://backend:3005',
    segments: ['workflows', 'approvals'],
    description: 'Approval chains & workflow orchestration',
  },
  {
    domain: 'data-analytics',
    serviceName: 'data-analytics-service',
    upstreamDefault: 'http://backend:3005',
    segments: ['imports', 'exports', 'reports', 'search'],
    description: 'Bulk import/export, scheduled reports & global search',
  },
  {
    domain: 'billing',
    serviceName: 'billing-service',
    upstreamDefault: 'http://backend:3005',
    segments: ['payments', 'reconciliation'],
    description: 'Payment callbacks, checkout & reconciliation',
  },
  {
    domain: 'integrations',
    serviceName: 'integrations-service',
    upstreamDefault: 'http://backend:3005',
    segments: ['webhooks', 'inbound-webhooks', 'provider-registry', 'outbox', 'idempotency'],
    description: 'Outbound/inbound webhooks, provider registry & outbox',
  },
  {
    domain: 'operations',
    serviceName: 'operations-service',
    upstreamDefault: 'http://backend:3005',
    segments: ['ops', 'metrics'],
    description: 'System Console operational endpoints & Prometheus metrics',
  },
];

function parseUpstreamOverrides(overridesRaw?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!overridesRaw || !overridesRaw.trim()) {
    return map;
  }
  const trimmed = overridesRaw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.trim()) {
          map.set(k.trim().toLowerCase(), v.trim());
        }
      }
      return map;
    } catch {
      return map;
    }
  }
  for (const pair of trimmed.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const domain = pair.slice(0, eqIdx).trim().toLowerCase();
    const upstream = pair.slice(eqIdx + 1).trim();
    if (domain && upstream) {
      map.set(domain, upstream);
    }
  }
  return map;
}

/**
 * Xây dựng bảng định tuyến dịch vụ chuẩn bị cho việc tách microservice qua API Gateway.
 * Giữ nguyên toàn bộ URL contract `/{apiPrefix}/{segment}` (`stripPrefix: false`).
 */
export function buildServiceRoutingTable(
  apiPrefix = 'api/v1',
  overridesRaw?: string,
): ServiceRoutingEntry[] {
  const cleanPrefix = normalizeApiPrefix(apiPrefix);
  const overrides = parseUpstreamOverrides(overridesRaw);

  return CORE_SERVICE_DOMAINS.map((def) => ({
    domain: def.domain,
    serviceName: def.serviceName,
    upstreamDefault: overrides.get(def.domain) ?? def.upstreamDefault,
    prefixes: def.segments.map((seg) => `/${cleanPrefix}/${seg}`),
    stripPrefix: false,
    stability: 'v1-stable',
    description: def.description,
  }));
}

/** Kiểm tra không có hai domain dịch vụ cùng sở hữu một path prefix. */
export function validateServiceRoutingTable(
  entries: readonly ServiceRoutingEntry[],
): ServiceRoutingValidationResult {
  const owners = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const prefix of entry.prefixes) {
      const normalized = prefix.replace(/\/+$/, '');
      if (!owners.has(normalized)) {
        owners.set(normalized, new Set());
      }
      owners.get(normalized)!.add(entry.domain);
    }
  }

  const collisions: ServiceRoutingCollision[] = [];
  for (const [prefix, domains] of owners.entries()) {
    if (domains.size > 1) {
      collisions.push({ prefix, domains: [...domains] });
    }
  }

  return {
    valid: collisions.length === 0,
    collisions,
  };
}

/** Sinh đoạn cấu hình Nginx location theo domain dịch vụ để sẵn sàng tách upstream khi cần. */
export function renderNginxServiceLocations(entries: readonly ServiceRoutingEntry[]): string {
  return entries
    .map((entry) => {
      const regex = entry.prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      return [
        `# Domain: ${entry.domain} (${entry.serviceName})`,
        `location ~ ^(${regex})(/|$) {`,
        `    proxy_pass ${entry.upstreamDefault};`,
        `    include /etc/nginx/conf.d/proxy-common.inc;`,
        `}`,
      ].join('\n');
    })
    .join('\n\n');
}

/** Sinh đoạn ACL & use_backend cho HAProxy theo từng domain dịch vụ. */
export function renderHaproxyServiceAcls(entries: readonly ServiceRoutingEntry[]): string {
  return entries
    .map((entry) => {
      const aclName = `is_${entry.domain.replace(/[^a-z0-9_]/gi, '_')}`;
      const paths = entry.prefixes.join(' ');
      return [
        `# Domain: ${entry.domain} -> ${entry.serviceName} (${entry.upstreamDefault})`,
        `acl ${aclName} path_beg ${paths}`,
        `use_backend bk_${entry.domain.replace(/[^a-z0-9_]/gi, '_')} if ${aclName}`,
      ].join('\n');
    })
    .join('\n\n');
}
