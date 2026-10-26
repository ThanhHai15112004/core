import { z } from 'zod';
import {
  booleanQueryParam,
  intQueryParam,
  optionalQueryParam,
  parseSelectFields,
} from '@packages/http/index.js';
import { isSupportedLocale, isValidIanaTimezone } from '@packages/i18n/index.js';
import {
  USER_STATUS,
  type UserStatusCode,
  parseUserGender,
  parseUserStatus,
} from '../contracts/index.js';

export const preferredLocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(16)
  .refine((loc) => isSupportedLocale(loc), {
    message: 'Unsupported or inactive locale code in i18n_locales',
  });

export const preferredTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => isValidIanaTimezone(tz), {
    message: 'Invalid IANA timezone identifier (e.g., Asia/Ho_Chi_Minh, UTC, America/New_York)',
  });

export const userStatusSchema = z.preprocess(
  (val) => (val === undefined ? undefined : parseUserStatus(val)),
  z.union([
    z.literal(USER_STATUS.ACTIVE),
    z.literal(USER_STATUS.INACTIVE),
    z.literal(USER_STATUS.LOCKED),
    z.literal(USER_STATUS.ARCHIVED),
  ]),
);

export const userGenderSchema = z.preprocess(
  (val) => (val === undefined || val === null ? val : parseUserGender(val)),
  z.number().int().min(1).nullable().optional(),
);

const coercePositiveInt = z.preprocess((v) => Number(v), z.number().int().min(1));

export const userOrganizationAssignmentInputSchema = z.object({
  organizationUnitId: coercePositiveInt,
  isPrimary: z.boolean().optional().default(false),
  positionTitle: z.string().trim().max(128).nullable().optional(),
});

export type UserOrganizationAssignmentInput = z.infer<typeof userOrganizationAssignmentInputSchema>;

export const createUserSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        'Username may only contain letters, digits, dot, underscore or hyphen',
      )
      .optional(),
    email: z.string().trim().email().max(255),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(150).optional(),
    fullName: z.string().trim().min(2).max(255).optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    avatarUrl: z.string().trim().url().max(500).nullable().optional(),
    dateOfBirth: z.string().trim().max(32).nullable().optional(),
    gender: userGenderSchema,
    identityNumber: z.string().trim().max(64).nullable().optional(),
    address: z.string().trim().max(255).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    country: z.string().trim().max(100).nullable().optional(),
    bio: z.string().trim().max(2000).nullable().optional(),
    preferredLocale: preferredLocaleSchema.optional(),
    preferredTimezone: preferredTimezoneSchema.optional(),
    password: z.string().min(8).max(128),
    status: userStatusSchema.default(USER_STATUS.ACTIVE),
    managerId: coercePositiveInt.nullable().optional(),
    roleIds: z.array(coercePositiveInt).default([]),
    organizationUnits: z.array(userOrganizationAssignmentInputSchema).default([]),
  })
  .refine(
    (data) =>
      Boolean(data.fullName && data.fullName.trim().length >= 2) ||
      Boolean(data.firstName && data.firstName.trim().length >= 1),
    {
      message: 'Either fullName or firstName/lastName must be provided',
    },
  );

export type CreateUserRequest = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(150).optional(),
  fullName: z.string().trim().min(2).max(255).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  avatarUrl: z.string().trim().url().max(500).nullable().optional(),
  dateOfBirth: z.string().trim().max(32).nullable().optional(),
  gender: userGenderSchema,
  identityNumber: z.string().trim().max(64).nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  preferredLocale: preferredLocaleSchema.optional(),
  preferredTimezone: preferredTimezoneSchema.optional(),
  managerId: coercePositiveInt.nullable().optional(),
  expectedVersion: z.number().int().min(1).optional(),
});

export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

export const updateUserPreferencesSchema = z.object({
  preferredLocale: preferredLocaleSchema.optional(),
  preferredTimezone: preferredTimezoneSchema.optional(),
});

export type UpdateUserPreferencesRequest = z.infer<typeof updateUserPreferencesSchema>;

export const lockUserSchema = z.object({
  reason: z.string().trim().min(2).max(255),
  lockedUntil: z.string().datetime().nullable().optional(),
});

export type LockUserRequest = z.infer<typeof lockUserSchema>;

export const changeUserStatusSchema = z.object({
  status: userStatusSchema,
  reason: z.string().trim().max(255).nullable().optional(),
  lockedUntil: z.string().datetime().nullable().optional(),
});

export interface ChangeUserStatusRequest {
  readonly status: UserStatusCode;
  readonly reason?: string | null | undefined;
  readonly lockedUntil?: string | null | undefined;
}

export const assignUserRolesSchema = z.object({
  roleIds: z.array(coercePositiveInt),
  stepUpToken: z.string().trim().min(10).optional(),
  requireStepUp: z.boolean().optional(),
});

export type AssignUserRolesRequest = z.infer<typeof assignUserRolesSchema>;

export const assignUserOrganizationsSchema = z.object({
  organizationUnits: z.array(userOrganizationAssignmentInputSchema),
});

export type AssignUserOrganizationsRequest = z.infer<typeof assignUserOrganizationsSchema>;

