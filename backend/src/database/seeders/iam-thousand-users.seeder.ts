import { PasswordHasherService } from '@packages/security/index.js';
import type { SeederContext, SeederContract } from '@packages/database/index.js';
import { ORGANIZATION_UNIT_TYPE } from '@modules/organizations/contracts/index.js';
import { USER_STATUS, type UserStatusCode } from '@modules/users/contracts/index.js';
import { HCMC_ORGANIZATION_UNITS, STANDARD_IAM_ROLES } from './iam-master.seeder.js';

export const REGULAR_USER_DEFAULT_PASSWORD = 'Abcd@454647#';
export const TOTAL_REGULAR_USERS_COUNT = 1000;

interface NameEntry {
  readonly vi: string;
  readonly slug: string;
}

const LAST_NAMES: readonly NameEntry[] = [
  { vi: 'Nguyễn', slug: 'nguyen' },
  { vi: 'Trần', slug: 'tran' },
  { vi: 'Lê', slug: 'le' },
  { vi: 'Phạm', slug: 'pham' },
  { vi: 'Hoàng', slug: 'hoang' },
  { vi: 'Huỳnh', slug: 'huynh' },
  { vi: 'Phan', slug: 'phan' },
  { vi: 'Vũ', slug: 'vu' },
  { vi: 'Võ', slug: 'vo' },
  { vi: 'Đặng', slug: 'dang' },
  { vi: 'Bùi', slug: 'bui' },
  { vi: 'Đỗ', slug: 'do' },
  { vi: 'Hồ', slug: 'ho' },
  { vi: 'Ngô', slug: 'ngo' },
  { vi: 'Dương', slug: 'duong' },
  { vi: 'Lý', slug: 'ly' },
  { vi: 'Đinh', slug: 'dinh' },
  { vi: 'Trương', slug: 'truong' },
  { vi: 'Lương', slug: 'luong' },
  { vi: 'Mai', slug: 'mai' },
  { vi: 'Trịnh', slug: 'trinh' },
  { vi: 'Đoàn', slug: 'doan' },
  { vi: 'Đào', slug: 'dao' },
  { vi: 'Tạ', slug: 'ta' },
] as const;

const MIDDLE_NAMES: readonly NameEntry[] = [
  { vi: 'Minh', slug: 'minh' },
  { vi: 'Hoàng', slug: 'hoang' },
  { vi: 'Ngọc', slug: 'ngoc' },
  { vi: 'Thanh', slug: 'thanh' },
  { vi: 'Quốc', slug: 'quoc' },
  { vi: 'Đức', slug: 'duc' },
  { vi: 'Gia', slug: 'gia' },
  { vi: 'Bảo', slug: 'bao' },
  { vi: 'Anh', slug: 'anh' },
  { vi: 'Thu', slug: 'thu' },
  { vi: 'Phương', slug: 'phuong' },
  { vi: 'Hữu', slug: 'huu' },
  { vi: 'Xuân', slug: 'xuan' },
  { vi: 'Khánh', slug: 'khanh' },
  { vi: 'Tuấn', slug: 'tuan' },
  { vi: 'Thảo', slug: 'thao' },
  { vi: 'Hải', slug: 'hai' },
  { vi: 'Nhật', slug: 'nhat' },
  { vi: 'Trọng', slug: 'trong' },
  { vi: 'Thiên', slug: 'thien' },
] as const;

const FIRST_NAMES: readonly NameEntry[] = [
  { vi: 'Khôi', slug: 'khoi' },
  { vi: 'Trâm', slug: 'tram' },
  { vi: 'Tuấn', slug: 'tuan' },
  { vi: 'Hân', slug: 'han' },
  { vi: 'Quân', slug: 'quan' },
  { vi: 'Linh', slug: 'linh' },
  { vi: 'Thịnh', slug: 'thinh' },
  { vi: 'Châu', slug: 'chau' },
  { vi: 'Kiệt', slug: 'kiet' },
  { vi: 'Vy', slug: 'vy' },
  { vi: 'Phúc', slug: 'phuc' },
  { vi: 'Nhi', slug: 'nhi' },
  { vi: 'Đạt', slug: 'dat' },
  { vi: 'Ngân', slug: 'ngan' },
  { vi: 'Long', slug: 'long' },
  { vi: 'Trang', slug: 'trang' },
  { vi: 'Huy', slug: 'huy' },
  { vi: 'Quỳnh', slug: 'quynh' },
  { vi: 'Khang', slug: 'khang' },
  { vi: 'My', slug: 'my' },
  { vi: 'Dũng', slug: 'dung' },
  { vi: 'Thư', slug: 'thu' },
  { vi: 'Bách', slug: 'bach' },
  { vi: 'Yến', slug: 'yen' },
  { vi: 'Thành', slug: 'thanh' },
  { vi: 'Hương', slug: 'huong' },
  { vi: 'Sơn', slug: 'son' },
  { vi: 'Lan', slug: 'lan' },
  { vi: 'Vinh', slug: 'vinh' },
  { vi: 'Diệp', slug: 'diep' },
  { vi: 'Tùng', slug: 'tung' },
  { vi: 'Ánh', slug: 'anh' },
  { vi: 'Cường', slug: 'cuong' },
  { vi: 'Trúc', slug: 'truc' },
  { vi: 'Lâm', slug: 'lam' },
  { vi: 'Hiền', slug: 'hien' },
] as const;

