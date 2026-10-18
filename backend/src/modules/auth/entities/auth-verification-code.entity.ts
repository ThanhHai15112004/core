import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

export const VERIFICATION_CHANNEL = {
  EMAIL: 1,
  PHONE_OTP: 2,
} as const;

export type VerificationChannelCode =
  (typeof VERIFICATION_CHANNEL)[keyof typeof VERIFICATION_CHANNEL];

export const VERIFICATION_PURPOSE = {
  VERIFY_EMAIL: 1,
  VERIFY_PHONE: 2,
  MFA_SMS: 3,
} as const;

export type VerificationPurposeCode =
  (typeof VERIFICATION_PURPOSE)[keyof typeof VERIFICATION_PURPOSE];

@Entity('auth_verification_codes')
export class AuthVerificationCodeEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'int' })
  public userId!: number;

  /** Kênh gửi mã: 1 = EMAIL, 2 = PHONE_OTP */
  @Index()
  @Column({ type: 'int', default: VERIFICATION_CHANNEL.EMAIL })
  public channel!: VerificationChannelCode;

  /** Mục đích xác minh: 1 = VERIFY_EMAIL, 2 = VERIFY_PHONE */
  @Column({ type: 'int', default: VERIFICATION_PURPOSE.VERIFY_EMAIL })
  public purpose!: VerificationPurposeCode;

  /** Địa chỉ Email hoặc Số điện thoại chuẩn hóa */
  @Index()
  @Column({ type: 'varchar', length: 255 })
  public target!: string;

  /** Mã băm SHA-256 của mã OTP hoặc token xác minh */
  @Index()
  @Column({ name: 'code_hash', type: 'varchar', length: 128 })
  public codeHash!: string;

  /** Số lần nhập sai hiện tại */
  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  public attemptCount!: number;

  /** Giới hạn số lần nhập sai tối đa trước khi hủy mã */
  @Column({ name: 'max_attempts', type: 'int', default: 5 })
  public maxAttempts!: number;

  /** Số lần đã gửi mã trong chu kỳ hiện tại */
  @Column({ name: 'send_count', type: 'int', default: 1 })
  public sendCount!: number;

  /** Giới hạn số lần gửi tối đa */
  @Column({ name: 'max_sends', type: 'int', default: 5 })
  public maxSends!: number;

  /** Thời điểm gửi gần nhất (phục vụ kiểm tra cooldown) */
  @Column({ name: 'last_sent_at', type: 'timestamp' })
  public lastSentAt!: Date;

  /** Thời điểm hết hạn của mã xác minh */
  @Column({ name: 'expires_at', type: 'timestamp' })
  public expiresAt!: Date;

  /** Thời điểm xác minh thành công */
  @Column({ name: 'verified_at', type: 'timestamp', nullable: true })
  public verifiedAt?: Date | null;

  @Column({ name: 'requested_ip', type: 'varchar', length: 64, nullable: true })
  public requestedIp?: string | null;
}

