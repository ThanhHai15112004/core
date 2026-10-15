import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApiDoc,
  ApiGroup,
  Public,
  ValidatedBody,
  ValidatedParams,
  uuidParamSchema,
} from '@packages/http/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { AUTH_ROUTES } from '../routes/auth.routes.js';
import { AuthService } from '../services/auth.service.js';
import { SessionService } from '../services/session.service.js';
import { PasswordService } from '../services/password.service.js';
import { MfaService } from '../services/mfa.service.js';
import { SecuritySettingsService } from '../services/security-settings.service.js';
import {
  type ChangePasswordRequest,
  type DisableMfaRequest,
  type EnableEmailOtpMfaRequest,
  type EnableTotpMfaRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type RefreshTokenRequest,
  type ResetPasswordRequest,
  type SendEmailOtpRequest,
  type UpdateSecuritySettingsRequest,
  type VerifyMfaChallengeRequest,
  changePasswordSchema,
  disableMfaSchema,
  enableEmailOtpMfaSchema,
  enableTotpMfaSchema,
  forgotPasswordSchema,
  loginRequestSchema,
  refreshTokenSchema,
  resetPasswordSchema,
  sendEmailOtpSchema,
  updateSecuritySettingsSchema,
  verifyMfaChallengeSchema,
} from '../requests/auth.requests.js';
import {
  type AuthenticatedUserProfileResponse,
  type ForgotPasswordResponse,
  type LoginResponse,
  type MfaEnableResultResponse,
  type MfaStatusResponse,
  type MfaTotpSetupResponse,
  type SecuritySettingsResponse,
  type SendEmailOtpResponse,
  type SessionItemResponse,
  authenticatedUserProfileSchema,
  forgotPasswordResponseSchema,
  loginResponseSchema,
  mfaEnableResultResponseSchema,
  mfaStatusResponseSchema,
  mfaTotpSetupResponseSchema,
  securitySettingsResponseSchema,
  sendEmailOtpResponseSchema,
  sessionItemResponseSchema,
} from '../responses/auth.response.js';

