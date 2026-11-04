import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';

export const API_CLIENT_STATUS = {
  ACTIVE: 1,
  REVOKED: 2,
} as const;

export type ApiClientStatusCode = (typeof API_CLIENT_STATUS)[keyof typeof API_CLIENT_STATUS];
export type ApiClientStatusName = keyof typeof API_CLIENT_STATUS;

export function getApiClientStatusName(code: number): ApiClientStatusName {
  return Number(code) === API_CLIENT_STATUS.REVOKED ? 'REVOKED' : 'ACTIVE';
}

export type ApiClientUsageResultType =
  | 'SUCCESS'
  | 'INVALID_SECRET'
  | 'DENIED_IP'
  | 'CLIENT_REVOKED'
  | 'SERVICE_ACCOUNT_INACTIVE'
  | 'FORBIDDEN_SCOPE';

export interface ApiClientUsageLogItem {
  readonly timestamp: string;
  readonly ipAddress: string | null;
  readonly action: 'ISSUE_TOKEN' | 'API_REQUEST';
  readonly endpoint: string | null;
  readonly status: 'SUCCESS' | 'FAILED';
  readonly result: ApiClientUsageResultType;
  readonly reason?: string | null;
}

/**
 * API Client gắn với Service Account (Mục 3.6.2 -> 3.6.7):
 * - Có Client ID và Client Secret (Secret chỉ hiển thị 1 lần khi tạo hoặc xoay vòng)
 * - Gán phạm vi truy cập (`scopesJson`) chỉ cho phép đúng API cần dùng
 * - Thu hồi API Client ngừng toàn bộ token đã cấp (`tokenVersion` + `status = REVOKED`)
 * - Giới hạn IP được phép gọi (`allowedIpsJson`)
 * - Theo dõi lần sử dụng gần nhất (`lastUsedAt`, `lastUsedIp`, `lastUsedResult`, `usageLogsJson`)
 */
@Entity('auth_api_clients')
export class AuthApiClientEntity extends TypeOrmBaseEntity {
  @Index()
  @Column({ name: 'service_account_id', type: 'int' })
  public serviceAccountId!: number;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  public name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  public description?: string | null;

  @Index({ unique: true })
  @Column({ name: 'client_id', type: 'varchar', length: 96 })
  public clientId!: string;

  @Column({ name: 'client_secret_hash', type: 'varchar', length: 255 })
  public clientSecretHash!: string;

  @Column({ name: 'secret_prefix', type: 'varchar', length: 32 })
  public secretPrefix!: string;

  /** Danh sách quyền/phạm vi truy cập được phép của API Client (JSON string[]) */
  @Column({ name: 'scopes_json', type: 'text', default: '[]' })
  public scopesJson!: string;

  /** Danh sách địa chỉ IP hoặc CIDR được phép gọi (JSON string[], rỗng = không giới hạn IP) */
  @Column({ name: 'allowed_ips_json', type: 'text', default: '[]' })
  public allowedIpsJson!: string;

  @Index()
  @Column({ name: 'status', type: 'int', default: API_CLIENT_STATUS.ACTIVE })
  public status!: ApiClientStatusCode;

  /** Phiên bản token: tăng mỗi khi xoay vòng secret hoặc thu hồi client để vô hiệu hóa toàn bộ token cũ */
  @Column({ name: 'token_version', type: 'int', default: 1 })
  public tokenVersion!: number;

  @Column({ name: 'secret_rotated_at', type: 'timestamp', nullable: true })
  public secretRotatedAt?: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  public revokedAt?: Date | null;

  @Column({ name: 'revoked_reason', type: 'varchar', length: 255, nullable: true })
  public revokedReason?: string | null;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  public lastUsedAt?: Date | null;

  @Column({ name: 'last_used_ip', type: 'varchar', length: 64, nullable: true })
  public lastUsedIp?: string | null;

  @Column({ name: 'last_used_result', type: 'varchar', length: 64, nullable: true })
  public lastUsedResult?: ApiClientUsageResultType | null;

  @Column({ name: 'last_used_endpoint', type: 'varchar', length: 255, nullable: true })
  public lastUsedEndpoint?: string | null;

  @Column({ name: 'usage_logs_json', type: 'text', default: '[]' })
  public usageLogsJson!: string;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  public createdBy?: number | null;
}
