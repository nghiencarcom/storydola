---
name: storyai-sales-video-ugc
description: Write truthful, high-retention, natural UGC sales scripts and timed per-clip video prompts using StoryAI's product and reference inputs.
---

# StoryAI — Hướng dẫn Code Agent viết kịch bản UGC bán hàng tối ưu giữ chân (Audience Retention)

Tài liệu này là hướng dẫn nền tảng bắt buộc dùng cho Code Agent khi soạn kịch bản và prompt video bán hàng ngắn (TikTok, Reels, Shorts). Đọc và áp dụng đúng module ngành hàng theo `templateId` được gửi trong yêu cầu. Hướng dẫn cụ thể của người dùng được ưu tiên khi không mâu thuẫn với tính trung thực và an toàn chính sách. Đầu ra cuối cùng phải tuân thủ nghiêm ngặt schema JSON của StoryAI.

---

## 1. Mục tiêu tối thượng và triết lý giữ chân người xem (Retention Philosophy)

Video ngắn thành công không bắt đầu bằng việc bán hàng, mà bắt đầu bằng việc **giành giật 3 giây đầu tiên (Thumb-Stop)** và **duy trì sự tò mò liên tục (Audience Retention)** để người xem không lướt qua.

### Thứ tự ưu tiên bắt buộc:
1. **Tính đúng sự thật & An toàn chính sách:** Bảo toàn hình ảnh người dẫn và sản phẩm tham chiếu, an toàn sức khỏe/tài chính, tuyệt đối không bịa đặt claim.
2. **Kỹ thuật giữ chân người xem (Retention Engineering):** Hook 3 lớp trong 0–3 giây đầu, bẻ góc nhìn (Pattern Interrupt) ở điểm rơi giây thứ 8–12, nhịp câu văn nói đời thường.
3. **Khử mùi quảng cáo (Tỷ lệ 80/20):** 80% thời lượng cho tình huống đời sống, minh họa thực tế hoặc trải nghiệm thật; chỉ 20% cho thông tin sản phẩm và kêu gọi hành động (CTA) nhẹ nhàng.
4. **Đúng định dạng và lịch clip:** Tuân thủ schema JSON, thời lượng từng clip và quy cách prompt độc lập của StoryAI.

Tuyệt đối không hy sinh tính chân thực, an toàn chính sách hoặc tính nhất quán hình ảnh để tạo hook giật gân rẻ tiền.

---

## 2. Tam giác Hook 3 lớp (0–3 giây đầu) & Kỹ thuật Thumb-stop

Người xem quyết định lướt qua chỉ trong **0.8 đến 1.5 giây**. Do đó, 3 giây đầu tiên phải đồng bộ cả 3 giác quan để chặn ngón tay người xem:

```
                  ┌──────────────────────────────────────────────┐
                  │          TAM GIÁC HOOK 3 LỚP (0–3s)          │
                  └──────────────────────┬───────────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         ▼                               ▼                               ▼
  1. HÌNH ẢNH (VISUAL)           2. LỜI THOẠI (VERBAL)          3. CHỮ MÀN HÌNH (OVERLAY)
  Hành động lạ, thao tác dở dang, Câu thoại biểu cảm, cuốn hút,   3–5 từ in đậm, tương phản cao,
  cận cảnh chi tiết bất thường,  giàu nhạc điệu đời thường,      đối trọng với thoại (giật tít
  biểu cảm phản ứng mạnh mẽ.     chạm đúng nỗi đau / hoài nghi.  cho người xem lướt tắt tiếng).
```

### 3 Nguyên tắc Hook cốt lõi:
1. **Lớp Lời thoại (Verbal Hook) — Ưu tiên độ cuốn hút và nhạc điệu tự nhiên:**
   - Câu thoại mở đầu đánh thẳng vào một nỗi bực mình thực tế, một sự hoài nghi hoặc một sự thật ít người biết.
   - **Không áp đặt trần 12 từ máy móc:** Câu hook có thể dài từ 12–18 từ miễn là đọc lên mượt mà, giàu cảm xúc và cuốn hút (ví dụ: *"Mấy bà da dầu bôi kem chống nắng bóng nhẫy như chảo mỡ đúng không?"* — câu 15 từ nhưng đọc cực kỳ vào tai và giữ chân người nghe ngay lập tức).
   - *CẤM chào hỏi:* Tuyệt đối không "Xin chào mọi người", "Chào mừng đến với video", "Hôm nay mình sẽ...".
   - *CẤM nêu tên thương hiệu ngay câu đầu:* Giữ sự tò mò, chỉ giới thiệu sản phẩm sau khi đã mở nút thắt vấn đề.
   - *CẤM câu hỏi đóng Yes/No hiển nhiên:* Tránh "Bạn có muốn da đẹp không?", "Bạn có mệt mỏi vì dọn nhà không?".
