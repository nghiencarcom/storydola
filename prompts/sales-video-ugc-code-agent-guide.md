---
name: storyai-sales-video-ugc
description: Write high-retention, natural UGC sales scripts and timed per-clip video prompts using StoryAI's product and reference inputs.
---

# StoryAI — Hướng dẫn Code Agent viết kịch bản UGC bán hàng tối ưu giữ chân (Audience Retention)

Tài liệu này là hướng dẫn nền tảng bắt buộc dùng cho Code Agent khi soạn kịch bản và prompt video bán hàng ngắn (TikTok, Reels, Shorts). Đọc và áp dụng đúng module ngành hàng theo `templateId` được gửi trong yêu cầu. Hướng dẫn cụ thể của người dùng được ưu tiên khi không mâu thuẫn với schema JSON và chính sách hiện hành. Đầu ra cuối cùng phải tuân thủ nghiêm ngặt schema JSON của StoryAI.

---

## 1. Mục tiêu tối thượng và triết lý giữ chân người xem (Retention Philosophy)

Video ngắn thành công không bắt đầu bằng việc bán hàng, mà bắt đầu bằng việc **giành giật 3 giây đầu tiên (Thumb-Stop)** và **duy trì sự tò mò liên tục (Audience Retention)** để người xem không lướt qua.

### Thứ tự ưu tiên bắt buộc:
1. **An toàn chính sách và hình ảnh tham chiếu:** Bảo toàn hình ảnh người dẫn và sản phẩm tham chiếu, tuân thủ quy định với nội dung sức khỏe/tài chính.
2. **Kỹ thuật giữ chân người xem (Retention Engineering):** Hook 3 lớp trong 0–3 giây đầu, bẻ góc nhìn (Pattern Interrupt) ở điểm rơi giây thứ 8–12, nhịp câu văn nói đời thường.
3. **Khử mùi quảng cáo (Tỷ lệ 80/20):** 80% thời lượng cho tình huống đời sống, minh họa thực tế hoặc trải nghiệm thật; chỉ 20% cho thông tin sản phẩm và kêu gọi hành động (CTA) nhẹ nhàng.
4. **Đúng định dạng và lịch clip:** Tuân thủ schema JSON, thời lượng từng clip và quy cách prompt độc lập của StoryAI.

Tuyệt đối không hy sinh an toàn chính sách hoặc tính nhất quán hình ảnh để tạo hook giật gân rẻ tiền.

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
1. **Lớp Lời thoại (Verbal Hook) — Ưu tiên độ cuốn hút, nhịp điệu và văn nói tự nhiên:**
   - Câu thoại mở đầu đánh thẳng vào một nỗi bực mình thực tế, một sự hoài nghi hoặc một sự thật ít người biết.
   - **ĐỘ DÀI & NHỊP THỞ ĐỒNG BỘ (2-Beat Cadence):** Câu hook mở đầu trong 0–3 giây có độ dài chuẩn **15–18 từ** (tương đương 2.5–3.5s đọc tự nhiên). Cấu trúc 2 vế rõ ràng ngắt bằng dấu phẩy:
     * *Vế 1 (7–9 từ):* Nêu trực diện nỗi bức xúc / bất tiện / hoài nghi / cảnh báo.
     * *Vế 2 (7–9 từ):* Hành động / khúc cua / điểm hé lộ (pivot / reveal) mở ra giải pháp.
   - **TUYỆT ĐỐI CẤM TỰ HỎI RỒI TỰ TRẢ LỜI (Self-Q&A):** Cấm mọi dạng hỏi người xem rồi tự trả lời hoặc chèn dấu hỏi chấm (`?`) vào câu hook (như *"Da dầu bôi kem chống nắng bóng nhẫy như chảo mỡ? Đổi sang chất gel này...", "...đúng không? Để mình chỉ cho", "...phải không? Dùng cái này đi..."*). Đây là lối nói giả tạo của tiếp thị truyền hình (tele-shopping), khiến người xem lướt đi ngay lập tức. Bắt buộc thay bằng **lời tự sự bộc bạch, tự thú hoặc nhận định trực diện** bằng câu trần thuật.
   - *CẤM chào hỏi:* Tuyệt đối không "Xin chào mọi người", "Chào mừng đến với video", "Hôm nay mình sẽ...".
   - *CẤM nêu tên thương hiệu ngay câu đầu:* Giữ sự tò mò, chỉ giới thiệu sản phẩm sau khi đã mở nút thắt vấn đề.
   - *CẤM câu hỏi đóng Yes/No hiển nhiên:* Tránh "Bạn có muốn da đẹp không?", "Bạn có mệt mỏi vì dọn nhà không?".
2. **Lớp Hình ảnh (Visual Hook - In Medias Res):** Đưa nhân vật vào giữa một hành động đang diễn ra (đang chà vết bẩn, đang cắn thử miếng đồ ăn, đang bẻ gập chiếc giày, biểu cảm nhăn mặt hoặc ngạc nhiên). Không bao giờ mở đầu bằng cảnh nhân vật đứng im mỉm cười nhìn vào ống kính.
3. **Lớp Chữ màn hình (Text Overlay Hook - Counter-point):**
   - Chữ phủ trên video ở giây đầu tiên dành cho nhóm 80% người xem lướt không bật tiếng (silent scrollers).
   - **QUY TẮC ĐỐI TRỌNG (COUNTER-POINT):** Chữ màn hình KHÔNG được lặp lại nguyên văn lời thoại và **TUYỆT ĐỐI CẤM mô tả lại hành động mắt thấy** (Cấm: "CẦM BÌNH", "XOAY MÀN HÌNH", "MỞ NẮP"). Chữ màn hình phải đóng vai trò là "tiêu đề bài báo giật gân" hoặc tóm gọn nỗi đau bằng 2–5 từ in hoa kèm 1–2 emoji (Xem chi tiết bộ 4 công thức giật tít tại Mục 9.3).
   - *Ví dụ:*
     * Lời thoại: "Da dầu sợ nhất bôi kem bóng nhẫy mặt, đổi sang chất gel này thấm ráo tức thì luôn." (17 từ, 2 vế nhịp thở dứt khoát, không câu hỏi tu từ, giữ chân người nghe ngay lập tức)
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
Kết thúc clip cuối bằng một lời mời click/bấm góc trái để tham khảo thêm **nếu sản phẩm hợp nhu cầu**. Dùng cách xưng hô theo đúng tệp khán giả, nói ngắn gọn, thân thiện và không nài ép mua:
- *Nên dùng:* "Nếu các bác thấy em này hợp nhu cầu thì click góc trái để tham khảo thêm nhé.", "Các mom thấy em nó phù hợp thì click góc trái để xem thêm nha."
- Nếu video dùng ngôn ngữ khác tiếng Việt, diễn đạt lời mời tương đương bằng ngôn ngữ đó và giữ cách xưng hô tự nhiên với tệp khán giả.
- *Tránh dùng:* "Mua ngay", "Chốt đơn đi", "Số lượng có hạn".

---

## 6. Nghệ thuật viết lời thoại UGC cuốn hút & Tự nhiên (Natural Conversational Dialogue)

