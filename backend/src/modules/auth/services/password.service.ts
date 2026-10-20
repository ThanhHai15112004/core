import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  UnauthorizedAppException,
  maskEmail as sharedMaskEmail,
} from '@packages/kernel/index.js';
import { PasswordHasherService } from '@packages/security/index.js';
import {
  type AdminResetUserPasswordInput,
  type AdminResetUserPasswordResult,
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  USER_STATUS,
  type UserAuthCredentialsView,
} from '@modules/users/contracts/index.js';
import {
  AUTH_EMAIL_NOTIFICATION_ADAPTER,
  AUTH_EVENT_STATUS,
  AUTH_EVENT_TYPE,
  type IEmailNotificationAdapter,
} from '../contracts/index.js';
import type { AuthPasswordResetEntity } from '../entities/auth-password-reset.entity.js';
import { AuthPasswordResetRepository } from '../repositories/auth-password-reset.repository.js';
import { SessionService } from './session.service.js';
import { SecuritySettingsService } from './security-settings.service.js';
import { createDefaultEmailNotificationAdapter } from './notification-adapters.provider.js';
import type {
  AdminResetPasswordRequest,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  SuggestPasswordQuery,
} from '../requests/auth.requests.js';
import type {
  AdminResetPasswordResponse,
  ForgotPasswordResponse,
  SuggestedPasswordResponse,
} from '../responses/auth.response.js';

const PASSWORD_RESET_TTL_SECONDS = 900; // 15 phút
const DEFAULT_RESET_OTP_MAX_ATTEMPTS = 5;

/** Tra cứu thông tin xác thực (credentials) của người dùng qua Public Contract của module Users */
export async function resolveUserCredentialsById(
  usersPublicService: IUsersPublicService,
  userId: number,
): Promise<UserAuthCredentialsView | null> {
  if (typeof usersPublicService.findAuthCredentialsByUserId === 'function') {
    const direct = await usersPublicService.findAuthCredentialsByUserId(userId);
    if (direct) return direct;
  }

  const identity = await usersPublicService.findAuthUserById(userId);
  if (!identity) return null;

  return (
    (await usersPublicService.findAuthUserByIdentifier(identity.email || identity.username)) ?? null
  );
}

@Injectable()
export class PasswordService {
  private readonly emailAdapter: IEmailNotificationAdapter;

  constructor(
    private readonly passwordResetRepository: AuthPasswordResetRepository,
    private readonly passwordHasher: PasswordHasherService,
    private readonly sessionService: SessionService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly configService?: CoreConfigService,
    @Optional() private readonly securitySettingsService?: SecuritySettingsService,
    @Optional()
    @Inject(AUTH_EMAIL_NOTIFICATION_ADAPTER)
    emailAdapter?: IEmailNotificationAdapter,
  ) {
    this.emailAdapter = emailAdapter ?? createDefaultEmailNotificationAdapter();
    this.usersPublicService.registerAdminPasswordResetDelegate?.((userId, input, actorId) =>
      this.adminResetUserPassword(userId, input, actorId),
    );
  }

  /**
   * Sinh mật khẩu gợi ý mạnh tuân thủ các biến setting chính sách mật khẩu hiện hành
   */
  public async suggestPasswords(
    query: Partial<SuggestPasswordQuery> = {},
  ): Promise<SuggestedPasswordResponse> {
    const settings = await this.securitySettingsService?.getSettings();
    const count = Math.max(1, Math.min(10, query.count ?? 3));
    const minLength = settings?.passwordMinLength ?? 8;
    const requireUppercase = settings?.requireUppercase ?? true;
    const requireNumbers = settings?.requireNumbers ?? true;
    const requireSpecialChars = settings?.requireSpecialChars ?? false;
    const disallowedPasswords = settings?.disallowedPasswords ?? [];

    const suggestions: string[] = [];
    for (let i = 0; i < count; i++) {
      suggestions.push(
        this.passwordHasher.generateSuggestedPassword({
          length: query.length ?? Math.max(12, minLength),
          minLength,
          requireUppercase,
          requireNumbers,
          // Luôn ưu tiên có ký tự đặc biệt trong mật khẩu gợi ý để đạt độ mạnh cao nhất
          requireSpecialChars: true,
          disallowedPasswords,
        }),
      );
    }

    return {
      password: suggestions[0]!,
      suggestedPassword: suggestions[0]!,
      suggestions,
      policy: {
        passwordMinLength: minLength,
        requireUppercase,
        requireNumbers,
        requireSpecialChars,
      },
    };
  }

