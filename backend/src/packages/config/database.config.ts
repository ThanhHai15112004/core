import { DatabaseDriver, DEFAULT_DATABASE_PORTS } from '@packages/kernel/index.js';
import { env } from './env.js';

/** Chuyển đổi giá trị sang kiểu số hoặc trả về giá trị mặc định */
const numberOr = (key: string, fallback: number): number => {
  const raw = env(key, false);
  return raw === '' ? fallback : env.number(key);
};
/** Chuyển đổi giá trị sang kiểu boolean hoặc trả về giá trị mặc định */
const booleanOr = (key: string, fallback: boolean): boolean =>
  env(key, false) ? env.boolean(key) : fallback;

/** Chuẩn hóa danh sách Read Replica từ `DB_READ_HOST`/`DB_READ_PORT` và `DB_READ_HOSTS`. */
function parseReadReplicas(params: {
  readHost: string;
  readPort: number;
  readHostsRaw: string;
  defaultPort: number;
  username: string;
  password: string;
  database: string;
}): ReadonlyArray<{
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly database: string;
}> {
  const entries: Array<{ host: string; port: number }> = [];
  const seen = new Set<string>();
  const addEntry = (hostRaw: string, portCandidate: number) => {
    const host = hostRaw.trim();
    if (!host) return;
    const port =
      Number.isInteger(portCandidate) && portCandidate > 0 && portCandidate <= 65535
        ? portCandidate
        : params.defaultPort;
    const key = `${host.toLowerCase()}:${port}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ host, port });
  };

  if (params.readHost.trim()) {
    addEntry(params.readHost, params.readPort);
  }

  for (const token of params.readHostsRaw.split(',')) {
    const item = token.trim();
    if (!item) continue;
    const colonIdx = item.lastIndexOf(':');
    if (colonIdx > 0 && !item.endsWith(']')) {
      const hostPart = item.slice(0, colonIdx);
      const portPart = Number(item.slice(colonIdx + 1));
      if (Number.isInteger(portPart) && portPart > 0) {
        addEntry(hostPart, portPart);
        continue;
      }
    }
    addEntry(item, params.readPort || params.defaultPort);
  }

  return entries.map((entry) => ({
    host: entry.host,
    port: entry.port,
    username: params.username,
    password: params.password,
    database: params.database,
  }));
}

/** Lấy thông tin cấu hình cơ sở dữ liệu */
export const databaseConfig = () => {
  const connection = (env('DB_CONNECTION', false) || DatabaseDriver.MYSQL) as DatabaseDriver;
  const defaultPort = DEFAULT_DATABASE_PORTS[connection] ?? 3306;
  const port = env.number('DB_PORT', false) || defaultPort;
  const database = env('DB_DATABASE', false) || 'core_db';
  const username = env('DB_USERNAME', false) || 'root';
  const password = env('DB_PASSWORD', false) || '';
  const readHost = env('DB_READ_HOST', false) || '';
  const readPort = env.number('DB_READ_PORT', false) || port;
  const readUsername = env('DB_READ_USERNAME', false) || username;
  const readPassword = env('DB_READ_PASSWORD', false) || password;
  const readDatabase = env('DB_READ_DATABASE', false) || database;
  const readHostsRaw = env('DB_READ_HOSTS', false) || '';
  const readReplicas = parseReadReplicas({
    readHost,
    readPort,
    readHostsRaw,
    defaultPort: port,
    username: readUsername,
    password: readPassword,
    database: readDatabase,
  });
  const replicationLagWarnMs = Math.max(100, numberOr('DB_REPLICATION_LAG_WARN_MS', 1_000));
  const replicationLagCritMs = Math.max(
    replicationLagWarnMs,
    Math.max(200, numberOr('DB_REPLICATION_LAG_CRIT_MS', 5_000)),
  );

  return {
    /** Tắt thì không kết nối database (các trang Database hiện "đã tắt"). */
    enabled: booleanOr('DB_ENABLED', true),
    connection,
    host: env('DB_HOST', false) || '127.0.0.1',
    port,
    /** Host Read Replica khi thật sự cần tách đọc/ghi (để trống = dùng chung node chính). */
    readHost,
    /** Port Read Replica (mặc định bằng port chính). */
    readPort,
    readUsername,
    readPassword,
    readDatabase,
    /** Danh sách Read Replica đã chuẩn hóa từ DB_READ_HOST + DB_READ_HOSTS. */
    readReplicas,
    /** Cửa sổ Read-After-Write (ms) giữ luồng đọc về Primary ngay sau khi ghi. */
    readAfterWriteWindowMs: Math.max(0, numberOr('DB_READ_AFTER_WRITE_WINDOW_MS', 3_000)),
    /** Thời gian mở mạch fallback về Primary (ms) khi Replica gặp sự cố. */
    replicaFallbackCooldownMs: Math.max(1_000, numberOr('DB_REPLICA_FALLBACK_COOLDOWN_MS', 30_000)),
    /** Ngưỡng cảnh báo độ trễ đồng bộ Replica (ms). */
    replicationLagWarnMs,
    /** Ngưỡng nghiêm trọng độ trễ đồng bộ Replica (ms). */
    replicationLagCritMs,
    /** Tự chuyển luồng đọc thường về Primary khi Replication Lag vượt ngưỡng nghiêm trọng. */
    fallbackOnCriticalLag: booleanOr('DB_REPLICA_FALLBACK_ON_CRITICAL_LAG', true),
    database,
    username,
    password,
    maxConnections: env.number('DB_MAX_CONNECTIONS', false) || 10,
    /** Số connection nhàn rỗi tối đa giữ trong pool (0 = bằng maxConnections). */
    poolMaxIdle: numberOr('DB_POOL_MAX_IDLE', 0),
    /** Thời gian tối đa (ms) giữ một connection nhàn rỗi trong pool trước khi đóng. */
    poolIdleTimeoutMs: numberOr('DB_POOL_IDLE_TIMEOUT_MS', 60_000),
    /** Giới hạn số yêu cầu xếp hàng chờ lấy connection từ pool (0 = không giới hạn). */
    poolQueueLimit: numberOr('DB_POOL_QUEUE_LIMIT', 0),
    synchronize: env.boolean('DB_SYNCHRONIZE', false),
    logging: env.boolean('DB_LOGGING', false),
    ssl: booleanOr('DB_SSL', false),
    connectTimeoutMs: numberOr('DB_CONNECT_TIMEOUT_MS', 10_000),
    /** Thời gian tối đa (ms) cho phép một câu truy vấn chạy trước khi bị ngắt (0 = không giới hạn). */
    queryTimeoutMs: numberOr('DB_QUERY_TIMEOUT_MS', 30_000),
    /** Chu kỳ kiểm tra kết nối (`SELECT 1`) và tự kết nối lại. */
    healthIntervalMs: numberOr('DB_HEALTH_INTERVAL_MS', 5000),
    /** Ngưỡng query chậm của trang Database. */
    slowQueryMs: numberOr('DB_SLOW_QUERY_MS', 500),
    /** Số query chậm trong 15 phút để bật cảnh báo "query chậm tăng". */
    /** Transaction mở lâu hơn ngưỡng này được đánh dấu "dài". */
    longTransactionSec: numberOr('DB_LONG_TX_SEC', 10),
    /** Thời gian tối đa (ms) cho phép một transaction chạy trong TransactionManager trước khi tự động rollback (0 = không giới hạn). */
    transactionTimeoutMs: numberOr('DB_TRANSACTION_TIMEOUT_MS', 30_000),
    /** Chính sách retry cho lỗi DB tạm thời (deadlock / lock_timeout) có giới hạn trần và jitter. */
    retry: {
      maxRetries: Math.min(5, Math.max(0, numberOr('DB_RETRY_MAX', 2))),
      baseDelayMs: Math.max(10, numberOr('DB_RETRY_BASE_DELAY_MS', 100)),
      maxDelayMs: Math.max(50, numberOr('DB_RETRY_MAX_DELAY_MS', 2_000)),
      jitter: booleanOr('DB_RETRY_JITTER', true),
    },
    /** Chặn chạy migration nếu phát hiện migration đã áp dụng bị sửa đổi hoặc xóa file. */
    migrationStrict: booleanOr('DB_MIGRATION_STRICT', true),
    /** Thời gian chờ khóa bảng tối đa khi chạy từng migration (ms). */
    migrationLockTimeoutMs: Math.max(500, numberOr('DB_MIGRATION_LOCK_TIMEOUT_MS', 5_000)),
    /** Thời gian chạy tối đa cho mỗi câu lệnh DDL/DML trong migration (ms, 0 = không giới hạn). */
    migrationStatementTimeoutMs: Math.max(0, numberOr('DB_MIGRATION_STATEMENT_TIMEOUT_MS', 60_000)),
    /** Thời gian giữ distributed lock migration trên Redis (giây). */
    migrationLockTtlSec: Math.max(30, numberOr('DB_MIGRATION_LOCK_TTL_SEC', 600)),
    /** Ngưỡng cảnh báo thời lượng thực thi/giữ khóa của một migration (ms). */
    migrationMaxLockWarnMs: Math.max(500, numberOr('DB_MIGRATION_MAX_LOCK_WARN_MS', 3_000)),
    /** Ngưỡng rủi ro tối thiểu bắt buộc phải có backup xác thực trước khi chạy migration (LOW|MEDIUM|HIGH|CRITICAL|NEVER). */
    migrationRequireBackupRisk: (
      env('DB_MIGRATION_REQUIRE_BACKUP_RISK', false) || 'HIGH'
    ).toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'NEVER',
    /** Tuổi tối đa (giờ) của bản backup hợp lệ trước khi chạy migration rủi ro. */
    migrationBackupMaxAgeHours: Math.max(1, numberOr('DB_MIGRATION_BACKUP_MAX_AGE_HOURS', 24)),
    /** Bắt buộc có người phê duyệt (`approvedBy`) khi triển khai migration trên môi trường Production. */
    migrationRequireApprovalInProd: booleanOr('DB_MIGRATION_REQUIRE_APPROVAL_IN_PROD', true),
    /** Dung lượng tối đa cấp cho database (GB) để tính % sử dụng; 0 = không biết. */
    storageLimitGb: numberOr('DB_STORAGE_LIMIT_GB', 0),
    storageWarnPercent: numberOr('DB_STORAGE_WARN_PERCENT', 80),
    /** Cancel query / terminate session từ System Console. */
    actionsEnabled: booleanOr('OPS_DATABASE_ACTIONS_ENABLED', true),
    /** Chạy migration từ System Console (nên tắt ở production khi chưa có RBAC). */
    migrationsEnabled: booleanOr('OPS_DATABASE_MIGRATIONS_ENABLED', false),
    migrationsTableName: env('DB_MIGRATIONS_TABLE', false) || 'core_migrations',
    /** Tuổi tối đa của bản backup gần nhất (giờ) trước khi đánh dấu cảnh báo quá hạn (stale). */
    backupMaxAgeHours: Math.max(1, numberOr('DB_BACKUP_MAX_AGE_HOURS', 26)),
  };
};

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
