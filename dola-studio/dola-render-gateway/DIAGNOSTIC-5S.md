# Đối chứng 5s sau lỗi 30s

Đã chạy trực tiếp UI worker, cố định từng profile, không luân chuyển tài khoản.
Giữ Seedance 2.5, extension bật, tỷ lệ 9:16, cảnh hồ và núi lúc bình minh,
không người/ảnh tham chiếu. Đổi yêu cầu thời lượng từ 30 xuống 5 giây.
Các lượt chẩn đoán này không tạo bản ghi job trong hàng đợi.

## Lỗi tìm được và sửa

- Trang khách vẫn có cookie và nút chat; không thể suy ra đã đăng nhập từ cookie.
- Nhãn Log In nằm trong SPAN con của BUTTON. Đổi sang accessible-name matching.
- Màn hình login trước khi gửi phải kích hoạt một lần Gmail relogin, không gán risk-control.
- Bỏ fallback Fast/Pro chung vì đó có thể là menu chat, không phải model video.
- Giữ model variant hợp lệ và JSON ability nguyên bản nếu không cần sửa.
- Ghi HTTP status và mã lỗi số; không ghi response chứa token/cookie.

## Kết quả thực tế

Các lượt đầu chưa gửi được 5s vì lỗi chọn model trên trang khách.
Sau khi sửa nhận diện Log In, đã thực sự chạy Continue with Google:

| Profile | Đăng nhập lại | Kết quả 5s |
| --- | --- | --- |
| andomoneycom-b6b041de | Thành công, kiểm tra lại phiên | Gửi model seedance_v2.5, duration 5, prompt 208 ký tự; HTTP 200, error_code 710022002; chưa có conversation |
| chinhtng26-ba1cb0b6 | Thành công, kiểm tra lại phiên | Page.goto net::ERR_TIMED_OUT tại https://www.dola.com/chat; chưa gửi request 5s |

Không có video mới hoặc conversation được ghi nhận trong hai lượt cuối.
5s cũng gặp lỗi giới hạn tần suất trên andomoneycom, nên lỗi không chỉ xuất
hiện ở 30s. Chưa đủ bằng chứng kết luận nguyên nhân là tốc độ nhập prompt,
extension hay mạng/IP. Cả hai thời lượng đều sử dụng extension; đây không
phải phép thử bật/tắt extension. Lượt 5s còn có thay đổi code và khôi phục
phiên, nên không phải đối chứng chỉ thay một biến.

Kiểm tra code: 34 unittest qua; git diff --check không có lỗi.
