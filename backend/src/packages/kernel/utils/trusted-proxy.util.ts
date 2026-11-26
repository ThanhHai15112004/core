export type ProxyTrustMode = 'off' | 'loopback' | 'private' | 'cidr' | 'hops';

export interface TrustedProxyPolicy {
  readonly trustMode: ProxyTrustMode;
  readonly trustedCidrs: readonly string[];
  readonly maxHops: number;
  readonly ipHeaders: readonly string[];
  readonly forwardedPrefixHeader?: string | undefined;
}

export interface ProxyRequestLike {
  readonly ip?: string | undefined;
  readonly headers?: Record<string, string | string[] | undefined> | undefined;
  readonly socket?: { readonly remoteAddress?: string | undefined } | null | undefined;
  readonly raw?:
    | { readonly socket?: { readonly remoteAddress?: string | undefined } | null | undefined }
    | undefined;
  readonly protocol?: string | undefined;
}

export interface ForwardedContext {
  readonly clientIp: string | null;
  readonly socketIp: string | null;
  readonly trustedProxy: boolean;
  readonly protocol: string | null;
  readonly host: string | null;
  readonly port: string | null;
  readonly prefix: string | null;
  readonly chain: readonly string[];
}

export interface ParsedForwardedHeader {
  readonly forList: readonly string[];
  readonly proto: string | null;
  readonly host: string | null;
}

const LOOPBACK_CIDRS = ['127.0.0.0/8', '::1/128'] as const;
const PRIVATE_CIDRS = [
  '127.0.0.0/8',
  '::1/128',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fc00::/7',
  'fe80::/10',
] as const;

let defaultTrustedProxyPolicy: TrustedProxyPolicy = {
  trustMode: 'loopback',
  trustedCidrs: [...LOOPBACK_CIDRS],
  maxHops: 1,
  ipHeaders: ['x-forwarded-for', 'forwarded', 'x-real-ip'],
  forwardedPrefixHeader: 'x-forwarded-prefix',
};

/** Cập nhật chính sách Trusted Proxy mặc định toàn tiến trình API. */
export function configureDefaultTrustedProxyPolicy(policy: TrustedProxyPolicy): void {
  defaultTrustedProxyPolicy = {
    ...policy,
    trustedCidrs: [...policy.trustedCidrs],
    ipHeaders: [...policy.ipHeaders],
  };
}

/** Lấy chính sách Trusted Proxy mặc định hiện hành. */
export function getDefaultTrustedProxyPolicy(): TrustedProxyPolicy {
  return defaultTrustedProxyPolicy;
}

/** Đọc một giá trị header HTTP đơn (ưu tiên phần tử đầu nếu là mảng). */
function readHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name.toLowerCase()] ?? headers[name];
  const val = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof val === 'string' ? val.trim() : '';
  return trimmed || undefined;
}

