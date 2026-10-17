# MaiVideo StoryAI — quy trình AI Drama

## Hai luồng đưa kịch bản vào project

- **Kịch bản nguồn AI Drama**: văn bản thường để dán khi tạo project. Gồm cốt truyện trọn vẹn, ghi chú story/canon, hồ sơ nhân vật/bối cảnh gọn và outline theo chunk. StoryAI tạo scene khi chạy từng chunk.
- **Nhập JSON**: `scene-script.v1` cho một tập/chunk hoặc `scene-series.v1` cho nhiều tập. Chỉ xuất JSON khi người dùng yêu cầu.
- Không biến project settings thành nội dung kịch bản. Model/provider, thời lượng clip, style, aspect ratio và các lựa chọn media được cấu hình trong UI.

## Hồ sơ nhân vật và bối cảnh trong UI

Tab **Nhân vật** quản lý tên, mô tả nhận diện, prompt ảnh, ảnh tham chiếu và voice tùy chọn. Mô tả dùng cho nhận diện hình ảnh; để tính cách, arc, quan hệ và cách viết thoại ở ghi chú câu chuyện riêng. Mỗi nhân vật có thể dùng voice riêng do người dùng chọn trong UI.

Tab **Bối cảnh** quản lý tên, bí danh, mô tả, prompt ảnh và ảnh tham chiếu. Mô tả nên nêu bố cục, lối vào, landmark, vật liệu và các điểm không đổi qua góc quay.

Prompt hồ sơ:

- **Nhân vật**: cùng một người trên nền trắng, đúng ba view: toàn thân chính diện, toàn thân phía sau, chân dung bán thân chính diện. Giữ khuôn mặt, tuổi đã xác lập, tóc, dáng, màu da, trang phục và bảng màu nhất quán; không thêm props chưa có trong canon.
- **Bối cảnh**: board 2×2 của cùng một địa điểm, bốn hướng bắc/đông/nam/tây; giữ nguyên mặt bằng, landmark và vị trí vật thể, chỉ đổi hướng camera.
- Đây là ảnh hồ sơ. `image_prompt` mô tả đúng frame mở đầu tại 0 giây. Video dùng ảnh cảnh làm chuẩn bối cảnh và bố cục, ảnh tham chiếu nhân vật để khóa nhận diện/trang phục; không gửi thêm ảnh hồ sơ bối cảnh khi ảnh cảnh đã được dùng.

## Visual style và Style Hình Ảnh

Hai trường được chọn độc lập trong form project và cùng áp dụng nhất quán cho ảnh hồ sơ, ảnh cảnh, video.

**Visual style** điều khiển hướng ánh sáng, bảng màu, tương phản và không khí:

| Preset | Đặc điểm |
| --- | --- |
| Cinematic | Ánh sáng có chủ đích, chiều sâu không khí và grade điện ảnh cân bằng |
| Warm & emotional | Tông ấm, chuyển bóng mềm, ánh sáng giàu cảm xúc |
| Bright & vibrant | Màu sáng, sinh động, chủ thể dễ đọc |
| Dark & suspenseful | Bóng tối có kiểm soát, điểm sáng chọn lọc, không khí hồi hộp |
| Dreamlike | Ánh sáng dịu, màu nhiều lớp, cảm giác mộng và kỳ ảo |
| Neon atmosphere | Đèn màu, phản chiếu có kiểm soát, tương phản lạnh/ấm |
| Natural documentary | Ánh sáng tự nhiên, màu tiết chế, môi trường chân thực |

**Style Hình Ảnh** điều khiển chất liệu và cách dựng hình:

| Preset | Đặc điểm |
| --- | --- |
| Photorealistic | Chất liệu và ánh sáng gần ảnh thật |
| 2D anime | Nét viền rõ, cel shading, biểu cảm anime vẽ 2D |
| 2D storybook | Minh hoạ 2D, hình khối biểu cảm, nền có chất liệu vẽ |
| Stylized 3D | Nhân vật 3D cách điệu, silhouette rõ, không hướng ảnh thật |
| Family 3D animation | Hoạt hình 3D thân thiện, biểu cảm, hoàn thiện bóng bẩy |
| Painterly illustration | Bề mặt cọ vẽ, màu nhiều lớp, nền vẽ tay |
| Graphic novel | Viền mực đậm, sáng tối đồ hoạ; không có khung truyện hay chữ |
| Stop-motion clay | Đất nặn có dấu vết thủ công, ánh sáng như phim stop-motion |

