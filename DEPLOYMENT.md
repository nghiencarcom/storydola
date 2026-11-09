# Phát hành StoryAI cho người dùng

## Phân phối hiện tại

- Mã nguồn: `https://github.com/nghiencarcom/storydola`.
- Container công khai: `ghcr.io/nghiencarcom/storydola:latest`.
- Mỗi lần cập nhật nhánh `main`, GitHub Actions tự build và xuất bản image `latest`.
- Cấu hình mặc định đã trỏ vào image này. Người dùng tải mã nguồn hoặc gói cài đặt, giải nén và chạy launcher theo `README-USER.md`.
- Launcher kiểm tra image mới mỗi lần mở ứng dụng. Dữ liệu trong `data/` và cấu hình `.env` ở lại trên máy người dùng khi cập nhật.

## Tạo gói cài đặt có phiên bản

Trong bản sao Git của repository, tạo và đẩy tag phiên bản:

```sh
git tag v0.1.0
git push origin v0.1.0
```

Workflow sẽ build image có tag tương ứng và tạo GitHub Release chứa `storyai-installer.zip`. Người dùng tải ZIP từ mục Releases, cài Docker Desktop hoặc Docker Engine, giải nén rồi chạy launcher cho hệ điều hành của họ.

## Dữ liệu và cập nhật

- Mỗi máy có dữ liệu riêng trong thư mục `data/`; dữ liệu không tự đồng bộ giữa các máy.
- Sao lưu `data/` và `.env` riêng. Giữ nguyên `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY` để đọc lại các API key đã mã hóa.
- Push mã nguồn lên `main` sẽ xuất bản image mới. Người dùng chạy lại launcher để tải image đó và khởi động phiên bản mới.
- Nếu image không tải được, launcher thử chạy image đã có. Nếu image mới không vượt health check, launcher khôi phục image trước đó; thư mục dữ liệu được giữ nguyên.
- Chỉ chạy một container với mỗi thư mục `data/`. Mặc định ứng dụng chỉ truy cập từ máy cài đặt ở `http://localhost:3011`.