/** Chuẩn hóa chuỗi IPv4/IPv6 (loại bỏ ngoặc vuông, port kèm theo và prefix `::ffff:`). */
export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;

  // Bỏ dấu ngoặc kép nếu có (từ RFC 7239 Forwarded: for="[::1]:1234")
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1).trim();
  }

  // Bỏ prefix obfuscated nếu có
  if (value.startsWith('_')) {
    return null;
  }

  // IPv6 kèm ngoặc vuông và port: [2001:db8::1]:443
  if (value.startsWith('[')) {
    const closeIdx = value.indexOf(']');
    if (closeIdx > 1) {
      value = value.slice(1, closeIdx);
    }
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    // IPv4 kèm port: 1.2.3.4:5678
    value = value.slice(0, value.lastIndexOf(':'));
  }

  // Loại bỏ zone id (ví dụ fe80::1%eth0)
  const zoneIdx = value.indexOf('%');
  if (zoneIdx > 0) {
    value = value.slice(0, zoneIdx);
  }

  const lower = value.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7);
    if (isValidIpv4(mapped)) {
      return mapped;
    }
  }

  if (isValidIpv4(lower)) {
    return lower;
  }
  if (isValidIpv6(lower)) {
    return lower;
  }
  return null;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function ipv4ToInt(ip: string): number | null {
  if (!isValidIpv4(ip)) return null;
  const parts = ip.split('.').map((p) => Number(p));
  return (((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0);
}

function isValidIpv6(ip: string): boolean {
  if (!ip.includes(':')) return false;
  const halves = ip.split('::');
  if (halves.length > 2) return false;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const total = left.length + right.length;
  if (halves.length === 1 && total !== 8) return false;
  if (halves.length === 2 && total >= 8) return false;
  return [...left, ...right].every((g) => /^[0-9a-f]{1,4}$/i.test(g));
}

function ipv6ToBigInt(ip: string): bigint | null {
  if (!isValidIpv6(ip)) return null;
  const halves = ip.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? 8 - (left.length + right.length) : 0;
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ];
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const g of groups) {
    result = (result << 16n) + BigInt(parseInt(g, 16));
  }
  return result;
}

/** Kiểm tra một địa chỉ IP có nằm trong CIDR (IPv4/IPv6) hay khớp trực tiếp không. */
export function isIpInCidr(ipRaw: string, cidrRaw: string): boolean {
  const ip = normalizeIp(ipRaw);
  if (!ip) return false;
  const trimmed = cidrRaw.trim().toLowerCase();
  if (!trimmed) return false;

  if (trimmed === 'loopback') {
    return LOOPBACK_CIDRS.some((c) => isIpInCidr(ip, c));
  }
  if (trimmed === 'private' || trimmed === 'uniquelocal') {
    return PRIVATE_CIDRS.some((c) => isIpInCidr(ip, c));
  }

  const slashIdx = trimmed.indexOf('/');
  if (slashIdx === -1) {
    const target = normalizeIp(trimmed);
    if (!target) return false;
    if (isValidIpv4(ip) && isValidIpv4(target)) return ip === target;
    const a = ipv6ToBigInt(ip);
    const b = ipv6ToBigInt(target);
    return a !== null && b !== null && a === b;
  }

  const networkRaw = trimmed.slice(0, slashIdx);
  const prefixLen = Number(trimmed.slice(slashIdx + 1));
  const network = normalizeIp(networkRaw);
  if (!network || !Number.isInteger(prefixLen) || prefixLen < 0) return false;

  if (isValidIpv4(ip) && isValidIpv4(network)) {
    if (prefixLen > 32) return false;
    const ipInt = ipv4ToInt(ip);
    const netInt = ipv4ToInt(network);
    if (ipInt === null || netInt === null) return false;
    if (prefixLen === 0) return true;
    const mask = (0xffffffff << (32 - prefixLen)) >>> 0;
    return (ipInt & mask) === (netInt & mask);
  }

  const ipV6 = ipv6ToBigInt(ip);
  const netV6 = ipv6ToBigInt(network);
  if (ipV6 !== null && netV6 !== null) {
    if (prefixLen > 128) return false;
    if (prefixLen === 0) return true;
    const shift = BigInt(128 - prefixLen);
    return (ipV6 >> shift) === (netV6 >> shift);
  }

  return false;
}

/** Danh sách CIDR hiệu lực tương ứng với chính sách tin cậy proxy. */
export function resolveEffectiveTrustedCidrs(policy: TrustedProxyPolicy): readonly string[] {
  switch (policy.trustMode) {
    case 'off':
      return [];
    case 'loopback':
      return policy.trustedCidrs.length > 0 ? policy.trustedCidrs : [...LOOPBACK_CIDRS];
    case 'private':
      return policy.trustedCidrs.length > 0 ? policy.trustedCidrs : [...PRIVATE_CIDRS];
    case 'cidr':
      return policy.trustedCidrs;
    case 'hops':
      return policy.trustedCidrs;
  }
}

