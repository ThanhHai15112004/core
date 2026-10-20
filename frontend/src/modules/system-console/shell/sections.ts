import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Boxes,
  Clock,
  Cpu,
  Database,
  FileText,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Package,
  Radio,
  Settings2,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { TimeRange } from '@core/constants/ui.constants';
import type { ConsoleMenuTreeNode, ConsoleSectionId } from '../types/console.types';
import { LOGS_RANGES } from '../constants/logs';
import { MESSAGING_RANGES } from '../constants/messaging';
import { OVERVIEW_RANGES } from '../constants/overview';
import { TRAFFIC_RANGES, TRAFFIC_TABS } from '../constants/traffic';
import { routeIdOf } from '../utils/traffic-format';
import { SCHEDULER_RANGES, SCHEDULER_TABS } from '../constants/scheduler';
import { RUNTIME_RANGES } from '../constants/runtime-metrics';
import { PERF_RANGES, PERF_TABS } from '../constants/performance';
import { DB_RANGES, DB_TABS } from '../constants/database';
import { WORKER_PAGE_TABS, WORKER_RANGES } from '../constants/worker';
import { JOBS_RANGES, JOBS_TABS, SHORT_ID_HEAD } from '../constants/jobs';
import { CACHE_RANGES } from '../constants/cache';
import { STORAGE_RANGES } from '../constants/storage';

type Translate = (path: string, params?: Record<string, string | number>) => string;

export const SECTION_GROUPS = ['runtime-traffic', 'infrastructure', 'background', 'governance'] as const;
export type SectionGroupId = (typeof SECTION_GROUPS)[number];

export interface SectionDef {
  id: ConsoleSectionId;
  /** `null` = mục gốc đứng đầu (Overview). Nhãn: `nav.group.<id>`. */
  group: SectionGroupId | null;
  icon: LucideIcon;
  component: LazyExoticComponent<ComponentType> | ComponentType;
  /**
   * Trang đã dùng bộ điều khiển chung trên thanh trên cùng (làm mới + khoảng thời gian).
   * Bỏ trống = trang cũ tự quản lý → ẩn các bộ điều khiển đó.
   */
  controls?: { ranges?: readonly TimeRange[] };
  /** Nhãn segment con trên breadcrumb (`params` = các segment sau id section). */
  crumb?: (params: string[], t: Translate) => string | null;
  /** Từ khoá tìm thêm trong Ctrl K. */
  keywords?: string[];
}

const load = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));

const tabCrumb = (ns: string) => (params: string[], t: Translate) => (params[0] ? t(`${ns}.tab.${params[0]}`) : null);

