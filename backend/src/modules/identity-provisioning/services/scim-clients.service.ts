import { Injectable, Optional } from '@nestjs/common';
import {
  ConflictAppException,
  NotFoundAppException,
  SettingRegistryService,
  defaultSettingRegistry,
  safeJsonParseObject,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  DEFAULT_SCIM_CLIENT_SCOPES,
  SCIM_AUDIT_META,
  SCIM_CLIENT_STATUS,
  SCIM_DEPROVISION_MODE,
  SCIM_SETTING_KEYS,
  type ScimDeprovisionMode,
} from '../enum/identity-provisioning.enum.js';
import type { ScimClientEntity } from '../entities/scim-client.entity.js';
import {
  generateScimBearerToken,
  normalizeAllowedIpList,
} from '../helpers/scim-security.helper.js';
import { ScimClientRepository } from '../repositories/scim-client.repository.js';
import type {
  CreateScimClientRequest,
  UpdateScimClientRequest,
} from '../requests/identity-provisioning.requests.js';
import type {
  ScimClientCreatedView,
  ScimClientView,
} from '../types/identity-provisioning.types.js';

function parseGroupRoleMappings(jsonStr?: string | null): Record<string, string[]> {
  const obj = safeJsonParseObject(jsonStr) ?? {};
  const result: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(obj)) {
    const cleanKey = key.trim();
    if (!cleanKey || !Array.isArray(val)) continue;
    const roles = Array.from(
      new Set(
        val
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    if (roles.length > 0) {
      result[cleanKey] = roles;
    }
  }
  return result;
}

function normalizeRoleCodeList(codes?: readonly string[]): string[] {
  if (!codes) return [];
  return Array.from(new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean)));
}