/** Kiểm tra IP kết nối trực tiếp có thuộc danh sách proxy được tin cậy hay không. */
export function isTrustedProxyIp(
  ipRaw: string | null | undefined,
  policy: TrustedProxyPolicy = defaultTrustedProxyPolicy,
): boolean {
  if (policy.trustMode === 'off') return false;
  const ip = normalizeIp(ipRaw);
  if (!ip) return false;
  if (policy.trustMode === 'hops') {
    return policy.maxHops > 0;
  }
  const cidrs = resolveEffectiveTrustedCidrs(policy);
  return cidrs.some((cidr) => isIpInCidr(ip, cidr));
}

/** Phân tích header RFC 7239 `Forwarded` (`for=...;proto=...;host=...`). */
export function parseForwardedHeader(header: string | undefined): ParsedForwardedHeader {
  if (!header) {
    return { forList: [], proto: null, host: null };
  }
  const forList: string[] = [];
  let proto: string | null = null;
  let host: string | null = null;

  const entries = header.split(',');
  for (const entry of entries) {
    const params = entry.split(';');
    for (const param of params) {
      const eqIdx = param.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = param.slice(0, eqIdx).trim().toLowerCase();
      let val = param.slice(eqIdx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
        val = val.slice(1, -1).trim();
      }
      if (!val) continue;
      if (key === 'for') {
        const ip = normalizeIp(val);
        if (ip) forList.push(ip);
      } else if (key === 'proto' && !proto) {
        proto = val.toLowerCase();
      } else if (key === 'host' && !host) {
        host = val;
      }
    }
  }

  return { forList, proto, host };
}

function parseCsvIps(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const ip = normalizeIp(part);
    if (ip) out.push(ip);
  }
  return out;
}

function sanitizeForwardedPrefix(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return null;
  if (trimmed.includes('..') || trimmed.includes('\\') || /\s/.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, '') || '/';
}

function pickClientIpFromChain(
  chain: readonly string[],
  socketIp: string,
  policy: TrustedProxyPolicy,
): string {
  if (chain.length === 0) return socketIp;
  const maxHops = Math.max(1, policy.maxHops);

  if (policy.trustMode === 'hops') {
    // Đi ngược từ hop gần nhất tối đa `maxHops` bước
    const idx = Math.max(0, chain.length - maxHops);
    return chain[idx] ?? socketIp;
  }

  // Duyệt từ phải sang trái (từ proxy gần nhất ra ngoài Internet),
  // bỏ qua tối đa `maxHops` proxy tin cậy để chống giả mạo IP ở đầu chuỗi XFF.
  let hopsWalked = 0;
  for (let i = chain.length - 1; i >= 0; i--) {
    const candidate = chain[i]!;
    if (hopsWalked < maxHops && isTrustedProxyIp(candidate, policy)) {
      hopsWalked += 1;
      continue;
    }
    return candidate;
  }
  return chain[0] ?? socketIp;
}

/**
 * Trích xuất ngữ cảnh proxy & IP thật của client.
 * Chỉ tin các header `X-Forwarded-*` / `Forwarded` / `X-Real-IP` khi kết nối gốc xuất phát từ proxy được tin cậy.
 */
