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
1. **Lớp Lời thoại (Verbal Hook) — Ưu tiên độ cuốn hút và nhạc điệu tự nhiên:**
   - Câu thoại mở đầu đánh thẳng vào một nỗi bực mình thực tế, một sự hoài nghi hoặc một sự thật ít người biết.
   - **Không áp đặt trần 12 từ máy móc:** Câu hook có thể dài từ 12–18 từ miễn là đọc lên mượt mà, giàu cảm xúc và cuốn hút (ví dụ: *"Mấy bà da dầu bôi kem chống nắng bóng nhẫy như chảo mỡ đúng không?"* — câu 15 từ nhưng đọc cực kỳ vào tai và giữ chân người nghe ngay lập tức).
   - *CẤM chào hỏi:* Tuyệt đối không "Xin chào mọi người", "Chào mừng đến với video", "Hôm nay mình sẽ...".
   - *CẤM nêu tên thương hiệu ngay câu đầu:* Giữ sự tò mò, chỉ giới thiệu sản phẩm sau khi đã mở nút thắt vấn đề.
   - *CẤM câu hỏi đóng Yes/No hiển nhiên:* Tránh "Bạn có muốn da đẹp không?", "Bạn có mệt mỏi vì dọn nhà không?".
2. **Lớp Hình ảnh (Visual Hook - In Medias Res):** Đưa nhân vật vào giữa một hành động đang diễn ra (đang chà vết bẩn, đang cắn thử miếng đồ ăn, đang bẻ gập chiếc giày, biểu cảm nhăn mặt hoặc ngạc nhiên). Không bao giờ mở đầu bằng cảnh nhân vật đứng im mỉm cười nhìn vào ống kính.
3. **Lớp Chữ màn hình (Text Overlay Hook - Counter-point):**
   - Chữ phủ trên video ở giây đầu tiên dành cho nhóm 80% người xem lướt không bật tiếng (silent scrollers).
   - **QUY TẮC ĐỐI TRỌNG (COUNTER-POINT):** Chữ màn hình KHÔNG được lặp lại nguyên văn lời thoại và **TUYỆT ĐỐI CẤM mô tả lại hành động mắt thấy** (Cấm: "CẦM BÌNH", "XOAY MÀN HÌNH", "MỞ NẮP"). Chữ màn hình phải đóng vai trò là "tiêu đề bài báo giật gân" hoặc tóm gọn nỗi đau bằng 2–5 từ in hoa kèm 1–2 emoji (Xem chi tiết bộ 4 công thức giật tít tại Mục 9.3).
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

### 6.2 BẢNG ĐEN: 6 Nhóm Từ Ngữ & Lối Nói Rập Khuôn Bị CẤM TUYỆT ĐỐI