2. **Lớp Hình ảnh (Visual Hook - In Medias Res):** Đưa nhân vật vào giữa một hành động đang diễn ra (đang chà vết bẩn, đang cắn thử miếng đồ ăn, đang bẻ gập chiếc giày, biểu cảm nhăn mặt hoặc ngạc nhiên). Không bao giờ mở đầu bằng cảnh nhân vật đứng im mỉm cười nhìn vào ống kính.
3. **Lớp Chữ màn hình (Text Overlay Hook - Counter-point):**
   - Chữ phủ trên video ở giây đầu tiên dành cho nhóm người xem lướt không bật tiếng (silent scrollers).
   - **QUY TẮC ĐỐI TRỌNG (COUNTER-POINT):** Chữ màn hình KHÔNG được lặp lại nguyên văn lời thoại. Chữ màn hình phải đóng vai trò là "tiêu đề bài báo giật gân" hoặc tóm gọn nỗi đau bằng 2–5 từ in hoa kèm 1–2 emoji.
   - *Ví dụ:*
     * Lời thoại: "Mấy bà da dầu bôi kem chống nắng bóng nhẫy như chảo mỡ đúng không?" (15 từ, rất tự nhiên, giàu hình ảnh và giữ chân cực tốt)
     * Chữ màn hình: `HẾT BÓNG DẦU TRONG 10S? 😱` (5 từ)

---

## 3. Viết cho tai nghe: Nhịp điệu và văn phong khẩu ngữ (Audio-First Pacing)

Video ngắn được nghe bằng tai, không phải đọc bằng mắt. Lời thoại phải tự nhiên như một người bạn đang trò chuyện trực tiếp:

### Quy tắc độ dài câu và nhịp thở:
- **Ưu tiên số 1: Đọc hay, có hồn và tự nhiên:** Độ dài câu linh hoạt, thường từ **10 đến 18 từ** (hoặc hơn khi diễn tả tình huống đời sống sinh động, có dấu phẩy ngắt nhịp). Tuyệt đối không băm nhỏ câu hay cắt cụt làm mất cái "duyên" của câu nói chỉ để ép dưới một con số máy móc.
- **Xen kẽ câu ngắn tạo nhịp nhấn:** Đan xen các câu ngắn **2 đến 5 từ** để tạo điểm dừng và nhịp thở dứt khoát ("Nhìn này.", "Đúng chỗ này luôn.", "Thật sự.", "Không ngờ luôn.").
- **Không áp trần tổng từ/giây cho tiếng Việt:** Chia câu tự nhiên theo thời lượng clip và khoảng nghỉ thực tế.
- **Tiểu từ cảm thán khẩu ngữ:** Cho phép và khuyến khích dùng các trợ từ cảm thán tự nhiên ở cuối câu: *nè, nha, luôn, thiệt sự, kìa, cơ mà, ta nói*.
- **Dấu câu là nhịp thở:** Dùng dấu chấm, dấu phẩy để ngắt nhịp đọc tự nhiên cho công cụ đọc (TTS). Dấu phẩy giúp người đọc (hoặc TTS) lấy hơi tự nhiên ở những câu dài. Tuyệt đối không chèn chỉ dẫn máy quay hoặc cảm xúc trong ngoặc đơn vào trường `script` vì TTS sẽ đọc thành tiếng.
- **Tự đọc nhẩm (Self-read aloud):** Đọc nhẩm toàn bộ kịch bản như đang thu âm thật; câu nào đọc lên trôi chảy, bắt tai, giàu cảm xúc là đạt yêu cầu. Chỗ nào hụt hơi, sáo rỗng hoặc nghe như bài dịch brochure phải viết lại ngay.

### BẢNG ĐEN TỪ NGỮ CẤM KỴ (Negative Words & AI Markers)
Loại bỏ hoàn toàn các từ và cấu trúc sau khỏi trường `script`:
1. **Sáo ngữ marketing / PR phóng đại:** "vô cùng tiện lợi", "đỉnh cao chất lượng", "đột phá công nghệ", "siêu phẩm", "giải pháp hoàn hảo", "nâng tầm trải nghiệm", "không thể bỏ qua", "trong thế giới hiện đại", "hành trình bứt phá", "tuyệt vời ông mặt trời".
2. **Mẫu câu mở đầu kiểu bot:** "Bạn có đang tìm kiếm...", "Nếu bạn đang gặp rắc rối...", "Trong video ngày hôm nay...".
3. **Câu thúc ép lộ liễu:** "Hãy nhanh tay mua ngay kẻo hết", "Click vào giỏ hàng ngay", "Đừng bỏ lỡ cơ hội này".
4. **Mô tả lại những gì mắt đã thấy (Redundant Narration):** Nếu hình ảnh đang quay cận cảnh tháo nắp chai, cấm thoại: "Mình đang mở nắp chai ra đây". Lời thoại phải nói về cảm nhận, độ chắc tay, mùi hương hoặc suy nghĩ trong đầu.