Mỗi video có thoại chỉ dùng **một người dẫn duy nhất** là nhân vật tham chiếu. Không tạo người hỏi ngoài khung hình, đối thoại hai vai, giọng thứ hai hoặc nhãn vai.

Lời thoại UGC phải nghe như một người bạn sành sỏi đang trò chuyện trực tiếp trước camera điện thoại — giàu nhạc điệu, giàu hơi thở đời thường, loại bỏ 100% giọng đọc TV commercial, văn bản hành chính hay văn dịch từ tiếng Anh.

### 6.1 Quy tắc Nhất quán Ngôi Xưng Hô (Persona & Pronoun Consistency)
**CẤM TUYỆT ĐỐI NHẢY ĐẠI TỪ XƯNG HÔ GIỮA CHỪNG:**
- Nếu mở đầu xưng `mình` và gọi khán giả là `các bác` (công nghệ) -> Suốt từ đầu đến cuối clip phải giữ đúng cặp `mình` – `các bác`.
- Nếu mở đầu gọi `mấy bà` / `các bồ` (làm đẹp, văn phòng) -> Giữ xuyên suốt `mình` – `mấy bà` / `các bồ`.
- Nếu gọi `các mom` / `mấy mẹ` (mẹ và bé) -> Giữ xuyên suốt `em` / `mình` – `các mom`.
- ❌ **CẤM:** Đầu clip xưng `mình`, giữa clip gọi `cả nhà`, cuối clip lại phán `nhu cầu của bạn` hoặc `các bác`.

---

### 6.2 BẢNG ĐEN: 7 Nhóm Từ Ngữ & Lối Nói Rập Khuôn Bị CẤM TUYỆT ĐỐI

| Nhóm lỗi | ❌ Mẫu câu cấm (Gượng gạo / Robot / Giọng PR) | ✅ Cách nói đời thường thay thế (Giàu nhạc điệu) |
|---|---|---|
| **1. Văn dịch PR & Sáo ngữ TVC** | • "Bí mật nằm ở cụm..."<br>• "Trang bị hẳn cảm biến..."<br>• "Hỗ trợ công nghệ tiên tiến..."<br>• "Mọi bước đi đều êm ru khó tin" | • "Cái gimbal này lia mượt dã man..."<br>• "Nhìn nhỏ gọn vậy thôi mà quay êm ru..."<br>• "Điểm ăn tiền nằm ở..."<br>• "Vừa đi vừa quay mà khung hình vẫn chắc nịch." |
| **2. Tự hỏi rồi tự trả lời (Self-Q&A / Câu hỏi tu từ `?`)** | • "Tốn tiền mua đồ linh tinh mà vẫn bực mình? Thử xem món này..."<br>• "Dưới một mét sáu mặc quần bị lùn đi? Là do chọn sai cạp..."<br>• "Da dầu bôi kem bóng nhẫy mặt đúng không? Đổi sang gel này..."<br>• "Đồ rẻ thế này dùng được không? Ra ngã tư test..." | • "Tốn cả đống tiền mua đồ linh tinh về vứt xó, tới khi gặp em này mới thấy sáng mắt."<br>• "Chân ngắn dưới một mét sáu rất dễ bị dìm dáng, bí quyết là chọn đúng cạp cao này."<br>• "Da dầu sợ nhất bôi kem bóng nhẫy mặt, đổi sang chất gel này thấm ráo tức thì luôn."<br>• "Lúc đầu thấy giá rẻ mình không tin đâu, đem ra ngã tư test thử mới thấy bất ngờ." |
| **3. Lối nói Hành chính / Cảnh báo hợp đồng** | • "Nhưng có một điểm cả nhà cần lưu ý là..."<br>• "Ai để ý bao bì thì lưu tâm nhé..."<br>• "Trước khi chọn, xem kỹ hình dáng và thông tin bảo hành có hợp nhu cầu của bạn không nha." | • "Có điều em này không chống nước đâu nha, trời mưa nhớ cất túi kỹ."<br>• "Mỗi tội vỏ hộp hơi đơn giản xíu, bù lại máy bên trong cực ngon."<br>• "Bác nào hay quay vlog giống mình thì nghía thử em này xem hợp gu không nha." |
| **4. Câu cộc lốc / Khảo sát điền form** | • "Điểm mình ưng là cảm giác cầm đầm tay."<br>• "Sản phẩm có thiết kế kim loại chắc chắn." | • "Cầm trên tay thấy đầm và chắc nịch luôn."<br>• "Phần vỏ kim loại hoàn thiện sờ mát rượi, cầm rất đã tay." |
| **5. Copy rập khuôn câu CTA mẫu** | • "Nếu cả nhà thấy món này hợp nhu cầu thì bấm góc trái để tham khảo thêm nha." (Copy nguyên văn gây nhàm chán) | • **Gắn chặt CTA vào tình huống sản phẩm:**<br>  - "Bác nào hay quay vlog di chuyển nhiều thì nghía thử ở góc trái nha."<br>  - "Bà nào lười dọn bếp giống mình thì bấm góc trái tham khảo nghen."<br>  - "Em để sẵn link ở góc trái màn hình cho cả nhà tiện xem nè." |
| **6. Đánh vần chữ số thô thiển (TTS distortion)** | • "bốn K hai trăm bốn mươi khung hình"<br>• "bảy trăm năm mươi mi li lít"<br>• "một inch ba trục" | • Giữ đúng số và thuật ngữ chuẩn: `quay 4K 240fps`, `bình 750ml`, `cảm biến 1 inch`, `gimbal 3 trục`. Giọng đọc AI hiện đại phát âm tự nhiên các ký hiệu này. |
| **7. Đọc thông số kỹ thuật khô khan** | • "Dung tích 750ml, chất liệu inox 304, giữ nhiệt 24 giờ." | • "Bình 750ml to vừa đủ, sáng rót nước đá mang đi làm tới chiều đá vẫn chưa tan hết." |

---

### 6.3 Bộ Chuyển Ý Khẩu Ngữ Đời Thường (Natural Conversational Connectors)

- **Chuyển sang hoài nghi / thử thách (giây 3–5):**
  * *"Lúc đầu nhìn cũng nghi nghi, sợ mua về phí tiền..."*
  * *"Thoạt nhìn cứ tưởng đồ chơi cho vui..."*
  * *"Trước giờ mình cứ nghĩ phải vác máy cơ cồng kềnh..."*
- **Chuyển sang trải nghiệm thực tế / khoảnh khắc "Wow" (giây 6–10):**
  * *"Mà công nhận, cầm vô cái là thấy khác bọt liền..."*
  * *"Bật máy lên lia thử một đường mà êm ru..."*
  * *"Thử một phát là ưng cái bụng ngay..."*
- **Chuyển sang nhược điểm thật (Khử mùi quảng cáo — giây 10–14):**
  * *"Nói đi cũng phải nói lại, có một điểm trừ nhỏ là..."*
  * *"Mỗi tội em này..."*
  * *"Có điều bác nào hay đi mưa nhớ lưu ý..."*
  * *"Duy chỉ có một điểm là..."*