export const USER_SELECTABLE_FIELDS = [
  'id',
  'username',
  'email',
  'firstName',
  'lastName',
  'fullName',
  'phone',
  'avatarUrl',
  'dateOfBirth',
  'gender',
  'genderName',
  'identityNumber',
  'address',
  'city',
  'country',
  'bio',
  'preferredLocale',
  'preferredTimezone',
  'status',
  'statusName',
  'mfaEnabled',
  'emailVerifiedAt',
  'phoneVerifiedAt',
  'lastLoginAt',
  'lockedUntil',
  'lockReason',
  'primaryOrganizationUnitId',
  'managerId',
  'roles',
  'organizationUnits',
  'version',
  'createdAt',
  'updatedAt',
] as const;

export const listUsersQuerySchema = z.object({
  q: optionalQueryParam(z.string().trim().max(200)),
  search: optionalQueryParam(z.string().trim().max(200)),
  status: optionalQueryParam(userStatusSchema),
  roleId: optionalQueryParam(intQueryParam({ min: 1 })),
  organizationUnitId: optionalQueryParam(intQueryParam({ min: 1 })),
  managerId: optionalQueryParam(intQueryParam({ min: 1 })),
  includeArchived: optionalQueryParam(booleanQueryParam()),
  mfaEnabled: optionalQueryParam(booleanQueryParam()),
  createdFrom: optionalQueryParam(z.string().trim().max(64)),
  createdTo: optionalQueryParam(z.string().trim().max(64)),
  fromDate: optionalQueryParam(z.string().trim().max(64)),
  toDate: optionalQueryParam(z.string().trim().max(64)),
  fields: optionalQueryParam(
    z.preprocess(
      (v) =>
        parseSelectFields(v as string | readonly string[] | undefined, {
          allowedFields: USER_SELECTABLE_FIELDS,
        }),
      z.array(z.string()).optional(),
    ),
  ),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 5000 })),
  countMode: optionalQueryParam(z.enum(['exact', 'estimated', 'none'])),
  sort: optionalQueryParam(z.string().trim().max(200)),
  sortBy: optionalQueryParam(
    z.enum(['id', 'createdAt', 'firstName', 'lastName', 'fullName', 'email', 'username', 'status']),
  ).default('id'),
  sortOrder: optionalQueryParam(
    z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
      z.enum(['ASC', 'DESC']),
    ),
  ).default('ASC'),
  format: optionalQueryParam(z.enum(['csv', 'xlsx'])),
  title: optionalQueryParam(z.string().trim().max(160)),
  logoBase64: optionalQueryParam(z.string().max(500_000)),
  stepUpToken: optionalQueryParam(z.string().trim().min(10)),
  requireStepUp: optionalQueryParam(booleanQueryParam()),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const bulkImportUserRowSchema = z.object({
  username: z.string().trim().min(3).max(64),
  email: z.string().trim().email().max(255),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(150).optional(),
  fullName: z.string().trim().min(2).max(255).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  password: z.string().min(8).max(128).optional(),
  status: userStatusSchema.optional().default(USER_STATUS.ACTIVE),
  positionTitle: z.string().trim().max(128).nullable().optional(),
  roleCodes: z.array(z.string().trim().min(1)).optional().default([]),
  organizationCodes: z.array(z.string().trim().min(1)).optional().default([]),
});

export type BulkImportUserRowInput = z.infer<typeof bulkImportUserRowSchema>;

export const importColumnMappingSchema = z.record(
  z.string(),
  z.union([z.string(), z.number().int().min(0)]).nullable(),
);

export const importDuplicateStrategySchema = z.enum(['SKIP', 'UPDATE', 'REJECT']);

export const bulkImportUsersSchema = z
  .object({
    fileName: z.string().trim().max(255).optional(),
    xlsxBase64: z.string().min(1).optional(),
    csvContent: z.string().min(1).optional(),
    items: z.array(bulkImportUserRowSchema).optional(),
    columnMapping: importColumnMappingSchema.optional(),
    defaultPassword: z.string().min(8).max(128).optional(),
    skipDuplicates: z.boolean().default(true),
    duplicateStrategy: importDuplicateStrategySchema.optional(),
    async: z.boolean().optional(),
    previewLimit: z.number().int().min(1).max(200).optional(),
  })
  .refine(
    (data) =>
      Boolean(data.xlsxBase64) ||
      Boolean(data.csvContent) ||
      (Array.isArray(data.items) && data.items.length > 0),
    {
      message: 'Either xlsxBase64, csvContent, or non-empty items array must be provided',
    },
  );

export type BulkImportUsersRequest = z.infer<typeof bulkImportUsersSchema>;

export const previewImportUsersSchema = bulkImportUsersSchema;
export type PreviewImportUsersRequest = z.infer<typeof previewImportUsersSchema>;

export const listUserImportHistoriesQuerySchema = z.object({
  actorId: optionalQueryParam(intQueryParam({ min: 1 })),
  status: optionalQueryParam(
    z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']),
  ),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});

export type ListUserImportHistoriesQuery = z.infer<typeof listUserImportHistoriesQuerySchema>;

export const adminResetUserPasswordSchema = z
  .object({
    newPassword: z.string().min(6).max(128).optional(),
    useSuggestedPassword: z.boolean().optional().default(false),
    revokeSessions: z.boolean().optional().default(true),
  })
  .default({ useSuggestedPassword: false, revokeSessions: true });

export type AdminResetUserPasswordRequest = z.infer<typeof adminResetUserPasswordSchema>;

export const adminResetUserMfaSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  verificationReference: z.string().trim().max(255).optional(),
  revokeSessions: z.boolean().optional().default(true),
  stepUpToken: z.string().trim().min(10).optional(),
});

export type AdminResetUserMfaRequest = z.infer<typeof adminResetUserMfaSchema>;