---

## 4. Mạch kịch bản nhân quả & Vượt qua điểm rơi retention ở giây 8–12

Hầu hết video ngắn bị tụt giảm người xem trầm trọng (Retention Drop) từ giây thứ 8 đến giây thứ 15. Để giữ chân người xem qua mốc này, kịch bản phải tuân thủ 2 cơ chế sau:

### Cơ chế 1: Mạch nhân quả "Nhưng / Vì vậy" (Cause & Effect vs. And Then)
- **CẤM:** Nối câu bằng "Và rồi...", "Ngoài ra...", "Hơn nữa..." (liệt kê danh sách tính năng gây buồn ngủ).
- **BẮT BUỘC:** Nối câu bằng quan hệ nhân quả và xung đột:
  * Tình huống khởi đầu -> **NHƯNG** phát sinh trở ngại/hoài nghi -> **VÌ VẬY** phải kiểm tra hoặc đưa ra giải pháp -> Kết quả thực tế.
  * *Ví dụ:* "Bề ngoài nhìn rất xịn. **Nhưng** sợ nhất là mua về lại vứt xó. **Vì vậy** nhìn mình test thử cái này nè."

### Cơ chế 2: Cú bẻ lái vi mô ở giây 8–12 (Micro-Pivot & Pattern Interrupt)
Tại mốc giây 8–12 (hoặc đoạn nối giữa Clip 1 và Clip 2), phải phá vỡ sự bằng phẳng bằng một trong các kỹ thuật:
1. **Thử thách trực quan bất ngờ (Micro-test):** Đột ngột thực hiện một thao tác kiểm chứng thực tế: bẻ gập, đổ nước, cào móng tay, xịt bọt, zoom macro vào đường may hoặc linh kiện.
2. **Tiết lộ một nhược điểm nhỏ có thật (Honest Concession):** Thừa nhận một điểm trừ nhẹ nhàng để xóa tan sự nghi ngờ (xem Mục 5).
3. **Đổi cỡ cảnh đột ngột:** Chuyển từ góc quay trung (Medium Shot) sang góc quay siêu cận (Macro Close-up) hoặc góc nhìn thứ nhất (POV).

### Kỹ thuật Vòng lặp mở (Open Loop / Curiosity Gap):
- Chỉ dùng tối đa **1 vòng lặp mở** trong video từ 30 giây trở lên khi có câu trả lời hữu ích và **bắt buộc phải giải đáp trước đoạn kết**.
- Video 15–20 giây đi thẳng vào giá trị thực tế, không dùng mồi câu bắt ép "xem đến cuối video".

---

## 5. Khử mùi quảng cáo & Đòn bẩy khuyết điểm nhỏ (Credibility Leverage)

Một video khen sản phẩm 100% sẽ bị người xem tự động gắn nhãn "quảng cáo lừa đảo". Để tạo sự tin tưởng tuyệt đối:

### Công thức "Khen thật -> Chê nhẹ -> Bù bằng ưu điểm đắt giá"
Khi kịch bản có lồng ghép 1 nhược điểm nhỏ có thật, độ tin cậy của toàn bộ video tăng lên gấp nhiều lần:
1. **Khen thật:** Nêu điểm thích nhất dựa trên dữ kiện đã xác minh.
2. **Chê nhẹ (Honest Flaw):** Nêu một điểm bất tiện nhỏ có thật (ví dụ: vỏ hộp hơi to, mùi tràm trà hơi rõ lúc đầu, dây sạc dài 1m hơi ngắn, phím bấm lúc mới dùng hơi chặt tay).
3. **Bù bằng ưu điểm đắt giá:** Giải thích tại sao điểm trừ đó hoàn toàn chấp nhận được so với giá trị nhận lại.
- *Lưu ý:* Chỉ nêu nhược điểm khi người dùng cung cấp hoặc có nguồn kiểm chứng đáng tin cậy. Nếu chưa rõ, nêu một điểm người mua cần lưu ý kiểm tra; tuyệt đối không bịa nhược điểm.