const PHONE_PREFIXES = [
  '090',
  '091',
  '093',
  '097',
  '098',
  '086',
  '038',
  '039',
  '070',
  '079',
] as const;

const POSITION_TITLES: readonly string[] = [
  'Kỹ sư Phần mềm Backend',
  'Kỹ sư Phần mềm Frontend',
  'Chuyên viên Phát triển Mobile',
  'Chuyên viên An toàn Thông tin',
  'Kỹ sư Vận hành Hệ thống (SRE)',
  'Chuyên viên Nhân sự & Tuyển dụng',
  'Chuyên viên Kế toán Tổng hợp',
  'Chuyên viên Kinh doanh Doanh nghiệp',
  'Chuyên viên Hỗ trợ Khách hàng',
  'Chuyên viên Phân tích Nghiệp vụ (BA)',
  'Kỹ sư Kiểm thử Phần mềm (QA/QC)',
] as const;

export interface GeneratedRealisticUserSeed {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly phone: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly status: UserStatusCode;
  readonly primaryOrgId: number;
  readonly branchOrgId: number;
  readonly roleId: number;
  readonly positionTitle: string;
}

/**
 * Sinh danh sách `count` (mặc định 1.000) người dùng tên thật ngẫu nhiên có tính tất định (deterministic PRNG),
 * đảm bảo:
 * - ID đánh theo số thứ tự nguyên liên tiếp từ 11 đến 1010 (sau 10 tài khoản đặc quyền ID 1..10)
 * - Không bao giờ đặt tên kiểu `user1`, `user2`...
 * - Có đầy đủ `firstName`, `lastName` và `fullName`
 * - 100% email có đuôi `@gmail.com`
 * - Gán vào Chi nhánh TP.HCM (`BRANCH_HCM`) và các phòng ban tại TP.HCM
 * - Trạng thái nguyên: `1 = ACTIVE`, `2 = INACTIVE`, `3 = LOCKED`
 */
export function generateRealisticUsersDataset(
  count = TOTAL_REGULAR_USERS_COUNT,
): GeneratedRealisticUserSeed[] {
  const departmentOrgs = HCMC_ORGANIZATION_UNITS.filter(
    (o) => o.type === ORGANIZATION_UNIT_TYPE.DEPARTMENT,
  );
  const branchHcm = HCMC_ORGANIZATION_UNITS.find((o) => o.code === 'BRANCH_HCM')!;
  const staffRole = STANDARD_IAM_ROLES.find((r) => r.code === 'staff')!;
  const managerRole = STANDARD_IAM_ROLES.find((r) => r.code === 'department_manager')!;

  const results: GeneratedRealisticUserSeed[] = [];
  const usedUsernames = new Set<string>();

  // Bộ sinh số giả ngẫu nhiên LCG (Linear Congruential Generator) giúp tên phân tán tự nhiên
  let state = 20261015;
  const nextRand = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };

  for (let i = 0; i < count; i++) {
    const ln = LAST_NAMES[nextRand() % LAST_NAMES.length]!;
    const mn = MIDDLE_NAMES[nextRand() % MIDDLE_NAMES.length]!;
    const fn = FIRST_NAMES[nextRand() % FIRST_NAMES.length]!;

    const firstName = fn.vi.charAt(0).toUpperCase() + fn.vi.slice(1);
    const lastName = `${ln.vi} ${mn.vi}`;
    const fullName = `${lastName} ${firstName}`;

    // Tạo hậu tố số ngẫu nhiên tự nhiên (ví dụ: 79, 86, 92, 204...) thay vì số thứ tự 1, 2, 3
    let tagNumber = 101 + (nextRand() % 8990);
    let username = `${fn.slug}.${ln.slug}${mn.slug}${tagNumber}`;
    while (usedUsernames.has(username)) {
      tagNumber += 7;
      username = `${fn.slug}.${ln.slug}${mn.slug}${tagNumber}`;
    }
    usedUsernames.add(username);

    const email = `${username}@gmail.com`;
    const phonePrefix = PHONE_PREFIXES[nextRand() % PHONE_PREFIXES.length]!;
    const phoneRest = String(1000000 + (nextRand() % 8999999)).slice(0, 7);
    const phone = `${phonePrefix}${phoneRest}`;

    const dept = departmentOrgs[nextRand() % departmentOrgs.length]!;
    const positionTitle = POSITION_TITLES[nextRand() % POSITION_TITLES.length]!;
    const role = i % 25 === 0 ? managerRole : staffRole;

    const statusRoll = nextRand() % 100;
    const status: UserStatusCode =
      statusRoll < 88
        ? USER_STATUS.ACTIVE
        : statusRoll < 95
          ? USER_STATUS.INACTIVE
          : USER_STATUS.LOCKED;

    results.push({
      id: 11 + i,
      username,
      email,
      phone,
      firstName,
      lastName,
      fullName,
      status,
      primaryOrgId: dept.id,
      branchOrgId: branchHcm.id,
      roleId: role.id,
      positionTitle,
    });
  }

  return results;
}

