# Core

Dự án **Core** - Cấu trúc nền tảng sử dụng Node.js & TypeScript.

---

## 📁 Cấu trúc thư mục (Directory Structure)

```text
.
├── src/
│   └── main.ts         # Điểm khởi chạy chính của ứng dụng
├── .gitignore          # Cấu hình danh sách các file/thư mục git bỏ qua
├── .nvmrc              # Cấu hình phiên bản Node.js cho NVM
├── .node-version       # Cấu hình phiên bản Node.js
├── package.json        # Danh sách phụ thuộc và scripts
├── package-lock.json   # Quản lý phiên bản chi tiết phụ thuộc
├── tsconfig.json       # Cấu hình trình biên dịch TypeScript
└── README.md           # Tài liệu hướng dẫn dự án
```

---

## 🚀 Cài đặt & Khởi chạy (Installation & Getting Started)

### 1. Yêu cầu hệ thống (Prerequisites)
- **Node.js**: v22.x (hoặc theo phiên bản trong `.nvmrc`)
- **npm**: v10.x trở lên

### 2. Cài đặt phụ thuộc (Install Dependencies)
```bash
npm install
```

---

## 🛠 Lệnh có sẵn (Available Scripts)

Trong dự án, bạn có thể thực hiện các lệnh sau:

- **Biên dịch TypeScript (`npm run build`)**:  
  Biên dịch các file mã nguồn `.ts` trong thư mục `src/` sang mã JavaScript trong thư mục `dist/`.
  ```bash
  npm run build
  ```

- **Khởi chạy ứng dụng (`npm start`)**:  
  Chạy ứng dụng bằng Node.js từ thư mục `dist/main.js`.
  ```bash
  npm start
  ```

- **Chế độ phát triển (`npm run dev`)**:  
  Biên dịch TypeScript tự động khi có thay đổi trong file mã nguồn.
  ```bash
  npm run dev
  ```

---

## 📄 Giấy phép (License)
ISC License
