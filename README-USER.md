# Chạy StoryAI trên macOS và Windows bằng npm

StoryAI chạy trực tiếp trên máy và mở giao diện trong trình duyệt tại `http://localhost:3012`. Chỉ cần Node.js và chạy `npm start` trong Terminal hoặc PowerShell; không cần Docker.

## Yêu cầu

Chỉ cần cài Node.js 22 trở lên (Git là tùy chọn; FFmpeg và FFprobe chỉ cần nếu muốn render MP4).

Node.js/npm phải được cài trước khi chạy `npm start`; npm không thể tự cài Node.js vì bản thân npm cần Node.js để hoạt động. Khi chạy `npm start` (hoặc `Start StoryAI.bat` / `Start StoryAI.command`), nếu máy chưa có Git, StoryAI tự cài Git (qua WinGet trên Windows / Homebrew trên macOS) hoặc tự tải bản cập nhật và plugin trực tiếp từ GitHub qua HTTPS — kể cả khi người dùng tải mã nguồn bằng nút **Code → Download ZIP** trên GitHub mà không rành Git. Nếu thiếu FFmpeg/FFprobe, `npm start` sẽ in hướng dẫn cài tương ứng và vẫn chạy StoryAI.

Trên Windows, có thể cài bằng WinGet trong PowerShell:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Git.Git --exact
```

Đóng rồi mở lại PowerShell sau khi cài để nạp `PATH` mới. Nếu không cần render MP4, có thể bỏ qua bước cài FFmpeg.

Nếu cần render MP4, cài FFmpeg và FFprobe bằng gói Gyan:

```powershell
winget install --id Gyan.FFmpeg --exact
```

Gói này có cả `ffmpeg.exe` và `ffprobe.exe`. Đóng rồi mở lại PowerShell, sau đó xác nhận cả hai lệnh đều chạy được:

```powershell
ffmpeg -version
ffprobe -version
```

Trên macOS, cài Node.js 22 trở lên và Git bằng bộ cài hoặc package manager bạn đang dùng. Nếu cần render MP4, cài thêm FFmpeg.

Nếu đã có Homebrew, có thể cài bằng Terminal:

```sh
brew install node git
# Chỉ cần nếu muốn render MP4:
brew install ffmpeg
```

Homebrew cài cả lệnh `ffmpeg` và `ffprobe` trong gói này.

Nếu chưa dùng Homebrew, tải Node.js từ [nodejs.org](https://nodejs.org/en/download/) và Git từ [git-scm.com](https://git-scm.com/downloads/). Có thể cài Homebrew tại [brew.sh](https://brew.sh/).

Kiểm tra cài đặt trước khi clone:

```sh
node --version
npm --version
git --version
```

Node.js phải là phiên bản 22 trở lên. Nếu dùng render MP4, cả `ffmpeg -version` và `ffprobe -version` đều phải chạy thành công.

Người dùng phổ thông có thể tải ZIP từ nút **Code → Download ZIP** trên GitHub, giải nén rồi mở `Start StoryAI.bat` (Windows) / `Start StoryAI.command` (macOS) hoặc chạy `npm start` trong thư mục dự án. Hoặc mở Terminal/PowerShell và chạy:

```powershell
git clone https://github.com/nghiencarcom/storydola.git StoryAI
cd StoryAI
npm start
```

Lần chạy đầu tự kiểm tra/cài Git (hoặc dùng HTTPS trực tiếp), nối thư mục với GitHub nếu tải từ ZIP, tự cài thư viện npm, build ứng dụng, tạo `.env` cùng khóa mã hóa riêng cho máy, rồi mở trình duyệt. Người dùng đăng nhập bằng tài khoản MaiVideo.

## Remake video từ link

Mở **Remake video**, nhập link YouTube, Facebook, TikTok, Douyin hoặc Instagram công khai, hoặc link HTTPS trực tiếp đến MP4, MOV, WebM. Mỗi job có URL riêng dạng `/video-remake/<job-id>`; chọn job trong hàng đợi sẽ mở URL đó, còn **Sao chép link job** chép đường dẫn để lưu hoặc mở lại. Với video dài, StoryAI chia timeline thành các mốc nguồn 5 giây, lấy khung hình theo từng lô và giữ nguyên tệp nguồn để timecode chính xác. Code Agent đã chọn trong **Cài đặt** tự phân tích và chọn nhịp 5, 10 hoặc 15 giây cho từng cảnh. StoryAI không đặt giới hạn thời lượng hoặc dung lượng cho video tải từ link. StoryAI lập kế hoạch chung, viết theo từng nhóm cảnh và chia dự án Phim AI thành nhiều tập khi cần. Khi job hoàn tất, mở bản nháp để xem nhận xét theo mốc thời gian, kịch bản, nhân vật, bối cảnh và prompt từng cảnh. Chọn **Duyệt và tạo dự án Phim AI** để chuyển toàn bộ kịch bản sang quy trình sản xuất.

Máy chạy StoryAI cần FFmpeg, FFprobe, Chrome hoặc Chromium, và CLI đã đăng nhập với model hỗ trợ ảnh (Codex, Antigravity hoặc Claude Code). Với link nền tảng, StoryAI mở MaiVideo Bulk Download trước, tải kết quả thẳng vào thư mục job local, rồi mới thử `yt-dlp` nếu MaiVideo không hỗ trợ hoặc tải lỗi. Chrome/Chromium được tự dò; nếu cài ở vị trí khác, đặt `STORYAI_BROWSER_PATH` trong `.env`. `yt-dlp` cập nhật có hỗ trợ JavaScript là phương án dự phòng trong `PATH` hoặc `STORYAI_YT_DLP_PATH`. Link trực tiếp đến MP4, MOV, WebM không cần MaiVideo. StoryAI đọc phụ đề có sẵn, dùng dịch vụ transcript MaiVideo cho YouTube, Facebook và TikTok và có thể chạy Whisper cục bộ nếu đặt `STORYAI_WHISPER_TRANSCRIBE_PATH` tới binary `whisper-transcribe` của MaiVideo cùng `STORYAI_WHISPER_MODEL_DIR` tới thư mục mô hình. Bạn cũng có thể dán transcript khi thêm job.

## Mở ứng dụng và cập nhật

Mỗi lần muốn mở StoryAI, vào thư mục `StoryAI` trong Terminal hoặc PowerShell và chạy `npm start`. Với bản clone sạch trên nhánh `main`, lệnh này kiểm tra và tải mã mới từ GitHub, cài lại thư viện nếu cần, build khi mã nguồn thay đổi rồi khởi động ứng dụng. Cần có Internet để kiểm tra bản cập nhật.

Giữ cửa sổ Terminal mở trong lúc sử dụng. Nhấn `Ctrl+C` để dừng ứng dụng. Nếu đã sửa mã nguồn trực tiếp, launcher sẽ bỏ qua cập nhật tự động để giữ các chỉnh sửa đó.

Khi maintainer đẩy commit mới lên nhánh `main`, bản clone sạch sẽ nhận mã đó ở lần chạy `npm start` tiếp theo.

## Khi gặp lỗi

Giữ nguyên nội dung lỗi trong Terminal. StoryAI cũng ghi log tại `logs/storyai-supervisor.log`; dòng `Runtime` có phiên bản StoryAI, Node.js và hệ điều hành để tiện chẩn đoán. Khi báo lỗi trên [GitHub Issues](https://github.com/nghiencarcom/storydola/issues/new/choose), gửi hệ điều hành, các bước tái hiện, thông báo lỗi và phần log liên quan.

Không gửi file `.env`, thư mục `data/`, API key, token đăng nhập hoặc log chưa rà soát. Hãy xóa thông tin cá nhân và thông tin xác thực khỏi log trước khi đăng công khai.

## Kết nối Codex, Claude Code và Antigravity

StoryAI cung cấp MCP server chạy qua `stdio`. Coding agent dùng CLI/tài khoản đã đăng nhập của chính nó để viết và điều phối; StoryAI vẫn lưu project và render trên máy chạy StoryAI. Tạo ảnh/video theo provider đã cấu hình. OmniVoice TTS gọi MaiVideo Public API bằng API key đã lưu trong **Cài đặt**; key được giữ trong StoryAI và không được gửi vào prompt hay trả về cho agent. TTS dùng `POST /api/v1/tts`, còn danh sách voice lấy từ `GET /api/v1/voices` theo [tài liệu API MaiVideo](https://maivideo.top/docs).

1. Khởi động StoryAI, để ứng dụng chạy trong lúc agent làm việc, rồi đăng nhập MaiVideo trong trình duyệt. Cấu hình API/provider tạo media trong **Cài đặt** như bình thường.
2. Mở **Cài đặt → Kết nối coding agent qua MCP**, chọn agent rồi nhấn **Kết nối**. StoryAI tự tạo token khi cần và cài cấu hình cho Codex, Claude Code hoặc Antigravity. Nếu file cấu hình đã có, StoryAI sao lưu file trước khi cập nhật.
3. Tải lại MCP trong agent hoặc khởi động lại agent. Khi cần, mở **Cấu hình thủ công và token MCP** để sao chép cấu hình thay vì cài tự động.

StoryAI ghi cấu hình user vào `~/.codex/config.toml` cho Codex, `~/.claude.json` cho Claude Code và `~/.gemini/config/mcp_config.json` cho Antigravity. Các MCP server khác trong file được giữ lại. Antigravity có thể tải lại cấu hình từ **Settings → Customizations → Installed MCP Servers**.

### Cài Code Agent trên nhiều máy tính

Mỗi máy tính chạy StoryAI độc lập, có thư mục project, dữ liệu và token riêng. Để tự kết nối CLI trên một máy, cài CLI đó và chạy StoryAI bằng `npm start` ngay trên máy ấy. Sau đó mở `http://localhost:3012`, vào **Cài đặt → Kết nối coding agent qua MCP**, tạo token nếu được yêu cầu rồi nhấn **Kết nối** cho CLI đã cài trên máy. StoryAI tự ghi cấu hình MCP vào hồ sơ người dùng local và kiểm tra kết nối; không cần nhập IP LAN hay sửa `STORYAI_URL`.

