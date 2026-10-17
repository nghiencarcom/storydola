# MaiVideo StoryAI — schema JSON cho AI Drama

Tài liệu này mô tả importer đang dùng trong StoryAI; nó không định nghĩa vai trò của GPT. Các field được đánh dấu **bắt buộc** được kiểm tra ở API import. Các field AI Drama nên có giúp UI nối cảnh với hồ sơ nhân vật/bối cảnh và voice.

## Hai schema được chấp nhận

- `scene-script.v1`: một tập/chunk, có `chunk_id`, `chunk_summary`, `scenes` và `continuity_state`.
- `scene-series.v1`: project mới hoặc nhiều tập, có mảng `episodes` không rỗng; mỗi episode là `scene-script.v1`.
- New-project UI nhận JSON rồi tạo project theo các setting trên form. Root `project` và `series_bible` không thay thế lựa chọn project trong form. Không đưa model/provider, clip duration, voice ID, profile ID, file path hoặc media ID vào JSON.

Tối giản, một scene-series có dạng:

```json
{
  "schema": "scene-series.v1",
  "series_bible": {
    "logline": "...",
    "canon_locks": ["..."],
    "characters": [
      { "name": "Mira Tran", "description": "Mô tả ngoại hình ổn định.", "image_prompt": "English prompt for the three-view character reference." }
    ],
    "locations": [
      { "name": "Kho lưu trữ cũ", "aliases": [], "description": "Mô tả layout và landmark.", "image_prompt": "English prompt for the four-direction location reference." }
    ]
  },
  "episodes": [
    {
      "schema": "scene-script.v1",
      "chunk_id": "A01",
      "chunk_summary": "...",
      "scenes": [],
      "continuity_state": {}
    }
  ]
}
```

`series_bible` và root `project` là tùy chọn đối với API import. Bible được lưu thành metadata; khi project có kịch bản, StoryAI đồng bộ `characters` và `locations` trong Bible thành hồ sơ AI Drama. Ảnh tham chiếu bối cảnh còn thiếu được tạo tự động trên dashboard. Dùng đúng tên canonical ở từng cảnh để gán hồ sơ; các setting đang chọn ở form project mới là nguồn áp dụng.

Root `project` chỉ là metadata tương thích nếu có: `title`, `preset_id`, `language`, `visual_style`, `image_style`, `aspect_ratio`, `chunk_size`. `visual_style` là hướng ánh sáng/màu/không khí; `image_style` là chất liệu/cách dựng hình. Các giá trị này không ghi đè form khi tạo project mới từ JSON; vì vậy có thể bỏ hẳn `project` khỏi file.

## Episode: `scene-script.v1`

```json
{
  "schema": "scene-script.v1",
  "chunk_id": "A01",
  "chunk_summary": "Tóm tắt ngắn tập này.",
  "scenes": [
    {
      "id": "S001",
      "start_sec": 0,
      "end_sec": 10,
      "act": "Mở đầu",
      "purpose": "Mục tiêu cảnh.",
      "beat_summary": "Hành động nhìn thấy trong cảnh.",
      "dialogue_or_voiceover": "Mira hỏi: Cậu đã tìm thấy nó chưa?",
      "voiceover_target_sec": 3,
      "media_type": "video",
      "image_keyword": "woman archive room",
      "video_keyword": "searching archive shelves",
      "image_prompt": "One complete cinematic frame ...",
      "video_prompt": "A continuous shot ...",
      "continuity_in": "Mira vừa vào phòng.",
      "continuity_out": "Mira phát hiện cuốn sổ.",
      "source_basis": "A01 outline: tìm kiếm cuốn sổ.",
      "risk_flags": [],
      "characters": ["Mira Tran"],
      "location_name": "Kho lưu trữ cũ",
      "speaker_character": "Mira Tran",
      "dialogue_segments": [
        { "speaker_character": "Mira Tran", "text": "Cậu đã tìm thấy nó chưa?", "start_sec": 2, "end_sec": 4 }
      ]
    }
  ],
  "continuity_state": {
    "story_so_far": "Mira vào kho lưu trữ để tìm cuốn sổ.",
    "active_characters": ["Mira Tran"],
    "active_locations": ["Kho lưu trữ cũ"],
    "important_props": ["Cuốn sổ cũ"],
    "open_threads": ["Ai đã lấy cuốn sổ?"],
    "next_chunk_plan": "Mira tìm người đang giữ cuốn sổ."
  }
}
```

## Field cảnh

Các field sau **bắt buộc bởi importer**:

