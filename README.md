# 🚀 VocabMaster - Ứng Dụng Học Từ Vựng Tiếng Anh Thông Minh

VocabMaster là ứng dụng web học từ vựng tiếng Anh hiện đại, kết hợp trải nghiệm Flashcards linh hoạt, Trắc nghiệm 4 đáp án, Luyện gõ từ và Theo dõi tiến trình trực quan. Hệ thống hỗ trợ lưu trữ Offline qua `localStorage` và đồng bộ tài khoản tự động qua Server Backend SQL (SQLite & Cloud PostgreSQL).

---

## 🛠️ Yêu Cầu Hệ Thống (Environment Requirements)

- **Node.js**: Phiên bản `^20.19.0` hoặc `>= 22.12.0` (phù hợp với Vite 8).
- **Package Manager**: `npm` v10+

---

## ⚙️ Cài Đặt (Installation)

1. **Clone repository về máy**:
   ```bash
   git clone https://github.com/letan01012006/vocab-master.git
   cd vocab-master
   ```

2. **Cài đặt các thư viện (Dependencies)**:
   ```bash
   npm install
   ```

---

## 🌐 Cấu Hình Biến Môi Trường (`.env`)

Sao chép file mẫu `.env.example` thành `.env` tại thư mục gốc:

```bash
cp .env.example .env
```

Nội dung cấu hình mẫu `.env`:
```env
PORT=5000
JWT_SECRET=your_secret_jwt_key_vocabmaster
CLIENT_ORIGIN=http://localhost:5173
DATABASE_URL=
PGSSLMODE=require
PGSSL_STRICT=true
SQLITE_DB_PATH=
VITE_API_URL=
```

> 💡 **Ghi chú CSDL**:
> - Nếu để trống `DATABASE_URL`, ứng dụng tự động dùng **SQLite Cục bộ** (`server/database.db`) tích hợp sẵn chế độ **WAL mode** siêu tốc.
> - Nếu cung cấp `DATABASE_URL` (Supabase, Neon, Render Postgres), server sẽ kết nối trực tiếp CSDL PostgreSQL đám mây.
> - `CLIENT_ORIGIN` là danh sách origin frontend được phép, phân tách bằng dấu phẩy nếu có nhiều origin. Production từ chối origin ngoài danh sách này.
> - Kết nối PostgreSQL kiểm tra chứng chỉ TLS theo mặc định. Chỉ đặt `PGSSL_STRICT=false` khi nhà cung cấp yêu cầu chứng chỉ tự ký và bạn hiểu rủi ro.
> - `SQLITE_DB_PATH` cho phép dùng một file SQLite khác; để trống sẽ dùng `server/database.db`.

---

## 🚀 Hướng Dẫn Chạy Ứng Dụng (Running Locally)

Ứng dụng gồm 2 phần: Frontend Client (Vite Port 5173) và Backend Server (Express Port 5000).

### Chạy song song cả Server và Web App:

1. **Khởi động Backend Server**:
   ```bash
   npm run server
   ```

2. **Khởi động Frontend Vite (trên cửa sổ Terminal mới)**:
   ```bash
   npm run dev
   ```

Mở trình duyệt truy cập: `http://localhost:5173`

---

## 🧪 Kiểm Thử Tự Động (Testing) & Linter

Chạy bộ kiểm thử đơn vị (Unit Tests):
```bash
npm test
```

Chạy kiểm tra cú pháp mã nguồn (Linter):
```bash
npm run lint
```

---

## 📦 Đóng Gói (Build) & Triển Khai (Deploy)

### 1. Đóng gói Production Bundle:
```bash
npm run build
```
Thư mục xuất file sản phẩm: `./dist`

### 2. Triển khai lên Render.com / Netlify:
- **Build Command**: `npm run build`
- **Start Command**: `npm run server`
- **Environment Variables**: Thiết lập `JWT_SECRET`, `NODE_VERSION=20.19.0`, `CLIENT_ORIGIN` và `DATABASE_URL` (nếu dùng Cloud Postgres).

---

## 💾 Tự Động Backup & Restore CSDL

Hệ thống hỗ trợ Endpoint tải bản sao lưu CSDL SQLite cục bộ:
- **Tải File Backup**: GET `/api/admin/backup` (Yêu cầu đăng nhập Header `Authorization: Bearer <TOKEN>`)
- Tài khoản phải có cờ `is_admin` trong bảng `users`; riêng tên đăng nhập `admin` không tự cấp quyền quản trị.

---

## 🏛️ Kiến Trúc Hệ Thống (Architecture Overview)

- **Frontend**: React 19, Vite 8, Lucide React, Canvas Confetti.
- **Backend**: Express 5, SQLite3 / PostgreSQL (`pg`), JSON Web Token (JWT), Helmet Security.
- **State & Router**: Context API + `useMemo` optimization, Single-Page Hash Router (`#learn/set-id`).
- **Data Safety**: Dual SQLite & PostgreSQL support, Graceful Shutdown handler, React ErrorBoundary fallback screen.
