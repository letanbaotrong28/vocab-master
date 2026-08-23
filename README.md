# 🚀 VocabMaster - Ứng Dụng Học Từ Vựng Tiếng Anh Thông Minh

VocabMaster là ứng dụng web học từ vựng tiếng Anh hiện đại, kết hợp Flashcards, Trắc nghiệm 4 đáp án, Luyện gõ từ và Theo dõi tiến trình trực quan. Khách có thể xem trang chủ và bộ mẫu; mọi thao tác tạo, sửa, xóa, nhập dữ liệu hoặc học bài đều yêu cầu đăng nhập. Bộ từ, tiến trình và chuỗi ngày học được lưu riêng theo từng tài khoản trên Backend SQL (SQLite hoặc Cloud PostgreSQL).

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
JWT_SECRET=replace_with_a_private_random_secret_of_at_least_32_bytes
CLIENT_ORIGIN=http://localhost:5173
DATABASE_URL=
PGSSLMODE=require
PGSSL_STRICT=true
SQLITE_DB_PATH=
REQUEST_BODY_LIMIT=10mb
TRUST_PROXY=loopback,linklocal,uniquelocal
VITE_API_URL=
```

> 💡 **Ghi chú CSDL**:
> - Nếu để trống `DATABASE_URL`, ứng dụng tự động dùng **SQLite Cục bộ** (`server/database.db`) tích hợp sẵn chế độ **WAL mode** siêu tốc.
> - Nếu cung cấp `DATABASE_URL` (Supabase, Neon, Render Postgres), server sẽ kết nối trực tiếp CSDL PostgreSQL đám mây.
> - `CLIENT_ORIGIN` là danh sách origin frontend được phép, phân tách bằng dấu phẩy nếu có nhiều origin. Production từ chối origin ngoài danh sách này.
> - Kết nối PostgreSQL kiểm tra chứng chỉ TLS theo mặc định. Chỉ đặt `PGSSL_STRICT=false` khi nhà cung cấp yêu cầu chứng chỉ tự ký và bạn hiểu rủi ro.
> - `SQLITE_DB_PATH` cho phép dùng một file SQLite khác; để trống sẽ dùng `server/database.db`.
> - `JWT_SECRET` là bắt buộc và phải có ít nhất 32 byte. Có thể tạo bằng `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`; không dùng giá trị mẫu khi deploy.
> - `TRUST_PROXY` chỉ nên chứa các dải mạng proxy đáng tin cậy. Giá trị mặc định phù hợp proxy nội bộ của Render; với nhà cung cấp khác, dùng CIDR do họ công bố, không dùng số hop chung chung.
> - Các file SQLite `*.db-wal`, `*.db-shm` và `*.db-journal` là dữ liệu tạm và đã được loại khỏi Git.

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
- **Environment Variables**: Thiết lập `NODE_ENV=production`, `JWT_SECRET`, `NODE_VERSION=20.19.0`, `CLIENT_ORIGIN` và `DATABASE_URL` (nếu dùng Cloud Postgres).
- Khi frontend và backend cùng một Render Web Service, để `VITE_API_URL` trống. Nếu frontend nằm ở domain khác, đặt `CLIENT_ORIGIN` đúng domain frontend và cấu hình `VITE_API_URL` hoặc proxy `/api` tương ứng.
- Render phải chạy cả bước build; server sẽ phục vụ trực tiếp thư mục `dist`. HTML được gửi với `no-store`, còn asset có hash được cache immutable để tránh trang trắng sau deploy.

---

## 💾 Tự Động Backup & Restore CSDL

Hệ thống hỗ trợ Endpoint tải bản sao lưu CSDL SQLite cục bộ:
- **Tải File Backup**: GET `/api/admin/backup` (yêu cầu phiên đăng nhập bằng cookie `HttpOnly` và quyền quản trị)
- Tài khoản phải có cờ `is_admin` trong bảng `users`; riêng tên đăng nhập `admin` không tự cấp quyền quản trị.

---

## 🏛️ Kiến Trúc Hệ Thống (Architecture Overview)

- **Frontend**: React 19, Vite 8, Lucide React, Canvas Confetti.
- **Backend**: Express 5, SQLite3 / PostgreSQL (`pg`), JSON Web Token (JWT), Helmet Security.
- **State & Router**: Context API + `useMemo` optimization, auth-gate tập trung và Single-Page Hash Router (`#learn/set-id`).
- **Authentication**: Cookie `HttpOnly`; khách luôn có streak `0`; streak tài khoản chỉ tăng khi một kết quả học được lưu thành công.
- **Data Safety**: Dual SQLite & PostgreSQL migrations, composite ownership constraints, graceful shutdown và React ErrorBoundary fallback.