- **Chuyển sang CTA nhẹ nhàng (cuối video):**
  * *"Bác nào đang tìm một em nhỏ gọn bỏ túi thì ghé góc trái tham khảo nha."*
  * *"Ai thấy hợp nhu cầu thì bấm góc trái xem thêm chi tiết nè."*
  * *"Em ghim sẵn ở góc trái cho mấy bà dễ tìm nghen."*

---

## 7. Chân dung khán giả, đại từ xưng hô & Ngôn ngữ tự nhiên

Chọn cách xưng hô phù hợp với tệp khách hàng của ngành hàng để tạo sự đồng cảm tức thì. Dùng thưa gửi tự nhiên, thường 1 lần ở đầu câu chuyện; ở CTA cuối, tiếp tục dùng đúng tệp xưng hô đã chọn:

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

## 9. Nhịp hình ảnh, Phân vai từng Clip (1 → n) & Chuẩn Prompt Video AI

Mỗi prompt video trong mảng `segments` phải được viết độc lập bằng tiếng Anh, tuân thủ đúng thời lượng được giao và có **vai trò kịch bản thị giác riêng biệt** tùy theo vị trí của clip trong chuỗi video:

Mọi mốc giây dưới đây là ví dụ cho clip 15 giây. Luôn tính lại theo `duration` thực của từng clip, dùng thời gian tương đối từ đầu clip và không tạo hành động, overlay hoặc SFX vượt quá thời lượng đó.

### 9.1 Phân vai thị giác theo vị trí clip (Narrative & Visual Arc):

1. **Clip đầu tiên — The Thumb-Stop Hook & Problem Setup:**
   - **00:00–00:03 (Thumb-stop / In Medias Res):** Bắt đầu ngay giữa một hành động dở dang hoặc biểu cảm giật mình / bực mình với vấn đề cũ. Tuyệt đối không mở đầu bằng cảnh nhân vật đứng im mỉm cười nhìn vào ống kính.
   - **Góc máy & Cỡ cảnh:** Eye-level Medium Shot (ống kính tương đương 35mm), rung nhẹ tự nhiên kiểu quay điện thoại cầm tay (steady handheld) kết hợp một cú đẩy chậm nhẹ nhàng (subtle push-in).
   - **Tương tác sản phẩm:** Ở giây thứ 4–8, nhân vật đưa sản phẩm chính `@Image2` vào khung hình bằng tay cầm tự nhiên, giới thiệu trực quan giải pháp.
   - **Điểm kết chuẩn bị chuyển cảnh (Match-cut preparation):** Trong giây cuối của clip, nhân vật hướng nhẹ sản phẩm về phía máy quay hoặc chuẩn bị chạm tay thao tác để nối sang clip kế tiếp.

2. **Clip 2..n-1 (15–30s+) — Deep-Dive Hands-On Demo & Sensory Proof:**
   - **Góc máy & Cỡ cảnh:** Cắt chuyển dứt khoát sang góc siêu cận (Macro Close-up), góc 45 độ trên mặt bàn (Tabletop 45°) hoặc góc nhìn thứ nhất (First-person POV) với ống kính 50mm, độ sâu trường ảnh vừa phải (shallow depth of field).
   - **Thao tác xúc giác thực tế (Tactile Demonstration):** Tập trung vào một thao tác chân thực và có căn cứ với `@Image2`, chọn theo chi tiết nhìn thấy hoặc dữ kiện đã xác minh. Không tự bịa thao tác, micro-test hay claim về độ bền/chống nước.
   - **Khử mùi quảng cáo (Honest Flaw):** Chỉ nêu nhược điểm nhỏ do người dùng cung cấp hoặc có nguồn kiểm chứng; đặt vào giữa clip theo thời lượng thực. Không bịa điểm trừ.
   - **Bảo toàn trục máy:** Giữ cùng hướng ánh sáng cửa sổ và cách cầm sản phẩm để tránh giật góc.

3. **Clip cuối (Clip n) — Demo Payoff & Soft CTA:**
   - **Góc máy & Cỡ cảnh:** Lùi máy quay hoặc reframing mượt mà trở lại góc trung (Medium Shot) ấm áp, bố cục thoáng đãng và dễ thở.
   - **Hành động & Cảm xúc:** Nối tiếp thao tác đã minh họa; biểu cảm phù hợp với hình ảnh, không giả nhận đã sử dụng hoặc tạo kết quả trải nghiệm chưa được cung cấp. Giơ sản phẩm hoặc đặt đứng vững chắc trên bàn.
   - **Kêu gọi hành động áp lực thấp:** Trong lời thoại cuối, mời người xem click góc trái để tham khảo thêm nếu sản phẩm hợp nhu cầu, dùng đúng đại từ theo tệp khán giả. Kết thúc bằng nụ cười thân thiện; có thể liếc hoặc hướng tay nhẹ về góc trái, không dựng nút hay giao diện giả và không nài ép mua.

### 9.2 Cấu trúc 5 khối chuẩn của một Prompt Video AI (Clean Prompt Architecture):

Mỗi prompt trong `segments` phải viết bằng tiếng Anh hoàn chỉnh theo chuẩn 5 khối sau:

Các mốc trong mẫu dưới đây minh họa clip 15 giây; co giãn theo `duration` thực và luôn giữ toàn bộ cue trong clip.
```text
REFERENCE LOCK:
- @Image1 is the sole presenter (consistent facial structure, skin tone, hair, and clothing).
- @Image2 is the single primary hero product (preserve exact silhouette, materials, branding, colors, and finish).
- @Image3 onward (if provided) only for an optional separate cutaway of a visible detail or accessory.

CAMERA & FRAMING:
- (Cỡ cảnh cụ thể: Eye-level Medium Shot / Tabletop 45° Macro Close-Up / Casual Handheld POV).
- (Chuyển động máy: Subtle push-in / Slow tracking follow / Stable lock-off).
- (Tỷ lệ khung hình: Vertical 9:16 vertical composition, upper-third eye line, clear central safe area for product).

ACTION & CHOREOGRAPHY (Timecoded):
- 00:00–00:05: [Hành động mở đầu, tư thế bắt đầu, biểu cảm gương mặt]
- 00:05–00:10: [Thao tác tay cụ thể với sản phẩm @Image2, chi tiết vật lý nhìn thấy được]
- 00:10–00:15: [Biểu cảm phản ứng, trạng thái kết thúc, tư thế chuẩn bị chuyển cảnh]

ENVIRONMENT & LIGHTING:
- Authentic domestic indoor space (kitchen/living room/desk). Soft diffused daylight from window, natural specular highlights on product surface, authentic skin texture, zero plastic CGI smoothing.

TIMELINE OVERLAYS & SFX:
- VIDEO OVERLAY TIMELINE: 00:01–00:04 | TEXT: "..." | EMOJI: ✨
- SFX TIMELINE: 00:02–00:04 | [subtle nonverbal tactile sound: click, soft rustle, metallic tap]
```

### 9.3 Nghệ thuật giật tít Text Overlay giữ chân người xem (High-Retention Text Overlay Playbook):

Chữ màn hình là **mồi câu thị giác thứ ba** quyết định tỷ lệ giữ chân của **80% người xem lướt video ở chế độ tắt tiếng**.