@Injectable()
export class ScimClientsService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly clientRepository: ScimClientRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() settingRegistry?: SettingRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  public toView(entity: ScimClientEntity): ScimClientView {
    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      description: entity.description ?? null,
      federatedProviderCode: entity.federatedProviderCode ?? null,
      status: entity.status,
      statusName: entity.status === SCIM_CLIENT_STATUS.ACTIVE ? 'ACTIVE' : 'INACTIVE',
      tokenPrefix: entity.tokenPrefix,
      allowedIps: safeJsonParseStringArray(entity.allowedIpsJson),
      scopes: safeJsonParseStringArray(entity.scopesJson),
      deprovisionMode: entity.deprovisionMode,
      groupRoleMappings: parseGroupRoleMappings(entity.groupRoleMappingsJson),
      allowedRoleCodes: safeJsonParseStringArray(entity.allowedRoleCodesJson),
      deniedRoleCodes: safeJsonParseStringArray(entity.deniedRoleCodesJson),
      defaultRoleCodes: safeJsonParseStringArray(entity.defaultRoleCodesJson),
      requireIfMatch: Boolean(entity.requireIfMatch),
      lastUsedAt: entity.lastUsedAt ? new Date(entity.lastUsedAt).toISOString() : null,
      lastUsedIp: entity.lastUsedIp ?? null,
      rotatedAt: entity.rotatedAt ? new Date(entity.rotatedAt).toISOString() : null,
      createdAt: entity.createdAt
        ? new Date(entity.createdAt).toISOString()
        : new Date().toISOString(),
      updatedAt: entity.updatedAt
        ? new Date(entity.updatedAt).toISOString()
        : new Date().toISOString(),
    };
  }

  public async listClients(): Promise<ScimClientView[]> {
    const entities = await this.clientRepository.listAll();
    return entities.map((e) => this.toView(e));
  }

  public async getClientEntityOrThrow(clientId: number): Promise<ScimClientEntity> {
    const found = await this.clientRepository.findById(clientId);
    if (!found) {
      throw new NotFoundAppException('identity-provisioning.clientNotFound', { id: clientId });
    }
    return found;
  }

  public async getClientById(clientId: number): Promise<ScimClientView> {
    const found = await this.getClientEntityOrThrow(clientId);
    return this.toView(found);
  }

  private resolveDefaultDeprovisionMode(): ScimDeprovisionMode {
    const raw = String(
      this.settingRegistry.getString(
        SCIM_SETTING_KEYS.DEFAULT_DEPROVISION_MODE,
        undefined,
        SCIM_DEPROVISION_MODE.LOCK_AND_REVOKE,
      ),
    )
      .trim()
      .toUpperCase();
    return raw === SCIM_DEPROVISION_MODE.DEACTIVATE_AND_REVOKE
      ? SCIM_DEPROVISION_MODE.DEACTIVATE_AND_REVOKE
      : SCIM_DEPROVISION_MODE.LOCK_AND_REVOKE;
  }

  public async createClient(
    dto: CreateScimClientRequest,
    actor?: UserIdentity,
  ): Promise<ScimClientCreatedView> {
    const normalizedCode = dto.code.trim().toLowerCase();
    const existing = await this.clientRepository.findByCode(normalizedCode);
    if (existing) {
      throw new ConflictAppException('identity-provisioning.clientCodeConflict', [], {
        code: normalizedCode,
      });
    }

    const token = generateScimBearerToken();
    const allowedIps = normalizeAllowedIpList(dto.allowedIps ?? []);
    const scopes =
      dto.scopes && dto.scopes.length > 0
        ? Array.from(new Set(dto.scopes.map((s) => s.trim()).filter(Boolean)))
        : [...DEFAULT_SCIM_CLIENT_SCOPES];

    const entity = this.clientRepository.create({
      code: normalizedCode,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      federatedProviderCode: dto.federatedProviderCode?.trim().toLowerCase() ?? null,
      status: dto.status ?? SCIM_CLIENT_STATUS.ACTIVE,
      tokenHash: token.tokenHash,
      tokenPrefix: token.tokenPrefix,
      allowedIpsJson: JSON.stringify(allowedIps),
      scopesJson: JSON.stringify(scopes),
      deprovisionMode: dto.deprovisionMode ?? this.resolveDefaultDeprovisionMode(),
      groupRoleMappingsJson: JSON.stringify(
        parseGroupRoleMappings(JSON.stringify(dto.groupRoleMappings ?? {})),
      ),
      allowedRoleCodesJson: JSON.stringify(normalizeRoleCodeList(dto.allowedRoleCodes)),
      deniedRoleCodesJson: JSON.stringify(normalizeRoleCodeList(dto.deniedRoleCodes)),
      defaultRoleCodesJson: JSON.stringify(normalizeRoleCodeList(dto.defaultRoleCodes)),
      requireIfMatch: Boolean(dto.requireIfMatch),
      createdBy: actor?.id ?? null,
      updatedBy: actor?.id ?? null,
    });

    const saved = await this.clientRepository.saveEntity(entity);
    const view = this.toView(saved);

    await this.auditLogService
      ?.record({
        actorUserId: actor?.id ?? null,
        module: SCIM_AUDIT_META.MODULE,
        feature: SCIM_AUDIT_META.FEATURE_CLIENT,
        action: 'CREATE_SCIM_CLIENT',
        resourceType: 'scim_client',
        resourceId: saved.id,
        afterData: view,
      })
      .catch(() => undefined);

    return { client: view, plainToken: token.plainToken };
  }

  public async updateClient(
    clientId: number,
    dto: UpdateScimClientRequest,
    actor?: UserIdentity,
  ): Promise<ScimClientView> {
    const existing = await this.getClientEntityOrThrow(clientId);
    const before = this.toView(existing);

    if (dto.name !== undefined) existing.name = dto.name.trim();
    if (dto.description !== undefined) {
      existing.description = dto.description ? dto.description.trim() : null;
    }
    if (dto.federatedProviderCode !== undefined) {
      existing.federatedProviderCode = dto.federatedProviderCode
        ? dto.federatedProviderCode.trim().toLowerCase()
        : null;
    }
    if (dto.status !== undefined) existing.status = dto.status;
    if (dto.allowedIps !== undefined) {
      existing.allowedIpsJson = JSON.stringify(normalizeAllowedIpList(dto.allowedIps));
    }
    if (dto.scopes !== undefined) {
      existing.scopesJson = JSON.stringify(
        Array.from(new Set(dto.scopes.map((s) => s.trim()).filter(Boolean))),
      );
    }
    if (dto.deprovisionMode !== undefined) existing.deprovisionMode = dto.deprovisionMode;
    if (dto.groupRoleMappings !== undefined) {
      existing.groupRoleMappingsJson = JSON.stringify(
        parseGroupRoleMappings(JSON.stringify(dto.groupRoleMappings)),
      );
    }
    if (dto.allowedRoleCodes !== undefined) {
      existing.allowedRoleCodesJson = JSON.stringify(normalizeRoleCodeList(dto.allowedRoleCodes));
    }
    if (dto.deniedRoleCodes !== undefined) {
      existing.deniedRoleCodesJson = JSON.stringify(normalizeRoleCodeList(dto.deniedRoleCodes));
    }
    if (dto.defaultRoleCodes !== undefined) {
      existing.defaultRoleCodesJson = JSON.stringify(normalizeRoleCodeList(dto.defaultRoleCodes));
    }
    if (dto.requireIfMatch !== undefined) existing.requireIfMatch = Boolean(dto.requireIfMatch);
    existing.updatedBy = actor?.id ?? null;

    const saved = await this.clientRepository.saveEntity(existing);
    const after = this.toView(saved);

    await this.auditLogService
      ?.record({
        actorUserId: actor?.id ?? null,
        module: SCIM_AUDIT_META.MODULE,
        feature: SCIM_AUDIT_META.FEATURE_CLIENT,
        action: 'UPDATE_SCIM_CLIENT',
        resourceType: 'scim_client',
        resourceId: saved.id,
        beforeData: before,
        afterData: after,
      })
      .catch(() => undefined);

    return after;
  }

  public async rotateClientToken(
    clientId: number,
    actor?: UserIdentity,
  ): Promise<ScimClientCreatedView> {
    const existing = await this.getClientEntityOrThrow(clientId);
    const token = generateScimBearerToken();
    existing.tokenHash = token.tokenHash;
    existing.tokenPrefix = token.tokenPrefix;
    existing.rotatedAt = new Date();
    existing.updatedBy = actor?.id ?? null;

    const saved = await this.clientRepository.saveEntity(existing);
    const view = this.toView(saved);

    await this.auditLogService
      ?.record({
        actorUserId: actor?.id ?? null,
        module: SCIM_AUDIT_META.MODULE,
        feature: SCIM_AUDIT_META.FEATURE_CLIENT,
        action: 'ROTATE_SCIM_CLIENT_TOKEN',
        resourceType: 'scim_client',
        resourceId: saved.id,
        afterData: { tokenPrefix: view.tokenPrefix, rotatedAt: view.rotatedAt },
      })
      .catch(() => undefined);

    return { client: view, plainToken: token.plainToken };
  }

  public async deleteClient(
    clientId: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const existing = await this.getClientEntityOrThrow(clientId);
    const before = this.toView(existing);
    await this.clientRepository.softDeleteEntity(existing);

    await this.auditLogService
      ?.record({
        actorUserId: actor?.id ?? null,
        module: SCIM_AUDIT_META.MODULE,
        feature: SCIM_AUDIT_META.FEATURE_CLIENT,
        action: 'DELETE_SCIM_CLIENT',
        resourceType: 'scim_client',
        resourceId: clientId,
        beforeData: before,
      })
      .catch(() => undefined);

    return { deleted: true, id: clientId };
  }
}
