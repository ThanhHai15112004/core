import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { BadRequestAppException, UnauthorizedAppException } from '@packages/kernel/index.js';
import { PasswordHasherService } from '@packages/security/index.js';
import {
  type IUsersPublicService,
  USERS_PUBLIC_SERVICE,
  USER_STATUS,
} from '@modules/users/contracts/index.js';
import { AuthPasswordResetRepository } from '../repositories/auth-password-reset.repository.js';
import { SessionService } from './session.service.js';
import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
} from '../requests/auth.requests.js';
import type { ForgotPasswordResponse } from '../responses/auth.response.js';

const PASSWORD_RESET_TTL_SECONDS = 900; // 15 phút

@Injectable()
export class PasswordService {
  constructor(
    private readonly passwordResetRepository: AuthPasswordResetRepository,
    private readonly passwordHasher: PasswordHasherService,
    private readonly sessionService: SessionService,
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService,
    @Optional() private readonly configService?: CoreConfigService,
  ) {}

  /** Đổi mật khẩu cho người dùng đang đăng nhập và thu hồi các phiên khác */
  public async changePassword(
    userId: number,
    dto: ChangePasswordRequest,
    currentSessionId?: number,
  ): Promise<{ changed: true; revokedSessionsCount: number }> {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestAppException('auth.newPasswordMustDiffer');
    }

    const userIdentity = await this.usersPublicService.findAuthUserById(userId);
    if (!userIdentity) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const credentials = await this.usersPublicService.findAuthUserByIdentifier(userIdentity.email);
    if (!credentials) {
      throw new UnauthorizedAppException('auth.userNotFound');
    }

    const isCurrentValid = await this.passwordHasher.verify(
      dto.currentPassword,
      credentials.passwordHash,
    );
    if (!isCurrentValid) {
      throw new UnauthorizedAppException('auth.invalidCurrentPassword');
    }

    const newHash = await this.passwordHasher.hash(dto.newPassword);
    await this.usersPublicService.updatePasswordHash(userId, newHash);

    let revokedSessionsCount = 0;
    if (dto.revokeOtherSessions !== false) {
      revokedSessionsCount = await this.sessionService.revokeAllUserSessions(
        userId,
        'Password changed by user',
        currentSessionId,
      );
    }

    return { changed: true, revokedSessionsCount };
  }

  /** Yêu cầu đặt lại mật khẩu khi quên mật khẩu (Forgot Password) */
  public async requestPasswordReset(
    dto: ForgotPasswordRequest,
    requestedIp?: string | null,
  ): Promise<ForgotPasswordResponse> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.usersPublicService.findAuthUserByIdentifier(normalizedEmail);

    // Luôn trả về thành công để chống dò quét email (User Enumeration Protection)
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
    const tokenHash = this.passwordHasher.sha256(plainToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);

    await this.passwordResetRepository.saveEntity({
      userId: user.id,
      tokenHash,
      expiresAt,
      usedAt: null,
      requestedIp: requestedIp ?? null,
    });

    const isProd = this.configService?.app.env === 'production';
    return {
      accepted: true,
      expiresInSeconds: PASSWORD_RESET_TTL_SECONDS,
      ...(!isProd ? { devResetToken: plainToken } : {}),
    };
  }

  /** Xác nhận đặt lại mật khẩu mới bằng token khôi phục (Reset Password) */
  public async resetPassword(
    dto: ResetPasswordRequest,
  ): Promise<{ reset: true; revokedSessionsCount: number }> {
    const tokenHash = this.passwordHasher.sha256(dto.token.trim());
    const resetRecord = await this.passwordResetRepository.findByTokenHash(tokenHash);

    if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestAppException('auth.invalidOrExpiredResetToken');
    }

    const newHash = await this.passwordHasher.hash(dto.newPassword);
    await this.usersPublicService.updatePasswordHash(Number(resetRecord.userId), newHash);
    await this.usersPublicService.autoUnlockExpiredLock(Number(resetRecord.userId));

    resetRecord.usedAt = new Date();
    await this.passwordResetRepository.saveEntity(resetRecord);

    const revokedSessionsCount = await this.sessionService.revokeAllUserSessions(
      Number(resetRecord.userId),
      'Password reset completed',
    );

    return { reset: true, revokedSessionsCount };
  }
}
