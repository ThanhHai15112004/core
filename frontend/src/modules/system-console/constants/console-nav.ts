import type { ConsoleSectionId } from '../types/console.types';

export type NavItemStatus = 'ready' | 'planned';

export interface NavLeaf {
  id: ConsoleSectionId;
  /** `planned`: chưa triển khai — hiển thị trang "Sắp có", không dùng dữ liệu giả. */
  status: NavItemStatus;
}

export interface NavGroup {
  id: string;
  icon: string;
  children: NavLeaf[];
}

/** Mục đơn ở đầu (không có con). */
export const NAV_ROOT: NavLeaf = { id: 'overview', status: 'ready' };

/** Cây điều hướng System Console. Nhãn: `nav.<id>`, `nav.group.<groupId>`. */
export const NAV_TREE: NavGroup[] = [
  {
    id: 'runtime-traffic',
    icon: 'activity',
    children: [
      { id: 'runtimes', status: 'ready' },
      { id: 'http-traffic', status: 'planned' },
      { id: 'performance', status: 'planned' },
    ],
  },
  {
    id: 'infrastructure',
    icon: 'database',
    children: [
      { id: 'database', status: 'ready' },
      { id: 'cache', status: 'ready' },
      { id: 'storage', status: 'planned' },
      { id: 'messaging', status: 'planned' },
    ],
  },
  {
    id: 'background',
    icon: 'worker',
    children: [
      { id: 'worker', status: 'planned' },
      { id: 'scheduler', status: 'planned' },
      { id: 'jobs', status: 'planned' },
    ],
  },
  {
    id: 'governance',
    icon: 'security',
    children: [
      { id: 'logs', status: 'ready' },
      { id: 'security', status: 'ready' },
      { id: 'secrets', status: 'planned' },
      { id: 'configuration', status: 'planned' },
      { id: 'packages', status: 'ready' },
    ],
  },
];

export const ALL_SECTIONS: NavLeaf[] = [NAV_ROOT, ...NAV_TREE.flatMap((g) => g.children)];

export const findNavLeaf = (id: string): NavLeaf | undefined => ALL_SECTIONS.find((l) => l.id === id);

export const groupOf = (id: ConsoleSectionId): NavGroup | undefined =>
  NAV_TREE.find((g) => g.children.some((c) => c.id === id));

/** Id cũ trong hash/localStorage → id mới. */
export const LEGACY_SECTION_ALIASES: Record<string, ConsoleSectionId> = { runtime: 'runtimes' };
