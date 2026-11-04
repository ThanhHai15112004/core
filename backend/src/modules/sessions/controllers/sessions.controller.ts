import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApiDoc,
  ApiGroup,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { CurrentUser, RequirePermissions, type UserIdentity } from '@packages/security/index.js';
import {
  type LoginHistoryQuery,
  type RevokeAllSessionsRequest,
  loginHistoryQuerySchema,
  revokeAllSessionsSchema,
} from '../requests/sessions.requests.js';
import {
  type LoginHistoryItemResponse,
  type SessionItemResponse,
  loginHistoryItemResponseSchema,
  sessionItemResponseSchema,
} from '../responses/sessions.response.js';
import { SESSIONS_ROUTES } from '../routes/sessions.routes.js';
import { SessionService } from '../services/session.service.js';

@ApiGroup(
  'Sessions & Login History',
  'Quản lý phiên đăng nhập, danh sách thiết bị đang hoạt động, thu hồi phiên và lịch sử đăng nhập (Mục 3.4)',
)
@Controller(SESSIONS_ROUTES.PREFIX)
export class SessionsController {
  constructor(private readonly sessionService: SessionService) {}

  /** Xem danh sách các phiên đăng nhập đang hoạt động của tài khoản */
  @Get(SESSIONS_ROUTES.LIST)
  @ApiDoc({
    summary: 'Danh sách các phiên đăng nhập / thiết bị đang hoạt động',
    response: z.array(sessionItemResponseSchema),
  })
  public async listSessions(@CurrentUser() user: UserIdentity): Promise<SessionItemResponse[]> {
    return this.sessionService.listUserSessions(user.id, user.sessionId);
  }

  /** Xem lịch sử đăng nhập & đăng xuất theo thời gian, IP và thiết bị (Mục 3.4.7) */
  @Get(SESSIONS_ROUTES.LOGIN_HISTORY)
  @ApiDoc({
    summary: 'Xem lịch sử đăng nhập, đăng xuất và thu hồi phiên theo thời gian, IP và thiết bị',
    response: z.array(loginHistoryItemResponseSchema),
  })
  public async listLoginHistory(
    @CurrentUser() user: UserIdentity,
    @ValidatedQuery(loginHistoryQuerySchema) query?: LoginHistoryQuery,
  ): Promise<LoginHistoryItemResponse[]> {
    return this.sessionService.listUserLoginHistory(user.id, query?.limit);
  }

  /** Thu hồi một phiên đăng nhập cụ thể */
  @Delete(SESSIONS_ROUTES.BY_ID)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Thu hồi một phiên đăng nhập theo sessionId',
    response: z.object({ revoked: z.literal(true), sessionId: z.number().int().positive() }),
  })
  public async revokeSession(
    @CurrentUser() user: UserIdentity,
    @ValidatedParams(positiveIntParamSchema, 'sessionId') sessionId: number,
    @Req() req?: FastifyRequest,
  ): Promise<{ revoked: true; sessionId: number }> {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    return this.sessionService.revokeSessionById(user.id, sessionId, 'Revoked by user', {
      ipAddress: req?.ip ?? null,
      userAgent,
    });
  }

  /** Thu hồi tất cả các phiên đăng nhập (Mục 3.2.5 & 3.4.6) */
  @Post(SESSIONS_ROUTES.REVOKE_ALL)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Thu hồi toàn bộ các phiên đăng nhập của tài khoản (hỗ trợ includeCurrent)',
    response: z.object({ revokedCount: z.number() }),
  })
  public async revokeAllOtherSessions(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(revokeAllSessionsSchema) body?: RevokeAllSessionsRequest,
    @Req() req?: FastifyRequest,
  ): Promise<{ revokedCount: number }> {
    const includeCurrent = body?.includeCurrent === true;
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const revokedCount = await this.sessionService.revokeAllUserSessions(
      user.id,
      includeCurrent ? 'Revoked all sessions' : 'Revoked all other sessions',
      includeCurrent ? undefined : user.sessionId,
      {
        ipAddress: req?.ip ?? null,
        userAgent,
      },
    );
    return { revokedCount };
  }

  /** Xem lịch sử đăng nhập & đăng xuất của một người dùng cụ thể (Dành cho Quản trị viên — Mục 3.4.7) */
  @Get(SESSIONS_ROUTES.USER_LOGIN_HISTORY)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem lịch sử đăng nhập & đăng xuất của một người dùng theo userId',
    response: z.array(loginHistoryItemResponseSchema),
  })
  public async listUserLoginHistory(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @ValidatedQuery(loginHistoryQuerySchema) query?: LoginHistoryQuery,
  ): Promise<LoginHistoryItemResponse[]> {
    return this.sessionService.listUserLoginHistory(userId, query?.limit);
  }

  /** Thu hồi toàn bộ phiên đăng nhập của một người dùng khi có sự cố bảo mật (Dành cho Quản trị viên — Mục 3.4.6) */
  @Post(SESSIONS_ROUTES.USER_REVOKE_ALL)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.status')
  @ApiDoc({
    summary: 'Thu hồi toàn bộ phiên đăng nhập của một người dùng theo userId',
    response: z.object({
      revoked: z.literal(true),
      userId: z.number().int().positive(),
      revokedCount: z.number(),
      revokedSessionsCount: z.number(),
    }),
  })
  public async revokeUserSessionsByAdmin(
    @ValidatedParams(positiveIntParamSchema, 'userId') userId: number,
    @CurrentUser() actor?: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<{
    revoked: true;
    userId: number;
    revokedCount: number;
    revokedSessionsCount: number;
  }> {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const reason = actor?.id
      ? `Revoked all sessions by administrator #${actor.id} due to security incident`
      : 'Revoked all sessions by administrator due to security incident';
    const revokedCount = await this.sessionService.revokeAllUserSessions(
      userId,
      reason,
      undefined,
      {
        ipAddress: req?.ip ?? null,
        userAgent,
      },
    );
    return {
      revoked: true,
      userId,
      revokedCount,
      revokedSessionsCount: revokedCount,
    };
  }
}