/** Danh mục section — nguồn duy nhất cho sidebar, router, breadcrumb và Ctrl K. Thứ tự = thứ tự trên sidebar. */
export const SECTIONS: SectionDef[] = [
  {
    id: 'overview',
    group: null,
    icon: LayoutDashboard,
    component: load(() => import('../sections/overview/OverviewSection'), 'OverviewSection'),
    controls: { ranges: OVERVIEW_RANGES },
  },
  {
    id: 'runtimes',
    group: 'runtime-traffic',
    icon: Cpu,
    component: load(() => import('../sections/runtimes/RuntimesSection'), 'RuntimesSection'),
    controls: { ranges: RUNTIME_RANGES },
    crumb: (p, t) => (p[0] ? t(`rt.name.${p[0]}`) : null),
    keywords: ['api', 'worker', 'scheduler', 'process'],
  },
  {
    id: 'http-traffic',
    group: 'runtime-traffic',
    icon: Globe,
    component: load(() => import('../sections/traffic/TrafficSection'), 'TrafficSection'),
    controls: { ranges: TRAFFIC_RANGES },
    crumb: (p, t) => (p[0] === 'endpoints' && p.length > 1 ? routeIdOf(p.slice(1)) : p[0] && (TRAFFIC_TABS as readonly string[]).includes(p[0]) ? t(`tr.tab.${p[0]}`) : null),
    keywords: ['http', 'request', 'endpoint'],
  },
  {
    id: 'performance',
    group: 'runtime-traffic',
    icon: Gauge,
    component: load(() => import('../sections/performance/PerformanceSection'), 'PerformanceSection'),
    controls: { ranges: PERF_RANGES },
    crumb: (p, t) => ((PERF_TABS as readonly string[]).includes(p[0] ?? '') ? t(`perf.tab.${p[0]}`) : null),
    keywords: ['latency', 'bottleneck', 'cpu'],
  },
  {
    id: 'database',
    group: 'infrastructure',
    icon: Database,
    component: load(() => import('../sections/database/DatabaseSection'), 'DatabaseSection'),
    controls: { ranges: DB_RANGES },
    crumb: (p, t) => (p[0] && (DB_TABS as readonly string[]).includes(p[0]) ? t(`db.tab.${p[0]}`) : null),
    keywords: ['mysql', 'sql', 'migration', 'session'],
  },
  {
    id: 'cache',
    group: 'infrastructure',
    icon: Zap,
    component: load(() => import('../sections/cache/CacheSection'), 'CacheSection'),
    controls: { ranges: CACHE_RANGES },
    crumb: tabCrumb('cache'),
    keywords: ['redis', 'namespace', 'key'],
  },
  {
    id: 'storage',
    group: 'infrastructure',
    icon: HardDrive,
    component: load(() => import('../sections/storage/StorageSection'), 'StorageSection'),
    controls: { ranges: STORAGE_RANGES },
    crumb: tabCrumb('storage'),
    keywords: ['file', 's3', 'bucket', 'upload'],
  },
  {
    id: 'messaging',
    group: 'infrastructure',
    icon: Radio,
    component: load(() => import('../sections/messaging/MessagingSection'), 'MessagingSection'),
    controls: { ranges: MESSAGING_RANGES },
    crumb: tabCrumb('messaging'),
    keywords: ['queue', 'broker'],
  },
  {
    id: 'worker',
    group: 'background',
    icon: Boxes,
    component: load(() => import('../sections/worker/WorkerSection'), 'WorkerSection'),
    controls: { ranges: WORKER_RANGES },
    crumb: (p, t) => (p[0] === 'queues' && p[1] ? p[1] : (WORKER_PAGE_TABS as readonly string[]).includes(p[0] ?? '') ? t(`wq.tab.${p[0]}`) : null),
    keywords: ['queue', 'bullmq'],
  },
  {
    id: 'scheduler',
    group: 'background',
    icon: Clock,
    component: load(() => import('../sections/scheduler/SchedulerSection'), 'SchedulerSection'),
    controls: { ranges: SCHEDULER_RANGES },
    crumb: (p, t) => (p[0] === 'tasks' && p[1] ? p[1] : (SCHEDULER_TABS as readonly string[]).includes(p[0] ?? '') ? t(`sch.tab.${p[0]}`) : null),
    keywords: ['cron', 'task'],
  },
  {
    id: 'jobs',
    group: 'background',
    icon: ListChecks,
    component: load(() => import('../sections/jobs/JobsSection'), 'JobsSection'),
    controls: { ranges: JOBS_RANGES },
    crumb: (p, t) => (p[0] === 'job' ? `#${(p[1] ?? '').slice(0, SHORT_ID_HEAD)}` : (JOBS_TABS as readonly string[]).includes(p[0]) ? t(`jobs.tab.${p[0]}`) : null),
    keywords: ['job', 'retry', 'failed'],
  },
  {
    id: 'logs',
    group: 'governance',
    icon: FileText,
    component: load(() => import('../sections/logs/LogsSection'), 'LogsSection'),
    controls: { ranges: LOGS_RANGES },
    crumb: (p, t) => (p[0] === 'traces' ? t('logs.tab.traces') : p[0] ? t(`logs.tab.${p[0]}`) : null),
    keywords: ['log', 'error', 'trace', 'audit'],
  },
  {
    id: 'security',
    group: 'governance',
    icon: ShieldCheck,
    component: load(() => import('../sections/security/SecuritySection'), 'SecuritySection'),
    controls: {},
    keywords: ['jwt', 'auth'],
  },
  {
    id: 'secrets',
    group: 'governance',
    icon: KeyRound,
    component: load(() => import('../sections/security/SecretsSection'), 'SecretsSection'),
    controls: {},
    keywords: ['secret', 'key'],
  },
  {
    id: 'configuration',
    group: 'governance',
    icon: Settings2,
    component: load(() => import('../sections/security/ConfigurationSection'), 'ConfigurationSection'),
    controls: {},
    keywords: ['env', 'config'],
  },
  {
    id: 'packages',
    group: 'governance',
    icon: Package,
    component: load(() => import('../sections/packages/PackagesSection'), 'PackagesSection'),
    controls: {},
    keywords: ['package', 'action'],
  },
];