Kết hợp hai trường tự do, ví dụ **2D anime + Dark & suspenseful** hoặc **Family 3D animation + Bright & vibrant**. Hành động, phiêu lưu, động vật và sci-fi là thể loại/chủ đề; chúng không thay thế hai trường style. Với câu chuyện về động vật, chọn chất liệu dựng hình riêng (ví dụ 2D anime hoặc Family 3D animation) rồi giữ đúng loài và giải phẫu theo canon. Người dùng có thể nhập mô tả tuỳ chỉnh.

Khi người dùng muốn “kiểu Disney”, gợi ý **Family 3D animation** ở Style Hình Ảnh; chọn màu/ánh sáng riêng ở Visual style. Mô tả đặc điểm chung, không yêu cầu sao chép chính xác hãng hoặc phim cụ thể. Style không bảo đảm lượt xem; không ghép nhiều chất liệu render trong cùng một project.

Kịch bản JSON nên có `series_bible` và dùng `characters`, `location_name` với đúng tên canonical ở từng cảnh. StoryAI đồng bộ hồ sơ từ Bible hoặc cảnh sau khi import; mô tả bối cảnh được gắn vào prompt tạo ảnh của từng cảnh. Ảnh tham chiếu bối cảnh được gửi kèm nếu đã có sẵn, không cần tạo trước. Voice, audio và video vẫn được cấu hình riêng trong project.

## Thoại, scene và voice

- Mỗi cảnh có thể có nhiều lượt thoại. Không tách cảnh chỉ vì đổi speaker.
- `dialogue_segments` là timeline phân speaker: mỗi lượt có `speaker_character`, `text`, `start_sec`, `end_sec`. Speaker phải là tên canonical hoặc `NARRATOR`; cue theo thứ tự và nằm trong duration cảnh.
- `dialogue_or_voiceover` nối chính xác các câu theo thứ tự, không kèm nhãn speaker. `speaker_character` cấp scene ghi người nói đầu tiên. Cảnh im lặng dùng `NONE`, chuỗi thoại rỗng và `dialogue_segments: []`.
- StoryAI chọn voice theo hồ sơ nhân vật; GPT không xuất voice ID, tên voice, TTS hay voice direction.
- `start_sec`/`end_sec` là timeline của câu chuyện. Chúng không chọn model hoặc tự đổi thời lượng clip do model video tạo; model và clip duration được cấu hình riêng trong project UI. Nếu một clip cần diễn trọn beat, hãy dùng beat phù hợp clip length đã chọn hoặc chia cảnh.
- Mỗi cảnh tối đa 15 giây. Timeline liên tục toàn series; ID dạng `S001`, `S002`… nối tiếp qua các tập.
- `image_prompt` tiếng Anh mô tả một frame hoàn chỉnh; `video_prompt` tiếng Anh mô tả blocking, acting, camera, pacing và ambience phù hợp cảnh.

## Cách nhập JSON trong StoryAI

- Import nhận `scene-script.v1` hoặc `scene-series.v1`. Các trường thật sự được importer yêu cầu và mapping scene nằm trong `MaiVideo_StoryAI_Import_Reference.md`.
- `scene-series.v1` có thể giữ `series_bible` dưới dạng metadata. StoryAI dùng các mục `characters`/`locations` trong Bible để đồng bộ hồ sơ UI; điền `image_prompt` cho profile và dùng cùng tên canonical ở các cảnh. `location_name` là bắt buộc cho từng cảnh AI Drama để ảnh bối cảnh tương ứng được gắn vào prompt ảnh.
- Khi tạo project mới bằng màn **Nhập JSON**, tên project và project/media settings do form cung cấp. Không dựa vào `project` metadata trong JSON để cấu hình model, duration clip hay hồ sơ.
- Không cần gửi `publishing_package` mặc định. Tạo title/thumbnail bằng công cụ Publishing trong project khi cần.

## Bảo toàn nội dung

- Brief, transcript, bible và canon người dùng cung cấp là nguồn sự thật. Không tự bịa tuổi, nguồn gốc, trang phục, quan hệ, công nghệ, phép thuật hoặc props.
- Prompt và lời thoại phải tuân ngôn ngữ video đã chọn; image/video prompts bằng tiếng Anh. Giữ ngoại hình, trang phục, đạo cụ, layout và hướng nhìn nhất quán giữa cảnh.
