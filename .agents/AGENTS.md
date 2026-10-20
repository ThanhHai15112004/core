# AGENTS.md — Quy Chuẩn & Bản Đồ Điều Hướng Kỹ Thuật (Core Chassis)

Tài liệu này là **Hiến pháp kỹ thuật cốt lõi** dành cho AI Assistants và Developers. Bản đặc tả chi tiết đầy đủ (cây thư mục 300 dòng, đặc tả 15 packages, 4 runtimes, CLI và System Console) được lưu trữ tại [architecture-spec.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/references/architecture-spec.md) để tra cứu theo nhu cầu (On-Demand), giúp tối ưu hóa ngữ cảnh và tiết kiệm token.

---

## 1. NGUYÊN TẮC THIẾT KẾ BẤT BIẾN (INVIOLABLE RULES)

1. **Core hoàn toàn độc lập với nghiệp vụ (Domain-Agnostic)**:
   - Tầng hạ tầng kỹ thuật nằm trong `packages/` (`kernel`, `config`, `http`, `database`, `logging`, `metrics`, `runtime`, `security`, `queue`, `messaging`, `cache`, `storage`, `http-client`, `i18n`).
   - **CẤM TUYỆT ĐỐI** viết business logic hoặc đặt Entity nghiệp vụ cụ thể (User, Order, Course...) vào `packages/`.
   - Mọi nghiệp vụ phải nằm trong `modules/<tên-module>/` hoặc `project-modules/<tên-module>/`.

2. **Modular Monolith & Bounded Context tự chủ (Microservices-Ready)**:
   - Mỗi module tự quản lý Entity, DTO, Repository, Service, Controller, Events riêng.
   - **CẤM TUYỆT ĐỐI**: Tạo Foreign Key vật lý xuyên module trong DB; KHÔNG inject Repository của module khác.
   - Giao tiếp đồng bộ chỉ thông qua Service/Facade export tại `index.ts`; ưu tiên giao tiếp bất đồng bộ qua Domain Events.

3. **Vị trí tệp kiểm thử (Test Separation)**:
   - **CẤM TUYỆT ĐỐI** đặt file test (`*.spec.ts`, `*.test.ts`) trong thư mục `src/`.
   - 100% kiểm thử phải đặt tại `test/` theo cấu trúc Coaching (`fixtures/`, `concerns/`, `unit/`, `feature/`).

4. **Quy chuẩn ESM & Config Fail-Fast**:
   - TypeScript ESM (`NodeNext`): relative import nội bộ bắt buộc có đuôi `.js` (vd: `import { x } from './helper.js'`).
   - KHÔNG đọc trực tiếp `process.env`, mọi cấu hình phải qua Zod schema validation tại `packages/config`.
   - Build production bắt buộc chạy `tsc-alias` để xử lý path alias (`@apps/*`, `@packages/*`, `@modules/*`, `@project-modules/*`).

5. **Chuẩn hóa Envelope Response & Exception**:
   - Thành công: `{ success: true, statusCode, data, meta?, timestamp }` (qua `TransformResponseInterceptor`).
   - Thất bại: `{ success: false, statusCode, error: { code, message, details? }, timestamp }` (qua `GlobalExceptionFilter`).

6. **Multi-Runtime Ready**:
   - Hệ thống có 4 entrypoint độc lập: `apps/api` (HTTP Fastify), `apps/worker` (BullMQ Processor), `apps/scheduler` (BullMQ Scheduler), `apps/cli` (CLI tool).

---

## 2. DANH MỤC MODULE NỀN TẢNG ĐÃ TỒN TẠI (CẤM TỰ Ý TẠO LẠI / LẶP CODE)

Hệ thống đã triển khai sẵn các Module Core trong `backend/src/modules/`. **BẮT BUỘC TÁI SỬ DỤNG** qua Public Contract/Registry hoặc khai báo trong `module.manifest.json`, **TUYỆT ĐỐI KHÔNG** tạo bảng/module mới trùng chức năng:

