# Kiểm tra tốc độ gõ prompt

Mặc định mới: DOLA_PROMPT_KEY_DELAY_MS=1 (ms/ký tự), vẫn gõ tuần tự.
Nếu nội dung không khớp: xoá và gõ lại một lần với độ trễ ít nhất 5ms.
Không sử dụng fill/insert_text để chèn prompt. Shift+Enter giữ dòng mới;
request native và nhãn Generated video của Dola không bị viết lại.

Kết quả đo cục bộ trên Chromium, tiếng Việt:
- 263 ký tự, 20ms: textarea 5755ms; contenteditable 5744ms, khớp tuyệt đối.
- 263 ký tự, 5ms: textarea 1605ms; contenteditable 1647ms, khớp tuyệt đối.
- 3000 ký tự, 1ms: textarea 4613ms, khớp tuyệt đối.
- 5000 ký tự, 1ms: textarea 7906ms, khớp tuyệt đối.

Kiểm tra ô nhập Dola trên andomoneycom:
- 263 ký tự, 5ms: 2366ms, kiểm tra nội dung qua worker.
- 5000 ký tự nhiều dòng, 1ms: 16855ms, khớp sau chuẩn hoá khoảng trắng
  bằng _prompt_compare_key; so chuỗi thô không khớp tuyệt đối.
- Không gửi request tạo video; đã xoá nội dung thử khỏi editor.

Đây là phép đo tốc độ nhập, không chứng minh tác dụng đối với risk-control
hay khả năng render 30s. Thời gian thực tế phụ thuộc cấu trúc prompt và máy.
