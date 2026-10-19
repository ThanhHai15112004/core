import { Column, Entity, Index } from 'typeorm';
import { TypeOrmBaseEntity } from '@packages/database/index.js';
import { AUDIT_ACTOR_TYPE, type AuditActorTypeCode } from '@packages/security/index.js';

@Entity('audit_logs')
export class AuditLogEntity extends TypeOrmBaseEntity {
  /** Loại chủ thể thực hiện: 1 = USER, 2 = SERVICE_ACCOUNT, 3 = SYSTEM (Mục 4.4.1) */
  @Index()
  @Column({ name: 'actor_type', type: 'int', default: AUDIT_ACTOR_TYPE.USER })
  public actorType!: AuditActorTypeCode;

  /** ID người dùng thực hiện thao tác (Mục 4.4.1) */
  @Index()
  @Column({ name: 'actor_user_id', type: 'int', nullable: true })
  public actorUserId?: number | null;

  /** ID tài khoản hệ thống (Service Account) thực hiện thao tác (Mục 4.4.1) */
  @Index()
  @Column({ name: 'actor_service_account_id', type: 'int', nullable: true })
  public actorServiceAccountId?: number | null;

  /** ID của API Client nếu thao tác qua M2M token */
  @Column({ name: 'actor_api_client_id', type: 'int', nullable: true })
  public actorApiClientId?: number | null;

  /** Định danh hiển thị của người thực hiện (Email, Username hoặc Client ID) */
  @Column({ name: 'actor_identifier', type: 'varchar', length: 255, nullable: true })
  public actorIdentifier?: string | null;

  /** Module phát sinh thao tác: 'users', 'roles', 'organizations', 'auth'... (Mục 4.4.3) */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  public module!: string;

  /** Chức năng cụ thể trong module (Mục 4.4.3) */
  @Index()
  @Column({ type: 'varchar', length: 128 })
  public feature!: string;

  /** Mã hành động cụ thể: 'USER_CREATED', 'USER_UNLOCKED', 'ROLE_UPDATED'... (Mục 4.4.3) */
  @Index()
  @Column({ type: 'varchar', length: 128 })
  public action!: string;

  /** Loại tài nguyên bị tác động: 'user', 'role', 'organization_unit'... */
  @Column({ name: 'resource_type', type: 'varchar', length: 64, nullable: true })
  public resourceType?: string | null;

  /** ID của bản ghi bị tác động */
  @Index()
  @Column({ name: 'resource_id', type: 'varchar', length: 64, nullable: true })
  public resourceId?: string | null;

  /** Dữ liệu JSON trước khi thay đổi (đã che trường nhạy cảm — Mục 4.4.4) */
  @Column({ name: 'before_data_json', type: 'text', nullable: true })
  public beforeDataJson?: string | null;

  /** Dữ liệu JSON sau khi thay đổi (đã che trường nhạy cảm — Mục 4.4.4) */
  @Column({ name: 'after_data_json', type: 'text', nullable: true })
  public afterDataJson?: string | null;

  /** Lý do thực hiện thay đổi (ví dụ: mở khóa tài khoản, sửa dữ liệu, reset MFA — Mục 4.4.5) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  public reason?: string | null;

  /** Địa chỉ IP phục vụ điều tra sự cố (Mục 4.4.2) */
  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  public ipAddress?: string | null;

  /** User-Agent của thiết bị/trình duyệt */
  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  public userAgent?: string | null;

  /** Request ID liên kết với HTTP request (Mục 4.4.6) */
  @Index()
  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true })
  public requestId?: string | null;

  /** Correlation ID liên kết xuyên suốt giữa Audit Log, Pino Log và BullMQ Queue (Mục 4.4.6) */
  @Index()
  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  public correlationId?: string | null;
}
