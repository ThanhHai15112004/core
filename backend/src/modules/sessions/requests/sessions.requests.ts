import { z } from 'zod';

export const revokeAllSessionsSchema = z
  .object({
    includeCurrent: z.boolean().optional().default(false),
  })
  .default({ includeCurrent: false });

export type RevokeAllSessionsRequest = z.infer<typeof revokeAllSessionsSchema>;

export const loginHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  })
  .default({ limit: 50 });

export type LoginHistoryQuery = z.infer<typeof loginHistoryQuerySchema>;
export const listLoginHistoriesQuerySchema = loginHistoryQuerySchema;
export type ListLoginHistoriesQuery = LoginHistoryQuery;
