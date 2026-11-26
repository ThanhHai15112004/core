import { z } from 'zod';
import { createPaginationQuerySchema, optionalQueryParam } from '@packages/http/index.js';
import {
  DR_CHECKLIST_STEP_STATUS,
  DR_DRILL_STATUS,
  DR_DRILL_TYPE,
  DR_RECONCILE_STATUS,
  DR_SWITCH_DIRECTION,
  DR_SWITCH_MODE,
  DR_SWITCH_STATUS,
  DR_SYNC_SCOPE,
  DR_SYNC_STATUS,
  DR_TOPOLOGY_MODE,
} from '../enum/dr-ops.enum.js';

export const PositiveIdParamSchema = z.coerce.number().int().positive();

export const StepKeyParamSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9_]+$/);

export const UpdateDrProfileSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  isEnabled: z.boolean().optional(),
  topologyMode: z
    .enum([
      DR_TOPOLOGY_MODE.BACKUP_RESTORE,
      DR_TOPOLOGY_MODE.PILOT_LIGHT,
      DR_TOPOLOGY_MODE.WARM_STANDBY,
      DR_TOPOLOGY_MODE.HOT_STANDBY,
    ])
    .optional(),
  rpoTargetSeconds: z.coerce.number().int().min(1).max(604_800).optional(),
  rtoTargetSeconds: z.coerce.number().int().min(1).max(604_800).optional(),
  primarySiteCode: z.string().trim().min(2).max(64).optional(),
  primarySiteName: z.string().trim().min(2).max(160).optional(),
  primaryRegion: z.string().trim().min(2).max(80).optional(),
  primaryEndpoint: z.string().trim().max(255).nullable().optional(),
  drSiteCode: z.string().trim().min(2).max(64).optional(),
  drSiteName: z.string().trim().min(2).max(160).optional(),
  drRegion: z.string().trim().min(2).max(80).optional(),
  drEndpoint: z.string().trim().max(255).nullable().optional(),
  syncCron: z.string().trim().min(5).max(64).optional(),
  drillIntervalDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const ListDrSyncRunsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    scope: optionalQueryParam(
      z.enum([DR_SYNC_SCOPE.DATABASE, DR_SYNC_SCOPE.STORAGE, DR_SYNC_SCOPE.FULL]),
    ),
    status: optionalQueryParam(
      z.enum([
        DR_SYNC_STATUS.RUNNING,
        DR_SYNC_STATUS.SUCCESS,
        DR_SYNC_STATUS.DEGRADED,
        DR_SYNC_STATUS.FAILED,
      ]),
    ),
  }),
);

export const RunDrSyncSchema = z.object({
  scope: z
    .enum([DR_SYNC_SCOPE.DATABASE, DR_SYNC_SCOPE.STORAGE, DR_SYNC_SCOPE.FULL])
    .default(DR_SYNC_SCOPE.FULL),
});

export const ListDrSwitchesQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    direction: optionalQueryParam(
      z.enum([DR_SWITCH_DIRECTION.FAILOVER, DR_SWITCH_DIRECTION.FAILBACK]),
    ),
    status: optionalQueryParam(
      z.enum([
        DR_SWITCH_STATUS.IN_PROGRESS,
        DR_SWITCH_STATUS.COMPLETED,
        DR_SWITCH_STATUS.ABORTED,
        DR_SWITCH_STATUS.FAILED,
      ]),
    ),
  }),
);

export const InitiateDrSwitchSchema = z.object({
  mode: z.enum([DR_SWITCH_MODE.SIMULATED, DR_SWITCH_MODE.LIVE]).default(DR_SWITCH_MODE.SIMULATED),
  reason: z.string().trim().min(5).max(1000),
  confirm: z.string().trim().max(64).optional(),
});

export const UpdateDrChecklistStepSchema = z.object({
  status: z.enum([
    DR_CHECKLIST_STEP_STATUS.PENDING,
    DR_CHECKLIST_STEP_STATUS.COMPLETED,
    DR_CHECKLIST_STEP_STATUS.SKIPPED,
    DR_CHECKLIST_STEP_STATUS.FAILED,
  ]),
  note: z.string().trim().max(500).nullable().optional(),
});

