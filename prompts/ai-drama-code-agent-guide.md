---
name: storyai-ai-drama
description: Comprehensive guide for coding agents writing episodic AI Drama scripts, character reference locks, 180-degree axis continuity, and 15-second camera combos in StoryAI.
---

# StoryAI — Hướng Dẫn Code Agent Viết Kịch Bản Phim AI Drama Chuẩn Điện Ảnh & Tối Ưu Giữ Chân

Tài liệu này là cẩm nang bắt buộc dành cho Code Agent khi khởi tạo, xây dựng cốt truyện và viết kịch bản JSON (`scene-script.v1`) cho thể loại **Phim AI (AI Drama)** trên StoryAI.

---

## 1. Quy trình 2 Bước Bắt buộc khi Sản xuất AI Drama

Mọi dự án Phim AI do Agent tạo lập bắt buộc phải tuân thủ trình tự sau:

1. **Bước 1: Khởi tạo Dự án & Drama Plan (`storyai_create_ai_drama_project`):**
   - Agent tự soạn kế hoạch hoàn chỉnh gồm: `videoTitle`, `logline`, `synopsis`, `continuityRules`, danh sách `characters` (kèm base prompt tạo Character Reference Sheet), danh sách `locations` (kèm base prompt tạo Location Reference Sheet), và mảng `episodes` khớp chính xác số tập theo công thức:
     $$\text{totalScenes} = \left\lceil \frac{\text{durationMinutes} \times 60}{15} \right\rceil$$
     $$\text{expectedEpisodes} = \left\lceil \frac{\text{totalScenes}}{\text{chunkSize}} \right\rceil$$
   - StoryAI sẽ lưu Drama Plan làm kịch bản nguồn (`sourceText`) và tạo cấu trúc chunk dự án (`A01`, `A02`...).

2. **Bước 2: Lấy Context & Nhập JSON Từng Tập Tuần tự:**
   - Gọi `storyai_get_episode_script_context` với `chunkId` tương ứng (`A01`, rồi đến `A02`, `A03`...).
   - Agent tự viết JSON `scene-script.v1` cho riêng tập đó, tuân thủ đúng dải scene ID (`expectedSceneIds`) và nối tiếp timeline (`timelineStartSec`).
   - Gọi `storyai_import_episode_script` với `{ slug, script, replace: false, preserveProjectSettings: true }`. Lặp lại cho đến tập cuối cùng.

---

## 2. Khóa Nhận Diện Nhân Vật & Gắn Token Tham Chiếu (Reference Identity Lock)

Trong StoryAI, mỗi nhân vật chính đều được tạo một **Character Reference Sheet** (bộ ảnh 3 góc nhìn). Hệ thống gán ảnh tham chiếu theo thứ tự `@Image1`, `@Image2`... hoặc token tên canonical `@CharacterName`.

### A. Lỗi Nghiêm Trọng Cần Tuyệt Đối Tránh
- **Lỗi chép lại văn xuôi mô tả ngoại hình tĩnh:** Trong `image_prompt` hoặc `video_prompt`, Agent tự động chép lại các tính từ mô tả từ Character Bible (*"Ba Loan: 60-year-old Vietnamese mother, wrinkled face, salt-and-pepper hair in a low bun..."* hoặc *"Huong: 32-year-old woman with straight black hair..."*).
- **Hậu quả hệ thống:**
  1. **Kích hoạt lỗi từ chối của StoryAI (`requireReferenceIdentityOnly`):** Hệ thống sẽ ném ngoại lệ và dừng render nếu phát hiện từ khóa tuổi tác (`32-year-old`, `60-year-old`, `elderly`, `young`) hoặc mô tả tĩnh khuôn mặt (`wrinkled face`, `oval face`, `almond eyes`, `skin tone`).
  2. **Gây xung đột mô hình sinh ảnh/video:** Model AI vừa phải bám theo ảnh tham chiếu, vừa cố vẽ lại theo văn bản, dẫn đến việc nhân vật bị "trẻ hóa", đổi kiểu tóc, biến đổi cấu trúc xương mặt hoặc thay đổi phục trang giữa các tập.

