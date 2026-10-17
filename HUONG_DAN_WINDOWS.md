# Chuyển StoryAI-Dola sang Windows

Có thể chạy toàn bộ ứng dụng trực tiếp trên Windows bằng Node.js và Python. Workspace này kèm Chromium Windows x64 tương thích với Patchright; lệnh setup sẽ dùng bản trong thư mục dự án nên không cần cài Chromium riêng trên từng máy Windows.

Trên mỗi máy mới, cài Node.js 20.9+, Python 3.11+ và kết nối Internet. Mở PowerShell tại thư mục dự án rồi chạy:

```powershell
npm run setup:local
npm start
```

Lệnh `npm start` mở StoryAI cùng các màn hình Dola tại [http://localhost:3021](http://localhost:3021), và Dola Gateway tại [http://localhost:8210](http://localhost:8210). Giao diện Dola đã nằm trong StoryAI; chỉ dùng `npm run dev:dola` khi cần mở Dola Studio riêng tại cổng 3117.

`npm run setup:local` cài dependency Node.js/Python, tạo cấu hình riêng cho máy này và dùng Chromium đã đóng gói. Vì vậy không cần tải Chromium riêng; lần setup đầu vẫn cần Internet để tải thư viện npm/PyPI. Không chép `.env.local`, profile Chromium, database hay thông tin đăng nhập từ máy cũ sang gói portable. Gói portable chỉ hỗ trợ Chromium Windows x64; WSL/Linux cần cài Chromium Linux riêng.

## Tạo ứng dụng Windows `.exe` portable

Trên máy build đã chạy `npm run setup:local` và có `ffmpeg.exe`, `ffprobe.exe`, `ffplay.exe` trong `PATH` (hoặc đặt `ffmpeg.exe` và `ffprobe.exe` ở thư mục gốc dự án), chạy:

```powershell
npm run build:windows-app
```

Build tạo `release/StoryDola-Windows-v<version>/StoryDola.exe` và ZIP phiên bản `release/StoryDola-Windows-v<version>.zip`. Gửi **toàn bộ ZIP** sang máy Windows x64, giải nén hết rồi mở `StoryDola.exe`; không chép riêng file `.exe`. Gói gồm Node.js, Python cùng dependency của Gateway, FFmpeg và FFprobe ở thư mục gốc, FFplay trong `runtime/ffmpeg/bin`, cùng Chromium. Máy đích không cần cài riêng các runtime này; launcher cần .NET Framework 4.8 trở lên.

Launcher mở trình duyệt ở cổng 3021 và giữ các dịch vụ local chạy khi cửa sổ launcher mở. Trước khi chạy, launcher tự dừng tiến trình đang chiếm cổng Gateway 8210; cùng cơ chế này được dùng bởi `npm start`. Đóng cửa sổ launcher để dừng các tiến trình do ứng dụng khởi chạy. Khóa API được cấu hình riêng trong `.env.local` sau lần chạy đầu. Các profile Dola, thông tin đăng nhập, database và log của máy build không được đưa vào gói.

### Cập nhật máy đã cài

Launcher có hai nút cập nhật. Chọn **Tải cập nhật** để mở trực tiếp ZIP của GitHub Release mới nhất trong trình duyệt mặc định; nếu GitHub yêu cầu, hãy đăng nhập bằng tài khoản có quyền đọc repository. Tải xong, quay lại launcher, chọn **Cài từ ZIP** rồi chọn file vừa tải. StoryDola dừng dịch vụ, cập nhật chương trình ngay trong thư mục hiện tại rồi mở lại. `.env*`, `data/`, log, database, profile trong `dola-studio/dola-render-gateway/accounts/` và nội dung tải về được giữ nguyên trên máy.

Repository GitHub của StoryDola là riêng tư. Máy nhận cập nhật cần đăng nhập GitHub trong trình duyệt mặc định và tài khoản đó cần được cấp quyền đọc repository. Không lưu GitHub token trong `.exe` hoặc trong source. Build vẫn tạo ZIP có tên phiên bản. Khi phát hành phiên bản mới, tạo GitHub Release với tag trùng version trong `package.json`, rồi đặt tên asset khi tải lên chính xác là `StoryDola-Windows-latest.zip`; đường dẫn này được launcher dùng để tải bản mới nhất trực tiếp.

Để tạo ZIP mã nguồn gọn chuyển sang máy khác, chạy `npm run package:portable`. Để backup cả project, kịch bản và media trong `data/`, chạy `npm run package:portable -- --include-data --output backups/StoryDola-Windows-Backup.zip`. Gói đầy đủ dữ liệu vẫn loại profile đăng nhập Dola trong `dola-studio/dola-render-gateway/accounts/`, `data/accounts/`, `data/profiles/`, danh sách tài khoản Seedance, API key MaiVideo, thông tin đăng nhập/cấu hình bí mật, database, log, cache npm, `release`, `node_modules` và môi trường ảo Python; Chromium Windows x64 cùng mã nguồn được đưa vào ZIP. Máy nhận ZIP cần cài Node.js/Python và chạy `npm run setup:local` một lần; nhập lại API key trong cấu hình riêng của máy đó.

FFmpeg không bắt buộc để mở ứng dụng; một số luồng xử lý media cần cài thêm. Profile Dola và phiên đăng nhập không được chép theo ZIP, nên đăng nhập lại trên máy nhận. Các tác vụ tạo media cần API key dịch vụ tương ứng; ứng dụng local không cần đăng nhập MaiVideo chỉ để mở giao diện. Chức năng lấy transcript từ URL còn cần dịch vụ `htmlvideo` riêng ở cổng 3000.

## Tùy chọn: chạy trong WSL2/Ubuntu

Các bước dưới đây chỉ cần nếu bạn muốn chạy môi trường Linux qua WSL2.

### 1. Cài WSL2 và Ubuntu

Mở PowerShell với quyền Administrator:

```powershell
wsl --install -d Ubuntu
wsl --update
```

Khởi động lại nếu Windows yêu cầu, mở Ubuntu lần đầu để tạo Linux username/password. Đảm bảo distro chạy WSL 2; WSLg cần WSL2 và Windows có hỗ trợ ứng dụng GUI.

### 2. Chép ZIP vào filesystem Linux

Trên máy nguồn, tạo gói sạch bằng `npm run package:portable` trong thư mục `StoryDola`. Chép file `StoryDola-Windows-Portable.zip` sang Windows, ví dụ thư mục Downloads.

Trong Ubuntu/WSL, thay giá trị `WIN_USER` bằng tên thư mục tài khoản Windows:

```bash
WIN_USER="ten-tai-khoan-windows"
unzip "/mnt/c/Users/$WIN_USER/Downloads/StoryDola-Windows-Portable.zip" -d "$HOME"
cd "$HOME/StoryDola"
```

Giữ mã nguồn trong `$HOME` của WSL để Node, SQLite và Chromium làm việc trên filesystem Linux. ZIP không chứa cấu hình/credential của máy nguồn; không chép `.env.local`, database hay thư mục profile cũ sang máy mới.

### 3. Cài phần mềm và dependency

Trong Ubuntu, cần Node.js 20.9+, npm, Python 3.11+, FFmpeg và Internet. Có thể cài các gói hệ thống sau bằng apt:

```bash
sudo apt update
sudo apt install -y unzip ffmpeg lsof python3 python3-venv python3-pip
node --version
npm --version
python3 --version
```

Nếu `python3` thấp hơn 3.11, cài thêm Python 3.11+ trong Ubuntu rồi chỉ rõ executable, ví dụ `PYTHON_BIN=python3.11 npm run setup:local`. Setup tự dò Python 3.11–3.14 nếu các executable đó có sẵn. Sau đó tại `~/StoryDola`:

```bash
npm run setup:local
npm start
```

Setup cài npm/Python dependency và tạo `.env.local` cùng khóa mã hóa riêng trên máy Windows/WSL. Windows dùng Chromium kèm theo workspace; WSL2 cần Chromium bản Linux riêng vì không chạy được binary Windows.

### 4. Mở ứng dụng

Từ trình duyệt Windows, mở [http://localhost:3021](http://localhost:3021). Các màn hình tạo hàng loạt, tài khoản Seedance và quản lý proxy nằm trong thanh bên StoryAI. WSL2 mặc định chuyển tiếp cổng Linux sang `localhost` của Windows.

StoryAI chạy local không cần đăng nhập tài khoản MaiVideo; API key MaiVideo vẫn cần thiết nếu dùng tính năng tạo ảnh, giọng đọc hoặc video. Để tạo kịch bản tự động, thêm `OPENAI_API_KEY` vào `.env.local` rồi khởi động lại. Trong Dola Studio, đăng nhập lại các profile Dola và thêm/gán proxy cho máy Windows.

Nếu cửa sổ Chromium không xuất hiện khi đăng nhập Dola, cập nhật WSL bằng `wsl --update`, chạy `wsl --shutdown` trong PowerShell rồi mở lại Ubuntu. Kiểm tra WSLg theo hướng dẫn GUI apps của Microsoft.
