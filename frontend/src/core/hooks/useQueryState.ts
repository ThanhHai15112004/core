import { useCallback, useSyncExternalStore } from 'react';

/**
 * Đọc / ghi tham số query trên hash URL (`#path?key=value`). Ghi bằng `replaceState` (không thêm lịch sử)
 * rồi phát `hashchange` để router và các hook khác cập nhật. Giá trị bằng `defaultValue` → xoá khỏi URL.
 */
function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

const getHash = () => window.location.hash;

export function splitHash(hash: string): { path: string; query: URLSearchParams } {
  const raw = hash.replace(/^#/, '');
  const i = raw.indexOf('?');
  return i === -1 ? { path: raw, query: new URLSearchParams() } : { path: raw.slice(0, i), query: new URLSearchParams(raw.slice(i + 1)) };
}

/** Ghi nhiều tham số một lần; `undefined`/`null`/'' = xoá. */
export function setHashQuery(updates: Record<string, string | null | undefined>, mode: 'replace' | 'push' = 'replace'): void {
  const { path, query } = splitHash(window.location.hash);
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null || v === '') query.delete(k);
    else query.set(k, v);
  }
  const qs = query.toString();
  const next = `#${path}${qs ? `?${qs}` : ''}`;
  if (next === window.location.hash) return;
  if (mode === 'push') {
    window.location.hash = next;
    return;
  }
  const old = window.location.href;
  window.history.replaceState(window.history.state, '', next);
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: old, newURL: window.location.href }));
}

export function useQueryState(key: string, defaultValue: string): [string, (value: string | null) => void] {
  const hash = useSyncExternalStore(subscribe, getHash, getHash);
  const value = splitHash(hash).query.get(key) ?? defaultValue;
  const setValue = useCallback((v: string | null) => setHashQuery({ [key]: v === defaultValue ? null : v }), [key, defaultValue]);
  return [value, setValue];
}
