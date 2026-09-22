import { createHash } from 'node:crypto';
import { UNMATCHED_ROUTE, type TrafficRoute } from '../contracts/traffic.types.js';

/** Id ngắn, ổn định cho cặp method + route template (dùng được trên URL). */
export function routeIdOf(method: string, route: string): string {
  return createHash('sha1').update(`${method} ${route}`).digest('hex').slice(0, 12);
}

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, '');

/** Segment đầu tiên sau API prefix, vd. `/api/v1/users/:id` → `users`. */
export function moduleOf(route: string, apiPrefix: string): string {
  if (route === UNMATCHED_ROUTE) return UNMATCHED_ROUTE;
  const prefix = trimSlashes(apiPrefix);
  let path = trimSlashes(route);
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`)))
    path = path.slice(prefix.length);
  const first = trimSlashes(path).split('/')[0] ?? '';
  return first && !first.startsWith(':') ? first : '/';
}

export function buildRoute(
  method: string,
  route: string,
  apiPrefix: string,
  internalModules: readonly string[],
): TrafficRoute {
  const module = moduleOf(route, apiPrefix);
  return {
    id: routeIdOf(method, route),
    method,
    route,
    module,
    internal: internalModules.includes(module),
  };
}

/** Glob đơn giản: `*` khớp mọi ký tự. */
export function matchesGlob(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const regex = new RegExp(
      `^${pattern
        .split('*')
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    );
    return regex.test(value);
  });
}
