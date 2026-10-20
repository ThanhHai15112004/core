import React, { Suspense, lazy, useCallback, useEffect, useMemo } from 'react';
import { navigateTo, useLocation } from '@core/router';
import type { ConsolePath, ConsoleSectionId } from './types/console.types';
import { CONSOLE_STORAGE_KEYS } from './constants/console.constants';
import { useConsoleData } from './context/console-data-context';
import { ConsoleRouteContext, type ConsoleRoute } from './context/console-route-context';
import { ConsoleShell } from './shell/ConsoleShell';
import { collectMenuSectionMap, resolveSection, sectionDef } from './shell/sections';
import { ROUTES } from '../../routes/index';

const BASE = ROUTES.SYSTEM_CONSOLE;

/** Trang duyệt bộ UI dùng chung — chỉ có ở dev (`/system-console/_kit`). */
const KIT_SEGMENT = '_kit';
const KitPage = import.meta.env.DEV ? lazy(() => import('@core/ui/kit/KitPage').then((m) => ({ default: m.KitPage }))) : null;

function readLastSection(): string | null {
  try {
    return localStorage.getItem(CONSOLE_STORAGE_KEYS.LAST_SECTION);
  } catch {
    return null;
  }
}

function rememberSection(section: string): void {
  try {
    localStorage.setItem(CONSOLE_STORAGE_KEYS.LAST_SECTION, section);
  } catch {
    /* chỉ giữ trong phiên */
  }
}

/** Các segment sau `/system-console` (đã decode). */
const segmentsOf = (pathname: string) => pathname.slice(BASE.length).split('/').filter(Boolean).map(decodeURIComponent);

/**
 * Router của System Console trên đường dẫn thật: `/system-console/<section>/<...params>?query`.
 * `/system-console` (không section) mở section dùng gần nhất.
 */
export const SystemConsoleRouter: React.FC = () => {
  const { pathname, search } = useLocation();
  const { menuTree } = useConsoleData();
  const segments = useMemo(() => segmentsOf(pathname), [pathname]);
  const fromUrl = resolveSection(segments[0]);
  const isKit = KitPage !== null && segments[0] === KIT_SEGMENT;

  const allowedSections = useMemo<Set<ConsoleSectionId> | null>(() => {
    const map = collectMenuSectionMap(menuTree);
    return map ? new Set(map.keys()) : null;
  }, [menuTree]);

  // Không có / sai section hoặc section đã bị tắt trên menu động → chuyển sang section hợp lệ gần nhất.
  useEffect(() => {
    if (isKit) return;
    const isBlockedByMenu =
      fromUrl !== null &&
      allowedSections !== null &&
      allowedSections.size > 0 &&
      !allowedSections.has(fromUrl);

    if (fromUrl && !isBlockedByMenu) return;

    const lastSec = resolveSection(readLastSection());
    const fallbackSec =
      lastSec && (!allowedSections || allowedSections.size === 0 || allowedSections.has(lastSec))
        ? lastSec
        : allowedSections && allowedSections.size > 0
          ? Array.from(allowedSections)[0]
          : 'overview';
    navigateTo(`${BASE}/${fallbackSec}${window.location.search}`, 'replace');
  }, [fromUrl, isKit, allowedSections]);

  // Đổi trang (không phải đổi query) → về đầu trang.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const route: ConsoleRoute = useMemo(
    () => ({ section: fromUrl ?? 'overview', params: fromUrl ? segments.slice(1) : [], query: search }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromUrl, segments, search.toString()],
  );

  const navigate = useCallback((path: ConsolePath) => {
    const clean = path.replace(/^\/+/, '');
    const section = resolveSection(clean.split(/[/?]/)[0]);
    if (section) rememberSection(section);
    navigateTo(`${BASE}/${clean}`);
  }, []);

  const value = useMemo(() => ({ route, navigate }), [route, navigate]);
  const Section = sectionDef(route.section).component;

  return (
    <ConsoleRouteContext.Provider value={value}>
      <ConsoleShell>
        <Suspense fallback={null}>{isKit && KitPage ? <KitPage /> : fromUrl ? <Section key={route.section} /> : null}</Suspense>
      </ConsoleShell>
    </ConsoleRouteContext.Provider>
  );
};
