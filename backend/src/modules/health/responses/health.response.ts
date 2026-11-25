import { z } from 'zod';

export const healthCheckResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  ready: z.boolean().optional(),
  live: z.boolean().optional(),
  uptime: z.number(),
  timestamp: z.string().optional(),
  redacted: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  checks: z.record(z.string(), z.unknown()).optional(),
});

export const livenessCheckResponseSchema = z.object({
  status: z.enum(['ok', 'down']),
  live: z.boolean(),
  uptime: z.number(),
  timestamp: z.string(),
});

export const readinessCheckResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  ready: z.boolean(),
  uptime: z.number(),
  timestamp: z.string(),
  redacted: z.boolean().optional(),
  checks: z.record(z.string(), z.unknown()).optional(),
});

export const detailedHealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  live: z.boolean(),
  ready: z.boolean(),
  uptime: z.number(),
  timestamp: z.string(),
  runtimeState: z.string(),
  warnings: z.array(z.string()),
  criticalErrors: z.array(z.string()),
  checks: z.record(z.string(), z.unknown()),
  dependencies: z.record(z.string(), z.unknown()),
  settings: z.record(z.string(), z.unknown()),
});
