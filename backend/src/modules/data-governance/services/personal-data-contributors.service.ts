import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DataGovernanceHookRegistry,
  defaultDataGovernanceHookRegistry,
  type PersonalDataErasureModuleResult,
  type PersonalDataModuleSection,
  type RetentionPolicyExecutionInput,
  type RetentionPolicyExecutionResult,
} from '@packages/kernel/index.js';
import { AUDIT_PUBLIC_SERVICE, type IAuditPublicService } from '@modules/audit/contracts/index.js';
import {
  CUSTOM_FIELDS_PUBLIC_SERVICE,
  type ICustomFieldsPublicService,
} from '@modules/custom-fields/contracts/index.js';
import {
  EXPORTS_PUBLIC_SERVICE,
  type IExportsPublicService,
} from '@modules/exports/contracts/index.js';
import {
  SESSIONS_PUBLIC_SERVICE,
  type ISessionsPublicService,
} from '@modules/sessions/contracts/index.js';
import { USERS_PUBLIC_SERVICE, type IUsersPublicService } from '@modules/users/contracts/index.js';
import { ConsentManagementService } from './consent-management.service.js';

@Injectable()
export class PersonalDataContributorsService {
  private readonly hookRegistry: DataGovernanceHookRegistry;

  constructor(
    private readonly consentService: ConsentManagementService,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersService?: IUsersPublicService,
    @Optional()
    @Inject(SESSIONS_PUBLIC_SERVICE)
    private readonly sessionsService?: ISessionsPublicService,
    @Optional()
    @Inject(AUDIT_PUBLIC_SERVICE)
    private readonly auditService?: IAuditPublicService,
    @Optional()
    @Inject(CUSTOM_FIELDS_PUBLIC_SERVICE)
    private readonly customFieldsService?: ICustomFieldsPublicService,
    @Optional()
    @Inject(EXPORTS_PUBLIC_SERVICE)
    private readonly exportsService?: IExportsPublicService,
    @Optional() hookRegistry?: DataGovernanceHookRegistry,
  ) {
    this.hookRegistry = hookRegistry ?? defaultDataGovernanceHookRegistry;
  }