#### 🚫 CẤM TUYỆT ĐỐI: Mô tả lại hành động mắt thấy (Redundant Action Labeling)
Người xem mắt đã thấy bàn tay đang thao tác gì trên màn hình. Chữ màn hình lặp lại hành động mắt thấy là vô nghĩa, nhàm chán và lãng phí không gian thị giác:
- ❌ **CẤM VIẾT:** `"XOAY MÀN HÌNH"`, `"CẦM BÌNH"`, `"MỞ NẮP"`, `"BẺ CHIẾC GIÀY"`, `"THOA KEM LÊN TAY"`, `"BẤM NÚT NGUỒN"`.

#### ✅ BẮT BUỘC: Giật tít Nỗi đau, Lợi ích tốc độ hoặc Sự thật gây tò mò
Chữ màn hình phải là lý do người xem **buộc phải dừng ngón tay lại xem tiếp**:
- **Thay vì `"XOAY MÀN HÌNH"`** 👉 `BẬT MÁY TRONG 1S ⚡` hoặc `XOAY LÀ QUAY LIỀN 🎬` (Lợi ích tốc độ thao tác!)
- **Thay vì `"CẦM BÌNH NƯỚC"`** 👉 `CỰC KỲ ĐẦM TAY! 🏆` hoặc `BÌNH XỊN HAY PHÍ TIỀN? 🤔` (Cảm nhận chất lượng!)
- **Thay vì `"MỞ NẮP HỘP"`** 👉 `XEM CÓ ĐÁNG TIỀN? 👀` hoặc `ĐẬP HỘP THỰC TẾ 📦`
- **Thay vì `"BẺ CHIẾC GIÀY"`** 👉 `BẺ GẬP ĐẾ KHÔNG GÃY? 💥` hoặc `ĐỆM ÊM TỰA MÂY ☁️`
- **Thay vì `"THOA KEM"`** 👉 `THẤM HẾT SAU 3S? ⏱️` hoặc `HẾT BÓNG DẦU TRONG 10S? 😱`

#### 🎯 Bộ 4 công thức Text Overlay chuẩn theo vị trí Clip:
1. **Clip 1 (Hook / Problem — Giây 0–3):** Công thức **Nỗi đau cực đoan / Hoài nghi nhột tai**
   - Cấu trúc: `[Nỗi đau / Hoài nghi / Thách thức] + [?] + [1–2 Emoji sốc 😱/😩/💸]`
   - Mẫu: `QUAY ĐÊM HẠT NHƯ CÁT? 😩`, `VLOG RUNG NHƯ ĐỘNG ĐẤT? 📳`, `ĐỒ RẺ DÙNG MAU HỎNG? 💸`, `BÀN HỌC BÃI CHIẾN TRƯỜNG? 🤯`
2. **Clip giữa (Deep Demo / Micro-test / Wow Factor):** Công thức **Lợi ích tốc độ / Khoảnh khắc "Wow"**
   - Cấu trúc: `[Kết quả tức thì / Thao tác siêu nhanh] + [1–2 Emoji tia chớp ⚡/🔥/✨/🏆/🎬]`
   - Mẫu: `BẬT MÁY TRONG 1 GIÂY ⚡`, `XOAY LÀ QUAY LIỀN 🎬`, `CHỐNG RUNG 3 TRỤC CỰC ĐỈNH 🎯`, `CỰC ĐẦM TAY! 🏆`, `XỊT 1 LẦN SẠCH BONG ✨`
3. **Điểm bẻ lái (Giây 8–12 / Khử mùi quảng cáo — Honest Flaw):** Công thức **Bóc phốt ngược / Cảnh báo thật**
   - Cấu trúc: `[Điểm trừ nhỏ có thật / Sự thật trần trụi] + [1–2 Emoji cảnh báo ⚠️/👀/🤔]`
   - Mẫu: `ĐIỂM TRỪ NÊN BIẾT ⚠️`, `HỘP HƠI ĐƠN GIẢN NHA 📦`, `DÂY SẠC HƠI NGẮN 👀`, `ĐẮT NHƯNG XẮT RA MIẾNG 💯`
4. **Clip cuối (Verdict / Soft CTA):** Công thức **Chốt hạ giá trị / Thách thức kiểm chứng**
   - Cấu trúc: `[Lời khuyên chân thành / Mời kiểm chứng nhẹ nhàng] + [1–2 Emoji 🌙/📌/💯/🛡️]`
   - Mẫu: `XEM TEST ĐÊM RỒI CHỌN 🌙`, `LƯU LẠI KHI CẦN NHA 📌`, `AI NÊN MUA NGAY? 🤔`, `RẤT ĐÁNG ĐỒNG TIỀN! 💯`, `CHECK KỸ BẢO HÀNH NHÉ 🛡️`

#### 📐 Quy chuẩn kỹ thuật Text Overlay:
- **Độ dài vàng:** Từ **2 đến 5 từ** (tối đa 6 từ ngắn).
- **In hoa toàn bộ (ALL CAPS):** Giúp người xem lướt đọc hiểu ngay trong 0.5 giây.
- **Kèm 1–2 emoji:** Biểu cảm trực quan, kích thích thị giác.
- **Đối trọng với thoại (Counter-point):** Không chép lại nguyên văn lời nói; đóng vai trò như tiêu đề báo giật tít cho người xem không bật tiếng.

### 9.4 Thư viện hành động tương tác sản phẩm (UGC Action Playbook) theo ngành:

- **Mỹ phẩm & Chăm sóc cá nhân (`beauty`):** Thoa mỏng lớp gel/kem trên mu bàn tay (swatch), texture tan mịn bóng nhẹ tự nhiên dưới ánh sáng ban ngày; ngón tay chạm nhẹ kiểm tra độ ráo; tránh hiệu ứng cà da láng mịn giả tạo.
- **Gia dụng & Đời sống (`home`):** Thao tác tháo/lắp nắp một chạm dứt khoát, nghe tiếng khớp nối "tách", rót nước không rỉ mép, bọt tẩy rửa tan cặn bẩn, cầm đầm tay chắc chắn.
- **Đồ công nghệ & Phụ kiện (`tech`):** Cầm trọn trong lòng bàn tay khoe kích thước nhỏ gọn, cắm dây sạc khít chặt, gõ phím cơ nảy êm, soi các góc cạnh hoàn thiện kim loại mờ (matte metal finish).
- **Thời trang & Giày dép (`fashion` / `footwear`):** Bẻ gập mũi giày chứng minh độ dẻo đàn hồi của đế cao su; kéo căng nhẹ cạp quần/đường chỉ may; vuốt nếp vải cotton không nhăn dưới ánh sáng tự nhiên.
- **Đồ ăn vặt & Thực phẩm (`snacks`):** Tách đôi khoe nhân ngập tràn, cắn miếng giòn rụm (kèm SFX crunch giòn tan), lắc nhẹ túi/hũ khoe topping phủ đều.

---

## 10. Module Cẩm Nang Lời Thoại Tự Nhiên Theo Từng Ngành Hàng (Category Dialogue Playbook)

Mỗi ngành hàng có tệp khán giả, đại từ xưng hô, nỗi đau và ngữ khí hoàn toàn khác nhau. AI phải viết theo đúng chất của creator ngành đó:

