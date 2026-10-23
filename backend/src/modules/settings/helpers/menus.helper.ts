import {
  MENU_POSITION,
  MENU_STATUS,
  MENU_STATUS_NAME_BY_CODE,
  MENU_TYPE,
  MENU_TYPE_NAME_BY_CODE,
  type MenuManifestItem,
  type MenuPositionCode,
  type MenuRegistryService,
  NotFoundAppException,
  type RegisteredMenuDefinition,
  discoverInstalledModules,
  discoverManifestMenus,
  parseMenuPosition,
  parseMenuStatusCode,
  parseMenuTypeCode,
  validateMenuInput,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { MenuSummary, SyncMenusResult } from '../contracts/index.js';
import type { MenuEntity } from '../entities/menu.entity.js';
import { SETTINGS_AUDIT_META } from '../enum/settings.enum.js';
import type { MenuRepository } from '../repositories/menu.repository.js';
import type { RecordMenuAuditParams, SyncManifestMenusParams } from '../types/settings.types.js';

export function syncMenuEntityToRegistry(
  entity: MenuEntity,
  registry: MenuRegistryService,
  moduleName = 'settings',
): RegisteredMenuDefinition {
  const status = parseMenuStatusCode(entity.status, MENU_STATUS.ACTIVE);
  const type = parseMenuTypeCode(entity.type, MENU_TYPE.ITEM);
  const position: MenuPositionCode = parseMenuPosition(entity.position, MENU_POSITION.SIDEBAR);
  return registry.registerMenu(
    {
      id: Number(entity.id),
      code: entity.code.trim().toUpperCase(),
      module: moduleName,
      name: entity.name,
      status,
      statusName: MENU_STATUS_NAME_BY_CODE[status],
      link: entity.link ?? null,
      linkApi: entity.linkApi ?? null,
      type,
      typeName: MENU_TYPE_NAME_BY_CODE[type],
      parent: entity.parent ? Number(entity.parent) : null,
      level: Number(entity.level ?? 1),
      key: entity.key ?? null,
      numOrder: Number(entity.numOrder ?? 0),
      icon: entity.icon ?? null,
      position,
      updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : new Date().toISOString(),
    },
    { silent: true },
  );
}

export function mapMenuDefinitionToSummary(def: RegisteredMenuDefinition): MenuSummary {
  return {
    id: def.id,
    code: def.code,
    module: def.module,
    name: def.name,
    status: def.status,
    statusName: def.statusName,
    link: def.link,
    linkApi: def.linkApi,
    type: def.type,
    typeName: def.typeName,
    parent: def.parent,
    parentCode: def.parentCode,
    level: def.level,
    key: def.key,
    numOrder: def.numOrder,
    icon: def.icon,
    position: def.position,
    updatedAt: def.updatedAt ?? new Date().toISOString(),
  };
}

export function serializeMenuState(def: RegisteredMenuDefinition): Record<string, unknown> {
  return {
    id: def.id,
    code: def.code,
    module: def.module,
    name: def.name,
    status: def.status,
    statusName: def.statusName,
    link: def.link,
    linkApi: def.linkApi,
    type: def.type,
    typeName: def.typeName,
    parent: def.parent,
    parentCode: def.parentCode,
    level: def.level,
    key: def.key,
    numOrder: def.numOrder,
    icon: def.icon,
    position: def.position,
  };
}

export function resolveParentMenuFromRegistry(
  registry: MenuRegistryService,
  parentId?: number | null | undefined,
  parentCode?: string | null | undefined,
): RegisteredMenuDefinition | null {
  if (parentCode !== undefined) {
    if (parentCode === null || parentCode.trim() === '') {
      return null;
    }
    const found = registry.getMenuByCode(parentCode.trim().toUpperCase());
    if (!found) {
      throw new NotFoundAppException(`Parent menu '${parentCode.trim().toUpperCase()}' not found`);
    }
    return found;
  }

  if (parentId !== undefined) {
    if (parentId === null || parentId <= 0) {
      return null;
    }
    const found = registry.getMenuById(parentId);
    if (!found) {
      throw new NotFoundAppException(`Parent menu #${parentId} not found`);
    }
    return found;
  }

  return null;
}

export async function persistSingleMenuToDatabaseSafe(
  def: RegisteredMenuDefinition,
  menuRepository?: MenuRepository | null,
): Promise<void> {
  if (!menuRepository) return;
  try {
    const existing = await menuRepository.findByCode(def.code);
    if (existing) {
      await menuRepository.saveEntity({
        ...existing,
        name: def.name,
        status: def.status,
        link: def.link,
        linkApi: def.linkApi,
        type: def.type,
        parent: def.parent,
        level: def.level,
        key: def.key,
        numOrder: def.numOrder,
        icon: def.icon,
        position: def.position,
      });
    }
  } catch {
    // Ignore when DB is offline in unit tests
  }
}

export async function persistMenuAndDescendantsToDatabaseSafe(
  rootId: number,
  registry: MenuRegistryService,
  menuRepository?: MenuRepository | null,
): Promise<void> {
  if (!menuRepository) return;
  const idsToPersist = [rootId, ...registry.getDescendantIds(rootId)];
  for (const id of idsToPersist) {
    const def = registry.getMenuById(id);
    if (def) {
      await persistSingleMenuToDatabaseSafe(def, menuRepository);
    }
  }
}

export async function recordMenuAuditLog(params: RecordMenuAuditParams): Promise<void> {
  if (!params.auditLogService) return;
  const reqCtx = RequestContextService.current();
  const resolvedActor = params.actor ?? (reqCtx?.actor as UserIdentity | undefined) ?? undefined;
  const rawUserId = resolvedActor?.id ?? reqCtx?.userId;
  const actorUserId =
    typeof rawUserId === 'number' && Number.isInteger(rawUserId) && rawUserId > 0
      ? rawUserId
      : typeof rawUserId === 'string' && /^\d+$/.test(rawUserId.trim())
        ? Number.parseInt(rawUserId.trim(), 10)
        : null;
  const actorIdentifier =
    resolvedActor?.email ??
    resolvedActor?.username ??
    (actorUserId ? `user:${actorUserId}` : 'system');

  try {
    await params.auditLogService.record({
      actor: resolvedActor,
      actorUserId,
      actorIdentifier,
      module: SETTINGS_AUDIT_META.MODULE,
      feature: SETTINGS_AUDIT_META.FEATURES.MENUS,
      action: `menu.${params.action.toLowerCase()}`,
      resourceType: 'menu',
      resourceId: params.code,
      beforeData: params.oldState,
      afterData: params.newState,
      reason: params.reason ?? null,
      ipAddress: reqCtx?.ipAddress ?? '127.0.0.1',
      userAgent: reqCtx?.userAgent ?? null,
      requestId: reqCtx?.requestId ?? reqCtx?.correlationId ?? null,
      correlationId: reqCtx?.correlationId ?? null,
    });
  } catch {
    // Ignore audit log error
  }
}

export async function syncManifestMenusToDatabaseAndRegistry(
  params: SyncManifestMenusParams,
): Promise<SyncMenusResult> {
  const { customMenus, registry, menuRepository, clearL2CacheSafe, markHydrated } = params;
  registry.setInstalledModules(discoverInstalledModules());
  const manifestMenus = customMenus ?? discoverManifestMenus();
  const syncedModules = new Set<string>();

  const merged = new Map<string, MenuManifestItem>();
  for (const item of manifestMenus) {
    const code = item.code.trim().toUpperCase();
    const mod = (item.module ?? 'settings').trim().toLowerCase();
    merged.set(code, { ...item, code, module: mod });
    syncedModules.add(mod);
  }

  if (menuRepository) {
    try {
      for (const item of merged.values()) {
        const validated = validateMenuInput({
          code: item.code,
          name: item.name,
          status: item.status ?? MENU_STATUS.ACTIVE,
          link: item.link,
          linkApi: item.linkApi,
          type: item.type ?? (item.link ? MENU_TYPE.ITEM : MENU_TYPE.GROUP),
          key: item.key,
          numOrder: item.numOrder ?? 0,
          icon: item.icon,
          position: item.position ?? MENU_POSITION.SIDEBAR,
        });

        const existing = await menuRepository.findByCode(validated.code);
        if (!existing) {
          await menuRepository.saveEntity({
            code: validated.code,
            name: validated.name,
            status: validated.status,
            link: validated.link,
            linkApi: validated.linkApi,
            type: validated.type,
            parent: item.parent ?? null,
            level: item.level ?? (item.parentCode || item.parent ? 2 : 1),
            key: validated.key,
            numOrder: validated.numOrder,
            icon: validated.icon,
            position: validated.position,
          });
        } else {
          await menuRepository.saveEntity({
            ...existing,
            name: existing.name || validated.name,
            link: existing.link ?? validated.link,
            linkApi: existing.linkApi ?? validated.linkApi,
            key: existing.key ?? validated.key,
            icon: existing.icon ?? validated.icon,
          });
        }
      }

      const allDbMenus = await menuRepository.findFiltered();
      const dbByCode = new Map<string, MenuEntity>();
      for (const m of allDbMenus) {
        dbByCode.set(m.code.trim().toUpperCase(), m);
      }

      for (const item of merged.values()) {
        if (!item.parentCode?.trim()) continue;
        const childEntity = dbByCode.get(item.code.trim().toUpperCase());
        const parentEntity = dbByCode.get(item.parentCode.trim().toUpperCase());
        if (childEntity && parentEntity && childEntity.parent !== parentEntity.id) {
          childEntity.parent = parentEntity.id;
          childEntity.level = (parentEntity.level ?? 1) + 1;
          await menuRepository.saveEntity(childEntity);
        }
      }

      const refreshedMenus = await menuRepository.findFiltered();
      for (const dbMenu of refreshedMenus) {
        const mod = merged.get(dbMenu.code.trim().toUpperCase())?.module ?? 'settings';
        syncMenuEntityToRegistry(dbMenu, registry, mod);
        syncedModules.add(mod);
      }
      registry.recomputeHierarchyLevels();
      registry.invalidateCache({ action: 'SYNC', silent: true });
      await clearL2CacheSafe();
      markHydrated();

      return {
        syncedModules: Array.from(syncedModules).sort(),
        totalMenus: refreshedMenus.length,
      };
    } catch {
      // Fallback to in-memory registry when DB is unavailable in unit tests
    }
  }

  registry.registerManifestMenus(Array.from(merged.values()));
  await clearL2CacheSafe();

  return {
    syncedModules: Array.from(syncedModules).sort(),
    totalMenus: registry.listMenus().length,
  };
}
