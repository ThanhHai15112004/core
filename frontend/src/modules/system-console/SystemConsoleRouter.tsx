import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { ConsolePath } from './types/console.types';
import { CONSOLE_STORAGE_KEYS } from './constants/console.constants';
import { ConsoleRouteContext, type ConsoleRoute } from './context/console-route-context';
import { ConsoleShell } from './shell/ConsoleShell';
import { resolveSection, sectionDef } from './shell/sections';
import { ROUTES } from '../../routes/index';

const HASH_PREFIX = ROUTES.SYSTEM_CONSOLE.replace(/^#/, '');

/** Trang duyệt bộ UI dùng chung — chỉ có ở dev (`#system-console/_kit`). */
const KIT_SEGMENT = '_kit';
const KitPage = import.meta.env.DEV ? lazy(() => import('@core/ui/kit/KitPage').then((m) => ({ default: m.KitPage }))) : null;
const isKitRoute = () => KitPage !== null && window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[1] === KIT_SEGMENT;

function readLastSection(): string | null {
  try {
    return localStorage.getItem(CONSOLE_STORAGE_KEYS.LAST_SECTION);
  } catch {
    return null;
  }
}

/** `#system-console/runtimes/worker/metrics?x=1` → `{ section, params, query }`. */
function parseRoute(): ConsoleRoute {
  const [pathPart = '', queryPart = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const segments = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const inConsole = segments[0] === HASH_PREFIX;
  const fromUrl = inConsole ? resolveSection(segments[1]) : null;
  return {
    section: fromUrl ?? resolveSection(readLastSection()) ?? 'overview',
    params: fromUrl ? segments.slice(2) : [],
    query: new URLSearchParams(queryPart),
  };
}

export const SystemConsoleRouter: React.FC = () => {
  const [route, setRoute] = useState<ConsoleRoute>(parseRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = useCallback((path: ConsolePath) => {
    const clean = path.replace(/^\/+/, '');
    const section = resolveSection(clean.split(/[/?]/)[0]);
    if (section) {
      try {
        localStorage.setItem(CONSOLE_STORAGE_KEYS.LAST_SECTION, section);
      } catch {
        /* chỉ giữ trong phiên */
      }
    }
    window.location.hash = `#${HASH_PREFIX}/${clean}`;
  }, []);

  const value = useMemo(() => ({ route, navigate }), [route, navigate]);
  const Section = sectionDef(route.section).component;
  const showKit = KitPage !== null && isKitRoute();

  return (
    <ConsoleRouteContext.Provider value={value}>
      <ConsoleShell>
        <Suspense fallback={null}>
          {showKit && KitPage ? <KitPage /> : <Section key={route.section} />}
        </Suspense>
      </ConsoleShell>
    </ConsoleRouteContext.Provider>
  );
};
