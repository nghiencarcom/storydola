# Phát hành StoryAI cho người dùng

## Thiết lập ban đầu

1. Tạo GitHub repository cho mã nguồn và đặt nhánh chính là `main`.
2. Đẩy mã nguồn lên repository. `.gitignore` và `.dockerignore` loại `data/`, `.env`, media, log và file build khỏi commit/image.
3. Trong GitHub, đặt quyền của package container GHCR thành **Public** nếu người dùng không có tài khoản GitHub/repository. Nếu giữ package private, từng máy cần `docker login ghcr.io` bằng tài khoản có quyền đọc package.
4. Tạo tag phiên bản, ví dụ `v1.0.0`, rồi đẩy tag. Workflow sẽ build image và tạo GitHub Release có gói cài đặt cho người dùng.
5. Tải `storyai-installer.zip` từ Release và gửi cho người dùng. Họ cài Docker Desktop/Engine, giải nén gói, rồi chạy launcher theo `README.md` trong gói.

Lệnh tạo và gửi tag đầu tiên sau khi đã cấu hình remote:

```sh
git tag v1.0.0
git push origin v1.0.0
```

Mỗi lần đẩy cập nhật lên `main`, workflow xuất bản image `latest`. Người dùng chạy lại launcher để tải image mới. Có thể phát hành thêm tag `v1.0.1` để tạo gói cài đặt mới cho người dùng mới.

## Giới hạn lưu trữ hiện tại

- Mỗi cài đặt là một instance riêng; project, media, API key đã lưu và workflow cục bộ không tự đồng bộ giữa các máy.
- Data được giữ trong thư mục `data/` cạnh gói cài đặt; thay image không xóa thư mục này.
- Cần sao lưu thư mục `data/` và file `.env` riêng. Giữ nguyên `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY` khi khôi phục.
- Ứng dụng đang dùng JSON và hàng đợi ghi trong một tiến trình. Hãy giữ một container chạy cho mỗi thư mục `data/`; không mở cùng thư mục đồng thời từ nhiều instance.
- Cổng chỉ bind vào `127.0.0.1` theo mặc định. Người dùng có thể bật truy cập LAN bằng `STORYAI_BIND_HOST=0.0.0.0`, nhưng cần tự quản lý mạng tin cậy và firewall.

## Trạng thái repository hiện tại

Thư mục làm việc chưa được khởi tạo Git hoặc gắn GitHub remote. Sau khi bạn tạo repository và đẩy nhánh `main`, workflow mới có thể phát hành image và gói cài đặt.
