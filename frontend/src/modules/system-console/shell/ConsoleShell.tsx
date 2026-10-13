import React, { useMemo } from 'react';
import { ArrowLeft, Home, Languages, Moon, RefreshCw, Server } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useTheme, toneOf, worstTone, type Tone } from '@core/theme';
import { useLive, useTimeRange } from '@core/data';
import { formatDuration } from '@core/lib/format';
import { API_LATENCY_THRESHOLD_MS } from '@core/constants/ui.constants';
import { Badge, Hint } from '@core/ui/primitives';
import { StatusDot } from '@core/ui/blocks/StatusDot';
import {
  AppShell,
  Breadcrumb,
  CommandPalette,
  LocaleToggle,
  RefreshControl,
  Sidebar,
  ThemeToggle,
  TimeRangePicker,
  TopBar,
  type CommandSection,
  type Crumb,
  type NavGroup,
} from '@core/ui/layout';
import { navigateTo } from '@core/router';
import { ROUTES } from '../../../routes/index';
import { useConsoleData } from '../context/console-data-context';
import { useConsoleRoute } from '../context/console-route-context';
import { ENV_TONE } from '../constants/console.constants';
import { SECTION_GROUPS, SECTIONS, sectionDef } from './sections';

const goHome = () => navigateTo(ROUTES.HOME);

/** Khung System Console: sidebar theo registry, breadcrumb, bộ điều khiển chung, Ctrl K. */
export const ConsoleShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, toggleLocale } = useLocale();
  const { toggleTheme } = useTheme();
  const { refreshNow } = useLive();
  const { route, navigate } = useConsoleRoute();
  const { overview, packages, currentLatency, isOffline, environment } = useConsoleData();
  const def = sectionDef(route.section);
  const effectiveRange = useTimeRange(def.controls?.ranges);

  /* Chấm trạng thái = tông tệ nhất của các thành phần trong health map trỏ về section. */
  const sectionTone = useMemo(() => {
    const map = new Map<string, Tone>();
    for (const item of overview?.healthMap ?? []) {
      const id = item.targetSection.split(/[/?]/)[0] ?? '';
      const tone = worstTone([map.get(id), toneOf(item.status)].filter((x): x is Tone => Boolean(x)));
      if (tone) map.set(id, tone);
    }
    return map;
  }, [overview?.healthMap]);

  const problemPackages = packages.filter((p) => p.statusReport.status === 'warning' || p.statusReport.status === 'error').length;

  const groups: NavGroup[] = useMemo(() => {
    const item = (s: (typeof SECTIONS)[number]) => ({
      id: s.id,
      label: t(`nav.${s.id}`),
      icon: s.icon,
      tone: sectionTone.get(s.id),
      ...(s.id === 'packages' ? { count: problemPackages, countLabel: t('ov.sidebar.problemPackages') } : {}),
    });
    return [
      { id: 'root', items: SECTIONS.filter((s) => s.group === null).map(item) },
      ...SECTION_GROUPS.map((g) => ({ id: g, label: t(`nav.group.${g}`), items: SECTIONS.filter((s) => s.group === g).map(item) })),
    ];
  }, [t, sectionTone, problemPackages]);

  const crumbs: Crumb[] = useMemo(() => {
    const detail = def.crumb?.(route.params, t) ?? null;
    const list: Crumb[] = [{ label: t('nav.systemConsole'), onClick: () => navigate('overview') }];
    list.push({ label: t(`nav.${def.id}`), onClick: detail ? () => navigate(def.id) : undefined });
    if (detail) list.push({ label: detail });
    return list;
  }, [def, route.params, t, navigate]);

  const commands: CommandSection[] = useMemo(
    () => [
      {
        id: 'pages',
        heading: t('ui.command.pages'),
        items: SECTIONS.map((s) => ({
          id: s.id,
          label: t(`nav.${s.id}`),
          icon: s.icon,
          keywords: [s.id, ...(s.keywords ?? [])],
          hint: s.group ? t(`nav.group.${s.group}`) : undefined,
          onSelect: () => navigate(s.id),
        })),
      },
      {
        id: 'actions',
        heading: t('ui.command.actions'),
        items: [
          { id: 'refresh', label: t('ui.action.refresh'), icon: RefreshCw, onSelect: refreshNow },
          { id: 'theme', label: t('ui.theme.toggle'), icon: Moon, onSelect: toggleTheme },
          { id: 'locale', label: t('ui.locale.toggle'), icon: Languages, onSelect: toggleLocale },
          { id: 'home', label: t('nav.backToHome'), icon: Home, onSelect: goHome },
        ],
      },
    ],
    [t, navigate, refreshNow, toggleTheme, toggleLocale],
  );

  const latencyTone: Tone = isOffline
    ? 'crit'
    : currentLatency >= API_LATENCY_THRESHOLD_MS.crit
      ? 'crit'
      : currentLatency >= API_LATENCY_THRESHOLD_MS.warn
        ? 'warn'
        : 'ok';

  const topbar = (
    <TopBar
      left={<Breadcrumb items={crumbs} ariaLabel={t('nav.systemConsole')} />}
      right={
        <>
          <CommandPalette sections={commands} />
          {environment && (
            <Badge tone={ENV_TONE[environment]} className="hidden md:inline-flex" title={t('ov.env.tooltip')}>
              {t(`ov.env.${environment}`)}
            </Badge>
          )}
          {def.controls?.ranges && <TimeRangePicker options={def.controls.ranges} value={effectiveRange} />}
          {def.controls && <RefreshControl />}
          <Hint content={t('console.topbar.latency')}>
            <Badge tone={latencyTone} variant="outline" className={isOffline ? 'hidden sm:inline-flex' : 'hidden font-mono sm:inline-flex'}>
              <StatusDot tone={latencyTone} size="xs" />
              {isOffline ? t('console.healthStatus.down') : formatDuration(currentLatency)}
            </Badge>
          </Hint>
          <LocaleToggle />
          <ThemeToggle />
        </>
      }
    />
  );

  return (
    <AppShell
      topbar={topbar}
      sidebar={({ rail, onNavigate }) => (
        <Sidebar
          brand={{ icon: Server, title: t('nav.systemConsole'), subtitle: t('ov.sidebar.subtitle') }}
          groups={groups}
          activeId={route.section}
          onSelect={(id) => navigate(id)}
          rail={rail}
          onNavigate={onNavigate}
          footer={(isRail) => (
            <button
              type="button"
              onClick={goHome}
              className={
                isRail
                  ? 'mb-1 flex h-8 w-full items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-fg'
                  : 'mb-1 flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-muted hover:bg-panel-2 hover:text-fg'
              }
              aria-label={t('nav.backToHome')}
            >
              <ArrowLeft className="size-4" />
              {!isRail && <span>{t('nav.backToHome')}</span>}
            </button>
          )}
        />
      )}
    >
      {children}
    </AppShell>
  );
};
