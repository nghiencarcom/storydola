# StoryAI — Preset Knowledge

StoryAI đã nạp sẵn ba preset runtime trong `app/lib/story-presets.ts`:

- **AI Story**: narrator-led, giàu hình ảnh, có hook và cliffhanger.
- **Audio Story**: voice-first, ưu tiên lời đọc, dialogue, SFX và timing TTS.
- **AI Drama**: character-led, conflict, subtext, acting beat và continuity cảm xúc.

Tất cả preset dùng chung quy tắc `scene-script.v1`: cảnh 15 giây, gói 10–20 cảnh, timeline liên tục, ID continuity ổn định và JSON hợp lệ.

Sau mỗi chunk, pipeline lưu `story-continuity.v1` gồm tóm tắt diễn biến, trạng thái nhân vật, địa điểm, đạo cụ, các tuyến truyện còn mở và kế hoạch chunk kế tiếp. Context này được truyền vào request sau và được lưu cùng output để có thể tiếp tục sau khi reload.

Khi project có YouTube URL nhưng chưa có transcript, StoryAI gọi `maivideo/htmlvideo` `/api/crawl-url` để yt-dlp + Whisper tự trích transcript trước khi chạy chunk. Sau khi sinh scene, pipeline mặc định chạy `stock-mixed`: tìm Pexels image/video theo `image_keyword`/`video_keyword`, rồi dùng MaiVideo Image API làm fallback nếu có cấu hình key. Endpoint video PixVerse của MaiVideo cần bật `MAIVIDEO_VIDEO_API_ENABLED` và cung cấp session/auth server-side.
