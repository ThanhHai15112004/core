import { BadRequestAppException } from '@packages/kernel/index.js';
import { ORG_UNIT_STATUS, ORG_UNIT_TYPE } from '../enum/organizations.enum.js';
import type { OrganizationUnitResponse } from '../responses/organizations.response.js';
import type {
  HierarchyNodeInput,
  OrganizationMoveImpact,
  OrganizationStats,
  OrganizationTreeNode,
} from '../types/organizations.types.js';

/**
 * Tính đường dẫn phân cấp (`/HQ/BRANCH/...`) và độ sâu (`depth`) của một đơn vị trong cây.
 */
export function computeUnitHierarchyPathAndDepth(
  allUnits: ReadonlyArray<{
    readonly id: number;
    readonly code: string;
    readonly parentId?: number | null | undefined;
  }>,
  unitId: number,
  overrideParentId?: number | null,
): { readonly path: string; readonly depth: number } {
  const unitById = new Map<
    number,
    { readonly id: number; readonly code: string; readonly parentId: number | null }
  >();
  for (const u of allUnits) {
    unitById.set(Number(u.id), {
      id: Number(u.id),
      code: u.code,
      parentId: u.parentId !== undefined && u.parentId !== null ? Number(u.parentId) : null,
    });
  }

  const target = unitById.get(Number(unitId));
  if (!target) {
    return { path: '', depth: 1 };
  }

  const codes: string[] = [target.code];
  let cursorParentId: number | null =
    overrideParentId !== undefined ? overrideParentId : target.parentId;
  const visited = new Set<number>([Number(unitId)]);

  while (cursorParentId !== null) {
    if (visited.has(cursorParentId)) break;
    visited.add(cursorParentId);
    const parentNode = unitById.get(cursorParentId);
    if (!parentNode) break;
    codes.unshift(parentNode.code);
    cursorParentId = parentNode.parentId;
  }

  return {
    path: `/${codes.join('/')}`,
    depth: codes.length,
  };
}

/**
 * Kiểm tra toàn diện tính hợp lệ và tính toán tác động khi di chuyển một đơn vị sang `newParentId` mới.
 */
export function validateAndComputeMoveImpact(params: {
  allUnits: ReadonlyArray<{
    readonly id: number;
    readonly code: string;
    readonly name: string;
    readonly parentId?: number | null | undefined;
    readonly status?: number | undefined;
  }>;
  unitId: number;
  newParentId: number | null;
  maxDepth: number;
  affectedUserCount: number;
}): OrganizationMoveImpact {
  const { allUnits, unitId, newParentId, maxDepth, affectedUserCount } = params;
  const target = allUnits.find((u) => Number(u.id) === Number(unitId));
  if (!target) {
    throw new BadRequestAppException('organizations.notFound', [{ id: unitId }]);
  }

  const descendantIds = collectDescendantUnitIds(allUnits, [Number(unitId)], true);
  const subtreeDepthBelow = calculateSubtreeDepthBelow(allUnits, Number(unitId));

  if (newParentId !== null) {
    if (Number(newParentId) === Number(unitId)) {
      throw new BadRequestAppException('organizations.cannotBeOwnParent');
    }
    const parent = allUnits.find((u) => Number(u.id) === Number(newParentId));
    if (!parent) {
      throw new BadRequestAppException('organizations.parentNotFound', [{ parentId: newParentId }]);
    }
    const parentStatus = Number(parent.status ?? ORG_UNIT_STATUS.ACTIVE);
    if (parentStatus !== ORG_UNIT_STATUS.ACTIVE) {
      throw new BadRequestAppException('organizations.parentUnitLocked', [
        { parentId: newParentId, status: parentStatus },
      ]);
    }
    if (descendantIds.includes(Number(newParentId))) {
      throw new BadRequestAppException('organizations.circularParentHierarchy', [
        { id: unitId, parentId: newParentId },
      ]);
    }
    ensureHierarchyDepthAllowed({
      allUnits,
      parentId: Number(newParentId),
      subtreeDepthBelowNode: subtreeDepthBelow,
      maxDepth,
    });
  }

  const oldPos = computeUnitHierarchyPathAndDepth(allUnits, Number(unitId));
  const newPos = computeUnitHierarchyPathAndDepth(allUnits, Number(unitId), newParentId);
  const directChildrenCount = allUnits.filter(
    (u) => Number(u.parentId) === Number(unitId) && Number(u.id) !== Number(unitId),
  ).length;
  const oldParentId =
    target.parentId !== undefined && target.parentId !== null ? Number(target.parentId) : null;

  return {
    unitId: Number(target.id),
    unitCode: target.code,
    unitName: target.name,
    oldParentId,
    newParentId,
    oldPath: oldPos.path,
    newPath: newPos.path,
    oldDepth: oldPos.depth,
    newDepth: newPos.depth,
    maxDepthInMovedSubtree: newPos.depth + subtreeDepthBelow,
    maxDepthAllowed: maxDepth,
    affectedUnitIds: descendantIds,
    affectedUnitCount: descendantIds.length,
    directChildrenCount,
    affectedUserCount,
    requiresPermissionScopeRefresh: oldParentId !== newParentId,
  };
}