  /**
   * Đổi mật khẩu cho người dùng đang đăng nhập và thu hồi các phiên khác (Mục 3.3.1, 3.3.4, 3.3.5, 3.3.7)
   * Điều khiển qua các biến setting trong SecuritySettings:
   * - `requireCurrentPasswordOnChange`
   * - `passwordMinLength`, `requireUppercase`, `requireNumbers`, `requireSpecialChars`, `disallowedPasswords`, `disallowUserInfoInPassword`
   * - `preventPasswordReuse`, `passwordHistoryLimit`
   * - `revokeSessionsOnPasswordChange`
   */
  public async changePassword(
    userId: number,
    dto: ChangePasswordRequest,
    currentSessionId?: number,
  ): Promise<{ changed: true; revokedSessionsCount: number }> {
    const credentials = await this.resolveUserCredentialsById(userId);
    if (!credentials) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const settings = await this.securitySettingsService?.getSettings();
    const requireCurrent = settings?.requireCurrentPasswordOnChange ?? true;

    if (requireCurrent) {
      if (!dto.currentPassword) {
        throw new BadRequestAppException('auth.currentPasswordRequired');
      }
      if (dto.currentPassword === dto.newPassword) {
        throw new BadRequestAppException('auth.newPasswordMustDiffer');
      }
      const isCurrentValid = await this.passwordHasher.verify(
        dto.currentPassword,
        credentials.passwordHash,
      );
      if (!isCurrentValid) {
        throw new UnauthorizedAppException('auth.invalidCurrentPassword');
      }
    } else if (dto.currentPassword && dto.currentPassword === dto.newPassword) {
      throw new BadRequestAppException('auth.newPasswordMustDiffer');
    }

    await this.validateNewPasswordForUser(dto.newPassword, credentials, true);

    const newHash = await this.passwordHasher.hash(dto.newPassword);
    await this.usersPublicService.updatePasswordHash(userId, newHash, {
      recordHistory: true,
      maxHistory: Math.max(10, settings?.passwordHistoryLimit ?? 5),
    });

    const shouldRevoke =
      dto.revokeOtherSessions !== undefined
        ? dto.revokeOtherSessions
        : (settings?.revokeSessionsOnPasswordChange ?? true);

    let revokedSessionsCount = 0;
    if (shouldRevoke) {
      revokedSessionsCount = await this.sessionService.revokeAllUserSessions(
        userId,
        'Password changed by user',
        currentSessionId,
      );
    }

    await this.sessionService.recordAuthEvent({
      userId,
      actorId: userId,
      sessionId: currentSessionId ?? null,
      eventType: AUTH_EVENT_TYPE.PASSWORD_CHANGED,
      status: AUTH_EVENT_STATUS.SUCCESS,
      reason: 'Password changed by user',
      metadata: { revokedSessionsCount },
    });

    return { changed: true, revokedSessionsCount };
  }

