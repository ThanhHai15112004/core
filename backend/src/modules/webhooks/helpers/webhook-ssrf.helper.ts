import { lookup as dnsLookupNative } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BadRequestAppException } from '@packages/kernel/index.js';

export interface DnsResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export type WebhookDnsLookupFn = (hostname: string) => Promise<readonly DnsResolvedAddress[]>;

export interface ValidateWebhookSsrfOptions {
  readonly allowHttpInDev?: boolean | undefined;
  readonly dnsLookup?: WebhookDnsLookupFn | undefined;
}

export interface WebhookSsrfValidationResult {
  readonly safe: boolean;
  readonly normalizedUrl?: string | undefined;
  readonly reason?: string | undefined;
  readonly resolvedIps?: readonly string[] | undefined;
}

const BLOCKED_EXACT_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'host.docker.internal',
  'gateway.docker.internal',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.arpa',
  '.svc',
  '.cluster.local',
] as const;

const defaultDnsLookup: WebhookDnsLookupFn = async (hostname: string) => {
  const records = await dnsLookupNative(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family }));
};

function stripIpv6BracketsAndZone(raw: string): string {
  let clean = raw.trim();
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }
  const zoneIdx = clean.indexOf('%');
  if (zoneIdx !== -1) {
    clean = clean.slice(0, zoneIdx);
  }
  return clean.toLowerCase();
}

function parseIpv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    acc = (acc * 256 + num) >>> 0;
  }
  return acc;
}

function inIpv4Cidr(ipUint32: number, networkIp: string, prefixLen: number): boolean {
  const net = parseIpv4ToUint32(networkIp);
  if (net === null) return false;
  if (prefixLen === 0) return true;
  const mask = (~0 << (32 - prefixLen)) >>> 0;
  return (ipUint32 & mask) === (net & mask);
}

