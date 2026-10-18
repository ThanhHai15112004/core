import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApiDoc,
  ApiGroup,
  Public,
  ValidatedBody,
  ValidatedParams,
  ValidatedQuery,
  positiveIntParamSchema,
} from '@packages/http/index.js';
import { CurrentUser, RequirePermissions, type UserIdentity } from '@packages/security/index.js';
import { AUTH_ROUTES } from '../routes/auth.routes.js';
import { AuthService } from '../services/auth.service.js';
import { SessionService } from '../services/session.service.js';
import { PasswordService } from '../services/password.service.js';
import { MfaService } from '../services/mfa.service.js';
import { SecuritySettingsService } from '../services/security-settings.service.js';
import { VerificationService } from '../services/verification.service.js';
import { ServiceAccountService } from '../services/service-account.service.js';
import {
  type AdminResetMfaRequest,
  type AdminResetPasswordRequest,
  type ChangePasswordRequest,
  type ConfirmEmailVerificationRequest,
  type ConfirmPhoneOtpVerificationRequest,
  type CreateApiClientRequest,
  type CreateServiceAccountRequest,
  type DisableMfaRequest,
  type EnableEmailOtpMfaRequest,
  type EnableSmsOtpMfaRequest,
  type EnableTotpMfaRequest,
  type ForgotPasswordRequest,
  type IssueApiClientTokenRequest,
  type ListApiClientsQuery,
  type LoginHistoryQuery,
  type LoginRequest,
  type RefreshTokenRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type RevokeAllSessionsRequest,
  type RevokeApiClientRequest,
  type RotateApiClientSecretRequest,
  type SendEmailOtpRequest,
  type SendEmailVerificationRequest,
  type SendPhoneOtpVerificationRequest,
  type SendSmsOtpRequest,
  type StepUpVerifyRequest,
  type SuggestPasswordQuery,
  type UpdateApiClientAllowedIpsRequest,
  type UpdateApiClientScopesRequest,
  type UpdateSecuritySettingsRequest,
  type UpdateServiceAccountRequest,
  type VerifyMfaChallengeRequest,
  adminResetMfaRequestSchema,
  adminResetPasswordRequestSchema,
  changePasswordSchema,
  confirmEmailVerificationSchema,
  confirmPhoneOtpVerificationSchema,
  createApiClientSchema,
  createServiceAccountSchema,
  disableMfaSchema,
  enableEmailOtpMfaSchema,
  enableSmsOtpMfaSchema,
  enableTotpMfaSchema,
  forgotPasswordSchema,
  issueApiClientTokenSchema,
  listApiClientsQuerySchema,
  loginHistoryQuerySchema,
  loginRequestSchema,
  refreshTokenSchema,
  registerRequestSchema,
  resetPasswordSchema,
  revokeAllSessionsSchema,
  revokeApiClientSchema,
  rotateApiClientSecretSchema,
  sendEmailOtpSchema,
  sendEmailVerificationSchema,
  sendPhoneOtpVerificationSchema,
  sendSmsOtpSchema,
  stepUpVerifySchema,
  suggestPasswordQuerySchema,
  updateApiClientAllowedIpsSchema,
  updateApiClientScopesSchema,
  updateSecuritySettingsSchema,
  updateServiceAccountSchema,
  verifyMfaChallengeSchema,
} from '../requests/auth.requests.js';
import {
  type AdminResetMfaResponse,
  type AdminResetPasswordResponse,
  type ApiClientCreatedWithSecretResponse,
  type ApiClientResponse,
  type ApiClientRevokeResponse,
  type ApiClientRotateSecretResponse,
  type ApiClientTokenResponse,
  type ApiClientUsageLogResponse,
  type AuthenticatedUserProfileResponse,
  type ForgotPasswordResponse,
  type LoginHistoryItemResponse,
  type LoginResponse,
  type MfaEnableResultResponse,
  type MfaStatusResponse,
  type MfaTotpSetupResponse,
  type RegisterResponse,
  type SecuritySettingsResponse,
  type SendEmailOtpResponse,
  type SendSmsOtpResponse,
  type ServiceAccountResponse,
  type SessionItemResponse,
  type StepUpVerifyResponse,
  type SuggestedPasswordResponse,
  type TrustedDeviceItemResponse,
  type VerificationConfirmResponse,
  type VerificationSendResponse,
  adminResetMfaResponseSchema,
  adminResetPasswordResponseSchema,
  apiClientCreatedWithSecretResponseSchema,
  apiClientResponseSchema,
  apiClientRevokeResponseSchema,
  apiClientRotateSecretResponseSchema,
  apiClientTokenResponseSchema,
  apiClientUsageLogResponseSchema,
  authenticatedUserProfileSchema,
  forgotPasswordResponseSchema,
  loginHistoryItemResponseSchema,
  loginResponseSchema,
  mfaEnableResultResponseSchema,
  mfaStatusResponseSchema,
  mfaTotpSetupResponseSchema,
  registerResponseSchema,
  securitySettingsResponseSchema,
  sendEmailOtpResponseSchema,
  sendSmsOtpResponseSchema,
  serviceAccountResponseSchema,
  sessionItemResponseSchema,
  stepUpVerifyResponseSchema,
  suggestedPasswordResponseSchema,
  trustedDeviceItemResponseSchema,
  verificationConfirmResponseSchema,
  verificationSendResponseSchema,
} from '../responses/auth.response.js';

