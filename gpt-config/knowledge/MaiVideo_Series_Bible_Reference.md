# MaiVideo Story Studio — Tham chiếu hồ sơ series và continuity

## Series bible

- `logline`: premise và xung đột trung tâm trong một câu.
- `viewer_promise`: trải nghiệm/giá trị cảm xúc mà series mang lại.
- `premise`: tình huống mở đầu, chủ thể và điều làm câu chuyện khác thường.
- `genre`: thể loại hoặc tổ hợp thể loại.
- `audience`: nhóm người xem dự kiến.
- `rating`: mức độ phù hợp đối tượng, gồm giới hạn nội dung nhạy cảm.
- `world_rules`: quy luật của thế giới, công nghệ, phép thuật, xã hội hoặc lịch sử.
- `characters`: tên/ID, vai trò, tuổi hoặc độ tuổi biểu kiến, ngoại hình, trang phục, mục tiêu, nỗi sợ, tính cách, giọng nói, cung phát triển.
- `locations`: tên/ID, địa hình, kiến trúc, bảng màu, ánh sáng, thời gian thường gặp và vật thể nhận diện.
- `visual_bible`: phong cách hình ảnh, màu, ánh sáng, framing, texture, camera/lens, aspect ratio và các yếu tố ổn định.
- `season_arc`: thay đổi lớn của nhân vật và câu hỏi trung tâm từ đầu đến cuối bộ.

## Bản đồ tập
Episode outline có thể lưu: `chunk_id`, episode number, title, logline tập, dramatic question, opening hook, turning point, climax, local payoff, open thread và phạm vi scene IDs. Những trường này là thông tin planning; đầu ra import vẫn dùng `scene-script.v1` cho mỗi tập.

## Handoff continuity
`continuity_state` mô tả trạng thái đầy đủ tại cuối một tập:

- `story_so_far`: diễn biến canon cô đọng tới thời điểm hiện tại.
- `active_characters`: danh sách nhân vật đang hoạt động; mỗi người có thể có `name`, `appearance`, `costume`, `goal`, `emotional_state`, `location`, `voice_profile`.
- `active_locations`: địa điểm hiện tại và các trạng thái nhận diện/tổn thất/thay đổi.
- `important_props`: vật dụng ảnh hưởng cốt truyện và vị trí/người đang giữ.
- `open_threads`: bí ẩn, lời hứa, xung đột hoặc câu hỏi chưa giải quyết.
- `next_chunk_plan`: điểm mở, trạng thái nhân vật và beat nối dự kiến cho tập sau.

## Nhất quán cảnh
Một thay đổi canon có thể nằm ở hành động hoặc quyết định trên màn hình. Tình trạng trang phục, thương tích, vật dụng, vị trí địa lý, thời gian trong ngày và cảm xúc là các biến liên tục. Một chuyển đổi đáng kể thường có beat chuyển tiếp nhìn thấy được hoặc được ghi rõ trong continuity.
