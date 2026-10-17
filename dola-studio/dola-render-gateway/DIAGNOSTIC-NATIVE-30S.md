# Kiểm tra request native 30s

- Profile: andomoneycom-b6b041de.
- Model: seedance_v2.5; thời lượng UI: 30s; tỷ lệ: 9:16.
- Prompt phong cảnh không nhắc thời lượng, 175 ký tự.
- Dola thêm nhãn `Generated video: ` và hậu tố `, 9:16` vào message.
- Worker kiểm tra nội dung nhưng gửi nguyên byte request: `rewritten=False`.
- Dola đã trả conversation ID: `38417873955899921`.
- URL: https://www.dola.com/chat/38417873955899921
- Chạy chẩn đoán trực tiếp worker, không tạo job trong database/hàng đợi.
- Đã nhận conversation không đồng nghĩa render xong. Không gửi lại conversation này.

## Kết quả cuối

Sau cửa sổ poll 300s, mở lại cùng conversation thấy Dola trả lời:
`Video generation currently supports durations from 4 to 15 seconds.`
Không có video. Đã bổ sung nhận diện phản hồi này là ProviderGenerationRejectedError
và xác minh bằng resume_video trên chính conversation, không gửi prompt mới.

Request nguyên bản không gặp lại mã 710022002 trong lượt thử này, nhưng chưa
chứng minh mọi lỗi đó do rewrite: còn thay đổi prompt, phiên và thời điểm.
Thời hạn tổng trong cấu hình hiện là tối đa 1800s (30 phút); cửa sổ poll là 300s.
Job đang render được tiếp tục theo dõi, chỉ dừng sớm khi có phản hồi từ chối rõ.