| Field | Kiểu | Quy tắc |
|---|---|---|
| `id` | string | `S001`, `S002`… liên tục, không trùng trong cả series. |
| `start_sec`, `end_sec` | number | `start_sec >= 0`; end lớn hơn start; cảnh tối đa 15 giây; không chồng lấn. |
| `act`, `purpose`, `beat_summary` | string | Ngắn gọn, nêu phần/kịch tính, mục tiêu và hành động chính. |
| `dialogue_or_voiceover` | string | Lời nói nối theo thứ tự; để rỗng nếu không thoại. |
| `voiceover_target_sec` | number | Số không âm; 0 khi im lặng; khớp gần đúng tổng thời gian nói. |
| `media_type` | string | Chỉ `image` hoặc `video`. |
| `image_keyword`, `video_keyword` | string | Cụm tiếng Anh ngắn dùng khi tìm media stock; không lặp nguyên prompt. |
| `image_prompt`, `video_prompt` | string | Prompt tạo ảnh/video bằng tiếng Anh. |
| `continuity_in`, `continuity_out`, `source_basis` | string | Trạng thái trước/sau cảnh và căn cứ ngắn từ nguồn. |
| `risk_flags` | array of strings | `[]` nếu không có flag. |

`continuity_state` **bắt buộc là object**; nên dùng `story_so_far`, `active_characters`, `active_locations`, `important_props`, `open_threads`, `next_chunk_plan` để bàn giao canon.

## Field liên kết AI Drama

Importer không bắt buộc các field sau, nhưng nên có để dùng tab AI Drama:

- `characters`: mảng tên canonical của những nhân vật thực sự nhìn thấy trong frame. Không gửi object hồ sơ hoặc profile ID.
- `location_name`: nên coi là bắt buộc trong JSON AI Drama; đây là tên canonical của bối cảnh chính. Mỗi cảnh chọn một bối cảnh chính và dùng tên đó ổn định để StoryAI tự gán hồ sơ bối cảnh, rồi thêm mô tả hồ sơ vào prompt tạo ảnh cảnh. Ảnh tham chiếu chỉ gửi kèm nếu đã có sẵn; không cần tạo ảnh bối cảnh trước. Importer vẫn nhận file cũ thiếu field này và có thể suy ra tên từ opening phrase tiêu chuẩn trong `image_prompt`.
- `speaker_character`: speaker đầu tiên; dùng tên canonical, `NARRATOR` hoặc `NONE`.
- `dialogue_segments`: từng lượt thoại với `speaker_character`, `text`, `start_sec`, `end_sec`. Thời gian tính từ đầu cảnh, theo thứ tự, nằm trong `end_sec - start_sec`. Cảnh im lặng dùng `[]`.

StoryAI có thể dùng tên canonical để tự gán hồ sơ sau khi người dùng đã tạo profile. Voice được chọn theo từng nhân vật trong UI; không có `voiceId`, tên voice hoặc voice settings trong schema JSON.

## Timeline và độ dài clip

- Scene ID tăng liên tục qua các tập. Chunk ID dùng `A01`, `A02`…; mỗi episode có một chunk ID duy nhất.
- `start_sec`/`end_sec` là timeline kịch bản trên toàn series. Timecode của `dialogue_segments` lại tính từ đầu từng scene.
- Độ dài scene trong timeline không chọn model hay duration của clip video. Model và thời lượng clip nằm trong media settings của project. Nếu một clip cần diễn trọn beat, căn nội dung scene theo clip duration đã chọn hoặc chia beat thành các scene phù hợp.
- `video_prompt` phải bao phủ đúng nhịp/hành động cần thể hiện trong cảnh; không yêu cầu model tạo chữ, phụ đề hoặc nhiều panel trong một frame.
- Với AI Drama, `image_prompt` mô tả đúng frame mở đầu tại 0 giây. Ảnh cảnh là chuẩn cho bối cảnh, bố cục, ánh sáng, đạo cụ và vị trí mở đầu; ảnh tham chiếu nhân vật chỉ khóa nhận diện và trang phục. Viết `video_prompt` bắt đầu từ frame đó, theo beat có timecode: nêu tên canonical, hành động cụ thể, đạo cụ đang cầm/chạm/trao, phản ứng và chuyển động máy quay. Giữ liên tục vị trí và trạng thái đạo cụ giữa các beat; không thêm nhân vật/đạo cụ hoặc đổi bối cảnh ngoài nội dung cảnh, không nhắc thêm ảnh hồ sơ bối cảnh khi đã dùng ảnh cảnh. Để nguyên văn lời thoại trong `dialogue_segments`, không chép vào `video_prompt`.

## Publishing package (tùy chọn)

Không cần kèm `publishing_package` để nhập kịch bản AI Drama; project có công cụ riêng tạo title và thumbnail. Chỉ thêm nếu người dùng yêu cầu xuất gói này. Khi thêm, episode dùng `publishing_package` gồm `title_options` và `thumbnail_prompt_options`; series dùng map `episodes` theo chunk ID và có thể có `series`.
