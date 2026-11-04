import { z } from 'zod';
import type { LoginHistoryItemResponse, SessionItemResponse } from '../types/sessions.types.js';

export type { LoginHistoryItemResponse, SessionItemResponse };
export type SessionResponse = SessionItemResponse;

export const sessionItemResponseSchema = z.object({
  id: z.number().int().min(1),
  userId: z.number().int().min(1),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  deviceName: z.string().nullable(),
  isCurrent: z.boolean(),
  lastActiveAt: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable().optional(),
  revokeReason: z.string().nullable().optional(),
});

export const sessionResponseSchema = sessionItemResponseSchema;
export const sessionListResponseSchema = z.array(sessionItemResponseSchema);

export const loginHistoryItemResponseSchema = z.object({
  id: z.number().int().min(1),
  userId: z.number().int().min(1).nullable(),
  sessionId: z.number().int().min(1).nullable(),
  identifier: z.string().nullable(),
  eventType: z.number().int().min(1).max(15),
  eventTypeName: z.enum([
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'MFA_CHALLENGE',
    'MFA_FAILED',
    'LOGOUT',
    'SESSION_REVOKED',
    'SESSION_REVOKE_ALL',
    'SESSION_EXPIRED',
    'TOKEN_REUSE_DETECTED',
    'MFA_DISABLED',
    'MFA_RESET',
    'PASSWORD_CHANGED',
    'PASSWORD_RESET',
    'PERMISSION_CHANGED',
    'DATA_EXPORT',
  ]),
  status: z.number().int().min(1).max(2),
  statusName: z.enum(['SUCCESS', 'FAILED']),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  deviceName: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const loginHistoryListResponseSchema = z.array(loginHistoryItemResponseSchema);

export const revokeSessionResponseSchema = z.object({
  revoked: z.literal(true),
  sessionId: z.number().int().positive(),
});

export const revokeAllSessionsResponseSchema = z.object({
  revokedCount: z.number(),
});