Lặp lại các bước này trên từng máy tính. Nút **Kết nối** chỉ cấu hình CLI trên máy đang chạy StoryAI; vì vậy nếu mở một StoryAI từ xa trong trình duyệt, thao tác vẫn chạy ở máy chủ của ứng dụng. Token và project không tự đồng bộ giữa các máy.

Sau khi kết nối, có thể yêu cầu agent **“Dùng StoryAI MCP, tự viết kịch bản nguồn AI Drama từ ý tưởng sau; tạo project và viết/import JSON từng tập theo đúng mẫu StoryAI. Làm lần lượt từng tập, nối continuity; chưa tạo ảnh, voice hoặc render.”** Agent dùng chính model/tài khoản đã đăng nhập của Codex, Claude Code hoặc Antigravity để viết nội dung; người dùng không cần cung cấp API key viết kịch bản. StoryAI lưu bible, synopsis và outline làm kịch bản nguồn, rồi `storyai_get_episode_script_context` cung cấp canon, scene range, continuity và JSON mẫu cho từng chunk. Agent tự viết rồi gọi `storyai_import_episode_script` một tập `scene-script.v1` mỗi lần.

Ví dụ prompt đầy đủ:

> Dùng StoryAI MCP. Từ ý tưởng [mô tả ý tưởng], tự phát triển kịch bản nguồn AI Drama bằng tiếng Việt: logline, synopsis có kết thúc, bible nhân vật/bối cảnh với tên canonical, continuity rules và outline đủ số tập theo project. Tạo project AI Drama thời lượng 10 phút, 20 cảnh mỗi tập. Sau đó lấy context từng tập, tự viết đúng số scene ID và schema `scene-script.v1`, nối continuity rồi import lần lượt. Chỉ viết và nhập kịch bản; chưa tạo ảnh/video, voice/TTS hoặc render.

