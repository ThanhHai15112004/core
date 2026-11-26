import { z } from 'zod';
import { createPaginationQuerySchema, optionalQueryParam } from '@packages/http/index.js';
import {
  BACKUP_RECORD_STATUS,
  BACKUP_TARGET_TYPE,
  BACKUP_VERIFY_STATUS,
  RESTORE_OPERATION_TYPE,
  RESTORE_SCOPE,
  RESTORE_STATUS,
} from '../enum/backup-ops.enum.js';
import { parseCronExpression } from '../helpers/backup-cron.helper.js';

export const PositiveIdParamSchema = z.coerce.number().int().positive();

const cronExpressionSchema = z
  .string()
  .trim()
  .min(9)
  .max(64)
  .refine((val) => parseCronExpression(val) !== null, {
    message: 'Invalid 5-field cron expression (minute hour day month dayOfWeek)',
  });

export const CreateBackupPolicySchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(160),
  targetType: z.enum([BACKUP_TARGET_TYPE.DATABASE, BACKUP_TARGET_TYPE.STORAGE]),
  scheduleCron: cronExpressionSchema,
  timezone: z.string().trim().min(2).max(64).default('Asia/Ho_Chi_Minh'),
  isEnabled: z.boolean().default(true),
  encryptionEnabled: z.boolean().default(true),
  compressionEnabled: z.boolean().default(true),
  retentionDays: z.coerce.number().int().min(1).max(3650).default(14),
  maxKeepCount: z.coerce.number().int().min(1).max(1000).default(30),
  autoVerifyDrill: z.boolean().default(true),
  alertOnFailure: z.boolean().default(true),
  staleThresholdHours: z.coerce.number().int().min(1).max(720).default(26),
  storagePrefix: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9/_-]+$/)
    .default('backups'),
});

export const UpdateBackupPolicySchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  scheduleCron: cronExpressionSchema.optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  isEnabled: z.boolean().optional(),
  encryptionEnabled: z.boolean().optional(),
  compressionEnabled: z.boolean().optional(),
  retentionDays: z.coerce.number().int().min(1).max(3650).optional(),
  maxKeepCount: z.coerce.number().int().min(1).max(1000).optional(),
  autoVerifyDrill: z.boolean().optional(),
  alertOnFailure: z.boolean().optional(),
  staleThresholdHours: z.coerce.number().int().min(1).max(720).optional(),
  storagePrefix: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9/_-]+$/)
    .optional(),
});

export const RunBackupSchema = z.object({
  policyId: z.coerce.number().int().positive().optional(),
  policyCode: z.string().trim().min(1).max(80).optional(),
  targetType: z.enum([BACKUP_TARGET_TYPE.DATABASE, BACKUP_TARGET_TYPE.STORAGE]).optional(),
  note: z.string().trim().max(500).optional(),
});

export const ListBackupRecordsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    targetType: optionalQueryParam(
      z.enum([BACKUP_TARGET_TYPE.DATABASE, BACKUP_TARGET_TYPE.STORAGE]),
    ),
    status: optionalQueryParam(
      z.enum([
        BACKUP_RECORD_STATUS.RUNNING,
        BACKUP_RECORD_STATUS.SUCCESS,
        BACKUP_RECORD_STATUS.FAILED,
        BACKUP_RECORD_STATUS.EXPIRED,
        BACKUP_RECORD_STATUS.PURGED,
      ]),
    ),
    verifyStatus: optionalQueryParam(
      z.enum([
        BACKUP_VERIFY_STATUS.PENDING,
        BACKUP_VERIFY_STATUS.PASSED,
        BACKUP_VERIFY_STATUS.FAILED,
        BACKUP_VERIFY_STATUS.SKIPPED,
      ]),
    ),
    policyCode: optionalQueryParam(z.string().trim().max(80)),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export const VerifyBackupSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

export const EnableStorageVersioningSchema = z.object({
  confirm: z.literal('ENABLE_VERSIONING'),
});

export const ListRestoreHistoriesQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    operationType: optionalQueryParam(
      z.enum([
        RESTORE_OPERATION_TYPE.DRILL_ISOLATED,
        RESTORE_OPERATION_TYPE.MANUAL_RESTORE,
        RESTORE_OPERATION_TYPE.LIVE_RESTORE,
      ]),
    ),
    scope: optionalQueryParam(
      z.enum([
        RESTORE_SCOPE.DATABASE,
        RESTORE_SCOPE.STORAGE,
        RESTORE_SCOPE.SECRETS_CONFIG,
        RESTORE_SCOPE.FULL,
      ]),
    ),
    status: optionalQueryParam(
      z.enum([RESTORE_STATUS.RUNNING, RESTORE_STATUS.SUCCESS, RESTORE_STATUS.FAILED]),
    ),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export const ExecuteOrRecordRestoreSchema = z.object({
  backupRecordId: z.coerce.number().int().positive().nullable().optional(),
  mode: z.enum(['RECORD_MANUAL', 'EXECUTE_LIVE']).default('RECORD_MANUAL'),
  scope: z.enum([
    RESTORE_SCOPE.DATABASE,
    RESTORE_SCOPE.STORAGE,
    RESTORE_SCOPE.SECRETS_CONFIG,
    RESTORE_SCOPE.FULL,
  ]),
  targetEnvironment: z.string().trim().min(2).max(120),
  targetDatabase: z.string().trim().max(120).nullable().optional(),
  actorName: z.string().trim().min(2).max(160).optional(),
  reason: z.string().trim().min(5).max(1000),
  confirm: z.string().trim().max(64).optional(),
});

export type CreateBackupPolicyRequest = z.infer<typeof CreateBackupPolicySchema>;
export type UpdateBackupPolicyRequest = z.infer<typeof UpdateBackupPolicySchema>;
export type RunBackupRequest = z.infer<typeof RunBackupSchema>;
export type VerifyBackupRequest = z.infer<typeof VerifyBackupSchema>;
export type ExecuteOrRecordRestoreRequest = z.infer<typeof ExecuteOrRecordRestoreSchema>;
