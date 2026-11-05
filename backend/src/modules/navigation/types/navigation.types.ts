import type {
  MenuManifestItem,
  MenuRegistryService,
  RegisteredMenuDefinition,
} from '@packages/kernel/index.js';
import type { AuditLogService, UserIdentity } from '@packages/security/index.js';
import type { MenuAuditActionType } from '../enum/navigation.enum.js';
import type { MenuRepository } from '../repositories/menu.repository.js';

export interface SyncManifestMenusParams {
  customMenus?: readonly MenuManifestItem[] | undefined;
  registry: MenuRegistryService;
  menuRepository?: MenuRepository | null | undefined;
  clearL2CacheSafe: () => Promise<void>;
  markHydrated: () => void;
}

export interface RecordMenuAuditParams {
  action: MenuAuditActionType;
  code: string;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown>;
  actor?: UserIdentity | undefined;
  reason?: string | null | undefined;
  auditLogService?: AuditLogService | null | undefined;
}

export type { RegisteredMenuDefinition };
