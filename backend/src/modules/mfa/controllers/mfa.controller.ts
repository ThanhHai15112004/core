import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiDoc, ApiGroup, Public, ValidatedBody, ValidatedParams } from '@packages/http/index.js';
import { CurrentUser, RequirePermissions, type UserIdentity } from '@packages/security/index.js';
import {
  type AdminResetMfaRequest,
  type DisableMfaRequest,
  type EnableEmailOtpMfaRequest,
  type EnableSmsOtpMfaRequest,
  type EnableTotpMfaRequest,
  type SendEmailOtpRequest,
  type SendSmsOtpRequest,
  type VerifyMfaChallengeRequest,
  adminResetMfaRequestSchema,
  disableMfaSchema,
  enableEmailOtpMfaSchema,
  enableSmsOtpMfaSchema,
  enableTotpMfaSchema,
  sendEmailOtpSchema,
  sendSmsOtpSchema,
  verifyMfaChallengeSchema,
} from '../requests/mfa.requests.js';
import {
  type AdminResetMfaResponse,
  type MfaEnableResultResponse,
  type MfaStatusResponse,
  type MfaTotpSetupResponse,
  type SendEmailOtpResponse,
  type SendSmsOtpResponse,
  type TrustedDeviceItemResponse,
  adminResetMfaResponseSchema,
  mfaEnableResultResponseSchema,
  mfaStatusResponseSchema,
  mfaTotpSetupResponseSchema,
  sendEmailOtpResponseSchema,
  sendSmsOtpResponseSchema,
  trustedDeviceItemResponseSchema,
} from '../responses/mfa.response.js';
import { MFA_ROUTES } from '../routes/mfa.routes.js';
import { MfaService } from '../services/mfa.service.js';

@ApiGroup(
  'Multi-Factor Authentication (MFA)',
  'Thiết lập TOTP, Email OTP, SMS OTP, Recovery Codes, Thiết bị tin cậy và Reset MFA (Mục 3.5)',
)
@Controller(MFA_ROUTES.PREFIX)
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  /** Xác thực mã MFA bước 2 (TOTP, Email OTP hoặc Recovery Code) để hoàn tất đăng nhập */
  @Public()
  @Post(MFA_ROUTES.VERIFY)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Xác thực mã MFA/2FA bước 2 (TOTP, Email OTP hoặc Recovery Code)',
  })
  public async verifyMfa(
    @ValidatedBody(verifyMfaChallengeSchema) body: VerifyMfaChallengeRequest,
    @Req() req?: FastifyRequest,
  ) {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    return this.mfaService.verifyMfaChallenge(body, {
      ipAddress: req?.ip ?? null,
      userAgent,
    });
  }

  /** Gửi mã OTP 6 chữ số qua Email phục vụ xác thực bước 2 (MFA — Mục 3.5.1) */
  @Public()
  @Post(MFA_ROUTES.EMAIL_OTP_SEND)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Gửi mã OTP 6 chữ số qua Email phục vụ xác thực nhiều lớp (Notification Adapter)',
    response: sendEmailOtpResponseSchema,
  })
  public async sendEmailOtp(
    @ValidatedBody(sendEmailOtpSchema) body: SendEmailOtpRequest,
    @CurrentUser() user?: UserIdentity,
  ): Promise<SendEmailOtpResponse> {
    return this.mfaService.sendMfaEmailOtp(body, user?.id);
  }

  /** Gửi mã OTP 6 chữ số qua SMS phục vụ xác thực bước 2 (MFA — Mục 3.5.2) */
  @Public()
  @Post(MFA_ROUTES.SMS_OTP_SEND)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Gửi mã OTP 6 chữ số qua SMS phục vụ xác thực nhiều lớp (SMS Provider)',
    response: sendSmsOtpResponseSchema,
  })
  public async sendSmsOtp(
    @ValidatedBody(sendSmsOtpSchema) body: SendSmsOtpRequest,
    @CurrentUser() user?: UserIdentity,
  ): Promise<SendSmsOtpResponse> {
    return this.mfaService.sendMfaSmsOtp(body, user?.id);
  }

  /** Xem trạng thái cấu hình xác thực nhiều lớp (MFA) */
  @Get(MFA_ROUTES.STATUS)
  @ApiDoc({
    summary: 'Xem trạng thái cấu hình MFA (TOTP, Email OTP, Recovery Codes)',
    response: mfaStatusResponseSchema,
  })
  public async getMfaStatus(@CurrentUser() user: UserIdentity): Promise<MfaStatusResponse> {
    return this.mfaService.getStatus(user.id);
  }

  /** Khởi tạo cấu hình TOTP (Google Authenticator / Authy) */
  @Post(MFA_ROUTES.TOTP_SETUP)
  @HttpCode(HttpStatus.OK)
  @ApiDoc({
    summary: 'Khởi tạo secret và đường dẫn otpauth:// cho ứng dụng Authenticator (TOTP)',
    response: mfaTotpSetupResponseSchema,
  })
  public async setupTotp(@CurrentUser() user: UserIdentity): Promise<MfaTotpSetupResponse> {
    return this.mfaService.setupTotp(user.id);
  }

  /** Kích hoạt TOTP sau khi xác nhận mã 6 số đầu tiên */
  @Post(MFA_ROUTES.TOTP_ENABLE)
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
  @Post(MFA_ROUTES.EMAIL_OTP_ENABLE)
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
  @Post(MFA_ROUTES.SMS_OTP_ENABLE)
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
  @Get(MFA_ROUTES.TRUSTED_DEVICES)
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
  @Delete(MFA_ROUTES.TRUSTED_DEVICE_BY_ID)
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
  @Delete(MFA_ROUTES.TRUSTED_DEVICES)
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
  @Post(MFA_ROUTES.DISABLE)
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

  /** Tạo mới bộ 8 mã khôi phục dự phòng (Recovery Codes — Mục 3.5.4) */
  @Post(MFA_ROUTES.RECOVERY_CODES)
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
  @Post(MFA_ROUTES.ADMIN_RESET)
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users.update')
  @ApiDoc({
    summary:
      'Reset MFA có kiểm soát cho người dùng bị mất thiết bị xác thực (kèm lý do/xác minh và thu hồi phiên)',
    response: adminResetMfaResponseSchema,
  })
  public async adminResetMfa(
    @CurrentUser() user: UserIdentity,
    @ValidatedBody(adminResetMfaRequestSchema) body: AdminResetMfaRequest,
  ): Promise<AdminResetMfaResponse> {
    return this.mfaService.adminResetUserMfa(body.userId, body, user.id);
  }
}
