# Core

Dự án **Core** - Cấu trúc nền tảng sử dụng Node.js & TypeScript.

---

## 📁 Cấu trúc thư mục (Directory Structure)

```text
.
├── backend/            # NestJS Backend Application
│   ├── src/            # Mã nguồn chính
│   ├── test/           # Unit & E2E Tests
│   └── package.json    # Package dependencies
├── frontend/           # Frontend Application (React)
├── .gitignore          # Cấu hình danh sách các file/thư mục git bỏ qua
└── README.md           # Tài liệu hướng dẫn dự án
```

---

## 🚀 Cài đặt & Khởi chạy Backend (Backend Getting Started)

### 1. Truy cập thư mục Backend
```bash
cd backend
```

### 2. Cài đặt phụ thuộc (Install Dependencies)
```bash
npm install
```

---

## 🛠 Lệnh có sẵn cho Backend (Available Scripts)

Trong thư mục `backend/`, bạn có thể thực hiện các lệnh sau:

- **Chế độ phát triển (`npm run dev` hoặc `npm run start:dev`)**:  
  Khởi chạy NestJS ở chế độ Watch mode (tự động reload khi sửa code).
  ```bash
  npm run dev
  # hoặc
  npm run start:dev
  ```

- **Biên dịch TypeScript (`npm run build`)**:  
  Biên dịch các file mã nguồn `.ts` trong thư mục `src/` sang mã JavaScript trong thư mục `dist/`.
  ```bash
  npm run build
  ```

- **Khởi chạy sản phẩm (`npm start`)**:  
  Chạy ứng dụng bằng Node.js từ thư mục `dist/main.js`.
  ```bash
  npm start
  ```

---

## 📄 Giấy phép (License)
ISC License
