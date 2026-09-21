# Hướng Dẫn & Kiến Trúc Kiểm Thử (Testing Architecture)

Thư mục `test/` được tổ chức tách biệt hoàn toàn khỏi `src/`, tuân theo chuẩn phân tầng kiểm thử chuyên nghiệp (lấy cảm hứng từ cấu trúc test của hệ thống Coaching):

```text
backend/test/
├── README.md                      # Tài liệu hướng dẫn này
├── fixtures/                      # Dữ liệu mẫu, env mock phục vụ test
│   └── env.fixture.ts             # Bộ biến môi trường mock chuẩn cho unit test
├── concerns/                      # Helpers / Traits dùng chung cho test cases
│   └── test-app.concern.ts        # Helper khởi tạo NestFastifyApplication cho Feature tests
├── unit/                          # Unit tests (cô lập, không I/O nặng)
│   ├── config/
│   │   └── config.spec.ts         # Kiểm thử env() helper fail-fast, CoreConfigService
│   ├── logging/
│   │   └── redact.util.spec.ts    # Kiểm thử tiện ích che dữ liệu nhạy cảm
│   └── services/
│       └── health.service.spec.ts # Kiểm thử HealthService logic
└── feature/                       # Feature / API tests (tương đương tests/Feature/Api)
    └── api/
        └── health/
            └── health.feature-spec.ts # Kiểm thử endpoint GET /health qua Fastify inject
```

---

## 1. Nguyên Tắc Cốt Lõi

1. **Tuyệt đối không để file test trong `src/`**:
   - Thư mục `src/` chỉ chứa mã nguồn chạy production. Mọi file `*.spec.ts`, `*.test.ts`, `*.feature-spec.ts` bắt buộc đặt trong `test/`.
2. **Cơ sở dữ liệu an toàn (Database Safety)**:
   - Tất cả các bài test kết nối DB (nếu có) PHẢI trỏ đến database test (`core_test` hoặc `:memory:` SQLite), tuyệt đối không trỏ vào database chính.
3. **Fail-Fast Configuration**:
   - `env()` helper sẽ văng lỗi `[ConfigError]` ngay lập tức nếu thiếu biến môi trường cần thiết, không dùng fallback ngầm để tránh lỗi tiềm ẩn.

---

## 2. Các Lệnh Thực Thi Kiểm Thử (WSL2 / Linux Bash)

Chạy trong thư mục `backend`:

```bash
# Chạy toàn bộ test suite
npm test

# Chạy riêng Unit tests
npm run test:unit

# Chạy riêng Feature tests
npm run test:feature

# Chạy kiểm thử có theo dõi thay đổi (Watch mode)
npm run test:watch

# Chạy đo độ phủ mã nguồn (Coverage)
npm run test:cov
```