### B. Quy Chuẩn Viết Đúng Reference Lock
1. **Chỉ gọi tên Canonical hoặc Token ảnh:**
   * Viết: `@Huong pauses holding the porcelain ladle...` hoặc `Huong stands rigidly on screen-left...`
   * **CẤM:** `A 32-year-old Vietnamese woman named Huong with straight black hair and silver earrings...`
2. **Chỉ mô tả Diễn xuất & Trạng thái tại Frame đó (Frame-Specific State):**
   * Tập trung 100% vào:
     - **Biểu cảm (`emotional expression`):** *eyes wide in shock, lips slightly parted in disbelief, defensive frown, joyful laughter*.
     - **Hướng nhìn (`gaze/eyeline`):** *staring down at the glowing screen, avoiding Huong's direct gaze, looking across the table*.
     - **Tư thế (`body language`):** *posture rigid, shoulders slumped in remorse, standing tall beside the chair*.
     - **Tương tác đạo cụ (`object handling`):** *fingers trembling against the paper, sliding the phone across the table, turning the brass key*.
   * **Mẫu prompt ảnh chuẩn:**
     ```text
     Interior of authentic Vietnamese townhouse dining kitchen, night. Medium shot framing the dark wooden dining table. Huong is paused mid-motion holding a porcelain soup ladle over a steaming bowl of sour soup, her eyes wide in shock as she looks down. Across the table, Ba Loan avoids her gaze, eyes lowered in defensive silence. Binh sits frozen, chopsticks lowered. On the tabletop, a smartphone screen illuminates with an urgent alert.

     REFERENCE LOCK: Bind visual identity, face, age, hair, and costume strictly to attached character reference images for @Huong, @BaLoan, and @Binh. Do not alter facial structure or wardrobe. Warm overhead tungsten pendant light.
     ```

---

## 3. Quy Tắc Trục Quay 180 Độ & Tính Nhất Quán Không Gian (180-Degree Line of Action)

Trong phim ngắn drama, sự đảo lộn phương hướng thị giác giữa các cảnh liên tiếp sẽ làm người xem bị mất định hướng (disorientation) và cắt đứt dòng cảm xúc.

### A. Thiết lập Trục Đối Thoại (Line of Action)
- Trong mọi cảnh có từ 2 nhân vật (đặc biệt là đối thoại, tranh cãi), xác định một đường thẳng tưởng tượng nối giữa 2 nhân vật chính.
- **Quy tắc máy quay:** Mọi góc máy của phân đoạn đó (toàn cảnh, trung cảnh, cận cảnh, qua vai OTS) phải nằm **cùng một phía** của đường thẳng này (Stage-Left hoặc Stage-Right).

### B. Khóa Vị trí Màn hình & Hướng Nhìn (Eyeline Vectors)
- **Nhân vật A (Bên chất vấn/tấn công):** Neo ở **Screen-Left**, hướng nhìn sang phải (**facing screen-right**).
- **Nhân vật B (Bên phòng thủ/giải trình):** Neo ở **Screen-Right**, hướng nhìn sang trái (**facing screen-left**).
- **Khi quay góc qua vai (OTS Shots):**
  * Shot quay A: Camera đặt sau vai phải của B (B ở tiền cảnh screen-right, A ở trung cảnh screen-left nhìn sang phải).
  * Shot quay B: Camera đặt sau vai trái của A (A ở tiền cảnh screen-left, B ở trung cảnh screen-right nhìn sang trái).
  * Hướng nhìn của 2 nhân vật luôn chạm nhau qua từng cú cắt, tạo cảm giác đối thoại chân thực, không bao giờ bị nhảy trục.
- **Mẫu khai báo trong `video_prompt`:**
  ```text
  180-DEGREE AXIS & SCREEN GEOGRAPHY: Camera positioned on the eastern side of the dining table (stage right). Huong is framed screen-left facing screen-right; Binh is framed screen-right facing screen-left. Eyelines and screen direction strictly align across cuts without crossing the line of action.
  ```

