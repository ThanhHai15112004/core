import { z } from 'zod';
import {
  booleanQueryParam,
  createPaginationQuerySchema,
  optionalQueryParam,
} from '@packages/http/index.js';
import {
  ALL_ALERT_CHANNELS,
  ALL_ALERT_EVENT_STATUSES,
  ALL_ALERT_METRIC_KEYS,
  ALL_ALERT_OPERATORS,
  ALL_ALERT_SEVERITIES,
} from '../enum/metrics-ops.enum.js';

export const METRICS_RANGE_MINUTES = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
} as const;

export type MetricsRangeKey = keyof typeof METRICS_RANGE_MINUTES;

export const MetricsOverviewQuerySchema = z.object({
  range: z
    .enum(Object.keys(METRICS_RANGE_MINUTES) as [MetricsRangeKey, ...MetricsRangeKey[]])
    .default('15m'),
});

export type MetricsOverviewQuery = z.infer<typeof MetricsOverviewQuerySchema>;

const scopeSchema = z
  .object({
    module: z.string().trim().min(1).max(64).optional(),
    version: z.string().trim().min(1).max(64).optional(),
    route: z.string().trim().min(1).max(200).optional(),
    instance: z.string().trim().min(1).max(160).optional(),
    runtime: z.string().trim().min(1).max(32).optional(),
    queue: z.string().trim().min(1).max(100).optional(),
    provider: z.string().trim().min(1).max(100).optional(),
  })
  .nullable()
  .optional();

const notifyTargetsSchema = z
  .object({
    userIds: z.array(z.coerce.number().int().positive()).max(50).optional(),
    roleCodes: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  })
  .nullable()
  .optional();

export const CreateAlertRuleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).nullable().optional(),
  isEnabled: z.boolean().optional(),
  metricKey: z.enum(
    ALL_ALERT_METRIC_KEYS as [
      (typeof ALL_ALERT_METRIC_KEYS)[number],
      ...(typeof ALL_ALERT_METRIC_KEYS)[number][],
    ],
  ),
  scope: scopeSchema,
  operator: z
    .enum(
      ALL_ALERT_OPERATORS as [
        (typeof ALL_ALERT_OPERATORS)[number],
        ...(typeof ALL_ALERT_OPERATORS)[number][],
      ],
    )
    .default('gt'),
  threshold: z.coerce.number().finite(),
  windowSeconds: z.coerce.number().int().min(60).max(86400).default(300),
  forSeconds: z.coerce.number().int().min(0).max(86400).default(0),
  cooldownSeconds: z.coerce.number().int().min(10).max(86400).default(300),
  severity: z
    .enum(
      ALL_ALERT_SEVERITIES as [
        (typeof ALL_ALERT_SEVERITIES)[number],
        ...(typeof ALL_ALERT_SEVERITIES)[number][],
      ],
    )
    .default('WARNING'),
  channels: z
    .array(
      z.enum(
        ALL_ALERT_CHANNELS as [
          (typeof ALL_ALERT_CHANNELS)[number],
          ...(typeof ALL_ALERT_CHANNELS)[number][],
        ],
      ),
    )
    .max(10)
    .optional(),
  webhookUrl: z.string().trim().max(500).nullable().optional(),
  notifyTargets: notifyTargetsSchema,
});

export type CreateAlertRuleRequest = z.infer<typeof CreateAlertRuleSchema>;

export const UpdateAlertRuleSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isEnabled: z.boolean().optional(),
  metricKey: z
    .enum(
      ALL_ALERT_METRIC_KEYS as [
        (typeof ALL_ALERT_METRIC_KEYS)[number],
        ...(typeof ALL_ALERT_METRIC_KEYS)[number][],
      ],
    )
    .optional(),
  scope: scopeSchema,
  operator: z
    .enum(
      ALL_ALERT_OPERATORS as [
        (typeof ALL_ALERT_OPERATORS)[number],
        ...(typeof ALL_ALERT_OPERATORS)[number][],
      ],
    )
    .optional(),
  threshold: z.coerce.number().finite().optional(),
  windowSeconds: z.coerce.number().int().min(60).max(86400).optional(),
  forSeconds: z.coerce.number().int().min(0).max(86400).optional(),
  cooldownSeconds: z.coerce.number().int().min(10).max(86400).optional(),
  severity: z
    .enum(
      ALL_ALERT_SEVERITIES as [
        (typeof ALL_ALERT_SEVERITIES)[number],
        ...(typeof ALL_ALERT_SEVERITIES)[number][],
      ],
    )
    .optional(),
  channels: z
    .array(
      z.enum(
        ALL_ALERT_CHANNELS as [
          (typeof ALL_ALERT_CHANNELS)[number],
          ...(typeof ALL_ALERT_CHANNELS)[number][],
        ],
      ),
    )
    .max(10)
    .optional(),
  webhookUrl: z.string().trim().max(500).nullable().optional(),
  notifyTargets: notifyTargetsSchema,
});

export type UpdateAlertRuleRequest = z.infer<typeof UpdateAlertRuleSchema>;

export const ListAlertRulesQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
}).and(
  z.object({
    metricKey: optionalQueryParam(
      z.enum(
        ALL_ALERT_METRIC_KEYS as [
          (typeof ALL_ALERT_METRIC_KEYS)[number],
          ...(typeof ALL_ALERT_METRIC_KEYS)[number][],
        ],
      ),
    ),
    severity: optionalQueryParam(
      z.enum(
        ALL_ALERT_SEVERITIES as [
          (typeof ALL_ALERT_SEVERITIES)[number],
          ...(typeof ALL_ALERT_SEVERITIES)[number][],
        ],
      ),
    ),
    isEnabled: optionalQueryParam(booleanQueryParam()),
    search: optionalQueryParam(z.string().trim().min(1).max(160)),
  }),
);

export type ListAlertRulesQuery = z.infer<typeof ListAlertRulesQuerySchema>;

export const ListAlertEventsQuerySchema = createPaginationQuerySchema({
  defaultLimit: 20,
}).and(
  z.object({
    status: optionalQueryParam(
      z.enum(
        ALL_ALERT_EVENT_STATUSES as [
          (typeof ALL_ALERT_EVENT_STATUSES)[number],
          ...(typeof ALL_ALERT_EVENT_STATUSES)[number][],
        ],
      ),
    ),
    severity: optionalQueryParam(
      z.enum(
        ALL_ALERT_SEVERITIES as [
          (typeof ALL_ALERT_SEVERITIES)[number],
          ...(typeof ALL_ALERT_SEVERITIES)[number][],
        ],
      ),
    ),
    metricKey: optionalQueryParam(
      z.enum(
        ALL_ALERT_METRIC_KEYS as [
          (typeof ALL_ALERT_METRIC_KEYS)[number],
          ...(typeof ALL_ALERT_METRIC_KEYS)[number][],
        ],
      ),
    ),
    ruleCode: optionalQueryParam(z.string().trim().min(1).max(80)),
    search: optionalQueryParam(z.string().trim().min(1).max(160)),
  }),
);

export type ListAlertEventsQuery = z.infer<typeof ListAlertEventsQuerySchema>;

export const TestAlertRuleSchema = z.object({
  dispatch: z.boolean().default(false),
});

export type TestAlertRuleRequest = z.infer<typeof TestAlertRuleSchema>;

export const AlertEventActionSchema = z.object({
  note: z.string().trim().max(500).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
});

export type AlertEventActionRequest = z.infer<typeof AlertEventActionSchema>;

export const RuleIdParamSchema = z.coerce.number().int().positive();
