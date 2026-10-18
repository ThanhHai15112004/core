import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

export const SERVICE_ACCOUNT_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  REVOKED: 3,
} as const;

export type ServiceAccountStatusCode =
  (typeof SERVICE_ACCOUNT_STATUS)[keyof typeof SERVICE_ACCOUNT_STATUS];
export type ServiceAccountStatusName = keyof typeof SERVICE_ACCOUNT_STATUS;

export function getServiceAccountStatusName(code: number): ServiceAccountStatusName {
  switch (Number(code)) {
    case SERVICE_ACCOUNT_STATUS.INACTIVE:
      return 'INACTIVE';
    case SERVICE_ACCOUNT_STATUS.REVOKED:
      return 'REVOKED';
    case SERVICE_ACCOUNT_STATUS.ACTIVE:
    default:
      return 'ACTIVE';
  }
}

export function parseServiceAccountStatus(val: unknown): ServiceAccountStatusCode {
  if (val === 2 || val === '2' || val === 'INACTIVE') return SERVICE_ACCOUNT_STATUS.INACTIVE;
  if (val === 3 || val === '3' || val === 'REVOKED') return SERVICE_ACCOUNT_STATUS.REVOKED;
  return SERVICE_ACCOUNT_STATUS.ACTIVE;
}

/**
 * Tài khoản hệ thống (Service Account — Mục 3.6.1)
 * Dùng cho hệ thống tích hợp hoặc background job, độc lập và không gắn với người dùng cá nhân.
 */
@Entity('auth_service_accounts')
export class AuthServiceAccountEntity extends TypeOrmBaseEntity {
  @Index({ unique: true })
  @Column({ name: 'code', type: 'varchar', length: 64 })
  public code!: string;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  public name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  public description?: string | null;

  @Index()
  @Column({ name: 'status', type: 'int', default: SERVICE_ACCOUNT_STATUS.ACTIVE })
  public status!: ServiceAccountStatusCode;

  /** Danh sách quyền/phạm vi truy cập tối đa của Service Account (JSON string[]) */
  @Column({ name: 'scopes_json', type: 'text', default: '[]' })
  public scopesJson!: string;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  public createdBy?: number | null;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  public lastUsedAt?: Date | null;

  @Column({ name: 'last_used_ip', type: 'varchar', length: 64, nullable: true })
  public lastUsedIp?: string | null;

  @Column({ name: 'last_used_result', type: 'varchar', length: 64, nullable: true })
  public lastUsedResult?: string | null;
}