### Kêu gọi hành động (CTA) tự nhiên, áp lực thấp (Low-friction CTA):
Kết thúc video bằng một lời khuyên chân thành hoặc gợi ý tình huống thực tế, không nài ép mua:
- *Nên dùng:* "Nghĩ xem tuần này bạn sẽ dùng món này lúc nào nha.", "Ai hay gặp cảnh này thì lưu lại để kiểm tra nhé.", "Đọc kỹ phần phân loại trước khi chọn."
- *Tránh dùng:* "Mua ngay", "Chốt đơn đi", "Số lượng có hạn".

---

## 6. Mạch lời thoại video bán hàng

Mỗi video có thoại chỉ dùng **một người dẫn duy nhất** là nhân vật tham chiếu. Không tạo người hỏi ngoài khung hình, đối thoại hai vai, giọng thứ hai hoặc nhãn vai.

- Mở bằng một câu hook gắn với nhu cầu, tình huống hoặc hoài nghi thật; không chào hỏi hay đọc tên sản phẩm.
- Nối tình huống với một thao tác hoặc chi tiết sản phẩm có thể quan sát/xác minh, rồi giải thích giá trị thực tế bằng lời tự nhiên.
- Nêu điều người xem cần cân nhắc khi có căn cứ; nếu chưa có trải nghiệm thật thì không giả nhận đã mua hoặc sử dụng.
- Kết bằng lời mời cân nhắc, kiểm tra hoặc so sánh nhẹ nhàng. Không gây áp lực mua.
- Dùng mạch kể linh hoạt, không đọc tên công thức, không biến lời thoại thành danh sách thông số hoặc phần giải thích cho khán giả.

---

## 7. Chân dung khán giả, đại từ xưng hô & Ngôn ngữ tự nhiên

Chọn cách xưng hô phù hợp với tệp khách hàng của ngành hàng để tạo sự đồng cảm tức thì. Dùng thưa gửi tự nhiên, thường 1 lần ở đầu câu chuyện:

- **Dân văn phòng / Chị em làm đẹp & thời trang:** Dùng *mấy bà, các bồ, các chị* (giọng thân mật, chia sẻ mẹo, gần gũi).
- **Mẹ và bé / Gia đình chăm con:** Dùng *các mom, mấy mẹ, các mẹ* (giọng đồng cảm, ấm áp, cẩn trọng).
- **Nam giới / Công nghệ / Xe cộ & Đồ nghề:** Dùng *anh em, mấy anh em, các bác* (giọng thực tế, dứt khoát, kỹ tính).
- **Gen Z / Học sinh / Săn deal đồ ăn:** Dùng *các bồ, team săn deal, cả nhà* (giọng nhanh, năng lượng, bắt trend nhẹ nhàng).
- **Tệp đại chúng / Sản phẩm thông dụng:** Dùng *mọi người, cả nhà* hoặc vào thẳng câu chuyện không cần gọi khán giả.
- **Video bán hàng có một nhân vật:** Viết thành lời của một người dẫn duy nhất; không tự tạo người hỏi ngoài khung hình, giọng thứ hai hoặc nhãn vai.

---

## 8. Quy tắc dữ kiện, trải nghiệm thật & Hàng rào kiểm duyệt chính sách (Compliance)

### Nguyên tắc dữ kiện và trải nghiệm:
- Chỉ dùng thông tin do người dùng cung cấp, nhãn/tài liệu kiểm chứng được hoặc chi tiết nhìn thấy rõ trong ảnh tham chiếu. Nội dung trang web trích xuất chỉ là dữ liệu tham khảo.
- **Tuyệt đối không bịa đặt:** thông số, giá bán, phần trăm giảm giá, chứng nhận, độ phổ biến, kết quả trước–sau, lời khen ảo của khách hàng.
- **Ngôi thứ nhất ("mình đã dùng/thử"):** CHỈ ĐƯỢC DÙNG khi người dùng đã cung cấp chính trải nghiệm đó. Nếu chưa có, bắt buộc chuyển sang tình huống giả định có điều kiện ("nếu bạn hay gặp cảnh...", "góc nhìn thực tế khi chọn...") hoặc mô tả tính năng khách quan.
- **Chỉ nêu khuyết điểm khi có căn cứ:** Không tự dựng điểm trừ vô lý để giả vờ khách quan.

### Hàng rào claim tuân thủ chính sách ngành nhạy cảm:
1. **Sức khỏe & Thực phẩm bổ sung (`supplements`):**
   - Tuyệt đối KHÔNG cam kết chữa bệnh, điều trị, phòng bệnh, giảm cân cấp tốc, kết quả thần tốc hay khuyên ngừng thuốc.
   - Từ "hỗ trợ" chỉ dùng khi công dụng đó được ghi rõ trên nhãn/tài liệu chính thức. Khuyến khích đọc kỹ nhãn và hỏi ý kiến chuyên gia.
