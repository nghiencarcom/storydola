# Cẩm nang Viết Lời thoại & Giữ chân Khán giả — Drama Việt

Tài liệu này cung cấp các nguyên tắc thực chiến, mẫu câu và kỹ thuật viết kịch bản giúp phim AI đạt độ hấp dẫn cao, lời thoại có "hồn", tự nhiên và tối đa hóa tỷ lệ giữ chân người xem (retention rate).

---

## 1. Bản chất của lời thoại hay: Thoại là Hành Động (Action), không phải Kể Lể (Exposition)

Trong phim ngắn và drama đời thường, khán giả không xem phim để nghe tóm tắt sự kiện. Họ xem để chứng kiến sự va chạm tâm lý giữa các nhân vật.

### Quy tắc 3 Tầng Thoại:
1. **Tầng bề mặt (Text):** Từ ngữ phát ra thành tiếng.
2. **Tầng ngầm ý (Subtext):** Điều nhân vật thực sự nghĩ, nỗi sợ hoặc toan tính bên trong.
3. **Tầng hành vi (Action/Intent):** Mục đích thực sự: tấn công, phòng thủ, thăm dò, tống tiền cảm xúc, lảng tránh hay gài bẫy đối phương.

### Bảng đối chiếu: Kể lể sự vụ vs Lời thoại sắc sảo có Subtext
| Tình huống | Lời thoại dở (Kể lể, khô khan, mất duyên) | Lời thoại sắc sảo (Có subtext, giữ chân cao) | Phân tích Action & Subtext |
| :--- | :--- | :--- | :--- |
| **Phát hiện tiền quỹ chung bị chuyển đi** | *"Mẹ ơi, con thấy tin nhắn tài khoản chung bị trừ ba mươi lăm triệu, mẹ có lấy đi mua máy may không?"* | *"Ba mươi lăm triệu quỹ thuốc thang của cả nhà... Duy bảo với con là đem gửi tiết kiệm, hóa ra 'tiết kiệm' nằm ở góc tiệm này hả mẹ?"* | **Tấn công ngầm:** Kéo chồng vào thế nói dối, bóc trần sự lấp liếm mà không cần quát tháo. |
| **Mẹ chồng bao biện việc tự ý quyết định** | *"Mẹ mua cái máy này để tiệm may kiếm ra tiền cho cả nhà, sao con cứ so đo mãi thế?"* | *"Tiệm này nuôi thằng Duy ăn học thành tài, giờ mẹ thay cái máy cũ rách cũng phải làm đơn xin phép con dâu từng chữ à?"* | **Tống tiền cảm xúc:** Đem công lao nuôi dạy con cái ra làm bia đỡ đạn, đẩy con dâu vào thế bất hiếu. |
| **Chồng né tránh mâu thuẫn giữa mẹ và vợ** | *"Thôi hai người đừng cãi nhau nữa, để anh đi làm kiếm tiền bù vào là được chứ gì."* | *"Mẹ tính mẹ xưa giờ thương con thương cháu, em cứ làm quá lên rồi cả khu này người ta lại cười cho xem..."* | **Thao túng tâm lý (Gaslighting):** Đổ lỗi cho vợ nhạy cảm để trốn tránh trách nhiệm cá nhân. |
| **Hàng xóm buôn chuyện, mỉa mai** | *"Chào chị Hạnh, dạo này nghe nói nhà chị đang có chuyện cãi nhau về tiền nong phải không?"* | *"Sáng nay thấy chiếc ô tô đỗ trước tiệm chở cái máy may to đùng, em tưởng nhà mình trúng quả đậm, ai ngờ..."* | **Thăm dò & Mỉa mai:** Tỏ vẻ chúc mừng nhưng thực chất là chọc ngoáy vào vết thương. |

---

## 2. Quy tắc Độ dài Câu Thoại: Bỏ trần 12 từ, Khuyến khích 12–18 từ

### A. Ưu tiên câu trọn vẹn 12–18 từ, linh hoạt theo nhịp
- Tiếng Việt đời thường có nhịp điệu phong phú, nhiều từ đệm, quan hệ từ và các vế đối đáp tự nhiên. Ưu tiên câu thoại trọn vẹn, có ngữ cảnh và subtext dài **12–18 từ**; có thể dài hơn khi dấu phẩy hoặc gạch ngang (`—`) ngắt nhịp tự nhiên và giữ trọn cái duyên.
- Độ dài 12–18 từ cho phép nhân vật trình bày trọn vẹn một lập luận sắc bén, một câu mỉa mai sâu cay hoặc một sự phản bác có sức nặng.
- **Về mặt kỹ thuật TTS:** Ở tốc độ 2.5–3 từ/giây, một câu 12–18 từ mất khoảng **4–7,2 giây**. Với `dialogue_led`, căn cue hoặc thêm lượt thoại tự nhiên để tuân thủ giới hạn khoảng lặng; nếu hành động gánh beat và cần khoảng lặng dài hơn, dùng `visual_led`.