@ApiGroup(
  'Authentication, Sessions & MFA',
  'Đăng ký, Đăng nhập, Quản lý mật khẩu, Phiên đăng nhập, MFA và Service Accounts / API Clients (Mục 3.2 - 3.6)',
)
@Controller(AUTH_ROUTES.PREFIX)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly passwordService: PasswordService,
    private readonly mfaService: MfaService,
    private readonly securitySettingsService: SecuritySettingsService,
    @Optional() private readonly verificationService?: VerificationService,
    @Optional() private readonly serviceAccountService?: ServiceAccountService,
  ) {}

  /** Đăng ký tài khoản bằng Email + mật khẩu hoặc SĐT + mật khẩu (Mục 3.2.1 & 3.2.2) */
  @Public()
  @Post(AUTH_ROUTES.REGISTER)
  @HttpCode(HttpStatus.CREATED)
  @ApiDoc({
    summary: 'Đăng ký tài khoản mới bằng Email + mật khẩu hoặc SĐT + mật khẩu (tùy cấu hình dự án)',
    response: registerResponseSchema,
  })
  public async register(
    @ValidatedBody(registerRequestSchema) body: RegisterRequest,
    @Req() req?: FastifyRequest,
  ): Promise<RegisterResponse> {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    return this.authService.register(body, {
      ipAddress: req?.ip ?? null,
      userAgent,
    });
  }

  /** Đăng nhập tài khoản bằng Username / Email / SĐT và Mật khẩu (Mục 3.2.3) */
  @Public()
  @Post(AUTH_ROUTES.LOGIN)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đăng nhập tài khoản bằng Email, Username hoặc SĐT (không tiết lộ tài khoản tồn tại)',
    response: loginResponseSchema,
  })
  public async login(
    @ValidatedBody(loginRequestSchema) body: LoginRequest,
    @Req() req?: FastifyRequest,
  ): Promise<LoginResponse> {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    return this.authService.login(body, {
      ipAddress: req?.ip ?? null,
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
    @Req() req?: FastifyRequest,
  ): Promise<LoginResponse> {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    return this.authService.verifyMfaChallenge(body, {
      ipAddress: req?.ip ?? null,
      userAgent,
    });
  }

  /** Gửi mã OTP 6 chữ số qua Email phục vụ xác thực bước 2 (MFA — Mục 3.5.1) */
  @Public()
  @Post(AUTH_ROUTES.MFA_EMAIL_OTP_SEND)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Gửi mã OTP 6 chữ số qua Email phục vụ xác thực nhiều lớp (Notification Adapter)',
    response: sendEmailOtpResponseSchema,
  })
  public async sendEmailOtp(
    @ValidatedBody(sendEmailOtpSchema) body: SendEmailOtpRequest,
    @CurrentUser() user?: UserIdentity,
  ): Promise<SendEmailOtpResponse> {
    return this.authService.sendMfaEmailOtp(body, user?.id);
  }

  /** Gửi mã OTP 6 chữ số qua SMS phục vụ xác thực bước 2 (MFA — Mục 3.5.2) */
  @Public()
  @Post(AUTH_ROUTES.MFA_SMS_OTP_SEND)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Gửi mã OTP 6 chữ số qua SMS phục vụ xác thực nhiều lớp (SMS Provider)',
    response: sendSmsOtpResponseSchema,
  })
  public async sendSmsOtp(
    @ValidatedBody(sendSmsOtpSchema) body: SendSmsOtpRequest,
    @CurrentUser() user?: UserIdentity,
  ): Promise<SendSmsOtpResponse> {
    return this.authService.sendMfaSmsOtp(body, user?.id);
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
    @Req() req?: FastifyRequest,
  ): Promise<LoginResponse> {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    return this.authService.refresh(body, {
      ipAddress: req?.ip ?? null,
      userAgent,
    });
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

  /** Đăng xuất khỏi phiên hiện tại (Mục 3.2.4) */
  @Post(AUTH_ROUTES.LOGOUT)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đăng xuất và thu hồi refresh token của phiên hiện tại',
    response: z.object({ loggedOut: z.literal(true) }),
  })
  public async logout(
    @CurrentUser() user: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<{ loggedOut: true }> {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    if (user.sessionId) {
      await this.sessionService.revokeSessionById(user.id, user.sessionId, 'User logged out', {
        ipAddress: req?.ip ?? null,
        userAgent,
      });
    } else {
      await this.sessionService.revokeAllUserSessions(user.id, 'User logged out', undefined, {
        ipAddress: req?.ip ?? null,
        userAgent,
      });
    }
    return { loggedOut: true };
  }

  /** Đăng xuất khỏi tất cả thiết bị (Mục 3.2.5) */
  @Post(AUTH_ROUTES.LOGOUT_ALL)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đăng xuất khỏi tất cả thiết bị (thu hồi toàn bộ phiên của người dùng)',
    response: z.object({ loggedOutAll: z.literal(true), revokedCount: z.number() }),
  })
  public async logoutAll(
    @CurrentUser() user: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<{ loggedOutAll: true; revokedCount: number }> {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const revokedCount = await this.sessionService.revokeAllUserSessions(
      user.id,
      'User logged out from all devices',
      undefined,
      {
        ipAddress: req?.ip ?? null,
        userAgent,
      },
    );
    return { loggedOutAll: true, revokedCount };
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

  /** Xem lịch sử đăng nhập & đăng xuất theo thời gian, IP và thiết bị (Mục 3.4.7) */
  @Get(AUTH_ROUTES.LOGIN_HISTORY)
  @ApiDoc({
    summary: 'Xem lịch sử đăng nhập, đăng xuất và thu hồi phiên theo thời gian, IP và thiết bị',
    response: z.array(loginHistoryItemResponseSchema),
  })
  public async listLoginHistory(
    @CurrentUser() user: UserIdentity,
    @ValidatedQuery(loginHistoryQuerySchema) query?: LoginHistoryQuery,
  ): Promise<LoginHistoryItemResponse[]> {
    return this.sessionService.listUserLoginHistory(user.id, query?.limit ?? 50);
  }

  /** Thu hồi một phiên đăng nhập cụ thể */
  @Delete(AUTH_ROUTES.SESSION_BY_ID)
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
  @Post(AUTH_ROUTES.REVOKE_ALL_SESSIONS)
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

  /** Gửi link hoặc mã xác minh Email có thời hạn (Mục 3.2.6) */
  @Public()
  @Post(AUTH_ROUTES.VERIFY_EMAIL_SEND)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Gửi link hoặc mã xác minh Email có thời hạn',
    response: verificationSendResponseSchema,
  })
  public async sendEmailVerification(
    @ValidatedBody(sendEmailVerificationSchema) body: SendEmailVerificationRequest,
    @CurrentUser() user?: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<VerificationSendResponse> {
    return this.verificationService!.sendEmailVerification(body ?? {}, {
      userId: user?.id,
      ipAddress: req?.ip ?? null,
    });
  }

  /** Xác nhận Email bằng link token hoặc mã xác minh 6 số (Mục 3.2.6) */
  @Public()
  @Post(AUTH_ROUTES.VERIFY_EMAIL_CONFIRM)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Xác nhận địa chỉ Email bằng link token hoặc mã 6 số',
    response: verificationConfirmResponseSchema,
  })
  public async confirmEmailVerification(
    @ValidatedBody(confirmEmailVerificationSchema) body: ConfirmEmailVerificationRequest,
    @CurrentUser() user?: UserIdentity,
  ): Promise<VerificationConfirmResponse> {
    return this.verificationService!.confirmEmailVerification(body, user?.id);
  }

  /** Gửi mã OTP xác minh SĐT có giới hạn số lần gửi và thời gian chờ (Mục 3.2.7) */
  @Public()
  @Post(AUTH_ROUTES.VERIFY_PHONE_SEND)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Gửi mã OTP 6 số xác minh SĐT (có giới hạn số lần gửi và cooldown)',
    response: verificationSendResponseSchema,
  })
  public async sendPhoneOtp(
    @ValidatedBody(sendPhoneOtpVerificationSchema) body: SendPhoneOtpVerificationRequest,
    @CurrentUser() user?: UserIdentity,
    @Req() req?: FastifyRequest,
  ): Promise<VerificationSendResponse> {
    return this.verificationService!.sendPhoneOtp(body ?? {}, {
      userId: user?.id,
      ipAddress: req?.ip ?? null,
    });
  }

  /** Xác minh SĐT bằng mã OTP 6 số có giới hạn số lần nhập sai (Mục 3.2.7) */
  @Public()
  @Post(AUTH_ROUTES.VERIFY_PHONE_CONFIRM)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Xác minh SĐT bằng mã OTP 6 số (có giới hạn số lần nhập sai)',
    response: verificationConfirmResponseSchema,
  })
  public async confirmPhoneOtp(
    @ValidatedBody(confirmPhoneOtpVerificationSchema) body: ConfirmPhoneOtpVerificationRequest,
    @CurrentUser() user?: UserIdentity,
  ): Promise<VerificationConfirmResponse> {
    return this.verificationService!.confirmPhoneOtp(body, user?.id);
  }

  /** Gợi ý mật khẩu mạnh ngẫu nhiên đạt chuẩn chính sách mật khẩu hiện hành (Mục 3.3) */
  @Public()
  @Get(AUTH_ROUTES.PASSWORD_SUGGEST)
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
  @Post(AUTH_ROUTES.PASSWORD_CHANGE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đổi mật khẩu tài khoản hiện tại (có kiểm tra chính sách mật khẩu, lịch sử mật khẩu và thu hồi phiên)',
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
  @Post(AUTH_ROUTES.PASSWORD_FORGOT)
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
  @Post(AUTH_ROUTES.PASSWORD_RESET)
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
  @Post(AUTH_ROUTES.PASSWORD_ADMIN_RESET)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Reset mật khẩu người dùng từ trang quản trị (hỗ trợ tự sinh mật khẩu gợi ý và thu hồi phiên)',
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

  /** Kích hoạt xác thực 2 lớp qua Email OTP (Mục 3.5.1) */
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

  /** Kích hoạt xác thực 2 lớp qua SMS OTP (Mục 3.5.2) */
  @Post(AUTH_ROUTES.MFA_SMS_OTP_ENABLE)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Kích hoạt xác thực 2 lớp qua SMS OTP và nhận danh sách mã khôi phục dự phòng',
    response: mfaEnableResultResponseSchema,
  })
  public async enableSmsOtp(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(enableSmsOtpMfaSchema) body: EnableSmsOtpMfaRequest,
  ): Promise<MfaEnableResultResponse> {
    return this.mfaService.enableSmsOtp(user.id, body);
  }

  /** Xem danh sách thiết bị tin cậy (Trusted Devices — Mục 3.5.5) */
  @Get(AUTH_ROUTES.MFA_TRUSTED_DEVICES)
  @ApiDoc({
    summary: 'Xem danh sách các thiết bị tin cậy đã được ghi nhận khi xác thực MFA',
    response: z.array(trustedDeviceItemResponseSchema),
  })
  public async listTrustedDevices(
    @CurrentUser() user: UserIdentity,
  ): Promise<TrustedDeviceItemResponse[]> {
    return this.mfaService.listTrustedDevices(user.id);
  }

  /** Thu hồi một thiết bị tin cậy theo deviceId (Mục 3.5.5) */
  @Delete(AUTH_ROUTES.MFA_TRUSTED_DEVICE_BY_ID)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Thu hồi một thiết bị tin cậy cụ thể theo deviceId',
    response: z.object({ revoked: z.literal(true), deviceId: z.string() }),
  })
  public async revokeTrustedDevice(
    @CurrentUser() user: UserIdentity,
    @ValidatedParams(z.string().trim().min(1), 'deviceId') deviceId: string,
  ): Promise<{ revoked: true; deviceId: string }> {
    return this.mfaService.revokeTrustedDevice(user.id, deviceId);
  }

  /** Thu hồi toàn bộ thiết bị tin cậy của tài khoản hiện tại (Mục 3.5.5) */
  @Delete(AUTH_ROUTES.MFA_TRUSTED_DEVICES)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Thu hồi toàn bộ thiết bị tin cậy của tài khoản',
    response: z.object({ revoked: z.literal(true), revokedCount: z.number() }),
  })
  public async revokeAllTrustedDevices(
    @CurrentUser() user: UserIdentity,
  ): Promise<{ revoked: true; revokedCount: number }> {
    return this.mfaService.revokeAllTrustedDevices(user.id);
  }

  /** Tắt xác thực nhiều lớp (TOTP, Email OTP, SMS OTP hoặc toàn bộ — Mục 3.5.7) */
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
    return this.authService.disableMfa(user.id, body);
  }

  /** Tạo mới bộ 8 mã khôi phục dự phòng (Recovery Codes — Mục 3.5.4) */
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

  /** Reset MFA có kiểm soát từ trang quản trị (chỉ người có quyền users.update — Mục 3.5.8) */
  @Post(AUTH_ROUTES.MFA_ADMIN_RESET)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Reset MFA có kiểm soát cho người dùng bị mất thiết bị xác thực (kèm lý do/xác minh và thu hồi phiên)',
    response: adminResetMfaResponseSchema,
  })
  public async adminResetMfa(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(adminResetMfaRequestSchema) body: AdminResetMfaRequest,
  ): Promise<AdminResetMfaResponse> {
    return this.authService.adminResetUserMfa(body.userId, body, user.id);
  }

  /** Xác thực lại khi thực hiện thao tác nhạy cảm (Step-Up Authentication — Mục 3.5.7) */
  @Post(AUTH_ROUTES.STEP_UP_VERIFY)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Xác thực lại bằng mật khẩu hiện tại hoặc mã MFA để nhận stepUpToken ngắn hạn cho thao tác nhạy cảm',
    response: stepUpVerifyResponseSchema,
  })
  public async verifyStepUp(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(stepUpVerifySchema) body: StepUpVerifyRequest,
  ): Promise<StepUpVerifyResponse> {
    return this.authService.verifyStepUp(user.id, body, user.sessionId);
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

  // ==========================================================================
  // MỤC 3.6: TÀI KHOẢN HỆ THỐNG (SERVICE ACCOUNT) & API CLIENT
  // ==========================================================================

  /** Danh sách tài khoản hệ thống (Service Accounts — Mục 3.6.1) */
  @Get(AUTH_ROUTES.SERVICE_ACCOUNTS)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Danh sách tài khoản hệ thống (Service Accounts — độc lập với người dùng cá nhân)',
    response: z.array(serviceAccountResponseSchema),
  })
  public async listServiceAccounts(): Promise<ServiceAccountResponse[]> {
    return this.serviceAccountService!.listServiceAccounts();
  }

  /** Tạo mới tài khoản hệ thống (Service Account — Mục 3.6.1) */
  @Post(AUTH_ROUTES.SERVICE_ACCOUNTS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Tạo tài khoản hệ thống (Service Account) dùng cho hệ thống tích hợp hoặc background job',
    response: serviceAccountResponseSchema,
  })
  public async createServiceAccount(
    @ValidatedBody(createServiceAccountSchema) body: CreateServiceAccountRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ServiceAccountResponse> {
    return this.serviceAccountService!.createServiceAccount(body, actor?.id);
  }

  /** Xem chi tiết một tài khoản hệ thống (Service Account — Mục 3.6.1) */
  @Get(AUTH_ROUTES.SERVICE_ACCOUNT_BY_ID)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem chi tiết tài khoản hệ thống (Service Account) theo ID',
    response: serviceAccountResponseSchema,
  })
  public async getServiceAccountById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<ServiceAccountResponse> {
    return this.serviceAccountService!.getServiceAccountById(id);
  }

  /** Cập nhật tài khoản hệ thống (Service Account — Mục 3.6.1) */
  @Patch(AUTH_ROUTES.SERVICE_ACCOUNT_BY_ID)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Cập nhật tên, mô tả, trạng thái hoặc phạm vi quyền của Service Account',
    response: serviceAccountResponseSchema,
  })
  public async updateServiceAccount(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateServiceAccountSchema) body: UpdateServiceAccountRequest,
  ): Promise<ServiceAccountResponse> {
    return this.serviceAccountService!.updateServiceAccount(id, body);
  }

  /** Danh sách các API Clients (Mục 3.6.2) */
  @Get(AUTH_ROUTES.API_CLIENTS)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Danh sách các API Clients (không hiển thị lại Client Secret)',
    response: z.array(apiClientResponseSchema),
  })
  public async listApiClients(
    @ValidatedQuery(listApiClientsQuerySchema) query?: ListApiClientsQuery,
  ): Promise<ApiClientResponse[]> {
    return this.serviceAccountService!.listApiClients(query?.serviceAccountId);
  }

  /** Tạo mới API Client có Client ID và Client Secret (Secret chỉ hiển thị 1 lần duy nhất — Mục 3.6.2, 3.6.3, 3.6.4, 3.6.6) */
  @Post(AUTH_ROUTES.API_CLIENTS)
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Tạo mới API Client (trả về Client Secret duy nhất một lần)',
    response: apiClientCreatedWithSecretResponseSchema,
  })
  public async createApiClient(
    @ValidatedBody(createApiClientSchema) body: CreateApiClientRequest,
    @CurrentUser() actor?: UserIdentity,
  ): Promise<ApiClientCreatedWithSecretResponse> {
    return this.serviceAccountService!.createApiClient(body, actor?.id);
  }

  /** Cấp Access Token cho API Client từ Client ID và Client Secret (Mục 3.6.2, 3.6.3, 3.6.6, 3.6.7) */
  @Public()
  @Post(AUTH_ROUTES.API_CLIENT_TOKEN)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Đổi Client ID và Client Secret lấy Access Token (có kiểm tra IP Whitelist & Scopes)',
    response: apiClientTokenResponseSchema,
  })
  public async issueApiClientToken(
    @ValidatedBody(issueApiClientTokenSchema) body: IssueApiClientTokenRequest,
    @Req() req?: FastifyRequest,
  ): Promise<ApiClientTokenResponse> {
    return this.serviceAccountService!.issueClientToken(body, {
      ipAddress: req?.ip ?? null,
      endpoint: req?.url ?? null,
    });
  }

  /** Xem chi tiết một API Client theo ID (không bao giờ trả về lại Client Secret — Mục 3.6.2 & 3.6.4) */
  @Get(AUTH_ROUTES.API_CLIENT_BY_ID)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem chi tiết API Client theo ID (không trả về lại Client Secret)',
    response: apiClientResponseSchema,
  })
  public async getApiClientById(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<ApiClientResponse> {
    return this.serviceAccountService!.getApiClientById(id);
  }

  /** Gán / cập nhật phạm vi truy cập (Scopes) cho API Client (Mục 3.6.3) */
  @Put(AUTH_ROUTES.API_CLIENT_SCOPES)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Gán hoặc cập nhật phạm vi truy cập (scopes) cho API Client',
    response: apiClientResponseSchema,
  })
  public async updateApiClientScopes(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateApiClientScopesSchema) body: UpdateApiClientScopesRequest,
  ): Promise<ApiClientResponse> {
    return this.serviceAccountService!.updateApiClientScopes(id, body);
  }

  /** Giới hạn danh sách IP được phép gọi cho API Client (Mục 3.6.6) */
  @Put(AUTH_ROUTES.API_CLIENT_ALLOWED_IPS)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Cấu hình danh sách địa chỉ IP được phép gọi (IP Whitelist) cho API Client',
    response: apiClientResponseSchema,
  })
  public async updateApiClientAllowedIps(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(updateApiClientAllowedIpsSchema) body: UpdateApiClientAllowedIpsRequest,
  ): Promise<ApiClientResponse> {
    return this.serviceAccountService!.updateApiClientAllowedIps(id, body);
  }

  /** Tạo và xoay vòng Client Secret (Secret mới chỉ hiển thị 1 lần duy nhất — Mục 3.6.4) */
  @Post(AUTH_ROUTES.API_CLIENT_ROTATE_SECRET)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Xoay vòng Client Secret của API Client (Secret mới chỉ hiển thị 1 lần và vô hiệu hóa token cũ)',
    response: apiClientRotateSecretResponseSchema,
  })
  public async rotateApiClientSecret(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(rotateApiClientSecretSchema) body?: RotateApiClientSecretRequest,
  ): Promise<ApiClientRotateSecretResponse> {
    return this.serviceAccountService!.rotateClientSecret(id, body);
  }

  /** Thu hồi API Client — Ngừng toàn bộ token đã cấp ngay lập tức (Mục 3.6.5) */
  @Post(AUTH_ROUTES.API_CLIENT_REVOKE)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary: 'Thu hồi API Client và ngừng toàn bộ token đã cấp ngay lập tức',
    response: apiClientRevokeResponseSchema,
  })
  public async revokeApiClient(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
    @ValidatedBody(revokeApiClientSchema) body?: RevokeApiClientRequest,
  ): Promise<ApiClientRevokeResponse> {
    return this.serviceAccountService!.revokeApiClient(id, body);
  }

  /** Theo dõi lần sử dụng gần nhất và lịch sử gọi của API Client (Ghi IP, thời gian, kết quả — Mục 3.6.7) */
  @Get(AUTH_ROUTES.API_CLIENT_USAGE)
  @RequirePermissions('users.read')
  @ApiDoc({
    summary: 'Xem lần sử dụng gần nhất và lịch sử sử dụng của API Client (IP, thời gian, kết quả)',
    response: apiClientUsageLogResponseSchema,
  })
  public async getApiClientUsage(
    @ValidatedParams(positiveIntParamSchema, 'id') id: number,
  ): Promise<ApiClientUsageLogResponse> {
    return this.serviceAccountService!.getApiClientUsage(id);
  }
}