---

### 10.1 Mọi sản phẩm (`general`)
- **Xưng hô:** `mình` – `mọi người` / `cả nhà` (thân thiện, gần gũi).
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Tốn tiền mua đồ linh tinh về vứt xó, tới khi gặp em này mới thấy sáng mắt."
  * *(Hoài nghi):* "Lúc đầu thấy giá rẻ cứ sợ phí tiền, mua về cầm trên tay mới thấy đáng tiền."
  * *(Tò mò):* "Món đồ chưa tới hai trăm nghìn, nhưng có đúng một chi tiết nhỏ ai nhìn cũng mê."
- **Thân bài & Nhược điểm:**
  * *"Cầm trên tay thấy đầm và chắc nịch, hoàn thiện kim loại sờ rất đã tay."*
  * *(Honest Flaw):* *"Có điều vỏ hộp hơi đơn giản xíu, bù lại sản phẩm bên trong hoàn thiện cực kỳ ngon."*
- **CTA tự nhiên:**
  * *"Bác nào thấy em này hợp nhu cầu thì bấm góc trái nghía thử nha."*
  * *"Ai đang tìm món tiện lợi mang đi làm thì ghé góc trái tham khảo nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "Bí mật nằm ở...", "Xem kỹ thông tin bảo hành có hợp nhu cầu không".

---

### 10.2 Thời trang (`fashion`)
- **Xưng hô:** `mình` – `mấy bà` / `các nàng` / `chị em` (chia sẻ gu mặc đẹp, thân mật).
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Chân ngắn dưới một mét sáu dễ bị dìm dáng, bí quyết là chọn đúng cạp này nha."
  * *(Cảnh báo):* "Đừng mua sơ mi trắng nếu chưa sờ chất vải, mặc cả ngày không lo nhăn nhúm nha."
  * *(Tò mò):* "Bụng dưới hơi tròn đổi sang chiếc váy này, eo thon hẳn mà giấu mỡ cực kỳ đỉnh."
- **Thân bài & Nhược điểm:**
  * *"Chất vải rũ tự nhiên, mặc lên hack chân cực kỳ, giấu nhẹm bụng dưới luôn."*
  * *(Honest Flaw):* *"Vải mới giặt lần đầu mấy bà nhớ giặt tay riêng nha, với form hơi rộng nên ai thích ôm thì lùi một size."*
- **CTA tự nhiên:**
  * *"Bà nào muốn tìm quần hack chân mặc đi làm thì lướt góc trái xem bảng size nha."*
  * *"Mấy bà bấm góc trái xem thêm các màu khác xem có ưng không nè."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "tôn vinh vóc dáng hoàn mỹ", "đẳng cấp thời thượng", "nâng tầm phong cách".

---

### 10.3 Gia dụng & Đời sống (`home`)
- **Xưng hô:** `mình` – `mọi người` / `cả nhà` / `mấy bà nội trợ`.
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Hồi trước dọn bếp chà muốn gãy cả tay, từ ngày có chai bọt này nhàn tênh luôn."
  * *(Hoài nghi):* "Tưởng chiếc máy mini này chỉ để làm cảnh, hút một đường ra nguyên đống bụi mịn."
  * *(Cảnh báo):* "Bỏ ngay cây lau nhà nặng trịch đau lưng đi, đổi sang cây tự vắt này nhẹ tênh."
- **Thân bài & Nhược điểm:**
  * *"Xịt bọt ra để tầm ba phút, lấy khăn quẹt nhẹ một đường là cặn dầu mỡ đi sạch trơn, đỡ tốn công kỳ cọ."*
  * *(Honest Flaw):* *"Dây cắm dài tầm một mét nên hơi ngắn xíu, bác nào dùng nhớ cắm gần ổ điện nha."*
- **CTA tự nhiên:**
  * *"Bác nào lười dọn bếp giống mình thì ghé góc trái sắm một chai dùng thử nha."*
  * *"Ai hay đau lưng vì lau nhà thì bấm góc trái tham khảo cây lau này nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "giải pháp tối ưu cho không gian sống", "nâng tầm chất lượng cuộc sống", "công nghệ đột phá".

---

### 10.4 Đồ ăn vặt & Đồ uống (`snacks`)
- **Xưng hô:** `mình` – `cả nhà` / `team ăn vặt` / `các bồ`.
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Giác quan):* "Nghe tiếng giòn rụm là thấy đã tai rồi, cắn một miếng sốt đậm đà bùng nổ liền."
  * *(Hoài nghi):* "Tưởng đồ ăn vặt chỉ toàn bột với đường, ai ngờ xé bịch ra topping ngập tràn luôn."
  * *(Tò mò):* "Nửa đêm đói bụng lỡ mở hũ này ra, bảo đảm ăn hoài không thể dừng lại được."
- **Thân bài & Nhược điểm:**
  * *"Topping giòn rụm đẫm sốt, cắn miếng nào thấm vị miếng đó, ăn cuốn dã man."*
  * *(Honest Flaw):* *"Vị hơi cay nồng nha, bác nào không ăn cay được thì nhớ cân nhắc trước khi thử."*
- **CTA tự nhiên:**
  * *"Team hảo ngọt/hảo cay bấm góc trái đặt ăn thử xem có dính như mình không nha."*
  * *"Bác nào thèm ăn vặt đêm thì bấm góc trái rinh một hũ về nhâm nhi nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "hương vị tuyệt hảo đánh thức mọi giác quan", "thực phẩm thượng hạng".

---

### 10.5 Hàng tiêu dùng (`consumer`)
- **Xưng hô:** `mình` – `mọi người` / `cả nhà` / `các bác`.
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Chưa tới hai nghìn cho một mẻ giặt, áo quần thơm lừng bỏ luôn tiền mua nước xả."
  * *(Cảnh báo):* "Đừng mua giấy ăn mỏng lau dính đầy bụi, nhìn mình nhúng nước vắt mạnh vẫn dai nguyên."
  * *(Tò mò):* "Món đồ thiết yếu nhà nào cũng cần mua, đổi sang loại này tiết kiệm hẳn một nửa."
- **Thân bài & Nhược điểm:**
  * *"Giấy dai dày dặn, nhúng nước vắt ráo không hề bị mủn hay dính bụi trắng lên mặt."*
  * *(Honest Flaw):* *"Gói hơi to nên ai thích bỏ túi xách nhỏ thì hơi cồng kềnh một chút nghen."*
- **CTA tự nhiên:**
  * *"Cả nhà ai hay dùng giấy lau nhiều thì bấm góc trái gom combo cho hời nha."*
  * *"Bác nào muốn đổi loại nước giặt tiết kiệm thì nghía thử link ở góc trái nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "chất lượng vượt trội hàng đầu", "sản phẩm tin dùng của triệu gia đình".

---

