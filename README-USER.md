# Cài StoryAI trên máy cá nhân

Gói này chạy StoryAI bằng Docker. Project, ảnh, video và file render được lưu trong thư mục `data/` cạnh launcher trên chính máy cài ứng dụng. Mỗi máy có bộ dữ liệu riêng.

## Yêu cầu

- Windows hoặc macOS: cài Docker Desktop và mở Docker Desktop trước khi chạy StoryAI.
- Linux: cài Docker Engine và Docker Compose v2.
- Máy có kết nối Internet khi cài lần đầu và khi tải bản cập nhật.
- Người dùng đăng nhập bằng tài khoản MaiVideo.

## Khởi chạy

1. Giải nén gói vào một thư mục ổn định trên máy.
2. Windows: mở `Start StoryAI.bat`.
3. macOS: mở `Start StoryAI.command`. Nếu macOS chặn lần đầu, nhấp phải file và chọn **Open**.
4. Linux: chạy `./scripts/start-storyai.sh` trong thư mục đã giải nén.
5. Lần đầu chạy sẽ tạo file `.env` và sinh khóa mã hóa riêng cho máy. Gói phát hành đã điền sẵn image; nếu bạn nhận được gói cấu hình mẫu, hãy đặt `STORYAI_IMAGE` trong `.env` theo hướng dẫn của người phát hành.
6. Launcher tải image mới nhất, khởi động ứng dụng và mở trình duyệt tại `http://localhost:3011`.

Nếu image nằm trong GHCR riêng tư, đăng nhập một lần bằng `docker login ghcr.io` trước khi chạy launcher. Để người dùng không cần tài khoản GitHub, người phát hành cần đặt package container ở chế độ public.

## Cập nhật và dừng

Mỗi lần mở launcher, StoryAI kiểm tra registry và tải image mới nếu có, rồi khởi động lại ứng dụng. Khi đang làm việc, lưu nội dung trước khi chạy launcher để cập nhật. Mã nguồn mới chỉ tới máy người dùng sau khi người phát hành đẩy bản cập nhật lên nhánh chính và workflow xuất bản image hoàn tất.

Windows: `Stop StoryAI.bat`. macOS: `Stop StoryAI.command`. Linux: `./scripts/stop-storyai.sh`. Lệnh dừng giữ nguyên thư mục `data/`.

## Dữ liệu và cấu hình

- Mỗi máy lưu dữ liệu cục bộ riêng trong thư mục `data/` cạnh launcher.
- Image được cập nhật độc lập với thư mục dữ liệu, nên nâng cấp ứng dụng không thay project và media.
- Giữ file `.env` an toàn. Không gửi file này hoặc thư mục `data/` công khai; `.env` chứa khóa và tùy chọn API.
- Không xóa hoặc đổi `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY` sau khi đã lưu API key trong ứng dụng. Hãy sao lưu cả khóa này khi sao lưu dữ liệu.
- Ảnh đã chọn từ MaiVideo Media Library được tải về thư mục `data/` của StoryAI. Thư viện gốc vẫn thuộc tài khoản MaiVideo.
- Các tích hợp HTMLVideo và OmniVoice mặc định tìm dịch vụ trên máy cài Docker tại cổng 3000 và 8000. Nếu không dùng các tích hợp này, có thể để nguyên. Trên Linux hoặc khi dịch vụ ở máy khác, sửa `STORYAI_HTMLVIDEO_BASE_URL` và `STORYAI_OMNIVOICE_BASE_URL` trong `.env` thành URL truy cập được từ Docker.

## Chuyển sang máy khác

Sao chép thư mục `data/` và file `.env` sang gói cài đặt trên máy mới. Giữ nguyên `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY` để mở lại API key đã lưu. Nếu chỉ cài gói mới mà không chép `data/`, StoryAI sẽ bắt đầu với dữ liệu trống.