/**
 * Tính số lượng tổ tiên phía trên một đơn vị `parentId` (tối thiểu = 1 nếu `parentId` tồn tại).
 */
export function calculateAncestorCount(
  allUnits: readonly HierarchyNodeInput[],
  parentId: number,
): number {
  const parentByUnitId = new Map<number, number | null>();
  for (const unit of allUnits) {
    parentByUnitId.set(
      Number(unit.id),
      unit.parentId !== undefined && unit.parentId !== null ? Number(unit.parentId) : null,
    );
  }

  let ancestorCount = 1;
  let cursor: number | null = Number(parentId);
  const visited = new Set<number>();
  while (cursor !== null) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const nextParent: number | null = parentByUnitId.get(cursor) ?? null;
    if (nextParent !== null) {
      ancestorCount += 1;
    }
    cursor = nextParent;
  }

  return ancestorCount;
}

/**
 * Kiểm tra độ sâu cây đơn vị khi gán vào `parentId` (bao gồm cả độ sâu nhánh con bên dưới nếu đang di chuyển/cập nhật).
 */
export function ensureHierarchyDepthAllowed(params: {
  allUnits: readonly HierarchyNodeInput[];
  parentId: number;
  subtreeDepthBelowNode?: number;
  maxDepth: number;
}): void {
  const { allUnits, parentId, subtreeDepthBelowNode = 0, maxDepth } = params;
  const ancestorCount = calculateAncestorCount(allUnits, parentId);
  const totalDepth = ancestorCount + 1 + subtreeDepthBelowNode;
  if (totalDepth > maxDepth) {
    throw new BadRequestAppException('organizations.maxHierarchyDepthExceeded', [
      { parentId, maxDepth, attemptedDepth: totalDepth },
    ]);
  }
}

/**
 * Tính số tầng con sâu nhất bên dưới một đơn vị (0 nếu không có đơn vị con).
 */
export function calculateSubtreeDepthBelow(
  allUnits: readonly HierarchyNodeInput[],
  unitId: number,
): number {
  const childrenByParent = new Map<number, number[]>();
  for (const unit of allUnits) {
    if (unit.parentId !== undefined && unit.parentId !== null) {
      const pId = Number(unit.parentId);
      const list = childrenByParent.get(pId) ?? [];
      list.push(Number(unit.id));
      childrenByParent.set(pId, list);
    }
  }

  let maxChildDepth = 0;
  const queue: Array<{ id: number; depth: number }> = [{ id: Number(unitId), depth: 0 }];
  const visited = new Set<number>([Number(unitId)]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth > maxChildDepth) {
      maxChildDepth = current.depth;
    }
    for (const childId of childrenByParent.get(current.id) ?? []) {
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push({ id: childId, depth: current.depth + 1 });
      }
    }
  }
  return maxChildDepth;
}

/**
 * Giải quyết danh sách toàn bộ ID đơn vị (bao gồm các đơn vị gốc `rootUnitIds` và toàn bộ đơn vị con trực thuộc theo BFS).
 */