Nếu đã có project, yêu cầu agent lấy project bằng MCP rồi viết tiếp từ chunk còn thiếu. `storyai_get_episode_script_context` trả về range và số cảnh chính xác; mỗi tập phải có các ID đó, timeline liên tục toàn series, thời lượng cảnh AI Drama 5/10/15 giây, `location_name` và tên nhân vật canonical. JSON không chứa voice ID, model, provider hay API key. Lỗi validator khi import được trả thẳng cho agent để sửa rồi nhập lại.

Tạo ảnh/video vẫn gọi provider đã cấu hình trong StoryAI/MaiVideo khi người dùng yêu cầu; TTS vẫn đi qua OmniVoice MaiVideo. Việc agent viết kịch bản nguồn và JSON không gọi API viết kịch bản do StoryAI cấu hình.

Xếp job tạo ảnh/video sẽ gọi provider đã chọn và có thể phát sinh phí tài khoản MaiVideo/Seedance. MCP token chỉ truy cập project của tài khoản đã đăng nhập, cho phép đọc/cập nhật/import/tạo media/render và không cho phép xóa project. StoryAI mã hóa bản lưu token agent và phiên MaiVideo trong `data/` bằng `STORYAI_CREDENTIALS_ENCRYPTION_KEY` hoặc `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY`; mỗi agent cũng lưu token trong file cấu hình local để kết nối.