| Nhóm lỗi | ❌ Mẫu câu cấm (Gượng gạo / Robot / Giọng PR) | ✅ Cách nói đời thường thay thế (Giàu nhạc điệu) |
|---|---|---|
| **1. Văn dịch PR & Sáo ngữ TVC** | • "Bí mật nằm ở cụm..."<br>• "Trang bị hẳn cảm biến..."<br>• "Hỗ trợ công nghệ tiên tiến..."<br>• "Mọi bước đi đều êm ru khó tin" | • "Cái gimbal này lia mượt dã man..."<br>• "Nhìn nhỏ gọn vậy thôi mà quay êm ru..."<br>• "Điểm ăn tiền nằm ở..."<br>• "Vừa đi vừa quay mà khung hình vẫn chắc nịch." |
| **2. Lối nói Hành chính / Cảnh báo hợp đồng** | • "Nhưng có một điểm cả nhà cần lưu ý là..."<br>• "Ai để ý bao bì thì lưu tâm nhé..."<br>• "Trước khi chọn, xem kỹ hình dáng và thông tin bảo hành có hợp nhu cầu của bạn không nha." | • "Có điều em này không chống nước đâu nha, trời mưa nhớ cất túi kỹ."<br>• "Mỗi tội vỏ hộp hơi đơn giản xíu, bù lại máy bên trong cực ngon."<br>• "Bác nào hay quay vlog giống mình thì nghía thử em này xem hợp gu không nha." |
| **3. Câu cộc lốc / Khảo sát điền form** | • "Điểm mình ưng là cảm giác cầm đầm tay."<br>• "Sản phẩm có thiết kế kim loại chắc chắn." | • "Cầm trên tay thấy đầm và chắc nịch luôn."<br>• "Phần vỏ kim loại hoàn thiện sờ mát rượi, cầm rất đã tay." |
| **4. Copy rập khuôn câu CTA mẫu** | • "Nếu cả nhà thấy món này hợp nhu cầu thì bấm góc trái để tham khảo thêm nha." (Copy nguyên văn gây nhàm chán) | • **Gắn chặt CTA vào tình huống sản phẩm:**<br>  - "Bác nào hay quay vlog di chuyển nhiều thì nghía thử ở góc trái nha."<br>  - "Bà nào lười dọn bếp giống mình thì bấm góc trái tham khảo nghen."<br>  - "Em để sẵn link ở góc trái màn hình cho cả nhà tiện xem nè." |
| **5. Đánh vần chữ số thô thiển (TTS distortion)** | • "bốn K hai trăm bốn mươi khung hình"<br>• "bảy trăm năm mươi mi li lít"<br>• "một inch ba trục" | • Giữ đúng số và thuật ngữ chuẩn: `quay 4K 240fps`, `bình 750ml`, `cảm biến 1 inch`, `gimbal 3 trục`. Giọng đọc AI hiện đại phát âm tự nhiên các ký hiệu này. |
| **6. Đọc thông số kỹ thuật khô khan** | • "Dung tích 750ml, chất liệu inox 304, giữ nhiệt 24 giờ." | • "Bình 750ml to vừa đủ, sáng rót nước đá mang đi làm tới chiều đá vẫn chưa tan hết." |

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
- [ ] Câu hook mở đầu có chào hỏi hoặc nêu tên sản phẩm không? (Nếu có -> Xóa ngay).
- [ ] Toàn bộ lời thoại đọc lên có trôi chảy, giàu cảm xúc và cuốn hút không? (Ưu tiên câu đọc hay, có hồn, không máy móc băm cụt câu).
- [ ] **Ngôi xưng hô có nhất quán từ đầu đến cuối không?** (Tuyệt đối không để đầu câu xưng "mình", giữa câu gọi "cả nhà", cuối câu lại phán "của bạn"; giữ đúng 1 cặp đại từ xuyên suốt).
- [ ] **Kịch bản có dính từ ngữ thuộc BẢNG ĐEN không?**
  * Có câu nào như "Bí mật nằm ở...", "Trang bị hẳn...", "Điểm mình ưng là..." không? (Thay bằng khẩu ngữ đời thường).
  * Khi nêu nhược điểm nhỏ, có bị hành chính hóa ("cần lưu ý là", "ai để ý thì lưu tâm", "xem kỹ thông tin bảo hành") không? (Thay bằng "Mỗi tội...", "Có điều...", "Duy chỉ có...").
  * Có bị đánh vần số thô ("bốn K hai trăm bốn mươi", "bảy trăm năm mươi mi li lít") không? (Giữ nguyên dạng số `4K 240fps`, `750ml`).
- [ ] **Câu CTA cuối có bị copy rập khuôn nguyên văn mẫu không?** (Cấm chép y nguyên "Nếu cả nhà thấy món này hợp nhu cầu thì bấm góc trái để tham khảo thêm nha"; bắt buộc phải gắn CTA vào bối cảnh sản phẩm và cách xưng hô của tệp).
- [ ] Chữ trong `VIDEO OVERLAY TIMELINE` có bị rơi vào bẫy mô tả lại hành động mắt thấy (như "XOAY MÀN HÌNH", "CẦM BÌNH", "MỞ NẮP", "BẤM NÚT") không? HOẶC có bị trùng nguyên văn lời thoại không? (Nếu có -> BẮT BUỘC đổi thành tiêu đề giật tít 2–5 từ in hoa + emoji nêu lợi ích tốc độ, nỗi đau nhột tai hoặc sự thật tò mò: ví dụ "BẬT MÁY 1 GIÂY ⚡", "VLOG RUNG NHƯ ĐỘNG ĐẤT? 📳", "CỰC KỲ ĐẦM TAY! 🏆").
- [ ] Ở giây thứ 8–12 có chi tiết bẻ lái (Micro-test / Khuyết điểm nhỏ có thật) để giữ chân người xem không?
- [ ] Đã khóa đúng `@Image1` cho người dẫn và `@Image2` cho sản phẩm chưa?
- [ ] Prompt hình ảnh của từng clip đã phân vai rõ ràng chưa? (Clip 1 là Hook/Problem, các clip giữa là Macro Close-up Demo có căn cứ, clip cuối là Demo Payoff/CTA). Các mốc thời gian có nằm trong duration và các clip có điểm nối hợp lý không?