@ApiGroup(
  'Authentication, Sessions & MFA',
  'Đăng nhập, Quản lý mật khẩu, Phiên đăng nhập và Xác thực nhiều lớp (Mục 3)',
)
@Controller(AUTH_ROUTES.PREFIX)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly passwordService: PasswordService,
    private readonly mfaService: MfaService,
    private readonly securitySettingsService: SecuritySettingsService,
  ) {}

  /** Đăng nhập tài khoản bằng Username/Email và Mật khẩu */
  @Public()
  @Post(AUTH_ROUTES.LOGIN)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đăng nhập tài khoản (hỗ trợ bước 2 MFA nếu tài khoản đã bật)',
    response: loginResponseSchema,
  })
  public async login(
    @ValidatedBody(loginRequestSchema) body: LoginRequest,
    @Req() req: FastifyRequest,
  ): Promise<LoginResponse> {
    const userAgent =
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    return this.authService.login(body, {
      ipAddress: req.ip ?? null,
      userAgent,
    });
  }

  /** Xác thực mã MFA bước 2 (TOTP, Email OTP hoặc Recovery Code) để hoàn tất đăng nhập */
  @Public()
  @Post(AUTH_ROUTES.MFA_VERIFY)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Xác thực mã MFA/2FA bước 2 (TOTP, Email OTP hoặc Recovery Code)',
    response: loginResponseSchema,
  })
  public async verifyMfa(
    @ValidatedBody(verifyMfaChallengeSchema) body: VerifyMfaChallengeRequest,
    @Req() req: FastifyRequest,
  ): Promise<LoginResponse> {
    const userAgent =
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    return this.authService.verifyMfaChallenge(body, {
      ipAddress: req.ip ?? null,
      userAgent,
    });
  }

  /** Gửi mã OTP 6 chữ số qua Email phục vụ xác thực bước 2 (MFA) */
  @Public()
  @Post(AUTH_ROUTES.MFA_EMAIL_OTP_SEND)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Gửi mã OTP 6 chữ số qua Email phục vụ xác thực nhiều lớp',
    response: sendEmailOtpResponseSchema,
  })
  public async sendEmailOtp(
    @ValidatedBody(sendEmailOtpSchema) body: SendEmailOtpRequest,
    @CurrentUser() user?: UserIdentity,
  ): Promise<SendEmailOtpResponse> {
    return this.authService.sendMfaEmailOtp(body, user?.id);
  }

  /** Làm mới Access Token bằng Refresh Token (Refresh Token Rotation) */
  @Public()
  @Post(AUTH_ROUTES.REFRESH)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Làm mới Access Token và xoay vòng Refresh Token',
    response: loginResponseSchema,
  })
  public async refresh(
    @ValidatedBody(refreshTokenSchema) body: RefreshTokenRequest,
  ): Promise<LoginResponse> {
    return this.authService.refresh(body);
  }

  /** Lấy thông tin hồ sơ người dùng đang đăng nhập */
  @Get(AUTH_ROUTES.ME)
  @ApiDoc({
    summary: 'Lấy thông tin hồ sơ và quyền hạn của người dùng đang đăng nhập',
    response: authenticatedUserProfileSchema,
  })
  public async getMe(@CurrentUser() user: UserIdentity): Promise<AuthenticatedUserProfileResponse> {
    return this.authService.getMe(user.id);
  }

  /** Đăng xuất khỏi phiên hiện tại */
  @Post(AUTH_ROUTES.LOGOUT)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đăng xuất và thu hồi phiên hiện tại',
    response: z.object({ loggedOut: z.literal(true) }),
  })
  public async logout(@CurrentUser() user: UserIdentity): Promise<{ loggedOut: true }> {
    if (user.sessionId) {
      await this.sessionService.revokeSessionById(user.id, user.sessionId, 'User logged out');
    } else {
      await this.sessionService.revokeAllUserSessions(user.id, 'User logged out');
    }
    return { loggedOut: true };
  }

  /** Xem danh sách các phiên đăng nhập đang hoạt động của tài khoản */
  @Get(AUTH_ROUTES.SESSIONS)
  @ApiDoc({
    summary: 'Danh sách các phiên đăng nhập / thiết bị đang hoạt động',
    response: z.array(sessionItemResponseSchema),
  })
  public async listSessions(@CurrentUser() user: UserIdentity): Promise<SessionItemResponse[]> {
    return this.sessionService.listUserSessions(user.id, user.sessionId);
  }

  /** Thu hồi một phiên đăng nhập cụ thể */
  @Delete(AUTH_ROUTES.SESSION_BY_ID)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Thu hồi một phiên đăng nhập theo sessionId',
    response: z.object({ revoked: z.literal(true), sessionId: z.string().uuid() }),
  })
  public async revokeSession(
    @CurrentUser() user: UserIdentity,
    @ValidatedParams(uuidParamSchema, 'sessionId') sessionId: string,
  ): Promise<{ revoked: true; sessionId: string }> {
    return this.sessionService.revokeSessionById(user.id, sessionId, 'Revoked by user');
  }

  /** Thu hồi tất cả các phiên đăng nhập khác */
  @Post(AUTH_ROUTES.REVOKE_ALL_SESSIONS)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Thu hồi toàn bộ các phiên đăng nhập khác của tài khoản',
    response: z.object({ revokedCount: z.number() }),
  })
  public async revokeAllOtherSessions(
    @CurrentUser() user: UserIdentity,
  ): Promise<{ revokedCount: number }> {
    const revokedCount = await this.sessionService.revokeAllUserSessions(
      user.id,
      'Revoked all other sessions',
      user.sessionId,
    );
    return { revokedCount };
  }

  /** Đổi mật khẩu khi đang đăng nhập */
  @Post(AUTH_ROUTES.PASSWORD_CHANGE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đổi mật khẩu tài khoản hiện tại',
    response: z.object({ changed: z.literal(true), revokedSessionsCount: z.number() }),
  })
  public async changePassword(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(changePasswordSchema) body: ChangePasswordRequest,
  ): Promise<{ changed: true; revokedSessionsCount: number }> {
    return this.passwordService.changePassword(user.id, body, user.sessionId);
  }

  /** Yêu cầu đặt lại mật khẩu khi quên mật khẩu */
  @Public()
  @Post(AUTH_ROUTES.PASSWORD_FORGOT)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Yêu cầu đặt lại mật khẩu (Forgot Password)',
    response: forgotPasswordResponseSchema,
  })
  public async forgotPassword(
    @ValidatedBody(forgotPasswordSchema) body: ForgotPasswordRequest,
    @Req() req: FastifyRequest,
  ): Promise<ForgotPasswordResponse> {
    return this.passwordService.requestPasswordReset(body, req.ip ?? null);
  }

  /** Đặt lại mật khẩu mới bằng token khôi phục */
  @Public()
  @Post(AUTH_ROUTES.PASSWORD_RESET)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đặt lại mật khẩu mới bằng token khôi phục (Reset Password)',
    response: z.object({ reset: z.literal(true), revokedSessionsCount: z.number() }),
  })
  public async resetPassword(
    @ValidatedBody(resetPasswordSchema) body: ResetPasswordRequest,
  ): Promise<{ reset: true; revokedSessionsCount: number }> {
    return this.passwordService.resetPassword(body);
  }

  /** Xem trạng thái cấu hình xác thực nhiều lớp (MFA) */
  @Get(AUTH_ROUTES.MFA_STATUS)
  @ApiDoc({
    summary: 'Xem trạng thái cấu hình MFA (TOTP, Email OTP, Recovery Codes)',
    response: mfaStatusResponseSchema,
  })
  public async getMfaStatus(@CurrentUser() user: UserIdentity): Promise<MfaStatusResponse> {
    return this.mfaService.getStatus(user.id);
  }

  /** Khởi tạo cấu hình TOTP (Google Authenticator / Authy) */
  @Post(AUTH_ROUTES.MFA_TOTP_SETUP)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Khởi tạo secret và đường dẫn otpauth:// cho ứng dụng Authenticator (TOTP)',
    response: mfaTotpSetupResponseSchema,
  })
  public async setupTotp(@CurrentUser() user: UserIdentity): Promise<MfaTotpSetupResponse> {
    return this.mfaService.setupTotp(user.id);
  }

  /** Kích hoạt TOTP sau khi xác nhận mã 6 số đầu tiên */
  @Post(AUTH_ROUTES.MFA_TOTP_ENABLE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Kích hoạt xác thực 2 lớp TOTP và nhận danh sách mã khôi phục dự phòng',
    response: mfaEnableResultResponseSchema,
  })
  public async enableTotp(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(enableTotpMfaSchema) body: EnableTotpMfaRequest,
  ): Promise<MfaEnableResultResponse> {
    return this.mfaService.enableTotp(user.id, body);
  }

  /** Kích hoạt xác thực 2 lớp qua Email OTP */
  @Post(AUTH_ROUTES.MFA_EMAIL_OTP_ENABLE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Kích hoạt xác thực 2 lớp qua Email OTP và nhận danh sách mã khôi phục dự phòng',
    response: mfaEnableResultResponseSchema,
  })
  public async enableEmailOtp(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(enableEmailOtpMfaSchema) body: EnableEmailOtpMfaRequest,
  ): Promise<MfaEnableResultResponse> {
    return this.mfaService.enableEmailOtp(user.id, body);
  }

  /** Tắt xác thực nhiều lớp (TOTP, Email OTP hoặc toàn bộ) */
  @Post(AUTH_ROUTES.MFA_DISABLE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Tắt xác thực nhiều lớp (MFA)',
    response: mfaStatusResponseSchema,
  })
  public async disableMfa(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(disableMfaSchema) body: DisableMfaRequest,
  ): Promise<MfaStatusResponse> {
    return this.mfaService.disableMfa(user.id, body);
  }

  /** Tạo mới bộ 8 mã khôi phục dự phòng (Recovery Codes) */
  @Post(AUTH_ROUTES.MFA_RECOVERY_CODES)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Cấp lại bộ 8 mã khôi phục dự phòng (Recovery Codes)',
    response: z.object({ recoveryCodes: z.array(z.string()) }),
  })
  public async regenerateRecoveryCodes(
    @CurrentUser() user: UserIdentity,
  ): Promise<{ recoveryCodes: string[] }> {
    return this.mfaService.regenerateRecoveryCodes(user.id);
  }

  /** Xem cấu hình Bảo mật & Mã hóa hệ thống (System Console -> Security) */
  @Public()
  @Get(AUTH_ROUTES.SECURITY_SETTINGS)
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
  @Put(AUTH_ROUTES.SECURITY_SETTINGS)
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