export function resolveForwardedContext(
  req: ProxyRequestLike | undefined | null,
  policy: TrustedProxyPolicy = defaultTrustedProxyPolicy,
): ForwardedContext {
  if (!req) {
    return {
      clientIp: null,
      socketIp: null,
      trustedProxy: false,
      protocol: null,
      host: null,
      port: null,
      prefix: null,
      chain: [],
    };
  }

  const rawSocketIp =
    req.raw?.socket?.remoteAddress ?? req.socket?.remoteAddress ?? req.ip ?? null;
  const socketIp = normalizeIp(rawSocketIp) ?? (typeof rawSocketIp === 'string' ? rawSocketIp : null);
  const directProtocol = typeof req.protocol === 'string' ? req.protocol.toLowerCase() : null;

  if (!socketIp || !isTrustedProxyIp(socketIp, policy)) {
    return {
      clientIp: socketIp,
      socketIp,
      trustedProxy: false,
      protocol: directProtocol,
      host: readHeaderValue(req.headers, 'host') ?? null,
      port: null,
      prefix: null,
      chain: socketIp ? [socketIp] : [],
    };
  }

  const xffIps = parseCsvIps(readHeaderValue(req.headers, 'x-forwarded-for'));
  const forwardedParsed = parseForwardedHeader(readHeaderValue(req.headers, 'forwarded'));
  const realIp = normalizeIp(readHeaderValue(req.headers, 'x-real-ip'));

  let resolvedIp: string = socketIp;
  let chain: readonly string[] = [socketIp];

  for (const headerName of policy.ipHeaders) {
    const normalizedName = headerName.trim().toLowerCase();
    if (normalizedName === 'x-forwarded-for' && xffIps.length > 0) {
      resolvedIp = pickClientIpFromChain(xffIps, socketIp, policy);
      chain = [...xffIps, socketIp];
      break;
    }
    if (normalizedName === 'forwarded' && forwardedParsed.forList.length > 0) {
      resolvedIp = pickClientIpFromChain(forwardedParsed.forList, socketIp, policy);
      chain = [...forwardedParsed.forList, socketIp];
      break;
    }
    if (normalizedName === 'x-real-ip' && realIp) {
      resolvedIp = realIp;
      chain = [realIp, socketIp];
      break;
    }
  }

  const rawProto = readHeaderValue(req.headers, 'x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const protocol =
    (rawProto === 'http' || rawProto === 'https' ? rawProto : null) ??
    (forwardedParsed.proto === 'http' || forwardedParsed.proto === 'https'
      ? forwardedParsed.proto
      : null) ??
    directProtocol;

  const host =
    readHeaderValue(req.headers, 'x-forwarded-host')?.split(',')[0]?.trim() ??
    forwardedParsed.host ??
    readHeaderValue(req.headers, 'host') ??
    null;

  const rawPort = readHeaderValue(req.headers, 'x-forwarded-port')?.split(',')[0]?.trim();
  const port = rawPort && /^\d{1,5}$/.test(rawPort) ? rawPort : null;

  const prefixHeader = policy.forwardedPrefixHeader || 'x-forwarded-prefix';
  const prefix = sanitizeForwardedPrefix(readHeaderValue(req.headers, prefixHeader));

  return {
    clientIp: resolvedIp,
    socketIp,
    trustedProxy: true,
    protocol,
    host,
    port,
    prefix,
    chain,
  };
}

/** Trích xuất IP thật của client từ request theo chính sách Trusted Proxy (chống giả mạo XFF). */
export function resolveClientIp(
  req: ProxyRequestLike | undefined | null,
  policy: TrustedProxyPolicy = defaultTrustedProxyPolicy,
): string | null {
  return resolveForwardedContext(req, policy).clientIp;
}

/**
 * Tạo tùy chọn `trustProxy` tương thích với `FastifyAdapter` từ `TrustedProxyPolicy`.
 * Hỗ trợ `off` (false), `hops` (number), `loopback`/`private`/`cidr` (hàm kiểm tra CIDR chuẩn).
 */
export function buildFastifyTrustProxyOption(
  policy: TrustedProxyPolicy,
): boolean | number | ((address: string, hop: number) => boolean) {
  if (policy.trustMode === 'off') {
    return false;
  }
  if (policy.trustMode === 'hops') {
    return Math.max(0, policy.maxHops);
  }
  const maxHops = Math.max(1, policy.maxHops);
  return (address: string, hop: number): boolean => {
    if (hop > maxHops) return false;
    return isTrustedProxyIp(address, policy);
  };
}