### 10.6 Mỹ phẩm & Chăm sóc da (`beauty`)
- **Xưng hô:** `mình` – `mấy bà` / `các nàng` / `chị em` (tâm tình, chia sẻ skincare).
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Da dầu sợ nhất bôi kem bóng nhẫy mặt, đổi sang chất gel này thấm ráo tức thì."
  * *(Cảnh báo):* "Da nhạy cảm rửa mặt xong mà căng rát, đổi ngay sang chai bọt dịu nhẹ này nha."
  * *(Tò mò):* "Bí quyết giữ lớp nền ráo mịn cả ngày, thật ra chỉ nhờ đúng bước đệm nhỏ này."
- **Thân bài & Nhược điểm:**
  * *"Chất gel mát rượi, thoa tới đâu thấm ráo tới đó, nâng tone nhẹ tênh không bị vệt trắng."*
  * *(Honest Flaw):* *"Mùi tràm trà lúc mới thoa hơi rõ một chút nha, ai nhạy cảm mùi hương thì để ý xíu nghen."*
- **CTA tự nhiên:**
  * *"Bà nào da dầu đang tìm kcn ráo mịn thì bấm góc trái nghía thử nha."*
  * *"Chị em nào da nhạy cảm ghé góc trái xem bảng thành phần xem hợp da không nè."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "tái tạo da thần tốc", "trắng bật tông sau 1 đêm", "chữa dứt điểm mụn", "tinh chất nano thấm sâu tế bào".

---

### 10.7 Mẹ và bé (`baby`)
- **Xưng hô:** `em` / `mình` – `các mom` / `mấy mẹ` / `ba mẹ` (đồng cảm, cẩn trọng, nhẹ nhàng).
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Ước gì mình biết món này từ sớm, đỡ hẳn cảnh nửa đêm lục đục pha nước ấm."
  * *(Cảnh báo):* "Các mom đừng chọn bình hút rẻ dễ sặc, nhìn van chống trào ngược này mới yên tâm."
  * *(Tò mò):* "Đưa bé ra ngoài đồ đạc lỉnh kỉnh, có chiếc túi chia ngăn này đi lại nhẹ tênh."
- **Thân bài & Nhược điểm:**
  * *"Bình cầm nhẹ tay, có van chống sặc một chiều nên bé nằm ti hay ngồi ti đều êm ru không lo trớ."*
  * *(Honest Flaw):* *"Bình có nhiều chi tiết chống sặc nên lúc rửa các mom chịu khó tháo ra vệ sinh kỹ một chút nghen."*
- **CTA tự nhiên:**
  * *"Mom nào đang tìm bình tập hút chống sặc cho con thì ghé góc trái xem review nha."*
  * *"Mẹ nào sắp sinh hay chăm con nhỏ thì bấm góc trái tham khảo chiếc máy này nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "an toàn tuyệt đối cho mọi trẻ em", "phát triển trí não vượt trội", "cam kết 100% không dị ứng".

---

### 10.8 Đồ công nghệ & Phụ kiện (`tech`)
- **Xưng hô:** `mình` – `anh em` / `các bác` / `mấy bác` (thực tế, sành sỏi, kỹ tính).
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Hoài nghi):* "Lúc đầu thấy giá rẻ mình không tin, đem ra ngã tư test thử mới thấy bất ngờ."
  * *(Nỗi đau):* "Đi làm ngoài đường sợ nhất sập nguồn máy, thủ sẵn cục sạc nhỏ bằng bao diêm này."
  * *(Tò mò):* "Tưởng phải tốn tiền triệu mới gõ êm tay, nghe thử tiếng phím giá học sinh này nha."
- **Thân bài & Nhược điểm:**
  * *"Gimbal ba trục vật lý lia mượt dã man, vừa bước đi vừa quay mà khung hình vẫn chắc nịch, không bị giật cục."*
  * *(Honest Flaw):* *"Có điều máy không có chuẩn kháng nước sẵn đâu nha, trời mưa bắt buộc phải dùng thêm ốp bảo vệ."*
- **CTA tự nhiên:**
  * *"Bác nào hay quay vlog di chuyển nhiều thì ghé góc trái tham khảo nha."*
  * *"Anh em nào thích đồ công nghệ bỏ túi thì bấm góc trái xem thêm thông số nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "Bí mật nằm ở cụm...", "Trang bị hẳn...", "bốn K hai trăm bốn mươi khung hình" (viết chuẩn `4K 240fps`).

---

### 10.9 Phụ kiện thời trang (`accessories`)
- **Xưng hô:** `mình` – `mấy bà` / `các nàng` / `anh em` (tùy tệp nam/nữ).
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Áo thun đơn giản mặc hơi đơn điệu, thêm đúng điểm nhấn nhỏ này nhìn có gu liền."
  * *(Cảnh báo):* "Mặt tròn chọn sai gọng kính rất dễ dìm, đổi qua dáng này nhìn mặt thanh thoát hẳn."
  * *(Tò mò):* "Món phụ kiện chưa tới một trăm nghìn, nhưng phối với set đồ nào nhìn cũng cực sang."
- **Thân bài & Nhược điểm:**
  * *"Gọng kính nhẹ tênh, đeo cả ngày không bị cấn sống mũi hay đau vành tai."*
  * *(Honest Flaw):* *"Hộp đựng tặng kèm hơi mỏng xíu, ai hay quăng quật thì sắm thêm hộp cứng nha."*
- **CTA tự nhiên:**
  * *"Bà nào mặt tròn muốn tìm gọng kính hack mặt thon thì bấm góc trái nghía thử nha."*
  * *"Bác nào thích phụ kiện tối giản dễ phối đồ thì ghé góc trái tham khảo nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "kiệt tác thời trang", "đẳng cấp quý phái thượng lưu".

---

### 10.10 Giày dép (`footwear`)
- **Xưng hô:** `mình` – `cả nhà` / `các bác` / `chị em` (chú trọng độ êm và thoải mái).
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Đi làm đứng nhiều sợ nhất trầy gót chân, nhìn mình bẻ gập chiếc đế siêu dẻo này."
  * *(Cảnh báo):* "Đừng mua giày vì nhìn ảnh chụp đẹp, không có đệm êm đi nửa tiếng là đau liền."
  * *(Tò mò):* "Đôi giày nhẹ tênh như đi chân trần, mang vô vừa êm lại ăn gian chiều cao nữa."
- **Thân bài & Nhược điểm:**
  * *"Đế cao su dẻo bẻ gập thoải mái, đệm lót êm ái, bước đi êm ru không lo đau gót."*
  * *(Honest Flaw):* *"Form giày hơi ôm ngang một chút, bác nào chân bè thì nhớ nhích lên một size đi cho thoải mái nha."*
- **CTA tự nhiên:**
  * *"Ai phải đứng hay đi bộ nhiều thì bấm góc trái rinh một đôi về trải nghiệm nha."*
  * *"Bác nào thích giày êm chân tôn dáng thì lướt góc trái chọn size nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "bước đi uyển chuyển thần tiên", "chất liệu thượng hạng độc quyền".

---

### 10.11 Đồ trang trí & Nội thất (`decor`)
- **Xưng hô:** `mình` – `các bồ` / `team mê decor` / `mọi người`.
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Góc phòng trọ cũ nhìn tẻ nhạt chán ngắt, sắm đúng chiếc đèn vàng này về chill liền."
  * *(Cảnh báo):* "Đừng tốn mấy triệu sơn lại tường phòng, dán mảng ốp này mười phút là đẹp như mới."
  * *(Tò mò):* "Tưởng góc làm việc này tốn chục triệu decor, sự thật sắm đồ hết chưa tới năm trăm."