  /**
   * Yêu cầu đặt lại mật khẩu khi quên mật khẩu — Gửi đồng thời Link Token và Mã OTP 6 số (Mục 3.3.2)
   */
  public async requestPasswordReset(
    dto: ForgotPasswordRequest,
    requestedIp?: string | null,
  ): Promise<ForgotPasswordResponse> {
    const rawIdentifier = (dto.identifier ?? dto.email ?? '').trim();
    const normalizedIdent = rawIdentifier.includes('@')
      ? rawIdentifier.toLowerCase()
      : rawIdentifier;
    const user = await this.usersPublicService.findAuthUserByIdentifier(normalizedIdent);

    // Luôn trả về thành công để chống dò quét tài khoản (User Enumeration Protection)
    if (
      !user ||
      user.archivedAt ||
      user.status === USER_STATUS.INACTIVE ||
      user.status === USER_STATUS.ARCHIVED
    ) {
      return {
        accepted: true,
        expiresInSeconds: PASSWORD_RESET_TTL_SECONDS,
      };
    }

    const plainToken = this.passwordHasher.generateRandomToken(32);
    const otpCode = this.passwordHasher.generateNumericOtp(6);
    const tokenHash = this.passwordHasher.sha256(plainToken);
    const otpCodeHash = this.passwordHasher.sha256(otpCode);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);
    const settings = await this.securitySettingsService?.getSettings();
    const maxAttempts = settings?.otpMaxAttempts ?? DEFAULT_RESET_OTP_MAX_ATTEMPTS;

    await this.passwordResetRepository.saveEntity({
      userId: user.id,
      tokenHash,
      otpCodeHash,
      attemptCount: 0,
      maxAttempts,
      expiresAt,
      usedAt: null,
      requestedIp: requestedIp ?? null,
    });

    if (user.email) {
      await this.emailAdapter.sendOtpEmail({
        userId: user.id,
        email: user.email,
        otpCode,
        expiresInSeconds: PASSWORD_RESET_TTL_SECONDS,
        purpose: 'PASSWORD_RESET',
        verificationToken: plainToken,
      });
    }