  public registerBuiltinContributorsAndRetention(): void {
    this.hookRegistry.registerPersonalDataContributor(this.consentService);
    this.hookRegistry.registerRetentionExecutor(this.consentService);

    if (this.usersService) {
      const usersSvc = this.usersService;
      this.hookRegistry.registerPersonalDataContributor({
        contributorKey: 'users.personal_profile',
        moduleName: 'users',
        dataTypeCode: 'users.personal_profile',
        defaultClassification: 'CONFIDENTIAL',
        collectPersonalData: async (subjectUserId: number): Promise<PersonalDataModuleSection> => {
          const identity = await usersSvc.findAuthUserById(subjectUserId);
          const records: Record<string, unknown>[] = identity
            ? [
                {
                  id: identity.id,
                  username: identity.username,
                  email: identity.email,
                  phone: identity.phone,
                  firstName: identity.firstName,
                  lastName: identity.lastName,
                  fullName: identity.fullName,
                  statusName: identity.statusName,
                  preferredLocale: identity.preferredLocale ?? null,
                  preferredTimezone: identity.preferredTimezone ?? null,
                  roles: identity.roles,
                  organizationUnitIds: identity.organizationUnitIds,
                  profile: identity.profile ?? null,
                },
              ]
            : [];
          return {
            moduleName: 'users',
            dataTypeCode: 'users.personal_profile',
            classificationLevel: 'CONFIDENTIAL',
            recordCount: records.length,
            records,
          };
        },
        eraseOrAnonymizePersonalData: async (opts): Promise<PersonalDataErasureModuleResult> => {
          if (usersSvc.anonymizePersonalData) {
            const res = await usersSvc.anonymizePersonalData(
              opts.subjectUserId,
              opts.reason ?? `DSAR Erasure ${opts.requestCode}`,
              opts.actorUserId ?? undefined,
            );
            return {
              moduleName: 'users',
              dataTypeCode: 'users.personal_profile',
              erasedCount: 0,
              anonymizedCount: res.anonymized ? 1 : 0,
              retainedExceptions: [],
            };
          }
          if (usersSvc.deactivateProvisionedUser) {
            await usersSvc.deactivateProvisionedUser(
              opts.subjectUserId,
              opts.reason ?? `DSAR Erasure ${opts.requestCode}`,
              opts.actorUserId ?? undefined,
            );
            return {
              moduleName: 'users',
              dataTypeCode: 'users.personal_profile',
              erasedCount: 0,
              anonymizedCount: 1,
              retainedExceptions: [],
            };
          }
          return {
            moduleName: 'users',
            dataTypeCode: 'users.personal_profile',
            erasedCount: 0,
            anonymizedCount: 0,
            retainedExceptions: [],
          };
        },
      });
    }

    if (this.sessionsService) {
      const sessionsSvc = this.sessionsService;
      this.hookRegistry.registerPersonalDataContributor({
        contributorKey: 'sessions.auth_activity',
        moduleName: 'sessions',
        dataTypeCode: 'auth.sessions',
        defaultClassification: 'CONFIDENTIAL',
        collectPersonalData: async (subjectUserId: number): Promise<PersonalDataModuleSection> => {
          const [activeSessions, loginHistory] = await Promise.all([
            sessionsSvc.listUserSessions(subjectUserId).catch(() => []),
            sessionsSvc.listUserLoginHistory(subjectUserId, 50).catch(() => []),
          ]);
          const records: Record<string, unknown>[] = [
            ...activeSessions.map((s) => ({ kind: 'active_session', ...s })),
            ...loginHistory.map((h) => ({ kind: 'login_history', ...h })),
          ];
          return {
            moduleName: 'sessions',
            dataTypeCode: 'auth.sessions',
            classificationLevel: 'CONFIDENTIAL',
            recordCount: records.length,
            records,
          };
        },
        eraseOrAnonymizePersonalData: async (opts): Promise<PersonalDataErasureModuleResult> => {
          const revoked = await sessionsSvc
            .revokeAllUserSessions(opts.subjectUserId, `DSAR Erasure (${opts.requestCode})`)
            .catch(() => 0);
          return {
            moduleName: 'sessions',
            dataTypeCode: 'auth.sessions',
            erasedCount: revoked,
            anonymizedCount: 0,
            retainedExceptions: [],
          };
        },
      });
    }

    if (this.customFieldsService) {
      const cfSvc = this.customFieldsService;
      this.hookRegistry.registerPersonalDataContributor({
        contributorKey: 'custom-fields.user_values',
        moduleName: 'custom-fields',
        dataTypeCode: 'custom_fields.user_values',
        defaultClassification: 'CONFIDENTIAL',
        collectPersonalData: async (subjectUserId: number): Promise<PersonalDataModuleSection> => {
          const values = await cfSvc
            .getRecordValuesForApi('users', subjectUserId, {
              viewMode: 'detail',
              actor: { permissions: ['*'] },
            })
            .catch(() => ({}));
          const hasValues = Object.keys(values).length > 0;
          return {
            moduleName: 'custom-fields',
            dataTypeCode: 'custom_fields.user_values',
            classificationLevel: 'CONFIDENTIAL',
            recordCount: hasValues ? 1 : 0,
            records: hasValues ? [values] : [],
          };
        },
      });
    }

    if (this.auditService) {
      const auditSvc = this.auditService;
      this.hookRegistry.registerPersonalDataContributor({
        contributorKey: 'audit.logs',
        moduleName: 'audit',
        dataTypeCode: 'audit.logs',
        defaultClassification: 'RESTRICTED',
        collectPersonalData: async (subjectUserId: number): Promise<PersonalDataModuleSection> => {
          const page = await auditSvc
            .listAuditLogs({
              actorUserId: subjectUserId,
              page: 1,
              limit: 50,
            } as Parameters<IAuditPublicService['listAuditLogs']>[0])
            .catch(() => ({ data: [], meta: { total: 0 } }));
          const records = page.data.map((item) => ({
            id: item.id,
            module: item.module,
            feature: item.feature,
            action: item.action,
            resourceType: item.resourceType,
            resourceId: item.resourceId,
            ipAddress: item.ipAddress,
            createdAt: item.createdAt,
          }));
          return {
            moduleName: 'audit',
            dataTypeCode: 'audit.logs',
            classificationLevel: 'RESTRICTED',
            recordCount: records.length,
            records,
          };
        },
        eraseOrAnonymizePersonalData: async (opts): Promise<PersonalDataErasureModuleResult> => {
          const page = await auditSvc
            .listAuditLogs({
              actorUserId: opts.subjectUserId,
              page: 1,
              limit: 1,
            } as Parameters<IAuditPublicService['listAuditLogs']>[0])
            .catch(() => ({ data: [], meta: { totalItems: 0 } }));
          const totalCount = page.meta.totalItems ?? page.data.length;
          return {
            moduleName: 'audit',
            dataTypeCode: 'audit.logs',
            erasedCount: 0,
            anonymizedCount: 0,
            retainedExceptions:
              totalCount > 0
                ? [
                    {
                      moduleName: 'audit',
                      dataTypeCode: 'audit.logs',
                      reasonCode: 'IMMUTABLE_AUDIT_OBLIGATION',
                      reason:
                        'Nhật ký kiểm toán bảo mật bất biến (Audit Log) bắt buộc lưu giữ theo nghĩa vụ pháp lý và an toàn thông tin.',
                      retainedCount: totalCount,
                    },
                  ]
                : [],
          };
        },
      });
    }

    if (this.exportsService) {
      const exportsSvc = this.exportsService;
      this.hookRegistry.registerPersonalDataContributor({
        contributorKey: 'exports.histories',
        moduleName: 'exports',
        dataTypeCode: 'exports.artifacts',
        defaultClassification: 'INTERNAL',
        collectPersonalData: async (subjectUserId: number): Promise<PersonalDataModuleSection> => {
          const histories = await exportsSvc
            .listHistories({ actorId: subjectUserId, includeExpired: true, limit: 50 })
            .catch(() => []);
          const records = histories.map((h) => ({
            id: h.id,
            profileCode: h.profileCode,
            module: h.module,
            format: h.format,
            totalExported: h.totalExported,
            status: h.status,
            createdAt: h.createdAt,
          }));
          return {
            moduleName: 'exports',
            dataTypeCode: 'exports.artifacts',
            classificationLevel: 'INTERNAL',
            recordCount: records.length,
            records,
          };
        },
      });

      this.hookRegistry.registerRetentionExecutor({
        dataTypeCode: 'exports.artifacts',
        moduleName: 'exports',
        executeRetention: async (
          input: RetentionPolicyExecutionInput,
        ): Promise<RetentionPolicyExecutionResult> => {
          const histories = await exportsSvc
            .listHistories({ includeExpired: true, limit: 200 })
            .catch(() => []);
          const candidates = histories.filter(
            (h) => new Date(h.createdAt).getTime() <= input.cutoffDate.getTime(),
          );
          let affectedCount = 0;
          let skippedLegalHoldCount = 0;

          for (const item of candidates) {
            if (item.actorId && (await input.isUserUnderLegalHold(item.actorId))) {
              skippedLegalHoldCount += 1;
              continue;
            }
            if (await input.isResourceUnderLegalHold('exports', item.id)) {
              skippedLegalHoldCount += 1;
              continue;
            }
            if (!input.dryRun) {
              await exportsSvc.deleteHistory(item.id).catch(() => undefined);
            }
            affectedCount += 1;
          }

          return {
            dataTypeCode: 'exports.artifacts',
            scannedCount: candidates.length,
            affectedCount,
            skippedLegalHoldCount,
            actionApplied: input.dryRun
              ? `DRY_RUN_${input.retentionAction}`
              : input.retentionAction,
          };
        },
      });
    }
  }
}