- **Thân bài & Nhược điểm:**
  * *"Ánh sáng vàng ấm hắt tường cực chill, tối bật lên nghe nhạc hay cày phim là bao mê."*
  * *(Honest Flaw):* *"Đèn này thiên về tạo không gian thư giãn thôi nha, bác nào ngồi học hay đọc sách thì nhớ bật thêm đèn bàn."*
- **CTA tự nhiên:**
  * *"Bồ nào muốn F5 lại góc phòng trọ giá hạt dẻ thì ghé góc trái nghía thử nha."*
  * *"Ai mê góc làm việc ấm cúng thì bấm góc trái tham khảo nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "kiệt tác kiến trúc nghệ thuật", "sang trọng quý phái bậc nhất".

---

### 10.12 Đồ dùng học tập & Văn phòng (`school`)
- **Xưng hô:** `mình` – `mấy bồ` / `team học sinh sinh viên` / `các bác văn phòng`.
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Bàn học bừa bộn nhìn tụt cảm hứng, gom vào kệ xoay thông minh này gọn gàng ngay."
  * *(Cảnh báo):* "Mực bút thấm sang trang sau nhìn bẩn, quẹt thử cây ngòi khô nhanh này trên giấy mỏng."
  * *(Tò mò):* "Món đồ nhỏ xíu trên bàn làm việc, giúp mình tập trung tăng năng suất gấp đôi luôn."
- **Thân bài & Nhược điểm:**
  * *"Kệ chia nhiều ngăn xoay mượt mà, gom hết bút thước sổ tay vô một góc gọn gàng hẳn."*
  * *(Honest Flaw):* *"Khay đựng bút hơi nông một xíu, kéo dài thì vừa nhưng ai dùng thước ba mươi phân nhớ để góc riêng nha."*
- **CTA tự nhiên:**
  * *"Bồ nào muốn dọn lại bàn học cho gọn gàng thì bấm góc trái rinh một em về nha."*
  * *"Ai hay làm thất lạc bút thước thì ghé góc trái tham khảo kệ này nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "dụng cụ học tập chuyên nghiệp đỉnh cao", "bứt phá năng suất học tập thần tốc".

---

### 10.13 Thực phẩm bổ sung (`supplements`)
- **Xưng hô:** `mình` – `các bác` / `mọi người` / `dân văn phòng` (chân thành, có trách nhiệm, tuân thủ pháp luật).
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Dân văn phòng thức khuya ăn uống thất thường, cứ để sẵn gói dinh dưỡng này trên bàn."
  * *(Cảnh báo):* "Ai ngại uống viên to khó nuốt cả cổ, đổi sang dạng gói thanh mát này rất tiện."
  * *(Tò mò):* "Mất đúng mười giây mỗi buổi sáng, giúp mình giữ tinh thần tỉnh táo suốt cả ngày."
- **Thân bài & Nhược điểm:**
  * *"Dạng gói xé tiện lợi, vị thanh nhẹ dễ uống, uống đều đặn thấy người đỡ uể oải hẳn khi làm việc."*
  * *(Honest Flaw):* *"Vị hơi chua thanh nhẹ nha, bác nào bụng yếu thì nên uống sau ăn và pha với nước ấm nghen."*
- **CTA tự nhiên:**
  * *"Bác nào hay làm việc khuya thức đêm giống mình thì bấm góc trái tham khảo nha."*
  * *"Ai đang tìm món bổ sung tiện lợi cho gia đình thì ghé góc trái xem hướng dẫn dùng nghen."*
- **Bảng Đen cấm kỵ:** TUYỆT ĐỐI CẤM hỏi rồi tự trả lời (`?`); CẤM "chữa dứt điểm", "trị dứt điểm bệnh", "giảm cân cấp tốc", "thay thế thuốc chữa bệnh".

---

### 10.14 Đồ chơi trẻ em (`toys`)
- **Xưng hô:** `mình` – `ba mẹ` / `các phụ huynh` / `cả nhà`.
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Thấy con dán mắt vào điện thoại cả ngày, đưa bộ này là bé ngồi chơi ngoan liền."
  * *(Cảnh báo):* "Đừng mua đồ chơi nhựa giòn sắc nhọn nguy hiểm, nhìn mình thả rơi xe thử độ bền."
  * *(Tò mò):* "Món đồ chơi chưa tới hai trăm nghìn, mà hai bố con lắp ráp quên cả giờ ăn."
- **Thân bài & Nhược điểm:**
  * *"Nhựa dày dặn, các góc bo tròn nhẵn bóng không lo trầy xước tay con, màu sắc sinh động bé mê tít."*
  * *(Honest Flaw):* *"Bộ này có một vài chi tiết nhỏ nên bé dưới ba tuổi chơi cần có ba mẹ ngồi cùng nha."*
- **CTA tự nhiên:**
  * *"Ba mẹ nào muốn cai tivi cho con thì ghé góc trái tham khảo bộ này nha."*
  * *"Ai đang tìm quà sinh nhật cho bé thì bấm góc trái xem thêm chi tiết nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "phát triển trí tuệ thiên tài", "thần đồng nhí", "cam kết an toàn tuyệt đối 100%".

---

### 10.15 Xe cộ & Phụ kiện di chuyển (`vehicles`)
- **Xưng hô:** `mình` – `anh em` / `các bác tài` / `anh em đi xe`.
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Trời mưa gương chiếu hậu đọng nước mờ tịt, xịt lớp này lên nước trôi tuột tức thì."
  * *(Cảnh báo):* "Đừng để lốp non hơi giữa đường vắng mới lo, thủ sẵn chiếc bơm mini này trong cốp."
  * *(Tò mò):* "Gắn món nhỏ xíu này lên xe năm giây, đi đường xa liên tục đỡ mỏi tay hẳn."
- **Thân bài & Nhược điểm:**
  * *"Xịt lên gương tạo hiệu ứng lá sen liền, nước mưa trôi tuột không đọng giọt, nhìn gương sáng rõ an tâm."*
  * *(Honest Flaw):* *"Lớp phủ duy trì tầm hai đến ba tuần thôi nha, sau đó anh em nhớ xịt lại để gương luôn rõ nghen."*
- **CTA tự nhiên:**
  * *"Bác nào hay lái xe đường dài trời mưa thì ghé góc trái thủ sẵn một chai bỏ xe nha."*
  * *"Anh em đi xe máy hay ô tô bấm góc trái xem thêm để lái xe an toàn hơn nghen."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "phụ kiện siêu cấp tuyệt đối an toàn", "cứu nguy khẩn cấp 100%".

---

### 10.16 Phụ kiện & Chăm sóc thú cưng (`pets`)
- **Xưng hô:** `mình` – `mấy sen` / `các con sen` / `hội nuôi boss`.
- **Hook 0–3s (Chuẩn 17–18 từ, 2 vế nhịp thở, cấm hỏi đáp):**
  * *(Nỗi đau):* "Mùa lông rụng dính đầy ghế với quần áo, chải đúng một đường ra nguyên tảng lông luôn."
  * *(Cảnh báo):* "Mấy sen đừng bấm móng bằng kìm thường làm đau bé, dùng loại có đèn soi mạch máu."
  * *(Tò mò):* "Tưởng mèo nhà mình chảnh không thèm chơi, vừa thả món này xuống là vồ lấy liền nha."