## Dựng hoạt hình bằng Blender local

StoryAI có chế độ render hoạt hình bằng Blender theo workflow scene Python của [video-studio-kit](https://github.com/owlinthebarnai/video-studio-kit), cùng tinh thần render local của 1VideoTool. Cài Blender 4.2 trở lên. StoryAI tự dò Blender trong `~/Applications/Blender.app`, `/Applications/Blender.app` hoặc `PATH`; nếu cài ở vị trí khác, đặt `STORYAI_BLENDER_PATH` trỏ tới executable Blender.

1. Mở project và yêu cầu Codex, Claude Code hoặc Antigravity đọc project/kịch bản cảnh, rồi dựng một cảnh Blender liên tục giữ nhận diện nhân vật, bối cảnh và các nhịp thời gian.
2. Agent lưu script `bpy` tại `data/outputs/<project-slug>/blender/scene.py`. StoryAI cung cấp đường dẫn script này qua MCP; script đọc JSON project/cảnh và tham số render do StoryAI truyền vào.
3. Chọn **Blender · dựng hoạt cảnh 3D local** ở phần render của project rồi nhấn render. Qua MCP, gọi `storyai_render_project` với `settings.renderer="blender"`; tool trả về ngay khi render bắt đầu. Sau đó gọi `storyai_wait_for_render` lặp lại đến khi trạng thái là `completed` hoặc `failed`.
4. StoryAI chạy Blender trên máy và lưu MP4 cùng file `.blend` có thể mở để sửa tiếp trong thư mục output của project.

Agent nên dựng và kiểm tra vài still đại diện các đoạn đầu/giữa/cuối bằng Blender trước khi render toàn bộ, theo quy trình của video-studio-kit. StoryAI không tự viết scene Blender thay agent; coding agent phải tạo `scene.py` trước khi gọi render. Chế độ Blender hiện xuất hình ảnh/hoạt cảnh local nhưng chưa ghép tiếng TTS hoặc âm thanh gốc. Tạo voice vẫn dùng OmniVoice MaiVideo như các chế độ khác.

- [Codex MCP](https://developers.openai.com/codex/mcp)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Antigravity MCP](https://developers.google.com/knowledge/mcp)

## Dữ liệu và cấu hình

- Mỗi máy lưu project, media và file render riêng trong thư mục `data/` cạnh mã nguồn; dữ liệu không tự đồng bộ giữa các máy.
- File `.env` và thư mục `data/` không bị ghi đè khi cập nhật. Không xóa hoặc đổi `SEEDANCE_CREDENTIALS_ENCRYPTION_KEY` sau khi đã lưu API key.
- Sao lưu cả `data/` và `.env`. Khi chuyển sang máy khác, chép chúng vào thư mục StoryAI mới để khôi phục dữ liệu và giữ nguyên khóa mã hóa.
- Ảnh chọn từ MaiVideo Media Library được tải về thư mục `data/` local; thư viện gốc vẫn thuộc tài khoản MaiVideo.
- Tính năng render MP4 cần FFmpeg và FFprobe trong `PATH`. Tích hợp HTMLVideo mặc định tìm dịch vụ local ở cổng 3000; OmniVoice TTS dùng MaiVideo Public API và API key trong Cài đặt.

## Tải mã nguồn ZIP

Có thể tải **Source code (zip)** từ [GitHub Releases](https://github.com/nghiencarcom/storydola/releases). Giải nén rồi chạy `npm start`. Bản ZIP không có metadata Git nên không tự tải cập nhật; dùng `git clone` ở hướng dẫn trên để nhận cập nhật tự động.