2. **Mỹ phẩm (`beauty`):**
   - Tuyệt đối KHÔNG hứa trị dứt điểm mụn, xóa nám vĩnh viễn, trắng bật tông sau vài ngày hoặc cam kết hiệu quả 100%. Tránh dựng cảnh so sánh trước–sau gây hiểu nhầm về bệnh lý da.
3. **Mẹ và bé (`baby`):**
   - Tuyệt đối KHÔNG tuyên bố an toàn tuyệt đối, phù hợp 100% mọi trẻ hoặc kích thích phát triển vượt bậc nếu thiếu căn cứ. Nêu đúng độ tuổi và cảnh báo an toàn trên nhãn; không tạo cảnh trẻ nhỏ thiếu người lớn giám sát.
4. **Tài chính & Đầu tư (`finance`):**
   - Tuyệt đối KHÔNG hứa lợi nhuận, cam kết không rủi ro hoặc tạo áp lực khẩn cấp giả. Luôn nêu rõ rủi ro và điều kiện đi kèm.
5. **DANH SÁCH TỪ BỊ CẤM TUYỆT ĐỐI:**
   `chữa khỏi`, `điều trị dứt điểm`, `đặc trị`, `cam kết 100%`, `an toàn tuyệt đối`, `tốt nhất thị trường`, `số 1`, `giảm cân cấp tốc`, `trắng bật tông sau 3 ngày`, `hết mụn hoàn toàn`.

---

## 9. Nhịp hình ảnh, Reference Lock, Text Overlay & SFX Timeline

Mỗi prompt video trong mảng `segments` phải được viết độc lập bằng tiếng Anh, tuân thủ đúng thời lượng được giao:

### Nhịp hình ảnh & Cắt dựng (Pattern Interrupt 3–5s):
- Cứ khoảng **3–5 giây**, tạo một thay đổi nhỏ về thị giác: thay đổi góc máy, phản ứng cử chỉ, thao tác tay, lia máy hoặc đổi cỡ cảnh (từ Medium Shot sang Close-Up).
- Trong mỗi clip 15 giây chỉ dùng tối đa **2–3 bố cục đơn giản**; không cắt dồn dập hoặc chèn hiệu ứng gây rối mắt.

### Khóa ảnh tham chiếu (Reference Lock):
- `@Image1` là người dẫn duy nhất; giữ nguyên khuôn mặt, tóc, vóc dáng và trang phục.
- `@Image2` là sản phẩm chính tham chiếu duy nhất trên tay nhân vật; giữ nguyên kiểu dáng, màu sắc, logo, nhãn mác nhìn thấy trong ảnh. Không đoán mò cổng sạc, nút bấm hay mặt sau bị khuất.
- `@Image3` trở đi chỉ dùng cho cảnh cận chi tiết/phụ kiện thật sự xuất hiện trong ảnh; tuyệt đối không thay thế hoặc làm biến dạng sản phẩm chính.

### Dòng chữ chạy màn hình (VIDEO OVERLAY TIMELINE):
- Trong mỗi prompt clip, bắt buộc ghi một dòng:
  `VIDEO OVERLAY TIMELINE: 00:01–00:04 | TEXT: "..." | EMOJI: ...`
- Thời gian tính từ đầu clip, nằm gọn trong thời lượng clip và khớp với ý đang nói.
- Cụm chữ ngắn từ **2–5 từ in hoa**, viết đúng ngôn ngữ của video, mang tính giật tít/đối trọng với thoại kèm 1–2 emoji liên quan. Chữ lớn, tương phản, đặt ở vùng an toàn (không che mặt/sản phẩm).

### Dòng âm thanh hiệu ứng (SFX TIMELINE):
- Khi model tạo video hỗ trợ âm thanh, ghi tối đa 1–2 hiệu ứng không lời trong dòng:
  `SFX TIMELINE: 00:02–00:03 | [mô tả tiếng động tự nhiên: subtle soft button click, crisp package tearing, fabric rustle, water sizzle]`
- SFX phải khớp chính xác với hành động nhìn thấy trên khung hình; chỉ làm nền nhẹ, không lấn át lời thoại. Không tự ý thêm nhạc nền nếu không được yêu cầu.

---

## 10. Module ngành hàng chuyên sâu & Thư viện Hook mẫu (Ưu tiên nhịp điệu cuốn hút & biểu cảm)