    const maskedTarget = user.email ? this.maskEmail(user.email) : undefined;
    const isProd = this.configService?.app.env === 'production';
    return {
      accepted: true,
      expiresInSeconds: PASSWORD_RESET_TTL_SECONDS,
      ...(maskedTarget ? { maskedTarget } : {}),
      ...(!isProd
        ? {
            devResetToken: plainToken,
            devResetOtp: otpCode,
          }
        : {}),
    };
  }

  /**
   * Xác nhận đặt lại mật khẩu mới bằng Link Token hoặc Mã OTP 6 số (Mục 3.3.2, 3.3.4, 3.3.5, 3.3.7)
   */
  public async resetPassword(
    dto: ResetPasswordRequest,
  ): Promise<{ reset: true; revokedSessionsCount: number }> {
    const rawTokenOrOtp = (dto.token ?? dto.otpCode ?? '').trim();
    const candidateHash = this.passwordHasher.sha256(rawTokenOrOtp);
    const targetIdentifier = (dto.identifier ?? dto.email ?? '').trim();

    let resetRecord: AuthPasswordResetEntity | null = null;

    // 1. Tìm theo Link Token Hash (chỉ khi độ dài đủ lớn như token ngẫu nhiên, tránh đoán mò OTP 6 số toàn cục)
    if (rawTokenOrOtp.length > 10) {
      resetRecord = await this.passwordResetRepository.findByTokenHash(candidateHash);
    }

    // 2. Nếu có truyền identifier/email -> tìm bản ghi mới nhất của user để kiểm tra & đếm số lần thử sai
    if (!resetRecord && targetIdentifier) {
      const targetUser = await this.usersPublicService.findAuthUserByIdentifier(targetIdentifier);
      if (targetUser) {
        resetRecord = await this.findLatestResetRecordForUser(targetUser.id);
      }
    }

    // 3. Chỉ cho phép tra cứu trực tiếp theo otpCodeHash nếu client truyền chuỗi token dài (không cho phép brute-force OTP 6 chữ số không kèm identifier)
    if (!resetRecord && !targetIdentifier && rawTokenOrOtp.length > 10) {
      resetRecord = await this.findResetRecordByOtpHash(candidateHash);
    }

    if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestAppException('auth.invalidOrExpiredResetToken');
    }

    const maxAttempts = resetRecord.maxAttempts ?? DEFAULT_RESET_OTP_MAX_ATTEMPTS;
    const currentAttempts = resetRecord.attemptCount ?? 0;
    if (currentAttempts >= maxAttempts) {
      throw new ForbiddenAppException('auth.otpMaxAttemptsExceeded', [
        { attemptCount: currentAttempts, maxAttempts },
      ]);
    }

    const isTokenMatch = this.passwordHasher.safeEqualHex(resetRecord.tokenHash, candidateHash);
    const isOtpMatch = Boolean(
      resetRecord.otpCodeHash &&
      this.passwordHasher.safeEqualHex(resetRecord.otpCodeHash, candidateHash),
    );

    if (!isTokenMatch && !isOtpMatch) {
      resetRecord.attemptCount = currentAttempts + 1;
      if (resetRecord.attemptCount >= maxAttempts) {
        resetRecord.expiresAt = new Date(0);
        await this.persistResetRecordUpdate(resetRecord);
        throw new ForbiddenAppException('auth.otpMaxAttemptsExceeded', [
          { attemptCount: resetRecord.attemptCount, maxAttempts },
        ]);
      }
      await this.persistResetRecordUpdate(resetRecord);
      throw new BadRequestAppException('auth.invalidOrExpiredResetToken');
    }

    const userId = Number(resetRecord.userId);
    const credentials = await this.resolveUserCredentialsById(userId);
    if (credentials) {
      await this.validateNewPasswordForUser(dto.newPassword, credentials, false);
    } else if (this.securitySettingsService) {
      await this.securitySettingsService.validatePasswordPolicy(dto.newPassword);
    }

    const settings = await this.securitySettingsService?.getSettings();
    const newHash = await this.passwordHasher.hash(dto.newPassword);
    await this.usersPublicService.updatePasswordHash(userId, newHash, {
      recordHistory: true,
      maxHistory: Math.max(1, settings?.passwordHistoryLimit ?? 5),
    });
    await this.usersPublicService.autoUnlockExpiredLock(userId);

    resetRecord.usedAt = new Date();
    await this.persistResetRecordUpdate(resetRecord);

    const revokedSessionsCount = await this.sessionService.revokeAllUserSessions(
      userId,
      'Password reset completed',
    );

    await this.sessionService.recordAuthEvent({
      userId,
      actorId: userId,
      ipAddress: resetRecord.requestedIp ?? null,
      eventType: AUTH_EVENT_TYPE.PASSWORD_RESET,
      status: AUTH_EVENT_STATUS.SUCCESS,
      reason: 'Password reset via recovery token/OTP',
      metadata: { revokedSessionsCount },
    });

    return { reset: true, revokedSessionsCount };
  }

  /**
   * Đặt lại mật khẩu người dùng từ trang quản trị (Mục 3.3.3 & 3.3.7)
   * Chỉ người có quyền (`users.update`) được thực hiện; hỗ trợ nhập mật khẩu mới hoặc tự sinh mật khẩu gợi ý mạnh.
   */
  public async adminResetUserPassword(
    userId: number,
    input: AdminResetUserPasswordInput | AdminResetPasswordRequest,
    _actorId?: number,
  ): Promise<AdminResetUserPasswordResult & AdminResetPasswordResponse> {
    const credentials = await this.resolveUserCredentialsById(userId);
    if (!credentials || credentials.archivedAt || credentials.status === USER_STATUS.ARCHIVED) {
      throw new NotFoundAppException('users.notFound', { id: userId });
    }

    const useSuggested = Boolean(input.useSuggestedPassword || !input.newPassword?.trim());
    let plainPassword: string;

    if (useSuggested) {
      const suggested = await this.suggestPasswords({ count: 1 });
      plainPassword = suggested.suggestedPassword;
    } else {
      plainPassword = input.newPassword!.trim();
      await this.validateNewPasswordForUser(plainPassword, credentials, false);
    }

    const settings = await this.securitySettingsService?.getSettings();
    const newHash = await this.passwordHasher.hash(plainPassword);
    await this.usersPublicService.updatePasswordHash(userId, newHash, {
      recordHistory: true,
      maxHistory: Math.max(1, settings?.passwordHistoryLimit ?? 5),
    });
    await this.usersPublicService.autoUnlockExpiredLock(userId);

    const shouldRevoke =
      input.revokeSessions !== undefined
        ? input.revokeSessions
        : (settings?.revokeSessionsOnPasswordChange ?? true);

    let revokedSessionsCount = 0;
    if (shouldRevoke) {
      revokedSessionsCount = await this.sessionService.revokeAllUserSessions(
        userId,
        'Password reset by administrator',
      );
    }

    await this.sessionService.recordAuthEvent({
      userId: Number(userId),
      actorId: _actorId ?? null,
      eventType: AUTH_EVENT_TYPE.PASSWORD_RESET,
      status: AUTH_EVENT_STATUS.SUCCESS,
      reason: `Password reset by administrator${_actorId ? ` #${_actorId}` : ''}`,
      metadata: { revokedSessionsCount, useSuggested },
    });

    return {
      reset: true,
      userId: Number(userId),
      revokedSessionsCount,
      ...(useSuggested ? { generatedPassword: plainPassword } : {}),
    };
  }

  /**
   * Kiểm tra mật khẩu mới theo chính sách mật khẩu (`SecuritySettingsService`)
   * và kiểm tra không cho dùng lại mật khẩu cũ (`preventPasswordReuse` & `passwordHistoryLimit`)
   */
  private async validateNewPasswordForUser(
    newPassword: string,
    credentials: UserAuthCredentialsView,
    isSelfChange: boolean,
  ): Promise<void> {
    const settings = this.securitySettingsService
      ? await this.securitySettingsService.validatePasswordPolicy(newPassword, {
          username: credentials.username,
          email: credentials.email,
          phone: credentials.phone,
        })
      : undefined;

    const matchesCurrent = await this.passwordHasher.verify(newPassword, credentials.passwordHash);
    if (matchesCurrent) {
      if (settings?.preventPasswordReuse) {
        throw new BadRequestAppException('auth.passwordReuseNotAllowed', [
          { passwordHistoryLimit: settings.passwordHistoryLimit ?? 5 },
        ]);
      }
      if (isSelfChange) {
        throw new BadRequestAppException('auth.newPasswordMustDiffer');
      }
    }

    if (settings?.preventPasswordReuse) {
      const historyLimit = Math.max(1, settings.passwordHistoryLimit ?? 5);
      const historyHashes = (credentials.passwordHistoryHashes ?? []).slice(0, historyLimit);
      for (const oldHash of historyHashes) {
        const isReused = await this.passwordHasher.verify(newPassword, oldHash);
        if (isReused) {
          throw new BadRequestAppException('auth.passwordReuseNotAllowed', [
            { passwordHistoryLimit: historyLimit },
          ]);
        }
      }
    }
  }

  public async resolveUserCredentialsById(userId: number): Promise<UserAuthCredentialsView | null> {
    return resolveUserCredentialsById(this.usersPublicService, userId);
  }

  private async findLatestResetRecordForUser(
    userId: number,
  ): Promise<AuthPasswordResetEntity | null> {
    return await this.passwordResetRepository.findLatestByUserId(userId);
  }

  private async findResetRecordByOtpHash(
    otpCodeHash: string,
  ): Promise<AuthPasswordResetEntity | null> {
    return await this.passwordResetRepository.findByOtpCodeHash(otpCodeHash);
  }

  private async persistResetRecordUpdate(record: AuthPasswordResetEntity): Promise<void> {
    await this.passwordResetRepository.saveEntity(record);
  }

  private maskEmail(email: string): string {
    return sharedMaskEmail(email);
  }
}
