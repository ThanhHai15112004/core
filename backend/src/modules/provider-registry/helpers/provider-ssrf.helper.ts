import { lookup as dnsLookupNative } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BadRequestAppException } from '@packages/kernel/index.js';

export interface ProviderDnsAddress {
  readonly address: string;
  readonly family: number;
}

export type ProviderDnsLookupFn = (hostname: string) => Promise<readonly ProviderDnsAddress[]>;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'host.docker.internal',
  'gateway.docker.internal',
]);

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.arpa',
  '.svc',
  '.cluster.local',
] as const;

const defaultDnsLookup: ProviderDnsLookupFn = async (hostname: string) => {
  const records = await dnsLookupNative(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family }));
};

function parseIpv4Uint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const num = Number(part);
    if (num < 0 || num > 255) return null;
    acc = (acc * 256 + num) >>> 0;
  }
  return acc;
}

function inIpv4Cidr(ipUint32: number, network: string, prefixLen: number): boolean {
  const net = parseIpv4Uint32(network);
  if (net === null) return false;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipUint32 & mask) === (net & mask);
}

const PRIVATE_IPV4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isBlockedIp(rawIp: string): boolean {
  let ip = rawIp.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);

  const kind = isIP(ip);
  if (kind === 4) {
    const uint32 = parseIpv4Uint32(ip);
    if (uint32 === null) return true;
    return PRIVATE_IPV4_CIDRS.some(([net, prefix]) => inIpv4Cidr(uint32, net, prefix));
  }
  if (kind === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('::ffff:')) {
      return isBlockedIp(ip.slice('::ffff:'.length));
    }
    if (
      ip.startsWith('fe80:') ||
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      ip.startsWith('ff')
    ) {
      return true;
    }
    return false;
  }
  return false;
}

export async function validateHealthCheckUrl(
  rawUrl: string,
  options?: {
    readonly allowPrivateUrls?: boolean | undefined;
    readonly dnsLookup?: ProviderDnsLookupFn | undefined;
  },
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new BadRequestAppException('provider-registry.invalidHealthCheckUrl', [{ url: rawUrl }]);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestAppException('provider-registry.invalidHealthCheckUrl', [
      { url: rawUrl, reason: 'protocol' },
    ]);
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestAppException('provider-registry.invalidHealthCheckUrl', [
      { url: rawUrl, reason: 'credentials' },
    ]);
  }

  if (options?.allowPrivateUrls) {
    return parsed.toString();
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new BadRequestAppException('provider-registry.invalidHealthCheckUrl', [
      { url: rawUrl, reason: 'blocked_hostname' },
    ]);
  }

  if (isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      throw new BadRequestAppException('provider-registry.invalidHealthCheckUrl', [
        { url: rawUrl, reason: 'blocked_ip' },
      ]);
    }
    return parsed.toString();
  }

  const lookup = options?.dnsLookup ?? defaultDnsLookup;
  try {
    const addresses = await lookup(hostname);
    if (addresses.length > 0 && addresses.some((a) => isBlockedIp(a.address))) {
      throw new BadRequestAppException('provider-registry.invalidHealthCheckUrl', [
        { url: rawUrl, reason: 'blocked_resolved_ip' },
      ]);
    }
  } catch (err) {
    if (err instanceof BadRequestAppException) throw err;
    // Allow DNS resolution errors during static config saving; runtime health probe will report DOWN
  }

  return parsed.toString();
}