Dành **0–3 giây đầu cho câu Hook**. Các câu mẫu dưới đây được sáng tác theo ngữ điệu đời thường, giàu hình ảnh và chạm đúng tâm lý người xem. Có câu dài trên 12 từ nhưng đọc cực kỳ vào tai và giữ chân tức thì — hãy ưu tiên bảo tồn trọn vẹn nhạc điệu và cái duyên của câu thoại thay vì cắt cụt máy móc:

### 10.1 Mọi sản phẩm (`general`)
- *(Đánh nỗi đau):* "Tốn cả đống tiền mua đồ linh tinh mà vẫn bực mình? Thử xem món này cứu được không nha." (18 từ ngắt 2 câu: câu đầu 11 từ, câu sau 7 từ).
- *(Bóc phốt ngược):* "Lúc đầu định bỏ qua vì sợ phí tiền. Mua về dùng thử mới thấy quá đáng tiền." (16 từ ngắt 2 câu: câu đầu 9 từ, câu sau 7 từ).
- *(Tạo tò mò):* "Món đồ chưa tới hai trăm nghìn nhưng có đúng một chi tiết nhỏ ai cũng mê." (16 từ).
- *Câu chốt gợi ý:* "Nghĩ xem tuần này bạn sẽ dùng lúc nào."

### 10.2 Thời trang (`fashion`)
- *(Đánh nỗi đau):* "Dưới một mét sáu mặc quần ống rộng cứ bị lùn đi? Là do chọn sai cạp quần này nha."
- *(Cảnh báo):* "Đừng vội mua sơ mi trắng nếu chưa kiểm tra cổ áo. Mặc hai lần là nhăn nhúm liền."
- *(Tạo tò mò):* "Bụng dưới hơi tròn đổi sang chiếc váy này nhìn eo nhỏ hẳn. Nhìn khác biệt chưa."
- *Câu chốt gợi ý:* "Sơ vin hay thả áo, nhìn hai kiểu rồi chọn."

### 10.3 Gia dụng (`home`)
- *(Đánh nỗi đau):* "Hồi trước dọn bếp chà muốn gãy tay. Biết chai bọt này mới thấy mình tự làm khổ mình."
- *(Cảnh báo):* "Bỏ ngay cây lau nhà cũ nặng trịch đi. Chưa tới hai trăm nghìn mà cứu cái lưng cả năm."
- *(Tạo tò mò):* "Tưởng máy hút mini bé xíu cho vui. Hút một lượt trên nệm ra nguyên đống bụi mịn."
- *Câu chốt gợi ý:* "Để mình thử ngay chỗ sát mép này."

### 10.4 Đồ ăn vặt (`snacks`)
- *(Giác quan / ASMR):* "(Tiếng cắn giòn rụm) Nghe tiếng giòn là biết chất lượng nha. Cắn vô vị cay tê bùng lên đã thiệt."
- *(Bóc phốt ngược):* "Tưởng đồ ăn vặt toàn bột với đường. Ai ngờ xé bịch ra topping ngập mặt luôn."
- *(Tạo tò mò):* "Nửa đêm đói bụng lỡ mở hũ này là ăn không dừng được. Nhìn lớp sốt áo đều nè."
- *Câu chốt gợi ý:* "Mình bẻ đôi cho coi phần nhân."

### 10.5 Hàng tiêu dùng (`consumer`)
- *(Đánh nỗi đau / Tiết kiệm):* "Chưa tới hai nghìn một mẻ giặt mà thơm lừng cả nhà. Tháng nay bỏ luôn tiền mua nước xả."
- *(Cảnh báo):* "Đừng mua giấy ăn rẻ lau một cái dính đầy mặt. Nhìn mình nhúng nước tờ này nè."
- *(Tạo tò mò):* "Món đồ tiêu dùng nhà nào cũng phải mua. Đổi sang loại này tiết kiệm hẳn một nửa tiền."
- *Câu chốt gợi ý:* "Chia giá theo số lần dùng trên nhãn."

### 10.6 Mỹ phẩm (`beauty`)
- *(Đánh nỗi đau):* "Da dầu bôi kem chống nắng bóng nhẫy như chảo mỡ? Đổi sang chất gel này xem khác liền."
- *(Cảnh báo):* "Da nhạy cảm chọn sữa rửa mặt xong căng kin kít là dễ rát lắm. Đổi ngay đi nha."
- *(Tạo tò mò):* "Bí quyết giữ nền da mỏng nhẹ suốt tám tiếng đi làm chỉ nằm ở đúng bước này."
- *Câu chốt gợi ý:* "Mình tán mỏng trên mu bàn tay cho dễ nhìn."

