import { z } from 'zod';
import {
  booleanQueryParam,
  createPaginationQuerySchema,
  optionalQueryParam,
} from '@packages/http/index.js';
import {
  ALL_INCIDENT_SEVERITIES,
  ALL_INCIDENT_SOURCES,
  ALL_INCIDENT_STATUSES,
  ALL_POSTMORTEM_STATUSES,
  ALL_SIEM_DRIVERS,
  SIEM_DISPATCH_STATUS,
} from '../enum/incidents-ops.enum.js';

export const PositiveIdParamSchema = z.coerce.number().int().positive();

export const SeverityParamSchema = z.enum(
  ALL_INCIDENT_SEVERITIES as [
    (typeof ALL_INCIDENT_SEVERITIES)[number],
    ...(typeof ALL_INCIDENT_SEVERITIES)[number][],
  ],
);

export const UpdateSeverityPolicySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  responseSlaMinutes: z.coerce.number().int().min(1).max(43200).optional(),
  resolutionSlaMinutes: z.coerce.number().int().min(1).max(129600).optional(),
  autoEscalate: z.boolean().optional(),
});

export type UpdateSeverityPolicyRequest = z.infer<typeof UpdateSeverityPolicySchema>;

export const ListRunbooksQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    alertCode: optionalQueryParam(z.string().trim().max(100)),
    severity: optionalQueryParam(SeverityParamSchema),
    isActive: optionalQueryParam(booleanQueryParam()),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListRunbooksQuery = z.infer<typeof ListRunbooksQuerySchema>;

export const CreateRunbookSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[A-Za-z0-9._-]+$/),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(500).nullable().optional(),
  alertCode: z.string().trim().max(100).nullable().optional(),
  defaultSeverity: SeverityParamSchema.default('P2'),
  triageSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  mitigationSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  verificationSteps: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  isActive: z.boolean().optional(),
});

export type CreateRunbookRequest = z.infer<typeof CreateRunbookSchema>;

export const UpdateRunbookSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  alertCode: z.string().trim().max(100).nullable().optional(),
  defaultSeverity: SeverityParamSchema.optional(),
  triageSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(30).optional(),
  mitigationSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(30).optional(),
  verificationSteps: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateRunbookRequest = z.infer<typeof UpdateRunbookSchema>;

export const ListOwnerMappingsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    source: optionalQueryParam(
      z.enum(
        ALL_INCIDENT_SOURCES as [
          (typeof ALL_INCIDENT_SOURCES)[number],
          ...(typeof ALL_INCIDENT_SOURCES)[number][],
        ],
      ),
    ),
    severity: optionalQueryParam(SeverityParamSchema),
    ownerUserId: z.coerce.number().int().positive().optional(),
    isEnabled: optionalQueryParam(booleanQueryParam()),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListOwnerMappingsQuery = z.infer<typeof ListOwnerMappingsQuerySchema>;

export const CreateOwnerMappingSchema = z.object({
  alertCode: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/),
  alertName: z.string().trim().min(2).max(160),
  source: z
    .enum(
      ALL_INCIDENT_SOURCES as [
        (typeof ALL_INCIDENT_SOURCES)[number],
        ...(typeof ALL_INCIDENT_SOURCES)[number][],
      ],
    )
    .default('SIEM'),
  defaultSeverity: SeverityParamSchema.default('P2'),
  ownerUserId: z.coerce.number().int().positive(),
  backupOwnerUserId: z.coerce.number().int().positive().nullable().optional(),
  runbookId: z.coerce.number().int().positive().nullable().optional(),
  notifyChannels: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
  isEnabled: z.boolean().optional(),
});

export type CreateOwnerMappingRequest = z.infer<typeof CreateOwnerMappingSchema>;

export const UpdateOwnerMappingSchema = z.object({
  alertName: z.string().trim().min(2).max(160).optional(),
  source: z
    .enum(
      ALL_INCIDENT_SOURCES as [
        (typeof ALL_INCIDENT_SOURCES)[number],
        ...(typeof ALL_INCIDENT_SOURCES)[number][],
      ],
    )
    .optional(),
  defaultSeverity: SeverityParamSchema.optional(),
  ownerUserId: z.coerce.number().int().positive().optional(),
  backupOwnerUserId: z.coerce.number().int().positive().nullable().optional(),
  runbookId: z.coerce.number().int().positive().nullable().optional(),
  notifyChannels: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
  isEnabled: z.boolean().optional(),
});