const BLOCKED_IPV4_CIDRS: ReadonlyArray<readonly [string, number, string]> = [
  ['0.0.0.0', 8, 'unspecified-network'],
  ['10.0.0.0', 8, 'rfc1918-private'],
  ['100.64.0.0', 10, 'cgnat-shared'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local-metadata'],
  ['172.16.0.0', 12, 'rfc1918-private'],
  ['192.0.0.0', 24, 'ietf-protocol-reserved'],
  ['192.0.2.0', 24, 'test-net-1'],
  ['192.88.99.0', 24, '6to4-relay-anycast'],
  ['192.168.0.0', 16, 'rfc1918-private'],
  ['198.18.0.0', 15, 'benchmarking-reserved'],
  ['198.51.100.0', 24, 'test-net-2'],
  ['203.0.113.0', 24, 'test-net-3'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved-broadcast'],
];

function checkBlockedIpv4Uint32(ipUint32: number): string | null {
  for (const [net, prefix, reason] of BLOCKED_IPV4_CIDRS) {
    if (inIpv4Cidr(ipUint32, net, prefix)) {
      return `Blocked IPv4 range (${reason})`;
    }
  }
  return null;
}

function parseIpv6ToGroups(rawIp: string): number[] | null {
  const ip = stripIpv6BracketsAndZone(rawIp);
  if (isIP(ip) !== 6) return null;

  let working = ip;
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const ipv4Tail = working.slice(lastColon + 1);
    const v4 = parseIpv4ToUint32(ipv4Tail);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const doubleColonParts = working.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSegment = (segment: string): number[] | null => {
    if (!segment) return [];
    const tokens = segment.split(':');
    const out: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
      out.push(Number.parseInt(token, 16));
    }
    return out;
  };

  if (doubleColonParts.length === 1) {
    const groups = parseSegment(doubleColonParts[0] ?? '');
    return groups && groups.length === 8 ? groups : null;
  }

  const head = parseSegment(doubleColonParts[0] ?? '');
  const tail = parseSegment(doubleColonParts[1] ?? '');
  if (!head || !tail) return null;
  const missing = 8 - (head.length + tail.length);
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function groupsToUint32Tail(g6: number, g7: number): number {
  return (((g6 & 0xffff) << 16) | (g7 & 0xffff)) >>> 0;
}

function checkBlockedIpv6Groups(groups: readonly number[]): string | null {
  const g0 = groups[0] ?? 0;
  const g1 = groups[1] ?? 0;
  const g2 = groups[2] ?? 0;
  const g3 = groups[3] ?? 0;
  const g4 = groups[4] ?? 0;
  const g5 = groups[5] ?? 0;
  const g6 = groups[6] ?? 0;
  const g7 = groups[7] ?? 0;

  const isAllZeroPrefix96 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;

  // ::/128 (unspecified) and ::1/128 (loopback)
  if (isAllZeroPrefix96 && g6 === 0 && (g7 === 0 || g7 === 1)) {
    return g7 === 1 ? 'Blocked IPv6 loopback (::1)' : 'Blocked IPv6 unspecified (::)';
  }

  // ::ffff:0:0/96 (IPv4-mapped IPv6) and ::/96 (IPv4-compatible IPv6)
  if (
    (isAllZeroPrefix96 && g6 !== 0) ||
    (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff)
  ) {
    const embeddedV4 = groupsToUint32Tail(g6, g7);
    const v4Reason = checkBlockedIpv4Uint32(embeddedV4);
    if (v4Reason) return `Blocked IPv4-mapped IPv6 (${v4Reason})`;
  }

  // 64:ff9b::/96 (NAT64 well-known prefix) & 64:ff9b:1::/48 (NAT64 local-use)
  if (g0 === 0x0064 && g1 === 0xff9b && (g2 === 0 || g2 === 1)) {
    const embeddedV4 = groupsToUint32Tail(g6, g7);
    const v4Reason = checkBlockedIpv4Uint32(embeddedV4);
    return v4Reason ? `Blocked NAT64 IPv6 (${v4Reason})` : 'Blocked NAT64 IPv6 prefix';
  }

  // 100::/64 (discard-only)
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) {
    return 'Blocked IPv6 discard prefix (100::/64)';
  }

  // 2001::/32 (Teredo) and 2001:db8::/32 (documentation)
  if (g0 === 0x2001 && (g1 === 0x0000 || g1 === 0x0db8)) {
    return 'Blocked IPv6 reserved tunnel/documentation prefix';
  }

  // 2002::/16 (6to4 tunneling)
  if (g0 === 0x2002) {
    const embeddedV4 = groupsToUint32Tail(g1, g2);
    const v4Reason = checkBlockedIpv4Uint32(embeddedV4);
    return v4Reason ? `Blocked 6to4 IPv6 (${v4Reason})` : 'Blocked 6to4 IPv6 prefix';
  }

  // fc00::/7 (Unique Local Address / private)
  if ((g0 & 0xfe00) === 0xfc00) {
    return 'Blocked IPv6 unique local address (fc00::/7)';
  }

  // fe80::/10 (link-local) and fec0::/10 (site-local)
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) {
    return 'Blocked IPv6 link-local/site-local prefix';
  }

  // ff00::/8 (multicast)
  if ((g0 & 0xff00) === 0xff00) {
    return 'Blocked IPv6 multicast prefix (ff00::/8)';
  }

  return null;
}

export function isBlockedIpAddress(rawIp: string): { blocked: boolean; reason?: string } {
  const cleaned = stripIpv6BracketsAndZone(rawIp);
  const ipFamily = isIP(cleaned);
  if (ipFamily === 4) {
    const v4 = parseIpv4ToUint32(cleaned);
    if (v4 === null) return { blocked: true, reason: 'Invalid IPv4 address' };
    const reason = checkBlockedIpv4Uint32(v4);
    return reason ? { blocked: true, reason } : { blocked: false };
  }
  if (ipFamily === 6) {
    const groups = parseIpv6ToGroups(cleaned);
    if (!groups) return { blocked: true, reason: 'Invalid IPv6 address' };
    const reason = checkBlockedIpv6Groups(groups);
    return reason ? { blocked: true, reason } : { blocked: false };
  }
  return { blocked: true, reason: 'Unrecognized IP address family' };
}