### B. Tuyệt đối cấm băm nhỏ câu hay cắt cụt làm mất "duyên"
- **Lỗi băm nhỏ câu:** Tự động cắt một ý hay thành những mẩu vụn 4–7 từ khiến nhân vật nói năng giật cục như học sinh đọc chính tả. Câu ngắn trọn vẹn 3–7 từ vẫn dùng được khi đan xen có chủ đích để nhấn, bùng nổ, ra lệnh hoặc từ chối:
  * *Bị cấm:* *"Mẹ đã mua máy. Tiền của con. Con không thích. Mẹ xin lỗi."* (Vô hồn, máy móc, mất hết cảm xúc).
  * *Đúng chuẩn tự nhiên (15 từ):* *"Tiền mồ hôi nước mắt con tích cóp ba năm, mẹ đem đi đặt cọc mà không nói một lời?"*
- **Khi nào dùng câu ngắn (< 12 từ)?**
  * Chỉ dùng khi có dụng ý; câu trọn vẹn 3–7 từ hợp để nhấn hoặc trong khoảnh khắc gắt gỏng bộc phát (*"Đủ rồi đấy Duy!"*), mệnh lệnh dứt khoát (*"Đưa chìa khóa đây cho tôi!"*), hoặc từ chối đanh thép (*"Không một đồng nào nữa hết."*).

### C. Kỹ thuật điều khiển nhịp thở cho AI TTS (ElevenLabs / Omnivoice)
- **Dấu phẩy `,`:** Chia câu 12–18 từ thành 2 vế nhịp nhàng (mỗi vế 6–9 từ), giúp giọng AI lấy hơi tự nhiên và có trọng âm rõ nét.
- **Dấu chấm lửng `...`:** Đặt ở giữa câu để thể hiện sự ngập ngừng, dối trá hoặc kìm nén nước mắt (*"Duy nói... anh ấy sang tên tiệm may... từ tháng trước rồi mẹ."*).
- **Dấu gạch ngang `—`:** Thể hiện cú chuyển ý đột ngột hoặc ngắt lời đối phương (*"Tôi tôn trọng mẹ cả đời này — nhưng cái tiệm này không phải của riêng mẹ!"*).

---

## 3. Ma trận Khẩu khí Nhân vật (Character Vocal Signature)

Mỗi nhân vật phải có một "vân tay ngôn ngữ" riêng. Không để tất cả nhân vật nói cùng một giọng văn viết chuẩn mực.

### 1. Thế hệ lớn tuổi / Mẹ chồng truyền thống
- **Tâm lý:** Sĩ diện, sợ mất quyền uy, vịn vào công lao và phong tục.
- **Đặc trưng ngôn ngữ:** Hay dùng câu hỏi ngược, nói bóng gió, dẫn chứng quá khứ, dùng đại từ xưng hô tôn ti (*"cái nhà này", "chị làm dâu", "thời buổi này"*).
- **Mẫu thoại điển hình:**
  * *"Chị đừng có đem mấy cái lý lẽ sách vở kế toán ra đây mà dạy đời một người cả đời cắm mặt nuôi cả cái nhà này."* (25 từ, ngắt 2 vế tự nhiên)
  * *"Cái ngữ con dâu mà bước qua khỏi cửa tiệm này, xem sau này còn mặt mũi nào nhìn họ hàng dưới quê nữa không!"* (22 từ)

### 2. Thế hệ trẻ / Nàng dâu hiện đại
- **Tâm lý:** Coi trọng sự minh bạch, bảo vệ gia đình hạt nhân, không cam chịu bất công.
- **Đặc trưng ngôn ngữ:** Câu cú mạch lạc, dùng dữ kiện (tiền, tin nhắn, hợp đồng), xưng hô lịch sự nhưng khoảng cách sắc lạnh.
- **Mẫu thoại điển hình:**
  * *"Con gọi mẹ là mẹ vì danh nghĩa gia đình, chứ không phải để mẹ tự ý lấy tiền riêng của vợ chồng con đem cho người khác."* (24 từ)
  * *"Trước khi mẹ trách con lạnh lùng, xin mẹ nhìn lại tin nhắn chuyển khoản ba mươi lăm triệu này xem ai là người lén lút trước."* (23 từ)

### 3. Người đàn ông kẹt ở giữa (Chồng ba phải / Né tránh)
- **Tâm lý:** Sợ mâu thuẫn, sợ mất mặt, hứa hẹn nước đôi, trốn chạy trách nhiệm.
- **Đặc trưng ngôn ngữ:** Ấp úng, dùng từ xoa dịu (*"thôi mà", "từ từ đã", "em bình tĩnh"*), đổi chủ đề.
- **Mẫu thoại điển hình:**
  * *"Kìa Mai... chuyện trong nhà đóng cửa bảo nhau, em cứ làm ầm lên rồi mẹ tăng huyết áp ra đấy thì ai chịu trách nhiệm?"* (22 từ)
  * *"Anh tính nói với em rồi chứ bộ... tại mấy hôm nay thấy em bận việc công ty quá nên anh chưa kịp mở lời thôi."* (21 từ)