export type UpdateOwnerMappingRequest = z.infer<typeof UpdateOwnerMappingSchema>;

export const ListIncidentsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    severity: optionalQueryParam(SeverityParamSchema),
    status: optionalQueryParam(
      z.enum(
        ALL_INCIDENT_STATUSES as [
          (typeof ALL_INCIDENT_STATUSES)[number],
          ...(typeof ALL_INCIDENT_STATUSES)[number][],
        ],
      ),
    ),
    source: optionalQueryParam(
      z.enum(
        ALL_INCIDENT_SOURCES as [
          (typeof ALL_INCIDENT_SOURCES)[number],
          ...(typeof ALL_INCIDENT_SOURCES)[number][],
        ],
      ),
    ),
    ownerUserId: z.coerce.number().int().positive().optional(),
    isRepeated: optionalQueryParam(booleanQueryParam()),
    slaBreached: optionalQueryParam(booleanQueryParam()),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListIncidentsQuery = z.infer<typeof ListIncidentsQuerySchema>;

export const CreateIncidentSchema = z.object({
  title: z.string().trim().min(3).max(240),
  description: z.string().trim().max(2000).nullable().optional(),
  source: z
    .enum(
      ALL_INCIDENT_SOURCES as [
        (typeof ALL_INCIDENT_SOURCES)[number],
        ...(typeof ALL_INCIDENT_SOURCES)[number][],
      ],
    )
    .default('MANUAL'),
  alertCode: z.string().trim().min(2).max(100).default('MANUAL_INCIDENT'),
  severity: SeverityParamSchema.optional(),
  fingerprint: z.string().trim().max(191).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateIncidentRequest = z.infer<typeof CreateIncidentSchema>;

export const IncidentNoteActionSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
});

export const MitigateIncidentSchema = z.object({
  mitigationSummary: z.string().trim().min(3).max(2000),
  actorUserId: z.coerce.number().int().positive().optional(),
});

export const ResolveIncidentSchema = z.object({
  rootCause: z.string().trim().min(3).max(4000),
  mitigationSummary: z.string().trim().min(3).max(4000),
  resolutionNote: z.string().trim().max(2000).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
});

export const AssignIncidentOwnerSchema = z.object({
  ownerUserId: z.coerce.number().int().positive(),
  note: z.string().trim().max(500).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
});

export const PreventiveActionInputSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(2).max(240),
  ownerUserId: z.coerce.number().int().positive().nullable().optional(),
  dueDate: z.string().trim().max(40).nullable().optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).default('OPEN'),
});

export const UpsertPostmortemSchema = z.object({
  title: z.string().trim().min(3).max(240),
  summary: z.string().trim().min(5).max(4000),
  impactSummary: z.string().trim().max(4000).nullable().optional(),
  rootCauseAnalysis: z.string().trim().min(5).max(6000),
  lessonsLearned: z.string().trim().min(5).max(6000),
  preventiveActions: z.array(PreventiveActionInputSchema).max(50).default([]),
  authorId: z.coerce.number().int().positive().optional(),
});

export type UpsertPostmortemRequest = z.infer<typeof UpsertPostmortemSchema>;

export const ListPostmortemsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    status: optionalQueryParam(
      z.enum(
        ALL_POSTMORTEM_STATUSES as [
          (typeof ALL_POSTMORTEM_STATUSES)[number],
          ...(typeof ALL_POSTMORTEM_STATUSES)[number][],
        ],
      ),
    ),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListPostmortemsQuery = z.infer<typeof ListPostmortemsQuerySchema>;

export const ListSiemLogsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    status: optionalQueryParam(
      z.enum([
        SIEM_DISPATCH_STATUS.SENT,
        SIEM_DISPATCH_STATUS.FAILED,
        SIEM_DISPATCH_STATUS.SKIPPED,
      ]),
    ),
    eventType: optionalQueryParam(z.string().trim().max(80)),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListSiemLogsQuery = z.infer<typeof ListSiemLogsQuerySchema>;

export const TestSiemConnectionSchema = z.object({
  driver: z
    .enum(
      ALL_SIEM_DRIVERS as [
        (typeof ALL_SIEM_DRIVERS)[number],
        ...(typeof ALL_SIEM_DRIVERS)[number][],
      ],
    )
    .optional(),
  endpoint: z.string().trim().max(500).optional(),
  authToken: z.string().trim().max(500).optional(),
});
