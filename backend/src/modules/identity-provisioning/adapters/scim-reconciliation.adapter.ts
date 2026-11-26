import { Injectable } from '@nestjs/common';
import type {
  IReconciliationSourceAdapter,
  ReconciliationAdapterContext,
  ReconciliationComparableRecord,
  ReconciliationDatasetPair,
} from '@packages/kernel/index.js';
import { ScimUserLinkRepository } from '../repositories/scim-user-link.repository.js';

/**
 * Adapter cầu nối tích hợp `identity-provisioning` vào `ReconciliationRegistryService` dùng chung của nền tảng.
 */
@Injectable()
export class ScimReconciliationSourceAdapter implements IReconciliationSourceAdapter {
  public readonly code = 'identity-provisioning.scim-users';
  public readonly name = 'SCIM 2.0 Identity Provisioning Links';
  public readonly description =
    'Đối soát danh sách tài khoản liên kết SCIM 2.0 nội bộ với dữ liệu snapshot từ Identity Provider.';
  public readonly targetModule = 'identity-provisioning';
  public readonly supportsExternalUpload = true;
  public readonly defaultMatchingRules = {
    ignoreCaseOnStatus: true,
    compareFields: ['userName', 'active'],
  };

  constructor(private readonly userLinkRepository: ScimUserLinkRepository) {}

  public async fetchData(
    context: ReconciliationAdapterContext,
  ): Promise<ReconciliationDatasetPair> {
    const clientIdRaw = context.parameters?.['clientId'] ?? context.jobConfig['clientId'];
    const clientId =
      typeof clientIdRaw === 'number' && Number.isInteger(clientIdRaw) ? clientIdRaw : undefined;

    const links = clientId
      ? await this.userLinkRepository.findByClient(clientId)
      : (await this.userLinkRepository.listPaginated({ page: 1, limit: context.maxRecords })).data;

    const internalRecords: ReconciliationComparableRecord[] = links
      .slice(0, context.maxRecords)
      .map((link) => ({
        recordKey: link.externalId,
        entityType: 'scim_user_link',
        entityId: String(link.userId),
        status: link.active ? 'ACTIVE' : 'INACTIVE',
        occurredAt: link.lastSyncedAt ? new Date(link.lastSyncedAt).toISOString() : undefined,
        fields: {
          userName: link.scimUsername,
          active: Boolean(link.active),
          scimVersion: link.scimVersion,
        },
        raw: {
          id: link.id,
          clientId: link.clientId,
          userId: link.userId,
          externalId: link.externalId,
          userName: link.scimUsername,
          active: link.active,
        },
      }));

    return {
      internalRecords,
      externalRecords: (context.externalRecords ?? []).slice(0, context.maxRecords),
      metadata: {
        adapter: this.code,
        clientId: clientId ?? 'ALL',
        fetchedInternalCount: internalRecords.length,
      },
    };
  }
}