| Module (`src/modules/`) | Bảng DB sở hữu | Service / Registry tái sử dụng | Trách nhiệm cốt lõi |
| :--- | :--- | :--- | :--- |
| **`organizations`** | `organization_units` | `OrganizationsService`, `ORGANIZATIONS_PUBLIC_SERVICE` | Cây đơn vị tổ chức/phòng ban/chi nhánh (`parentId`, `path`), kiểm tra vòng lặp, chặn xóa khi còn đơn vị con/nhân sự. |
| **`roles`** | `roles`, `permissions`, `role_permissions` | `RolesService`, `ROLES_PUBLIC_SERVICE`, `DataScopeService`, `AuditLogService` | RBAC, đồng bộ quyền từ `module.manifest.json`, kiểm soát phạm vi dữ liệu (`ALL`, `ORG_UNIT`, `SUBORDINATES`, `SELF`), tra cứu Audit Log bất biến. |
| **`users`** | `users`, `user_roles`, `user_organization_units`, `user_status_histories` | `UsersService`, `USERS_PUBLIC_SERVICE` | Quản lý hồ sơ người dùng, đa vai trò, đa đơn vị (1 đơn vị chính), vòng đời trạng thái, Import/Export CSV & XLSX. |
| **`auth`** | `auth_sessions`, `auth_mfa_configs`, `auth_password_resets`, `auth_login_histories`, `auth_security_settings`, `auth_service_accounts` | `AuthService`, `SecuritySettingsService` | Đăng nhập JWT + Refresh Token rotation, MFA (TOTP, Email OTP, Recovery Code), chính sách mật khẩu, khóa tạm thời, Service Account / API Key. |
| **`codes`** | `code_types`, `code_values` | `CodeRegistryService` (`@packages/kernel`), `CodesService`, `CODES_PUBLIC_SERVICE` | **Từ điển Danh mục Động & Hybrid Enum**: Quản lý các tập giá trị lựa chọn/trạng thái/phân loại (`numericCode`, `code`, `behaviorCode`, `labels` đa ngôn ngữ, `aliases`). Khai báo qua mục `"codeTypes"` trong `module.manifest.json`. |
| **`settings`** | `setting_groups`, `system_settings`, `system_setting_scopes`, `system_setting_histories`, `feature_flags`, `feature_flag_histories` | `SettingRegistryService`, `FeatureFlagRegistryService` (`@packages/kernel`), `SettingsService`, `FeatureFlagsService`, `SETTINGS_PUBLIC_SERVICE`, `FEATURE_FLAGS_PUBLIC_SERVICE` | **Cấu hình Hệ thống Động (5.1) & Bật tắt Tính năng Feature Flags (5.2)**: Quản lý tham số runtime 5 tầng (`UNIT_ENV -> UNIT_ALL -> GLOBAL_ENV -> GLOBAL -> DEFAULT`), mã hóa `AES-256-GCM`; quản lý Feature Flag kiểm tra `enabledModules`, bật theo User/Role/OrgUnit/Rollout % (FNV-1a hash)/Time window (`startsAt`..`endsAt`), lịch sử thay đổi & Cache L1/L2. Khai báo qua `"settingGroups"`, `"settings"`, `"featureFlags"` trong `module.manifest.json`. |
| **`health` & `*-ops`** | *(Không tạo bảng nghiệp vụ)* | `HealthModule`, `SystemOpsModule`, `DatabaseOpsModule`, `CacheOpsModule`, `Queue/Worker/Scheduler/LogsOps` | Healthcheck (`/health`) và toàn bộ API vận hành cho System Console (`/ops/*`). |

> **⚠️ Phân biệt rõ 4 cơ chế tránh viết chồng chéo (`config` vs `codes` vs `settings` vs `featureFlags`)**:
> 1. **`@packages/config` (`CoreConfigService`)**: Chỉ đọc biến môi trường tĩnh từ `.env` lúc khởi động hạ tầng (DB host, Redis port, JWT secret).
> 2. **`modules/codes` (`CodeRegistryService`)**: Dùng cho **Danh mục lựa chọn / Trạng thái / Phân loại** (Dropdown, Status, Type có mã số nguyên `numericCode` và nhãn `vi`/`en`).
> 3. **`modules/settings` — Settings (`SettingRegistryService`)**: Dùng cho **Tham số cấu hình vận hành thay đổi được lúc chạy (Runtime Settings)** theo Môi trường / Đơn vị hoặc cần mã hóa Secret & ghi lịch sử thay đổi.
> 4. **`modules/settings` — Feature Flags (`FeatureFlagRegistryService` & `FeatureFlagsService`)**: Dùng cho **Bật/Tắt tính năng của module đã cài (`enabledModules`)** theo Người dùng (`targetUserIds`), Vai trò (`targetRoles`), Đơn vị (`targetOrganizationUnitIds`), Tỷ lệ người dùng (`rolloutPercentage` $0..100\%$) và Khung thời gian thử nghiệm (`startsAt`..`endsAt`).
> 5. **Quét `module.manifest.json` tập trung**: Mọi logic đọc danh sách `module.manifest.json` trên đĩa bắt buộc gọi hàm dùng chung `scanModuleManifests()` và `discoverInstalledModules()` từ `@packages/kernel`, không tự viết lại vòng lặp `readdirSync`/`readFileSync`.

---

## 3. BẢN ĐỒ TRA CỨU TÀI LIỆU & SKILLS (ON-DEMAND REFERENCES)

AI Assistant **chỉ đọc thêm tài liệu/skill chi tiết khi task thực sự yêu cầu**, không tự ý nạp trước:

- **Cấu trúc thư mục chuẩn & Đặc tả chi tiết 15 Packages / 4 Runtimes / Console Ops**:
  👉 Đọc file: [architecture-spec.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/references/architecture-spec.md) hoặc kích hoạt skill `system-architecture-overview`.
- **Quy chuẩn Manifest, CLI & Ranh giới Module**:
  👉 Đọc file: [core-architecture-standards.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/rules/core-architecture-standards.md) hoặc kích hoạt skill `architecture-codebase`.
- **Sổ tay bài học kinh nghiệm & Bẫy lỗi cấm kỵ (Pitfalls)**:
  👉 Đọc file: [lessons-learned-and-pitfalls.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/rules/lessons-learned-and-pitfalls.md).
- **Quy tắc thực thi, phân cấp task & ngân sách kiểm thử**:
  👉 Đọc file: [core-development-rule.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/rules/core-development-rule.md).
- **Sổ tay tổng hợp các câu lệnh thường dùng (Dev, Test, CLI, Docker, CodeGraph)**:
  👉 Đọc file: [common-commands.md](file:///home/thanhhai/myProjects/CoreProjects/core/.agents/common-commands.md).
- **Đồ thị tri thức mã nguồn (CodeGraph — `.codegraph/codegraph.db`)**:
  👉 Ưu tiên dùng lệnh `codegraph explore`, `codegraph node`, `codegraph query`, `codegraph impact`, `codegraph affected` để tra cứu symbol, luồng gọi (callers/callees) và phân tích tác động thay vì đọc/grep thủ công nhiều tệp; chạy `codegraph sync` sau khi sửa code.