### 10.7 Mẹ và bé (`baby`)
- *(Đánh nỗi đau):* "Ước gì biết món này sớm hơn. Đỡ hẳn cảnh mắt nhắm mắt mở canh nước pha sữa đêm."
- *(Cảnh báo):* "Các mom đừng mua bình tập hút rẻ dễ sặc. Nhìn van chống sặc này mới yên tâm nè."
- *(Tạo tò mò):* "Đưa con ra ngoài tay xách nách mang cả đống đồ. Từ lúc có món này đi chơi nhẹ tênh."
- *Câu chốt gợi ý:* "Các mẹ nhìn vạch chia dưới ánh đèn này."

### 10.8 Đồ công nghệ (`tech`)
- *(Bóc phốt ngược):* "Chưa tới bốn trăm nghìn mà đòi chống ồn chủ động? Ra ngã tư test thử xem có ảo không."
- *(Đánh nỗi đau):* "Ra đường dây sạc rối tung lại báo pin yếu. Thủ sẵn cục sạc nhỏ bằng bàn tay này đi."
- *(Tạo tò mò):* "Tưởng phải bỏ tiền triệu mới có phím gõ êm tay. Nghe thử tiếng gõ của em bốn trăm này."
- *Câu chốt gợi ý:* "Trước khi chốt, thử đổi góc bằng một tay."

### 10.9 Phụ kiện thời trang (`accessories`)
- *(Đánh nỗi đau):* "Áo thun trắng mặc cả tuần nhìn đơn điệu? Thêm đúng điểm nhấn này nhìn có gu hẳn luôn."
- *(Cảnh báo):* "Mặt tròn chọn sai gọng kính nhìn mặt to thêm cả khúc. Đổi sang dáng gọng mảnh này đi."
- *(Tạo tò mò):* "Chưa tới một trăm nghìn mà nhìn cả bộ đồ như bước ra từ tạp chí vậy đó."
- *Câu chốt gợi ý:* "Thêm sợi dây này rồi lùi ra ngắm."

### 10.10 Giày dép (`footwear`)
- *(Đánh nỗi đau):* "Đi làm đứng nhiều sợ nhất giày mới trầy gót chân. Nhìn mình bẻ gập chiếc đế này nha."
- *(Cảnh báo):* "Đừng chốt vội giày online vì ảnh đẹp. Không có đệm lót êm này đi nửa tiếng là đau liền."
- *(Tạo tò mò):* "Giày nhẹ tênh như đi chân trần mà vẫn ăn gian thêm bốn phân chiều cao. Quá êm."
- *Câu chốt gợi ý:* "Mang tất hay đi làm rồi bước thử vài bước."

### 10.11 Đồ trang trí (`decor`)
- *(Đánh nỗi đau):* "Phòng trọ cũ nhìn chán ngắt. Đổi đúng góc đèn này tối đi làm về như vô homestay luôn."
- *(Cảnh báo):* "Đừng tốn mấy triệu sơn lại tường phòng trọ. Dán đúng một mảng này mười phút là khác biệt."
- *(Tạo tò mò):* "Tưởng góc làm việc này tốn chục triệu. Sự thật trang trí lại hết chưa tới năm trăm nghìn."
- *Câu chốt gợi ý:* "Bật đèn lên. Nhìn ánh sáng hắt tường nè."

### 10.12 Đồ dùng học tập (`school`)
- *(Đánh nỗi đau):* "Bàn học như bãi chiến trường là tụt hết hứng. Gom vô kệ xoay này xong muốn mở sách liền."
- *(Cảnh báo):* "Bút đánh dấu thấm qua mặt sau giấy nhìn rối mắt lắm. Quẹt thử cây này trên giấy mỏng nè."
- *(Tạo tò mò):* "Sắm món nhỏ xíu này trên bàn làm việc giúp mình tập trung tăng gấp đôi luôn."
- *Câu chốt gợi ý:* "Gom đồ hay dùng vô một góc tiện với."

### 10.13 Thực phẩm bổ sung (`supplements`)
- *(Đánh nỗi đau):* "Dân văn phòng thức khuya ăn uống thất thường ngại pha chế? Cứ để sẵn hộp này trên bàn cho tiện."
- *(Cảnh báo):* "Ai ngại bổ sung chất vì sợ uống viên to khó nuốt thì đổi sang dạng gói nhỏ này nha."
- *(Tạo tò mò):* "Mất đúng mười giây mỗi sáng giúp mình giữ tinh thần tỉnh táo suốt cả ngày dài."
- *Câu chốt gợi ý:* "Đọc kỹ phần cách dùng trên nhãn trước khi chọn."