---

## 4. Thiết Kế Chuyển Động Máy Quay (Camera Combos) Cho Khung Cảnh 15 Giây

Cảnh 15 giây là chuẩn mực của AI Drama để truyền tải trọn vẹn một beat tâm lý có diễn biến và chuyển đổi cảm xúc. Một prompt video 15 giây chuẩn mực phải được phân bổ thành **3 pha hành động liên tục**, không có thời gian chết:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 CẤU TRÚC CHUYỂN ĐỘNG MÁY QUAY 15 GIÂY (3 PHA)               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
     ┌─────────────────────────────────┼─────────────────────────────────┐
     ▼                                 ▼                                 ▼
Pha 1: 00:00 – 00:05              Pha 2: 00:05 – 00:10              Pha 3: 00:10 – 00:15
(Start Framing & Trigger)         (Movement & Climax Beat)          (End Framing & Hook/Cut)
Cỡ cảnh xuất phát ổn định.        Thực thi combo máy quay chính.     Khóa cỡ cảnh đích (Close-up
Camera bắt đầu di chuyển theo     Chuyển nét (Rack Focus) hoặc      hold hoặc Wide pull-back).
động lực hành động / âm thanh.    di chuyển đồng bộ với thoại.      Khép lại trọn vẹn nhịp diễn.
```

### Bảng Phân Bổ 3 Pha Mẫu
1. **Pha 1 (00:00–00:05):** Mở đầu từ `image_prompt` (Medium Shot / OTS / Low-Angle). Động lực xuất hiện (chuông điện thoại, bước chân xộc vào, đồ vật rơi).
2. **Pha 2 (00:05–00:10):** Camera thực hiện cú di chuyển chủ đạo theo Combo đã chọn (`Slow Push-In`, `OTS Push-In + Rack Focus`, `Lateral Tracking + Counter-Pan`, `Whip Pan + Tracking Follow`) đồng bộ với thoại và phản ứng.
3. **Pha 3 (00:10–00:15):** Dừng tại cỡ cảnh kết thúc (Close-up giữ nét căng thẳng, Pull-Back mở rộng không gian cô đơn, hoặc Pan bám theo nhân vật bước ra khỏi khung hình) trước khi chuyển cảnh.

---

## 5. Quy Chuẩn Lời Thoại & Giới Hạn Khoảng Lặng (Dialogue & Pacing)

- **`dialogue_led` (Cảnh thoại dẫn dắt):**
  - Bắt buộc phải có `dialogue_segments` với timecode tương đối trong cảnh (`0.0` đến `15.0s`).
  - **Giới hạn khoảng lặng bắt buộc:**
    * Từng khoảng nghỉ liên tục (khoảng trống giữa các câu thoại hoặc đầu/đuôi cảnh) tối đa **$\le 3.0$ giây**.
    * Tổng thời gian im lặng trong cảnh 15 giây tối đa **$\le 5.0$ giây** (tổng thời lượng thoại phải đạt ít nhất $10$ giây).
    * Giữa 2 cảnh `dialogue_led` liền nhau: Khoảng lặng đuôi cảnh trước + khoảng lặng đầu cảnh sau phải **$\le 3.0$ giây**.
  - Tốc độ thoại lý tưởng: **2.5 – 3.0 từ/giây**. Dùng dấu phẩy `,` ngắt nhịp thở tự nhiên.
- **`visual_led` (Cảnh hành động / khám phá manh mối / im lặng có chủ đích):**
  - Dành cho cảnh tìm kiếm tài liệu, sốc tâm lý, quan sát, ngã quỵ hoặc nấu ăn.
  - Được **miễn trừ toàn bộ giới hạn khoảng lặng** và giúp bẻ gãy chuỗi ràng buộc boundary giữa các cảnh thoại.
  - Đặt `speaker_character: "NONE"`, `dialogue_or_voiceover: ""`, và `dialogue_segments: []`.

---

## 6. Mẫu Cảnh JSON Hoàn Chỉnh Thực Chiến

```json
{
  "id": "S001",
  "start_sec": 0,
  "end_sec": 15,
  "duration_sec": 15,
  "act": "Act I - The Incident",
  "purpose": "Establish the opening dramatic hook with the phone notification interrupting the family dinner.",
  "beat_summary": "Hương đang múc canh chua cho mẹ chồng thì màn hình điện thoại trên bàn sáng lên thông báo trừ tiền 200 triệu, khiến chiếc muôi canh khựng lại trên không.",
  "dialogue_mode": "visual_led",
  "dialogue_or_voiceover": "",
  "dialogue_segments": [],
  "characters": ["Bà Loan", "Hương", "Bình"],
  "location_name": "Phòng Bếp & Bàn Ăn Gia Đình",
  "speaker_character": "NONE",
  "media_type": "video",
  "image_keyword": "vietnamese family dinner kitchen phone alert",
  "video_keyword": "slow push in rack focus soup ladle phone notification",
  "image_prompt": "Interior of authentic Vietnamese townhouse dining kitchen, night. Medium shot framing the dark wooden dining table. Huong is paused mid-motion holding a porcelain soup ladle over a steaming bowl of sour soup, her eyes wide in shock as she looks down. Across the table, Ba Loan avoids her gaze, eyes lowered in defensive silence. Binh sits frozen, chopsticks lowered. On the tabletop, a smartphone screen illuminates with an urgent banking alert banner.\n\nREFERENCE LOCK: Bind visual identity, face, age, hair, and costume strictly to attached character reference images for @Huong, @BaLoan, and @Binh. Do not alter facial structure or wardrobe. Warm overhead tungsten pendant light.",
  "video_prompt": "PRIMARY CAMERA COMBO: 04 Slow Push-In + Rack Focus.\nCHARACTER LOCK: Preserve canonical identity, facial features, age, and assigned wardrobe for @Huong, @BaLoan, and @Binh. No de-aging or wardrobe drift.\n180-DEGREE AXIS & SCREEN GEOGRAPHY: Camera positioned on the eastern side of the dining table (stage right). Huong is seated screen-left facing screen-right; Binh is seated screen-right facing screen-left; Ba Loan sits at the table head in the upper-right background facing down. Eyelines strictly adhere to this conversation axis.\n15-SECOND TIMED CAMERA PLAN:\n- 00:00-00:05 (Start Framing: Medium Two-Shot): Camera begins at eye level. At 00:02, the smartphone screen on the table lights up and buzzes with a high-contrast banking notification. Huong's hand freezes holding the soup ladle over the steaming bowl.\n- 00:05-00:10 (Movement: Slow Push-In & Focus Shift): Camera pushes in smoothly toward Huong while racking focus from her startled eyes down to the glowing smartphone screen on the table. A single droplet of soup drips from the ladle back into the bowl. Across the table, Ba Loan avoids Huong's eyeline.\n- 00:10-00:15 (End Framing: Tight Insert): Camera settles into an intimate, sharp close-up on the glowing notification reading '-200,000,000 VND' alongside Huong's rigid fingers, holding tension through 00:15.\nSFX: Soft ceramic clink, dull phone vibration hum, quiet simmering broth.",
  "continuity_in": "Bữa cơm tối thường nhật bắt đầu với mâm cơm gia đình ấm cúng và bát canh chua bốc khói.",
  "continuity_out": "Hương sững sờ buông chiếc muôi canh, ánh mắt hướng trừng trừng vào màn hình điện thoại hiển thị số dư trừ.",
  "source_basis": "Tập 1 Opening Hook: Tiếng thìa sứ rơi leng keng xuống mâm cơm khi màn hình điện thoại của Hương sáng lên tin nhắn ngân hàng trừ sạch 200 triệu quỹ gia đình.",
  "risk_flags": [],
  "voiceover_target_sec": 0
}
```
