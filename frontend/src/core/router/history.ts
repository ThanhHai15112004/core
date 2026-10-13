import { useCallback, useSyncExternalStore } from 'react';

/**
 * Router tối giản dựa trên History API (đường dẫn thật, không dùng `#`).
 * Mọi thay đổi URL đi qua `navigateTo` / `setSearchParams` → phát sự kiện để các hook cập nhật.
 */
const LOCATION_EVENT = 'app:locationchange';

export type NavigateMode = 'push' | 'replace';

export function navigateTo(url: string, mode: NavigateMode = 'push'): void {
  const target = new URL(url, window.location.origin);
  const next = `${target.pathname}${target.search}${target.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  if (mode === 'replace') window.history.replaceState(window.history.state, '', next);
  else window.history.pushState(null, '', next);
  window.dispatchEvent(new Event(LOCATION_EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener(LOCATION_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(LOCATION_EVENT, cb);
  };
}

const snapshot = () => `${window.location.pathname}${window.location.search}`;

export interface AppLocation {
  pathname: string;
  search: URLSearchParams;
}

/** Vị trí hiện tại (pathname + query), cập nhật khi điều hướng hoặc Back/Forward. */
export function useLocation(): AppLocation {
  const key = useSyncExternalStore(subscribe, snapshot, snapshot);
  const i = key.indexOf('?');
  return { pathname: i === -1 ? key : key.slice(0, i), search: new URLSearchParams(i === -1 ? '' : key.slice(i + 1)) };
}

/** Ghi nhiều tham số query một lần, giữ nguyên đường dẫn; `null`/`undefined`/'' = xoá. */
export function setSearchParams(updates: Record<string, string | null | undefined>, mode: NavigateMode = 'replace'): void {
  const query = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null || v === '') query.delete(k);
    else query.set(k, v);
  }
  const qs = query.toString();
  navigateTo(`${window.location.pathname}${qs ? `?${qs}` : ''}`, mode);
}

/** Một tham số query; bằng `defaultValue` → xoá khỏi URL. */
export function useQueryState(key: string, defaultValue: string): [string, (value: string | null) => void] {
  const { search } = useLocation();
  const value = search.get(key) ?? defaultValue;
  const setValue = useCallback((v: string | null) => setSearchParams({ [key]: v === defaultValue ? null : v }), [key, defaultValue]);
  return [value, setValue];
}

/**
 * Chuyển link kiểu cũ `/#<prefix>/a/b?x=1` sang `/<prefix>/a/b?x=1` (bookmark cũ vẫn mở đúng trang).
 * Gọi một lần lúc khởi động.
 */
export function migrateHashUrl(prefix: string): void {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const name = prefix.replace(/^\//, '');
  if (hash === name || hash.startsWith(`${name}/`) || hash.startsWith(`${name}?`)) {
    window.history.replaceState(window.history.state, '', `/${hash}`);
  }
}