const SECTION_MAP = new Map<string, SectionDef>(SECTIONS.map((s) => [s.id, s]));

/** Id cũ trong hash/localStorage → id mới. */
const SECTION_ALIASES: Record<string, ConsoleSectionId> = { runtime: 'runtimes' };

const MENU_CODE_TO_SECTION: Record<string, ConsoleSectionId> = {
  SC_OVERVIEW: 'overview',
  SC_RUNTIMES: 'runtimes',
  SC_HTTP_TRAFFIC: 'http-traffic',
  SC_PERFORMANCE: 'performance',
  SC_DATABASE: 'database',
  SC_CACHE: 'cache',
  SC_STORAGE: 'storage',
  SC_MESSAGING: 'messaging',
  SC_WORKER: 'worker',
  SC_SCHEDULER: 'scheduler',
  SC_JOBS: 'jobs',
  SC_LOGS: 'logs',
  SC_SECURITY: 'security',
  SC_SECRETS: 'secrets',
  SC_CONFIGURATION: 'configuration',
  SC_PACKAGES: 'packages',
};

const MENU_CODE_TO_GROUP: Record<string, SectionGroupId> = {
  SC_GROUP_RUNTIME: 'runtime-traffic',
  SC_GROUP_INFRA: 'infrastructure',
  SC_GROUP_BACKGROUND: 'background',
  SC_GROUP_GOVERNANCE: 'governance',
};

const ICON_BY_NAME: Record<string, LucideIcon> = {
  Boxes,
  Clock,
  Cpu,
  Database,
  FileText,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Package,
  Radio,
  Settings2,
  ShieldCheck,
  Zap,
};

export function resolveSection(raw: string | null | undefined): ConsoleSectionId | null {
  if (!raw) return null;
  return SECTION_MAP.get(SECTION_ALIASES[raw] ?? raw)?.id ?? null;
}

/** Ánh xạ một mục menu động từ DB (`link` hoặc `code`) sang `ConsoleSectionId`. */
export function resolveSectionFromMenuNode(node: { code?: string | null; link?: string | null }): ConsoleSectionId | null {
  if (node.link) {
    const clean = node.link.replace(/^\/+/, '').replace(/^system-console\/?/i, '');
    const seg = clean.split(/[/?]/)[0];
    const resolved = resolveSection(seg);
    if (resolved) return resolved;
  }
  if (node.code) {
    const byCode = MENU_CODE_TO_SECTION[node.code.trim().toUpperCase()];
    if (byCode) return byCode;
  }
  return null;
}

/** Ánh xạ mã nhóm menu (`SC_GROUP_*`) sang `SectionGroupId` để lấy bản dịch đa ngôn ngữ chuẩn. */
export function resolveGroupFromMenuCode(code?: string | null): SectionGroupId | null {
  if (!code) return null;
  return MENU_CODE_TO_GROUP[code.trim().toUpperCase()] ?? null;
}

/** Ánh xạ tên icon từ DB (`"Zap"`, `"Database"`, ...) sang component `LucideIcon`. */
export function resolveMenuIcon(iconName?: string | null, fallback: LucideIcon = LayoutDashboard): LucideIcon {
  if (!iconName) return fallback;
  return ICON_BY_NAME[iconName.trim()] ?? fallback;
}

export interface MenuSectionOverride {
  name?: string | null;
  icon?: string | null;
}

/**
 * Duyệt đệ quy cây menu động từ DB để thu thập tập các `ConsoleSectionId` được phép hiển thị
 * cùng thông tin ghi đè (`name`, `icon`). Bỏ qua các nút nhóm (`type === 1`) không trỏ trực tiếp tới section.
 */
export function collectMenuSectionMap(
  nodes: readonly ConsoleMenuTreeNode[] | null | undefined,
): Map<ConsoleSectionId, MenuSectionOverride> | null {
  if (!nodes) return null;
  const map = new Map<ConsoleSectionId, MenuSectionOverride>();

  const walk = (list: readonly ConsoleMenuTreeNode[]) => {
    for (const node of list) {
      if (node.children && node.children.length > 0) {
        walk(node.children);
      } else if (node.type !== 1) {
        const secId = resolveSectionFromMenuNode(node);
        if (secId && !map.has(secId)) {
          map.set(secId, { name: node.name, icon: node.icon });
        }
      }
    }
  };

  walk(nodes);
  return map;
}

export const sectionDef = (id: ConsoleSectionId): SectionDef => SECTION_MAP.get(id) ?? SECTIONS[0];
