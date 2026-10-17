# Dola Studio — cài trên máy mới

> Nếu bạn đang dùng thư mục tích hợp `StoryDola` (StoryAI chạy cùng các trang Dola), hãy làm theo [`../HUONG_DAN_WINDOWS.md`](../HUONG_DAN_WINDOWS.md) và chạy lệnh từ thư mục gốc. Hướng dẫn dưới đây chỉ dành cho gói Dola Studio độc lập `Dola-tool-backup-*.zip`.

Tài liệu này dành cho bản mã nguồn trong file `Dola-tool-backup-*.zip`. Gói có ứng dụng Studio, Dola Render Gateway, extension Chromium và mẫu cấu hình. Nó không kèm phiên đăng nhập hay dữ liệu cá nhân từ máy cũ.

## 1. Phần mềm cần cài

- macOS hoặc Linux. Máy Windows dùng WSL2/Ubuntu.
- Node.js **20.9 trở lên** và npm.
- Python **3.11 trở lên**.
- FFmpeg nên được cài để Gateway xử lý đường tải dự phòng khi video hoàn tất.
- Kết nối Internet để tải các thư viện, Chromium và truy cập MaiVideo/Dola.

Gateway tự động mở Chromium qua Patchright; không cần chép thư mục profile Chrome cũ.

Workspace Windows x64 này có kèm Chromium tương ứng trong `dola-render-gateway/browsers/chromium-1243`; khi thư mục dự án được sao chép đầy đủ, Gateway tự dùng bản này và không cần tải Chromium riêng trên từng máy Windows. Bản Chromium này không chạy trong WSL/Linux hoặc macOS. Máy mới vẫn cần cài Node.js, Python và các thư viện của dự án.

## 2. Giải nén và tạo cấu hình

Giải nén ZIP. Mở Terminal, vào thư mục `Dola` vừa giải nén rồi tạo hai file cấu hình cục bộ:

```sh
cp .env.example .env.local
cp dola-render-gateway/.env.example dola-render-gateway/.env
```

Tạo ba giá trị bí mật riêng cho máy mới:

```sh
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Mở `.env.local` và `dola-render-gateway/.env`, điền như sau:

| Biến | Điền ở đâu | Cách dùng |
| --- | --- | --- |
| `DOLA_GATEWAY_ADMIN_KEY` | `.env.local` | Dán giá trị bí mật thứ nhất. |
| `DOLA_ADMIN_KEY` | `dola-render-gateway/.env` | Dán đúng giá trị thứ nhất. Hai giá trị phải khớp để quản lý profile. |
| `DOLA_TASK_OWNER_SECRET` | `.env.local` | Dán giá trị bí mật thứ hai; giữ nguyên sau khi bắt đầu tạo job. |
| `DOLA_GATEWAY_API_KEY` | `.env.local` | Tùy chọn. Chỉ đặt nếu bật `DOLA_API_KEYS` ở Gateway. |
| `DOLA_API_KEYS` | `dola-render-gateway/.env` | Tùy chọn. Nếu bật, đặt cùng key với `DOLA_GATEWAY_API_KEY`. |

Nếu muốn bật xác thực API nội bộ, dùng giá trị bí mật thứ ba cho cả `DOLA_GATEWAY_API_KEY` và `DOLA_API_KEYS`. Không gửi các key này trong chat hoặc đưa chúng vào ZIP.

Nếu dùng proxy riêng cho kết nối Dola, đặt `DOLA_PROXY` trong file Gateway, ví dụ `http://127.0.0.1:7890`. Nếu không dùng proxy cục bộ, để `DOLA_PROXY=` trống để Gateway dùng kết nối mạng mặc định của máy. Profile có cấu hình proxy riêng sẽ tiếp tục ưu tiên proxy của profile.

Các giá trị MaiVideo trong mẫu đã trỏ tới `https://maivideo.top`; model ảnh chì mặc định là Nano Banana 2. `MAIVIDEO_API_KEY` không bắt buộc nếu bạn đăng nhập MaiVideo trong Studio.

## 3. Cài dependency

Tại thư mục gốc `Dola`:

```sh
npm ci
python3 -m venv dola-render-gateway/.venv
dola-render-gateway/.venv/bin/python -m pip install --upgrade pip
dola-render-gateway/.venv/bin/python -m pip install -r dola-render-gateway/requirements.txt
dola-render-gateway/.venv/bin/patchright install chromium
```

Trên máy Mac nếu cài bằng Homebrew, có thể dùng `brew install node python@3.11 ffmpeg`. Trên Linux, cài Node.js 20.9+, Python 3.11+, `python3-venv` và FFmpeg từ trình quản lý gói phù hợp với bản Linux.

## 4. Khởi động và đăng nhập

Từ thư mục `Dola`, chạy:

```sh
npm run dev
```

Mở **http://127.0.0.1:3107**. Giữ Terminal đang chạy để theo dõi log Studio. Launcher sẽ mở Dola Gateway trên cổng 8200 và dùng lại Gateway hiện có nếu cổng đó đã được chiếm.

1. Khi mở Studio bằng `localhost` hoặc `127.0.0.1`, không cần đăng nhập MaiVideo.
2. Mở **Tài khoản Seedance** và đăng nhập/thêm lại từng profile Dola cần dùng.
3. Nếu cần tạo API key cho người dùng, mở **Cài đặt → API cá nhân** sau khi đăng nhập.

ZIP không mang theo phiên tài khoản. Máy mới cần đăng nhập lại MaiVideo/Dola và thêm proxy riêng nếu cần.

## 5. Cập nhật và tạo bản backup tiếp theo

Để cài lại đúng dependency theo lockfile, chạy `npm ci`. Để tạo ZIP sạch từ workspace đang mở, chạy:

```sh
python3 scripts/create_portable_backup.py
```

Mặc định file mới nằm trong `backups/`. Có thể truyền đường dẫn khác:

```sh
python3 scripts/create_portable_backup.py --output /duong/dan/Dola-backup.zip
```

## Dữ liệu không nằm trong ZIP

Gói cố ý loại trừ `.env`/`.env.local`, API key và token, cookie, thư mục profile `accounts/`, credential vault, database job/API key, video tải về, log, Git history, `node_modules`, `.venv` và build cache. Trên máy mới, ứng dụng bắt đầu với dữ liệu và profile trống; đăng nhập lại thay vì chép nguyên các file phiên.

ZIP chứa mã nguồn và lockfile, không nhúng Node.js, Python, thư viện npm/PyPI hay Chromium. Lần cài đầu cần Internet để tải các thành phần này. Windows native chưa được launcher Studio hỗ trợ; dùng WSL2/Ubuntu.