function isBlockedHostname(hostname: string): string | null {
  const normalized = hostname.trim().replace(/\.+$/, '').toLowerCase();
  if (!normalized) {
    return 'Empty hostname';
  }
  if (BLOCKED_EXACT_HOSTNAMES.has(normalized)) {
    return `Blocked internal hostname "${normalized}"`;
  }
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      return `Blocked internal domain suffix "${suffix}"`;
    }
  }
  const bare = stripIpv6BracketsAndZone(normalized);
  if (isIP(bare) === 0 && !normalized.includes('.')) {
    return `Blocked single-label internal hostname "${normalized}"`;
  }
  return null;
}

/**
 * Kiểm tra URL đích Webhook để chống tấn công SSRF (Server-Side Request Forgery):
 * 1. Chỉ cho phép giao thức `https:` (chỉ cho `http:` nếu `allowHttpInDev = true`).
 * 2. Cấm `username`/`password` nhúng trong URL.
 * 3. Cấm hostname nội bộ (`localhost`, `*.local`, `*.internal`, `metadata.google.internal`, single-label...).
 * 4. Giải phân giải DNS (`dns.lookup(..., { all: true })`) và chặn toàn bộ IPv4/IPv6 nội bộ, loopback, link-local, CGNAT, cloud metadata, IPv4-mapped IPv6.
 */
export async function validateWebhookUrlSsrf(
  rawUrl: string,
  options: ValidateWebhookSsrfOptions = {},
): Promise<WebhookSsrfValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { safe: false, reason: 'Malformed webhook target URL' };
  }

  const protocol = parsed.protocol.toLowerCase();
  const allowedProtocols = options.allowHttpInDev
    ? new Set(['https:', 'http:'])
    : new Set(['https:']);
  if (!allowedProtocols.has(protocol)) {
    return {
      safe: false,
      reason: `Unsupported protocol "${protocol}". Only HTTPS is allowed`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      safe: false,
      reason: 'Embedded credentials in webhook URL are forbidden',
    };
  }

  const rawHostname = parsed.hostname;
  const hostReason = isBlockedHostname(rawHostname);
  if (hostReason) {
    return { safe: false, reason: hostReason };
  }

  const bareHost = stripIpv6BracketsAndZone(rawHostname);
  const literalFamily = isIP(bareHost);
  if (literalFamily !== 0) {
    const check = isBlockedIpAddress(bareHost);
    if (check.blocked) {
      return {
        safe: false,
        reason: check.reason ?? `Blocked IP literal "${bareHost}"`,
        resolvedIps: [bareHost],
      };
    }
    return {
      safe: true,
      normalizedUrl: parsed.toString(),
      resolvedIps: [bareHost],
    };
  }

  const lookupFn = options.dnsLookup ?? defaultDnsLookup;
  let records: readonly DnsResolvedAddress[];
  try {
    records = await lookupFn(rawHostname.replace(/\.+$/, ''));
  } catch {
    return {
      safe: false,
      reason: `DNS resolution failed for hostname "${rawHostname}"`,
    };
  }

  if (!records || records.length === 0) {
    return {
      safe: false,
      reason: `DNS lookup returned no addresses for hostname "${rawHostname}"`,
    };
  }

  const resolvedIps = records.map((r) => r.address);
  for (const record of records) {
    const check = isBlockedIpAddress(record.address);
    if (check.blocked) {
      return {
        safe: false,
        reason: `${check.reason ?? 'Blocked IP'} (resolved from "${rawHostname}": ${record.address})`,
        resolvedIps,
      };
    }
  }

  return {
    safe: true,
    normalizedUrl: parsed.toString(),
    resolvedIps,
  };
}

export async function assertWebhookUrlSafe(
  rawUrl: string,
  options: ValidateWebhookSsrfOptions = {},
): Promise<string> {
  const result = await validateWebhookUrlSsrf(rawUrl, options);
  if (!result.safe || !result.normalizedUrl) {
    throw new BadRequestAppException('webhooks.ssrfBlocked', [
      { field: 'url', message: result.reason ?? 'Blocked by SSRF policy' },
    ]);
  }
  return result.normalizedUrl;
}
