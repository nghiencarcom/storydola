# StoryAI + Dola local

Bản local của StoryAI kết nối MaiVideo API để đọc giọng OmniVoice, tạo ảnh và tạo video. Dola Render Gateway cũng chạy trên máy này để dùng Seedance bằng profile Chromium đã đăng nhập Dola và proxy do người dùng quản lý.

## Cài đặt trên máy mới

Yêu cầu Node.js 20.9+, Python 3.11+, FFmpeg và kết nối Internet để cài thư viện và Chromium. Có thể chạy trực tiếp trên Windows, macOS hoặc Linux; Gateway mở Chromium để đăng nhập profile.

```sh
npm run setup:local
npm start
```

`npm start` khởi động StoryAI cùng các màn hình Dola tại [http://127.0.0.1:3021](http://127.0.0.1:3021) và Render Gateway tại [http://127.0.0.1:8210](http://127.0.0.1:8210) trên Windows, macOS hoặc Linux. Giao diện StoryAI và Dola dùng chung cổng 3021; cổng 3117 chỉ dành cho chế độ chạy Dola Studio độc lập.

### Chuyển project sang Windows

Trên Windows, cài Python 3.11+ cùng Node.js rồi chạy trực tiếp trong PowerShell; xem [hướng dẫn Windows](HUONG_DAN_WINDOWS.md). Để tạo gói chuyển máy sạch, chạy `npm run package:portable`; gói ZIP được tạo cạnh thư mục project và loại trừ khóa, phiên đăng nhập, database, project/media, dependency và cache.

## Kết nối dịch vụ

1. Đăng nhập StoryAI bằng tài khoản MaiVideo. Bản local xác thực với `https://maivideo.top`.
2. Trong **Cài đặt**, nhập API key MaiVideo để tải catalog giọng OmniVoice và dùng API tạo ảnh/video. Để StoryAI tự viết hoặc nối tiếp kịch bản, điền `OPENAI_API_KEY` vào `.env.local` rồi khởi động lại; có thể dùng prompt/kịch bản thủ công nếu chưa cấu hình.
3. Các luồng trong **Tạo dự án mới** mặc định dùng giọng OmniVoice và catalog MaiVideo; video ưu tiên PixVerse v6 ở 720p theo catalog. Có thể chọn Seedance qua Dola Gateway trong cấu hình dự án.
4. Nếu dùng Seedance local, mở **Cài đặt → Quản lý tài khoản/profile**, thêm tài khoản Dola, hoàn tất Google OAuth trong cửa sổ Chromium và kiểm tra profile đã đăng nhập.
5. Mở **Cài đặt → Quản lý proxy**, nhập proxy nếu cần và gán cho profile. Gateway chỉ nhận kết nối trên loopback của máy.
6. Khi chọn Seedance local, StoryAI gửi prompt và ảnh tham chiếu tới Dola.com, chọn profile sẵn sàng, poll job rồi lưu MP4 vào media của cảnh. Nếu chọn MaiVideo, job video được tạo và theo dõi qua MaiVideo API.

Ảnh tham chiếu cho Dola được tải từ một route StoryAI ký số, chỉ cho phép Gateway truy cập qua loopback. Không cần tunnel hay public URL để tạo video trên cùng máy. Seedance hỗ trợ clip 5, 10 hoặc 15 giây; Gateway tự điều phối profile và proxy.

## Dữ liệu và khóa

- `npm start` tạo `.env.local` riêng cho máy lần đầu và chỉ cho tài khoản máy hiện tại đọc/ghi. Khóa mã hóa cần giữ nguyên để đọc lại các API key đã lưu. `.env.local` không được đưa vào source archive.
- API key MaiVideo lưu mã hóa trong `data/maivideo-api-keys.json`.
- Session Chromium, thông tin profile/proxy, credential vault, task database và video tải về nằm riêng trong `dola-studio/dola-render-gateway/`.
- Bản clone không mang theo project/story, media, tài khoản, proxy, credential, database hoặc API key từ máy nguồn. Mỗi máy cần đăng nhập Dola và nhập thông tin dịch vụ riêng.
- Dola Gateway có thể tiếp tục poll task đã nhận sau khi đóng cửa sổ StoryAI; mở lại `npm start` để theo dõi.

Giữ nguyên `.env.local`, thư mục `dola-render-gateway/accounts/` và credential vault nếu cần giữ phiên đăng nhập. Xoá các mục này sẽ yêu cầu đăng nhập lại.

## Cấu hình

`npm start` tự tạo `.env.local` với các cổng mặc định. Có thể đổi `STORYAI_PORT` và `DOLA_GATEWAY_PORT` trong file đó; cập nhật cùng origin loopback ở `STORYAI_LOCAL_BASE_URL`, `STORYAI_SEEDANCE_GATEWAY_URL` và `DOLA_GATEWAY_URL` để các service tiếp tục trỏ đúng nhau. Dùng `npm run dev:dola` nếu cần mở riêng giao diện Dola Studio tại cổng 3117.

## Thư mục thành phần

- `app/`, `scripts/`: StoryAI và launcher local.
- `dola-studio/`: Dola Studio cùng Render Gateway, proxy manager, profile manager và extension Chromium.
- `data/`: workspace StoryAI và media được tạo trên máy này.