---

## 4. Cấu trúc Giữ chân Vi mô (Micro-Retention Engine) cho Cảnh 10 Giây

Trong phim ngắn AI, tỷ lệ giữ chân phụ thuộc vào việc liên tục kích thích não bộ khán giả bằng thông tin hoặc cảm xúc mới.

### A. Hook mở đầu 3–5 giây
- Va chạm bắt đầu ngay, không nhạc dạo dài hay phong cảnh tĩnh. Hook có thể rõ ở giây 3; nếu cần thêm nhịp để người xem hiểu mâu thuẫn, ưu tiên dùng tối đa 5 giây. Không kéo dài chỉ để đủ mốc (In medias res).
- Câu thoại đầu tiên phải chứa đựng "mồi câu kịch tính": một sự mất mát, một bí mật bị phát hiện, một lời tố cáo hoặc một tối hậu thư.

### B. Quy luật "Không Cảnh 10s Nào Được Bằng Phẳng"
Mỗi cảnh 10 giây phải chứa ít nhất một trong ba yếu tố:
1. **Reveal (Tiết lộ):** Một manh mối mới được tung ra (mở tin nhắn, thấy vết son, tìm thấy tờ giấy biên nhận).
2. **Escalate (Leo thang):** Mức độ căng thẳng tăng lên, có người thứ ba can thiệp, nguy cơ mất trắng cận kề.
3. **Turn (Bẻ lái):** Phản ứng bất ngờ của nhân vật làm đảo lộn thế trận (người tưởng yếu thế bỗng tung đòn quyết định).

### C. 4 Công thức Cliffhanger Giữ Chân Cuối Tập (Episodic Cliffhangers)
Để người xem bấm "Xem tập tiếp theo" ngay lập tức mà không cắt ngang câu thoại nửa chừng:
1. **Lỗ hổng thông tin (The Knowledge Gap):**
   * *Hình ảnh:* Mở ngăn kéo tủ tìm chìa khóa, bất ngờ làm rơi tập hồ sơ bệnh án hoặc tờ giấy nợ lạ.
   * *Thoại cuối:* *"Tên người vay trên giấy này... đâu phải của ba?"* $\rightarrow$ Màn hình đen.
2. **Tối hậu thư & Giới hạn thời gian (The Ultimatum):**
   * *Thoại cuối:* *"Trước tám giờ sáng mai, nếu ba mươi lăm triệu không về tài khoản, con sẽ tự mang tập sao kê này ra họp cả dòng họ."*
3. **Nhân tố bất ngờ xuất hiện (The Sudden Intrusion):**
   * *Diễn biến:* Người chồng chuẩn bị thú nhận toàn bộ sự thật, bỗng cánh cửa bật mở, người thứ ba bước vào cùng chiếc vali.
   * *Thoại cuối:* *"Xin lỗi vì đến đột ngột... nhưng căn nhà này đã được sang tên cho tôi từ hôm qua rồi."*
4. **Câu hỏi dồn vào chân tường (The Unanswered Accusation):**
   * *Thoại cuối:* *"Mẹ nói chiếc máy may này ba mươi lăm triệu... vậy sao hóa đơn trong túi áo anh Duy ghi có mười hai triệu?"*

---

## 5. Kết hợp Lời thoại và Camera Combos của StoryAI

Tận dụng 25 Camera Combos của StoryAI để lời thoại đạt hiệu quả thị giác tối đa:

- **Khi thoại mang tính phát hiện bí mật:** Dùng **Combo 04 (Slow Push-In + Rack Focus)** — máy quay lấy nét từ tờ giấy/điện thoại sang nét mặt bàng hoàng của nhân vật.
- **Khi thoại là sự đối đầu nảy lửa giữa 2 nhân vật:** Dùng **Combo 06 (Arc Left + Slow Push-In)** hoặc **Combo 12 (OTS Push-In + Rack Focus)** — siết chặt khoảng cách giữa hai nhân vật qua góc quay qua vai.
- **Khi thoại là cú sốc bất ngờ:** Dùng **Combo 20 (Whip Pan + Tracking Follow)** hoặc **Combo 22 (Push-In + Rapid Pull-Back)** — tạo nhịp giật thị giác ngay khi câu nói chấn động phát ra.
- **Khi thoại là sự tuyệt vọng hoặc cô đơn sau phán quyết:** Dùng **Combo 15 (Tilt-Down + Slow Pull-Back)** hoặc **Combo 13 (Slow Arc + Gentle Dolly-Out)** — lùi dần ra xa để nhân vật chìm trong không gian trống trải.
