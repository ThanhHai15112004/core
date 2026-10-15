# Hướng Dẫn & Kiến Trúc Kiểm Thử (Testing Architecture — 2.7 Testing Foundation)

Thư mục `test/` được tổ chức tách biệt hoàn toàn khỏi `src/`, tuân theo chuẩn phân tầng kiểm thử chuyên nghiệp:

```text
backend/test/
├── README.md                                  # Tài liệu hướng dẫn kiến trúc kiểm thử
├── setup-env.ts                               # Khởi tạo biến môi trường cô lập trước khi chạy Jest
├── fixtures/                                  # Dữ liệu mẫu, Factory & env mock phục vụ test
│   ├── env.fixture.ts                         # Bộ biến môi trường mock chuẩn (core_test)
│   └── data-factory.fixture.ts                # Generic DataFactory<T>, defineFactory(), userIdentityFactory
├── concerns/                                  # Helpers / Traits dùng chung cho test cases
│   ├── test-app.concern.ts                    # Khởi tạo NestFastifyApplication & injectJson() E2E client
│   ├── test-database.concern.ts               # Chốt an toàn DB test (assertSafeTestDatabase) & withRollbackTransaction()
│   ├── permission.concern.ts                  # Helper kiểm thử RBAC: actingAs() & assertEndpointAuthMatrix()
│   ├── prometheus.concern.ts                  # Stub dữ liệu Prometheus cho các bài test vận hành
│   └── coverage-reporter.concern.ts           # Tổng hợp báo cáo độ phủ mã nguồn theo từng Package & Module
├── unit/                                      # Unit tests cô lập (*.spec.ts)
│   └── testing/
│       └── testing-foundation.spec.ts         # Kiểm thử đơn vị cho DataFactory, DB Safety Guard & Coverage Reporter
├── integration/                               # Integration tests phối hợp đa tầng (*.integration-spec.ts)
│   └── database-and-seeding.integration-spec.ts
└── feature/                                   # Feature / API E2E tests qua Fastify inject (*.feature-spec.ts)
    └── api/
        └── security/
            └── auth-rbac.feature-spec.ts      # Kiểm thử E2E cho AuthGuard, @Public, @RequireRoles, @RequirePermissions
```

---

## 1. Nguyên Tắc Cốt Lõi

1. **Tuyệt đối không để file test trong `src/`**:
   - Thư mục `src/` chỉ chứa mã nguồn chạy production. Mọi file `*.spec.ts`, `*.integration-spec.ts`, `*.feature-spec.ts` bắt buộc đặt trong `test/`.
2. **Cơ sở dữ liệu an toàn (Database Safety Guard)**:
   - Tất cả các thao tác kết nối/làm sạch DB trong test bắt buộc đi qua `assertSafeTestDatabase()` (`NODE_ENV=test` và tên DB phải là `core_test`, `*_test`, `test_*` hoặc `:memory:`).
   - Sử dụng `withRollbackTransaction(dataSource, async (em) => ...)` để tự động rollback dữ liệu sau mỗi bài test.
3. **Factory & Permission Helper chuẩn hóa**:
   - Sử dụng `defineFactory<T>((seq) => ...)` từ `fixtures/data-factory.fixture.ts` để tạo dữ liệu mẫu.
   - Sử dụng `actingAs(app, { roles, permissions })` và `assertEndpointAuthMatrix(app, options)` từ `concerns/permission.concern.ts` để kiểm tra phân quyền RBAC trên các API.

---

## 2. Các Lệnh Thực Thi Kiểm Thử (WSL2 / Linux Bash)

Chạy trong thư mục `backend` (hoặc từ thư mục gốc workspace):

```bash
# Chạy toàn bộ test suite (Unit + Integration + Feature E2E)
npm test

# Chạy riêng Unit tests
npm run test:unit

# Chạy riêng Integration tests
npm run test:integration

# Chạy riêng Feature / API E2E tests
npm run test:feature
npm run test:e2e

# Chạy đo độ phủ mã nguồn tổng thể
npm run test:cov

# Chạy đo độ phủ mã nguồn kèm bảng thống kê chi tiết theo từng Module & Package
npm run test:cov:module
```