/**
 * Seeder khởi tạo 1.000 người dùng thường tên thật tiếng Việt (`@gmail.com`, mật khẩu: `Abcd@454647#`)
 * trực thuộc Chi nhánh TP.HCM (`BRANCH_HCM`) và các phòng ban tại TP.HCM.
 */
export class IamThousandUsersSeeder implements SeederContract {
  public readonly name = 'IamThousandRealisticUsersSeeder';
  public readonly scope = 'development' as const;
  public readonly order = 25;

  private readonly passwordHasher = new PasswordHasherService();

  public async run(ctx: SeederContext): Promise<{ affected: number; details?: string }> {
    if (ctx.environment === 'production') {
      throw new Error('IamThousandUsersSeeder is strictly forbidden in production environment');
    }

    const users = generateRealisticUsersDataset(TOTAL_REGULAR_USERS_COUNT);
    const defaultPasswordHash = await this.passwordHasher.hash(REGULAR_USER_DEFAULT_PASSWORD);
    const isPostgres = ctx.driver === 'postgres';
    const batchSize = 100;
    let affected = 0;

    for (let offset = 0; offset < users.length; offset += batchSize) {
      const chunk = users.slice(offset, offset + batchSize);

      for (const u of chunk) {
        if (isPostgres) {
          await ctx.manager.query(
            `INSERT INTO users (id, username, email, phone, first_name, last_name, full_name, password_hash, status, primary_organization_unit_id, version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
             ON CONFLICT (username) DO NOTHING`,
            [
              u.id,
              u.username,
              u.email,
              u.phone,
              u.firstName,
              u.lastName,
              u.fullName,
              defaultPasswordHash,
              u.status,
              u.primaryOrgId,
            ],
          );
          await ctx.manager.query(
            `INSERT INTO user_roles (user_id, role_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, role_id) DO NOTHING`,
            [u.id, u.roleId],
          );
          await ctx.manager.query(
            `INSERT INTO user_organization_units (user_id, organization_unit_id, is_primary, position_title)
             VALUES ($1, $2, TRUE, $3), ($1, $4, FALSE, $3)
             ON CONFLICT (user_id, organization_unit_id) DO NOTHING`,
            [u.id, u.primaryOrgId, u.positionTitle, u.branchOrgId],
          );
        } else {
          await ctx.manager.query(
            `INSERT INTO users (id, username, email, phone, first_name, last_name, full_name, password_hash, status, primary_organization_unit_id, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE status = VALUES(status)`,
            [
              u.id,
              u.username,
              u.email,
              u.phone,
              u.firstName,
              u.lastName,
              u.fullName,
              defaultPasswordHash,
              u.status,
              u.primaryOrgId,
            ],
          );
          await ctx.manager.query(
            `INSERT INTO user_roles (user_id, role_id)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)`,
            [u.id, u.roleId],
          );
          await ctx.manager.query(
            `INSERT INTO user_organization_units (user_id, organization_unit_id, is_primary, position_title)
             VALUES (?, ?, TRUE, ?), (?, ?, FALSE, ?)
             ON DUPLICATE KEY UPDATE position_title = VALUES(position_title)`,
            [u.id, u.primaryOrgId, u.positionTitle, u.id, u.branchOrgId, u.positionTitle],
          );
        }
        affected++;
      }
    }

    // Seed lịch sử thay đổi trạng thái cho các user đang ở trạng thái INACTIVE (2) hoặc LOCKED (3)
    const countRows = (await ctx.manager.query(
      'SELECT COUNT(*) AS cnt FROM user_status_histories',
    )) as Array<{ cnt?: number | string }>;
    const existingHistoryCount = Number(countRows[0]?.cnt ?? 0);
    if (existingHistoryCount === 0) {
      const nonActiveUsers = users.filter((u) => u.status !== USER_STATUS.ACTIVE);
      for (const u of nonActiveUsers) {
        const reason =
          u.status === USER_STATUS.LOCKED
            ? 'Tạm khóa do nhập sai mật khẩu quá số lần quy định'
            : 'Tạm ngưng kích hoạt theo đề xuất của phòng Nhân sự';
        if (isPostgres) {
          await ctx.manager.query(
            `INSERT INTO user_status_histories (user_id, from_status, to_status, reason, changed_by)
             VALUES ($1, $2, $3, $4, 1)`,
            [u.id, USER_STATUS.ACTIVE, u.status, reason],
          );
        } else {
          await ctx.manager.query(
            `INSERT INTO user_status_histories (user_id, from_status, to_status, reason, changed_by)
             VALUES (?, ?, ?, ?, 1)`,
            [u.id, USER_STATUS.ACTIVE, u.status, reason],
          );
        }
      }
    }

    return {
      affected,
      details: `${affected} realistic Vietnamese users (IDs 11..1010, @gmail.com, pass: ${REGULAR_USER_DEFAULT_PASSWORD}) assigned to HCMC branch & departments`,
    };
  }
}
