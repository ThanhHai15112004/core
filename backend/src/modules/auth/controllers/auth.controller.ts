import { Controller, Get, HttpCode, HttpStatus, Optional, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiDoc, ApiGroup, Public, ValidatedBody } from '@packages/http/index.js';
import { CurrentUser, type UserIdentity } from '@packages/security/index.js';
import { SessionService } from '@modules/sessions/index.js';
import { type VerifyMfaChallengeRequest, verifyMfaChallengeSchema } from '@modules/mfa/index.js';
import { AUTH_ROUTES } from '../routes/auth.routes.js';
import { AuthService } from '../services/auth.service.js';
import { VerificationService } from '../services/verification.service.js';
import {
  type ConfirmEmailVerificationRequest,
  type ConfirmPhoneOtpVerificationRequest,
  type LoginRequest,
  type RefreshTokenRequest,
  type RegisterRequest,
  type SendEmailVerificationRequest,
  type SendPhoneOtpVerificationRequest,
  type StepUpVerifyRequest,
  type UpdateMyPreferencesRequest,
  confirmEmailVerificationSchema,
  confirmPhoneOtpVerificationSchema,
  loginRequestSchema,
  refreshTokenSchema,
  registerRequestSchema,
  sendEmailVerificationSchema,
  sendPhoneOtpVerificationSchema,
  stepUpVerifySchema,
  updateMyPreferencesSchema,
} from '../requests/auth.requests.js';
import {
  type AuthenticatedUserProfileResponse,
  type LoginResponse,
  type RegisterResponse,
  type StepUpVerifyResponse,
  type UserPreferencesResponse,
  type VerificationConfirmResponse,
  type VerificationSendResponse,
  authenticatedUserProfileSchema,
  loginResponseSchema,
  registerResponseSchema,
  stepUpVerifyResponseSchema,
  userPreferencesResponseSchema,
  verificationConfirmResponseSchema,
  verificationSendResponseSchema,
} from '../responses/auth.response.js';

@ApiGroup(
  'Authentication & Verification',
  'Đăng ký, Đăng nhập, Làm mới Token, Đăng xuất, Xác minh Email/SĐT và Xác thực lại Step-Up (Mục 3.2)',
)
@Controller(AUTH_ROUTES.PREFIX)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    @Optional() private readonly verificationService?: VerificationService,
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

  /** 5.3.2 & 5.3.5: Lấy tùy chọn ngôn ngữ (`preferredLocale`) và múi giờ (`preferredTimezone`) của người dùng đang đăng nhập */
  @Get(AUTH_ROUTES.PREFERENCES)
  @ApiDoc({
    summary: 'Lấy tùy chọn ngôn ngữ và múi giờ của người dùng đang đăng nhập (Mục 5.3)',
    response: userPreferencesResponseSchema,
  })
  public async getMyPreferences(
    @CurrentUser() user: UserIdentity,
  ): Promise<UserPreferencesResponse> {
    return this.authService.getMyPreferences(user.id);
  }

  /** 5.3.2 & 5.3.5: Cập nhật tùy chọn ngôn ngữ (`preferredLocale`) và múi giờ (`preferredTimezone`) của người dùng đang đăng nhập */
  @Patch(AUTH_ROUTES.PREFERENCES)
  @ApiDoc({
    summary:
      'Cập nhật tùy chọn ngôn ngữ (vi/en) và múi giờ IANA của người dùng đang đăng nhập (Mục 5.3)',
    response: userPreferencesResponseSchema,
  })
  public async updateMyPreferences(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(updateMyPreferencesSchema) body: UpdateMyPreferencesRequest,
  ): Promise<UserPreferencesResponse> {
    return this.authService.updateMyPreferences(user.id, body);
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

  /** Xác thực lại khi thực hiện thao tác nhạy cảm (Step-Up Authentication — Mục 3.5.7) */
  @Post(AUTH_ROUTES.STEP_UP_VERIFY)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary:
      'Xác thực lại bằng mật khẩu hiện tại hoặc mã MFA để nhận stepUpToken ngắn hạn cho thao tác nhạy cảm',
    response: stepUpVerifyResponseSchema,
  })
  public async verifyStepUp(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(stepUpVerifySchema) body: StepUpVerifyRequest,
  ): Promise<StepUpVerifyResponse> {
    return this.authService.verifyStepUp(user.id, body, user.sessionId);
  }
}