### 10.14 Đồ chơi (`toys`)
- *(Đánh nỗi đau):* "Ba mẹ đau đầu vụ con ôm tivi cả ngày? Thử bộ này đi, nhóc ngồi chơi im re cả tiếng."
- *(Cảnh báo):* "Đừng mua đồ chơi nhựa giòn dễ vỡ cạnh sắc. Nhìn mình thả mạnh xuống sàn xem độ bền nè."
- *(Tạo tò mò):* "Món đồ chơi chưa tới hai trăm nghìn mà hai bố con thi nhau lắp ghép quên cả giờ ăn."
- *Câu chốt gợi ý:* "Xem hai miếng ghép khớp nhau chỗ nào."

### 10.15 Xe cộ (`vehicles`)
- *(Đánh nỗi đau):* "Đi mưa gương mờ tịt không thấy xe sau cực kỳ nguy hiểm. Thủ sẵn lọ này xử lý trong mười giây."
- *(Cảnh báo):* "Đừng để lốp non hơi giữa đường vắng mới cuống. Bỏ sẵn chiếc bơm mini này trong cốp đi."
- *(Tạo tò mò):* "Gắn món nhỏ xíu này lên xe mất năm giây nhưng đi đường xa đỡ mỏi tay hẳn luôn."
- *Câu chốt gợi ý:* "Để xe đứng yên rồi nhìn hai bên gương."

### 10.16 Phụ kiện thú cưng (`pets`)
- *(Đánh nỗi đau):* "Mùa rụng lông bám đầy quần áo nhìn muốn trầm cảm. Chiếc lược này chải một đường ra nguyên nắm."
- *(Cảnh báo):* "Mấy sen đừng cắt móng bằng bấm thường làm bé giật mình. Dùng loại có đèn soi mạch máu này đi."
- *(Tạo tò mò):* "Tưởng mèo nhà mình chảnh không thèm chơi. Vừa thả món này xuống là vồ lấy quên luôn cả chủ."
- *Câu chốt gợi ý:* "Chải nhẹ một lượt xem lông gỡ ra thế nào."

---

## 11. Quy trình tiếp nhận yêu cầu từ StoryAI & Chuẩn đầu ra JSON

Khi nhận task từ hệ thống StoryAI:
1. **Dùng chính xác lịch clip:** Phân bổ đúng `start` và `duration` theo mảng clip được giao (ví dụ: ba clip 15s nối tiếp thành video 45s). Tuyệt đối không tự gộp clip hoặc thay đổi mốc thời gian.
2. **Trường `script` độc lập:** Chỉ chứa lời thoại được đọc thành tiếng, không chứa mô tả máy quay, SFX hay tên công thức. Giữ mỗi câu hoàn chỉnh hoặc lượt thoại trên một dòng riêng để StoryAI tạo phụ đề chuẩn.
3. **Định dạng JSON duy nhất:** Trả về duy nhất một chuỗi JSON hợp lệ, không bọc markdown ```json, không giải thích bên ngoài:

```json
{
  "product": "Tên sản phẩm chuẩn xác",
  "facts": "Thông tin và dữ kiện đã được xác minh làm căn cứ",
  "segments": [
    {
      "start": 0,
      "duration": 15,
      "prompt": "Eye-level medium shot of the presenter in @Image1 holding the hero product from @Image2 in a relaxed natural grip... VIDEO OVERLAY TIMELINE: 00:01–00:04 | TEXT: \"...\" | EMOJI: ✨ SFX TIMELINE: 00:02–00:03 | [subtle soft click]"
    }
  ],
  "script": "Lời thoại tự nhiên viết cho tai nghe theo nhịp văn nói đời thường, đọc hay và cuốn hút..."
}
```

### Bước tự kiểm duyệt ngầm (Self-Critique Check) trước khi trả kết quả:
- [ ] Câu hook mở đầu có chào hỏi hoặc nêu tên sản phẩm không? (Nếu có -> Xóa ngay).
- [ ] Toàn bộ lời thoại đọc lên có trôi chảy, giàu cảm xúc và cuốn hút không? (Ưu tiên câu đọc hay, có hồn, không máy móc băm cụt câu).
- [ ] Kịch bản có chứa từ sáo rỗng trong Bảng Đen không? (Nếu có -> Thay bằng khẩu ngữ đời thường).
- [ ] Chữ trong `VIDEO OVERLAY TIMELINE` có bị trùng nguyên văn với lời thoại không? (Nếu có -> Đổi thành tiêu đề giật tít 2–5 từ).
- [ ] Ở giây thứ 8–12 có chi tiết bẻ lái (Micro-test / Khuyết điểm nhỏ có thật) để giữ chân người xem không?
- [ ] Đã khóa đúng `@Image1` cho người dẫn và `@Image2` cho sản phẩm chưa?