export function collectDescendantUnitIds(
  allUnits: readonly HierarchyNodeInput[],
  rootUnitIds: readonly number[],
  includeInactive = true,
): number[] {
  const seeds = [
    ...new Set(rootUnitIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (seeds.length === 0) return [];

  const childrenByParent = new Map<number, number[]>();
  for (const unit of allUnits) {
    const status = Number(unit.status ?? ORG_UNIT_STATUS.ACTIVE);
    if (status === ORG_UNIT_STATUS.ARCHIVED) continue;
    if (!includeInactive && status === ORG_UNIT_STATUS.INACTIVE) continue;
    if (unit.parentId !== undefined && unit.parentId !== null) {
      const pId = Number(unit.parentId);
      const list = childrenByParent.get(pId) ?? [];
      list.push(Number(unit.id));
      childrenByParent.set(pId, list);
    }
  }

  const visited = new Set<number>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenByParent.get(current) ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push(childId);
      }
    }
  }

  return [...visited].sort((a, b) => a - b);
}

/**
 * Dựng cây sơ đồ tổ chức phân cấp (`OrganizationTreeNode[]`) kèm `depth`, `path`, `childrenCount` và `descendantCount`.
 */
export function buildOrganizationTree(
  units: readonly OrganizationUnitResponse[],
): OrganizationTreeNode[] {
  const unitById = new Map<number, OrganizationUnitResponse>();
  const childrenMap = new Map<number | null, OrganizationUnitResponse[]>();

  for (const unit of units) {
    unitById.set(unit.id, unit);
  }

  for (const unit of units) {
    const effectiveParentId =
      unit.parentId !== null && unitById.has(unit.parentId) && unit.parentId !== unit.id
        ? unit.parentId
        : null;
    const list = childrenMap.get(effectiveParentId) ?? [];
    list.push(unit);
    childrenMap.set(effectiveParentId, list);
  }

  const visited = new Set<number>();

  const buildNode = (
    unit: OrganizationUnitResponse,
    depth: number,
    ancestorsPath: string,
  ): OrganizationTreeNode => {
    visited.add(unit.id);
    const currentPath = `${ancestorsPath}/${unit.code}`;
    const rawChildren = childrenMap.get(unit.id) ?? [];
    const childNodes: OrganizationTreeNode[] = [];
    let descendantCount = 0;

    for (const child of rawChildren) {
      if (visited.has(child.id)) continue;
      const builtChild = buildNode(child, depth + 1, currentPath);
      childNodes.push(builtChild);
      descendantCount += 1 + builtChild.descendantCount;
    }

    return {
      ...unit,
      depth,
      path: currentPath,
      childrenCount: childNodes.length,
      descendantCount,
      children: childNodes,
    };
  };

  const roots = childrenMap.get(null) ?? [];
  return roots.map((root) => buildNode(root, 1, ''));
}

/**
 * Tính toán các chỉ số thống kê tổng quan của sơ đồ tổ chức (`OrganizationStats`).
 */
export function computeOrganizationStats(
  units: readonly OrganizationUnitResponse[],
  maxDepthAllowed: number,
): OrganizationStats {
  const tree = buildOrganizationTree(units);
  let maxDepthObserved = 0;

  const walkDepth = (nodes: readonly OrganizationTreeNode[]) => {
    for (const node of nodes) {
      if (node.depth > maxDepthObserved) {
        maxDepthObserved = node.depth;
      }
      if (node.children.length > 0) {
        walkDepth(node.children);
      }
    }
  };
  walkDepth(tree);

  let activeUnits = 0;
  let inactiveUnits = 0;
  let archivedUnits = 0;
  let headquarters = 0;
  let branch = 0;
  let department = 0;
  let team = 0;
  let custom = 0;

  for (const u of units) {
    if (u.status === ORG_UNIT_STATUS.ACTIVE) activeUnits++;
    else if (u.status === ORG_UNIT_STATUS.INACTIVE) inactiveUnits++;
    else if (u.status === ORG_UNIT_STATUS.ARCHIVED) archivedUnits++;

    if (u.type === ORG_UNIT_TYPE.HEADQUARTERS) headquarters++;
    else if (u.type === ORG_UNIT_TYPE.BRANCH) branch++;
    else if (u.type === ORG_UNIT_TYPE.DEPARTMENT) department++;
    else if (u.type === ORG_UNIT_TYPE.TEAM) team++;
    else custom++;
  }

  return {
    totalUnits: units.length,
    activeUnits,
    inactiveUnits,
    archivedUnits,
    rootUnits: tree.length,
    maxDepthObserved,
    maxDepthAllowed,
    byType: {
      headquarters,
      branch,
      department,
      team,
      custom,
    },
  };
}