- **Thân bài & Nhược điểm:**
  * *"Răng lược bo tròn chải êm ru, boss nằm phơi bụng tận hưởng, bấm một nút là đẩy nguyên tảng lông ra cực tiện."*
  * *(Honest Flaw):* *"Bản chải hơi to xíu nên bé mèo con dưới hai tháng tuổi thì chải hơi cồng kềnh nghen."*
- **CTA tự nhiên:**
  * *"Sen nào bất lực vì lông bay tứ tung trong phòng thì bấm góc trái sắm một cây chải nha."*
  * *"Hội nuôi boss ghé góc trái xem review lược chải lông rụng nè."*
- **Bảng Đen cấm kỵ:** Cấm hỏi rồi tự trả lời (`?`), cấm "dụng cụ vệ sinh thú cưng cao cấp", "đảm bảo triệt để 100% không còn lông".

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
      "prompt": "REFERENCE LOCK: @Image1 is the sole presenter. @Image2 is the single primary hero product...\nCAMERA & FRAMING: Eye-level Medium Shot (35mm lens), steady handheld with subtle organic push-in.\nACTION & CHOREOGRAPHY: 00:00–00:04 (Thumb-Stop Hook): In Medias Res. Presenter starts mid-speech with an expressive, skeptical gesture discussing the old annoying problem... 00:04–00:09: Presenter smoothly brings @Image2 into frame in a natural grip... 00:09–00:15: Rotates bottle slightly under window daylight... Sets up intentional match-cut close-up for Clip 2.\nENVIRONMENT & LIGHTING: Domestic room, soft natural window light.\nVIDEO OVERLAY TIMELINE: 00:01–00:04 | TEXT: \"TIÊU ĐỀ GIẬT TÍT 😱\" | EMOJI: ✨\nSFX TIMELINE: 00:06–00:08 | [subtle tactile handling click]"
    },
    {
      "start": 15,
      "duration": 15,
      "prompt": "REFERENCE LOCK: @Image1 is the sole presenter. @Image2 is the exact hero product from Clip 1...\nCAMERA & FRAMING: Starts with a Tabletop 45° Macro Close-Up (50mm lens), then reframes to a warm Medium Shot.\nACTION & CHOREOGRAPHY: 00:00–00:05 (Hands-On Proof): Macro close-up of presenter's fingers interacting directly with @Image2's visible material and mechanism... 00:05–00:10 (Honest Flaw): Reframes to medium shot as presenter objectively points out a real, supplied packaging consideration... 00:10–00:15 (Demo Payoff & CTA): Presenter places product firmly on table and offers a gentle, low-pressure recommendation without claiming unprovided results.\nENVIRONMENT & LIGHTING: Same room continuity, natural daylight.\nVIDEO OVERLAY TIMELINE: 00:02–00:06 | TEXT: \"ĐIỂM ĂN TIỀN NÈ! 🏆\" | EMOJI: 🔥\nSFX TIMELINE: 00:01–00:03 | [gentle solid tactile sound]"
    }
  ],
  "script": "Lời thoại tự nhiên viết cho tai nghe theo nhịp văn nói đời thường, đọc hay và cuốn hút..."
}
```

### Bước tự kiểm duyệt ngầm (Self-Critique Check) trước khi trả kết quả:
- [ ] Câu hook mở đầu có chào hỏi, nêu tên sản phẩm, HOẶC TỰ HỎI RỒI TỰ TRẢ LỜI (Self-Q&A chứa dấu '?') không? (Nếu có -> Xóa bỏ ngay lập tức; chuyển thành câu trần thuật biểu cảm chuẩn 15–18 từ có 2 vế nhịp thở tự nhiên).
- [ ] Toàn bộ lời thoại đọc lên có trôi chảy, giàu cảm xúc và cuốn hút không? (Ưu tiên câu đọc hay, có hồn, không máy móc băm cụt câu).
- [ ] **Ngôi xưng hô có nhất quán từ đầu đến cuối không?** (Tuyệt đối không để đầu câu xưng "mình", giữa câu gọi "cả nhà", cuối câu lại phán "của bạn"; giữ đúng 1 cặp đại từ xuyên suốt).
- [ ] **Kịch bản có dính từ ngữ thuộc BẢNG ĐEN không?**
  * Có câu nào kiểu tự hỏi rồi tự trả lời ("...đúng không? Để mình...", "...bị lùn đi? Là do chọn sai...") không? (Bắt buộc đổi thành câu trần thuật 2 vế).
  * Có câu nào như "Bí mật nằm ở...", "Trang bị hẳn...", "Điểm mình ưng là..." không? (Thay bằng khẩu ngữ đời thường).
  * Khi nêu nhược điểm nhỏ, có bị hành chính hóa ("cần lưu ý là", "ai để ý thì lưu tâm", "xem kỹ thông tin bảo hành") không? (Thay bằng "Mỗi tội...", "Có điều...", "Duy chỉ có...").
  * Có bị đánh vần số thô ("bốn K hai trăm bốn mươi", "bảy trăm năm mươi mi li lít") không? (Giữ nguyên dạng số `4K 240fps`, `750ml`).
- [ ] **Câu CTA cuối có bị copy rập khuôn nguyên văn mẫu không?** (Cấm chép y nguyên "Nếu cả nhà thấy món này hợp nhu cầu thì bấm góc trái để tham khảo thêm nha"; bắt buộc phải gắn CTA vào bối cảnh sản phẩm và cách xưng hô của tệp).
- [ ] Chữ trong `VIDEO OVERLAY TIMELINE` có bị rơi vào bẫy mô tả lại hành động mắt thấy (như "XOAY MÀN HÌNH", "CẦM BÌNH", "MỞ NẮP", "BẤM NÚT") không? HOẶC có bị trùng nguyên văn lời thoại không? (Nếu có -> BẮT BUỘC đổi thành tiêu đề giật tít 2–5 từ in hoa + emoji nêu lợi ích tốc độ, nỗi đau nhột tai hoặc sự thật tò mò: ví dụ "BẬT MÁY 1 GIÂY ⚡", "VLOG RUNG NHƯ ĐỘNG ĐẤT? 📳", "CỰC KỲ ĐẦM TAY! 🏆").
- [ ] Ở giây thứ 8–12 có chi tiết bẻ lái (Micro-test / Khuyết điểm nhỏ có thật) để giữ chân người xem không?
- [ ] Đã khóa đúng `@Image1` cho người dẫn và `@Image2` cho sản phẩm chưa?
- [ ] Prompt hình ảnh của từng clip đã phân vai rõ ràng chưa? (Clip 1 là Hook/Problem, các clip giữa là Macro Close-up Demo có căn cứ, clip cuối là Demo Payoff/CTA). Các mốc thời gian có nằm trong duration và các clip có điểm nối hợp lý không?
