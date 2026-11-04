import { Controller, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiDoc, ApiGroup, Public, ValidatedBody, ValidatedQuery } from '@packages/http/index.js';
import { CurrentUser, RequirePermissions, type UserIdentity } from '@packages/security/index.js';
import {
  type AdminResetPasswordRequest,
  type ChangePasswordRequest,
  type ForgotPasswordRequest,
  type ResetPasswordRequest,
  type SuggestPasswordQuery,
  type UpdateSecuritySettingsRequest,
  adminResetPasswordRequestSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  suggestPasswordQuerySchema,
  updateSecuritySettingsSchema,
} from '../requests/credentials.requests.js';
import {
  type AdminResetPasswordResponse,
  type ForgotPasswordResponse,
  type SecuritySettingsResponse,
  type SuggestedPasswordResponse,
  adminResetPasswordResponseSchema,
  forgotPasswordResponseSchema,
  securitySettingsResponseSchema,
  suggestedPasswordResponseSchema,
} from '../responses/credentials.response.js';
import { CREDENTIALS_ROUTES } from '../routes/credentials.routes.js';
import { PasswordService } from '../services/password.service.js';
import { SecuritySettingsService } from '../services/security-settings.service.js';

@ApiGroup(
  'Credentials & Password Security',
  'Quản lý mật khẩu, khôi phục mật khẩu, chính sách mật khẩu và cấu hình bảo mật hệ thống (Mục 3.3)',
)
@Controller(CREDENTIALS_ROUTES.PREFIX)
export class CredentialsController {
  constructor(
    private readonly passwordService: PasswordService,
    private readonly securitySettingsService: SecuritySettingsService,
  ) {}

  /** Gợi ý mật khẩu mạnh ngẫu nhiên đạt chuẩn chính sách mật khẩu hiện hành (Mục 3.3) */
  @Public()
  @Get(CREDENTIALS_ROUTES.PASSWORD_SUGGEST)
  @ApiDoc({
    summary: 'Gợi ý danh sách mật khẩu mạnh đạt chuẩn chính sách mật khẩu của hệ thống',
    response: suggestedPasswordResponseSchema,
  })
  public async suggestPassword(
    @ValidatedQuery(suggestPasswordQuerySchema) query?: SuggestPasswordQuery,
  ): Promise<SuggestedPasswordResponse> {
    return this.passwordService.suggestPasswords(query);
  }

  /** Đổi mật khẩu khi đang đăng nhập (Mục 3.3.1) */
  @Post(CREDENTIALS_ROUTES.PASSWORD_CHANGE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary:
      'Đổi mật khẩu tài khoản hiện tại (có kiểm tra chính sách mật khẩu, lịch sử mật khẩu và thu hồi phiên)',
    response: z.object({ changed: z.literal(true), revokedSessionsCount: z.number() }),
  })
  public async changePassword(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(changePasswordSchema) body: ChangePasswordRequest,
  ): Promise<{ changed: true; revokedSessionsCount: number }> {
    return this.passwordService.changePassword(user.id, body, user.sessionId);
  }

  /** Yêu cầu đặt lại mật khẩu khi quên mật khẩu (gửi cả Link Token và OTP 6 số - Mục 3.3.2) */
  @Public()
  @Post(CREDENTIALS_ROUTES.PASSWORD_FORGOT)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Yêu cầu đặt lại mật khẩu (gửi link khôi phục hoặc mã OTP 6 chữ số)',
    response: forgotPasswordResponseSchema,
  })
  public async forgotPassword(
    @ValidatedBody(forgotPasswordSchema) body: ForgotPasswordRequest,
    @Req() req?: FastifyRequest,
  ): Promise<ForgotPasswordResponse> {
    return this.passwordService.requestPasswordReset(body, req?.ip ?? null);
  }

  /** Đặt lại mật khẩu mới bằng token khôi phục hoặc mã OTP 6 chữ số (Mục 3.3.2) */
  @Public()
  @Post(CREDENTIALS_ROUTES.PASSWORD_RESET)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đặt lại mật khẩu mới bằng token khôi phục hoặc mã OTP 6 chữ số (Reset Password)',
    response: z.object({ reset: z.literal(true), revokedSessionsCount: z.number() }),
  })
  public async resetPassword(
    @ValidatedBody(resetPasswordSchema) body: ResetPasswordRequest,
  ): Promise<{ reset: true; revokedSessionsCount: number }> {
    return this.passwordService.resetPassword(body);
  }

  /** Reset mật khẩu người dùng từ trang quản trị (chỉ người có quyền users.update - Mục 3.3.3) */
  @Post(CREDENTIALS_ROUTES.PASSWORD_ADMIN_RESET)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary:
      'Reset mật khẩu người dùng từ trang quản trị (hỗ trợ tự sinh mật khẩu gợi ý và thu hồi phiên)',
    response: adminResetPasswordResponseSchema,
  })
  public async adminResetPassword(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(adminResetPasswordRequestSchema) body: AdminResetPasswordRequest,
  ): Promise<AdminResetPasswordResponse> {
    return this.passwordService.adminResetUserPassword(
      body.userId,
      {
        newPassword: body.newPassword,
        useSuggestedPassword: body.useSuggestedPassword,
        revokeSessions: body.revokeSessions,
      },
      user.id,
    );
  }

  /** Xem cấu hình Bảo mật & Mã hóa hệ thống (System Console -> Security) */
  @Public()
  @Get(CREDENTIALS_ROUTES.SECURITY_SETTINGS)
  @ApiDoc({
    summary:
      'Xem cấu hình thuật toán băm mật khẩu, thuật toán mã hóa DB và chính sách MFA/khóa tài khoản',
    response: securitySettingsResponseSchema,
  })
  public async getSecuritySettings(): Promise<SecuritySettingsResponse> {
    return this.securitySettingsService.getSettings();
  }

  /** Cập nhật cấu hình Bảo mật & Mã hóa hệ thống (System Console -> Security) */
  @Public()
  @Put(CREDENTIALS_ROUTES.SECURITY_SETTINGS)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary:
      'Cập nhật thuật toán băm mật khẩu, thuật toán mã hóa DB và chính sách MFA/khóa tài khoản',
    response: securitySettingsResponseSchema,
  })
  public async updateSecuritySettings(
    @ValidatedBody(updateSecuritySettingsSchema) body: UpdateSecuritySettingsRequest,
  ): Promise<SecuritySettingsResponse> {
    return this.securitySettingsService.updateSettings(body);
  }
}
