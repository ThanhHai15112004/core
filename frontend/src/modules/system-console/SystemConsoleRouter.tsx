import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo } from 'react';
import type { ConsolePath, ConsoleSectionId } from './types/console.types';
import { CONSOLE_STORAGE_KEYS } from './constants/console.constants';
import { findNavLeaf, LEGACY_SECTION_ALIASES } from './constants/console-nav';
import { ConsoleRouteContext, type ConsoleRoute } from './context/console-route-context';
import { ConsoleLayout } from './layouts/ConsoleLayout';
import { OverviewSection } from './sections/OverviewSection';
import { PackagesSection } from './sections/PackagesSection';
import { LogViewerSection } from './sections/LogViewerSection';
import { SecuritySection } from './sections/SecuritySection';
import { PlannedSection } from './sections/PlannedSection';
import { ROUTES } from '../../routes/index';

// Các trang lớn tải theo nhu cầu (tách chunk) để bundle ban đầu nhỏ.
const RuntimesSection = lazy(() => import('./sections/runtimes/RuntimesSection').then((m) => ({ default: m.RuntimesSection })));
const TrafficSection = lazy(() => import('./sections/traffic/TrafficSection').then((m) => ({ default: m.TrafficSection })));
const PerformanceSection = lazy(() => import('./sections/performance/PerformanceSection').then((m) => ({ default: m.PerformanceSection })));
const DatabaseSection = lazy(() => import('./sections/database/DatabaseSection').then((m) => ({ default: m.DatabaseSection })));
const CacheSection = lazy(() => import('./sections/cache/CacheSection').then((m) => ({ default: m.CacheSection })));
const StorageSection = lazy(() => import('./sections/storage/StorageSection').then((m) => ({ default: m.StorageSection })));

const HASH_PREFIX = ROUTES.SYSTEM_CONSOLE.replace(/^#/, '');

function readLastSection(): string | null {
  try {
    return localStorage.getItem(CONSOLE_STORAGE_KEYS.LAST_SECTION);
  } catch {
    return null;
  }
}

function resolveSection(raw: string | null | undefined): ConsoleSectionId | null {
  if (!raw) return null;
  const id = LEGACY_SECTION_ALIASES[raw] ?? raw;
  return findNavLeaf(id)?.id ?? null;
}

/** `#system-console/runtimes/worker/metrics?x=1` → `{ section, params, query }`. */
function parseRoute(): ConsoleRoute {
  const [pathPart = '', queryPart = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const inConsole = segments[0] === HASH_PREFIX;
  const section = (inConsole ? resolveSection(segments[1]) : null) ?? resolveSection(readLastSection()) ?? 'overview';
  return {
    section,
    params: inConsole && resolveSection(segments[1]) ? segments.slice(2) : [],
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
        // Ignore
      }
    }
    window.location.hash = `#${HASH_PREFIX}/${clean}`;
  }, []);

  const value = useMemo(() => ({ route, navigate }), [route, navigate]);

  const renderSection = () => {
    const leaf = findNavLeaf(route.section);
    if (leaf?.status === 'planned') return <PlannedSection sectionId={route.section} />;

    switch (route.section) {
      case 'runtimes':
        return <RuntimesSection />;
      case 'http-traffic':
        return <TrafficSection />;
      case 'performance':
        return <PerformanceSection />;
      case 'packages':
        return <PackagesSection />;
      case 'logs':
        return <LogViewerSection />;
      case 'database':
        return <DatabaseSection />;
      case 'cache':
        return <CacheSection />;
      case 'storage':
        return <StorageSection />;
      case 'security':
        return <SecuritySection />;
      default:
        return <OverviewSection onNavigate={navigate} />;
    }
  };

  return (
    <ConsoleRouteContext.Provider value={value}>
      <ConsoleLayout currentSection={route.section} onNavigate={navigate}>
        <Suspense fallback={<p className="ov-empty-line">…</p>}>{renderSection()}</Suspense>
      </ConsoleLayout>
    </ConsoleRouteContext.Provider>
  );
};
