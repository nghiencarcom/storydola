# Chạy StoryAI trên Windows bằng npm

StoryAI chạy trực tiếp trên máy, mở giao diện trong trình duyệt tại `http://localhost:3011`. Cách này không cần Docker.

## Cài một lần

Mở PowerShell và cài Node.js, Git for Windows, FFmpeg/FFprobe bằng WinGet:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Git.Git --exact
winget install --id Gyan.FFmpeg --exact
```

Đóng rồi mở lại PowerShell để nạp `PATH` mới. Máy cần có WinGet (Windows Package Manager/App Installer). Nếu chưa có WinGet, cài **App Installer** từ Microsoft Store trước. Các lệnh FFmpeg cần chạy được trong PowerShell.

Sau đó mở PowerShell tại thư mục muốn đặt StoryAI và chạy:

```powershell
git clone https://github.com/nghiencarcom/storydola.git StoryAI
cd StoryAI
npm start
```

Lần chạy đầu sẽ tự cài thư viện npm, build ứng dụng, tạo file `.env` cùng khóa mã hóa riêng cho máy, rồi mở trình duyệt. Người dùng đăng nhập bằng tài khoản MaiVideo.

## Mở ứng dụng và cập nhật

Mỗi lần muốn mở StoryAI, vào thư mục `StoryAI` trong PowerShell và chạy `npm start`. Với bản clone sạch trên nhánh `main`, lệnh này kiểm tra và tải mã mới từ GitHub, cài lại thư viện nếu cần, build khi mã nguồn thay đổi rồi khởi động ứng dụng. Cần có Internet để kiểm tra bản cập nhật.

Giữ cửa sổ Terminal mở trong lúc sử dụng. Nhấn `Ctrl+C` để dừng ứng dụng. Nếu đã sửa mã nguồn trực tiếp, launcher sẽ bỏ qua cập nhật tự động để giữ các chỉnh sửa đó.

## Dữ liệu và cấu hình

- Mỗi máy lưu project, media và file render riêng trong thư mục `data/` cạnh mã nguồn; dữ liệu không tự đồng bộ giữa các máy.
- File `.env` và thư mục `data/` không bị ghi đè khi cập nhật. Không xóa hoặc đổi `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY` sau khi đã lưu API key.
- Sao lưu cả `data/` và `.env`. Khi chuyển sang máy khác, chép chúng vào thư mục StoryAI mới để khôi phục dữ liệu và giữ nguyên khóa mã hóa.
- Ảnh chọn từ MaiVideo Media Library được tải về thư mục `data/` local; thư viện gốc vẫn thuộc tài khoản MaiVideo.
- Tính năng render MP4 cần FFmpeg và FFprobe trong `PATH`. Các tích hợp HTMLVideo và OmniVoice mặc định tìm dịch vụ local ở cổng 3000 và 8000.

## Tải mã nguồn ZIP

Có thể tải **Source code (zip)** từ [GitHub Releases](https://github.com/nghiencarcom/storydola/releases). Giải nén, cài thư viện bằng `npm ci`, rồi chạy `npm start`. Bản ZIP không có metadata Git nên không tự tải cập nhật; dùng `git clone` ở hướng dẫn trên để nhận cập nhật tự động.
