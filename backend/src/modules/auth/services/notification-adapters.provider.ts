import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { IEmailNotificationAdapter, ISmsOtpProvider } from '../contracts/index.js';

export interface DispatchedEmailNotificationLog {
  readonly messageId: string;
  readonly userId: number;
  readonly email: string;
  readonly otpCode: string;
  readonly expiresInSeconds: number;
  readonly purpose: 'MFA_EMAIL_OTP' | 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
  readonly verificationToken?: string | undefined;
  readonly sentAt: string;
}

export interface DispatchedSmsOtpLog {
  readonly providerMessageId: string;
  readonly userId: number;
  readonly phone: string;
  readonly otpCode: string;
  readonly expiresInSeconds: number;
  readonly purpose: 'MFA_SMS_OTP' | 'PHONE_VERIFICATION';
  readonly sentAt: string;
}

/**
 * Adapter mặc định gửi OTP/Verification qua Email (Mục 3.5.1).
 * Các dự án triển khai thực tế có thể override token `AUTH_EMAIL_NOTIFICATION_ADAPTER`
 * để kết nối SMTP / SendGrid / AWS SES / Notification Queue.
 */
@Injectable()
export class DefaultEmailNotificationAdapter implements IEmailNotificationAdapter {
  private readonly logger = new Logger(DefaultEmailNotificationAdapter.name);
  private readonly history: DispatchedEmailNotificationLog[] = [];

  public async sendOtpEmail(payload: {
    userId: number;
    email: string;
    otpCode: string;
    expiresInSeconds: number;
    purpose: 'MFA_EMAIL_OTP' | 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
    verificationToken?: string | undefined;
  }): Promise<{ delivered: boolean; messageId?: string }> {
    const messageId = `email-otp-${randomUUID()}`;
    const entry: DispatchedEmailNotificationLog = {
      messageId,
      userId: payload.userId,
      email: payload.email,
      otpCode: payload.otpCode,
      expiresInSeconds: payload.expiresInSeconds,
      purpose: payload.purpose,
      ...(payload.verificationToken ? { verificationToken: payload.verificationToken } : {}),
      sentAt: new Date().toISOString(),
    };
    this.history.unshift(entry);
    if (this.history.length > 100) {
      this.history.length = 100;
    }

    this.logger.log(
      `[EmailNotificationAdapter] Dispatched ${payload.purpose} to user #${payload.userId} (messageId=${messageId})`,
    );
    return { delivered: true, messageId };
  }

  public getDispatchedHistory(): readonly DispatchedEmailNotificationLog[] {
    return this.history;
  }
}

/**
 * Provider mặc định gửi OTP qua SMS (Mục 3.5.2).
 * Các dự án triển khai thực tế có thể override token `AUTH_SMS_OTP_PROVIDER`
 * để gắn cổng SMS riêng (Viettel, FPT, VNPT, Twilio, Infobip...).
 */
@Injectable()
export class DefaultSmsOtpProvider implements ISmsOtpProvider {
  private readonly logger = new Logger(DefaultSmsOtpProvider.name);
  private readonly history: DispatchedSmsOtpLog[] = [];

  public async sendOtpSms(payload: {
    userId: number;
    phone: string;
    otpCode: string;
    expiresInSeconds: number;
    purpose: 'MFA_SMS_OTP' | 'PHONE_VERIFICATION';
  }): Promise<{ delivered: boolean; providerMessageId?: string }> {
    const providerMessageId = `sms-otp-${randomUUID()}`;
    const entry: DispatchedSmsOtpLog = {
      providerMessageId,
      userId: payload.userId,
      phone: payload.phone,
      otpCode: payload.otpCode,
      expiresInSeconds: payload.expiresInSeconds,
      purpose: payload.purpose,
      sentAt: new Date().toISOString(),
    };
    this.history.unshift(entry);
    if (this.history.length > 100) {
      this.history.length = 100;
    }

    this.logger.log(
      `[SmsOtpProvider] Dispatched ${payload.purpose} to user #${payload.userId} (providerMessageId=${providerMessageId})`,
    );
    return { delivered: true, providerMessageId };
  }

  public getDispatchedHistory(): readonly DispatchedSmsOtpLog[] {
    return this.history;
  }
}

export function createDefaultEmailNotificationAdapter(): IEmailNotificationAdapter {
  return new DefaultEmailNotificationAdapter();
}

export function createDefaultSmsOtpProvider(): ISmsOtpProvider {
  return new DefaultSmsOtpProvider();
}