export const CompleteDrSwitchSchema = z.object({
  confirm: z.string().trim().max(64).optional(),
  reconciliationReportId: z.coerce.number().int().positive().nullable().optional(),
});

export const AbortDrSwitchSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});

export const ListDrReconciliationsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    scope: optionalQueryParam(
      z.enum([DR_SYNC_SCOPE.DATABASE, DR_SYNC_SCOPE.STORAGE, DR_SYNC_SCOPE.FULL]),
    ),
    status: optionalQueryParam(
      z.enum([
        DR_RECONCILE_STATUS.PASSED,
        DR_RECONCILE_STATUS.DISCREPANCIES_FOUND,
        DR_RECONCILE_STATUS.FAILED,
      ]),
    ),
  }),
);

const SnapshotRecordSchema = z.object({
  key: z.string().trim().min(1).max(255),
  checksumOrSize: z.union([z.string(), z.number()]),
});

export const RunDrReconciliationSchema = z.object({
  scope: z
    .enum([DR_SYNC_SCOPE.DATABASE, DR_SYNC_SCOPE.STORAGE, DR_SYNC_SCOPE.FULL])
    .default(DR_SYNC_SCOPE.FULL),
  switchExecutionId: z.coerce.number().int().positive().nullable().optional(),
  primaryDbSnapshots: z.array(SnapshotRecordSchema).max(500).optional(),
  drDbSnapshots: z.array(SnapshotRecordSchema).max(500).optional(),
  primaryStorageSnapshots: z.array(SnapshotRecordSchema).max(2000).optional(),
  drStorageSnapshots: z.array(SnapshotRecordSchema).max(2000).optional(),
});

export const ListDrDrillsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
}).and(
  z.object({
    drillType: optionalQueryParam(
      z.enum([
        DR_DRILL_TYPE.SCHEDULED_SIMULATION,
        DR_DRILL_TYPE.MANUAL_SIMULATION,
        DR_DRILL_TYPE.LIVE_GAME_DAY,
        DR_DRILL_TYPE.TABLETOP,
      ]),
    ),
    status: optionalQueryParam(
      z.enum([DR_DRILL_STATUS.RUNNING, DR_DRILL_STATUS.PASSED, DR_DRILL_STATUS.FAILED]),
    ),
  }),
);

export const RunDrDrillSchema = z.object({
  drillType: z
    .enum([
      DR_DRILL_TYPE.MANUAL_SIMULATION,
      DR_DRILL_TYPE.LIVE_GAME_DAY,
      DR_DRILL_TYPE.TABLETOP,
    ])
    .default(DR_DRILL_TYPE.MANUAL_SIMULATION),
  scenario: z
    .string()
    .trim()
    .min(3)
    .max(160)
    .default('Diễn tập chuyển đổi DC chính → DR và đo RTO/RPO thực tế'),
  measuredRpoSeconds: z.coerce.number().int().min(0).max(604_800).optional(),
  measuredRtoSeconds: z.coerce.number().int().min(0).max(604_800).optional(),
  lessonsLearned: z.string().trim().max(2000).optional(),
});

export type UpdateDrProfileRequest = z.infer<typeof UpdateDrProfileSchema>;
export type RunDrSyncRequest = z.infer<typeof RunDrSyncSchema>;
export type InitiateDrSwitchRequest = z.infer<typeof InitiateDrSwitchSchema>;
export type UpdateDrChecklistStepRequest = z.infer<typeof UpdateDrChecklistStepSchema>;
export type CompleteDrSwitchRequest = z.infer<typeof CompleteDrSwitchSchema>;
export type AbortDrSwitchRequest = z.infer<typeof AbortDrSwitchSchema>;
export type RunDrReconciliationRequest = z.infer<typeof RunDrReconciliationSchema>;
export type RunDrDrillRequest = z.infer<typeof RunDrDrillSchema>;
