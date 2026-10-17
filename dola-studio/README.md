# Dola Studio

Dashboard Next.js để gửi prompt Seedance hàng loạt qua Dola Render Gateway và theo dõi hàng đợi render. Ứng dụng này chạy cạnh các project đang có của MaiVideo; launcher chỉ dọn listener cũ trên hai cổng riêng của Dola, không đụng tới các dịch vụ khác.

## Bản đồ cổng

| Dịch vụ | Cổng local | Hostname public |
| --- | ---: | --- |
| Dola Studio (dashboard) | 3007 | https://seedance.maivideo.top |
| Dola Studio dev | 3107 | local |
| Dola Render Gateway | 8200 | dùng route /videos/* qua dashboard |
| MaiVideo backend | 8000 | https://maivideo.top |
| MaiVideo frontend | 3005 | https://maivideo.top |
| HTMLVideo | 3000 | https://html.maivideo.top |
| FB Publisher | 4242 | https://fb.maivideo.top |

## Chạy local

> **Quy tắc khi phát triển:** Dùng `npm run dev` tại port 3107 để có hot reload. `npm start` build lại và chạy production tại port 3007. Hai chế độ dùng thư mục build riêng và dùng chung Gateway 8200 cùng dữ liệu/profile tài khoản. Launcher dùng lại Gateway đang chạy; sau khi build, production sẽ thay listener cũ ở port 3007 nếu có.

~~~bash
cp .env.example .env.local
npm install
npm run dev
~~~

`npm run dev` mở http://127.0.0.1:3107 và khởi động Gateway 8200 nếu chưa chạy. Gateway mặc định nằm trong `dola-render-gateway/`; nếu đặt Gateway ở vị trí khác, đặt biến `DOLA_GATEWAY_DIR` trước khi chạy. Có thể đổi port giao diện bằng `DOLA_STUDIO_PORT`; `PORT` trong `.env.local` không thay đổi port của launcher.

Nếu chỉ muốn chạy giao diện Next.js, dùng `npm run dev:studio`.

Khi cần chạy production cho mục đích triển khai, dùng `npm start`; lệnh này tự build trước khi khởi động. Không dùng lệnh này trong lúc chỉnh sửa code hoặc kiểm tra UI:

~~~bash
npm start
~~~

Lệnh này chạy `next build` vào thư mục riêng `.next-production`, sau đó chỉ dọn listener cũ ở cổng Studio 3007 rồi chạy `next start`. Gateway 8200 là dịch vụ dùng chung giữa dev và production, được chạy độc lập nên dừng/restart một launcher không làm tắt chế độ còn lại. Nếu muốn giữ listener Studio cũ một cách có chủ ý, đặt `DOLA_CLEAR_OLD_PORTS=0`; nếu chỉ muốn chạy giao diện production sau khi đã build, dùng `npm run start:studio` (lệnh này không tự build).

Để kiểm tra bản production song song với bản dev, dùng `npm run start:isolated`. Bản này dùng build riêng `.next-production-isolated`, chạy Studio ở cổng 3107 và Gateway ở cổng 8201, nên không ảnh hưởng `npm run dev`:

~~~bash
npm run start:isolated
~~~

Gateway gốc mặc định dùng cổng 8000, đang trùng với MaiVideo backend. `npm run dev` đã khởi động Gateway trên cổng 8200 tự động. Nếu chạy `npm run dev:studio` hoặc khởi động thủ công, dùng:

~~~bash
cd /path/to/Dola/dola-render-gateway
DOLA_PORT=8200 \
DOLA_PUBLIC_BASE=https://seedance.maivideo.top \
uvicorn server:app --host 0.0.0.0 --port 8200
~~~

Nếu Gateway bật API key cho Studio nội bộ, đặt key ở DOLA_GATEWAY_API_KEY trong Dola/.env.local. Key này chỉ được đọc ở Route Handler phía server, không gửi xuống trình duyệt. API key riêng cho người dùng được tạo trong **Cài đặt → API cá nhân** sau khi đăng nhập MaiVideo.

## API Seedance cho người dùng

Key đầu tiên được tự tạo khi người dùng mở **Cài đặt → API cá nhân** lần đầu; key đầy đủ chỉ hiện lần đó và nên được lưu an toàn. Danh sách chỉ giữ key đã che một phần; người dùng có thể thu hồi hoặc tạo thêm, tối đa 10 key đang hoạt động. Mỗi key gắn với tài khoản MaiVideo đã tạo, vì vậy key khác không thể đọc hoặc retry job của người dùng đó. API key chỉ xác thực request, không cấp credit riêng: video tiêu thụ credit của các profile Seedance đang kết nối với Gateway. Gateway phải cấu hình `DOLA_ADMIN_KEY` và Studio phải có cùng giá trị trong `DOLA_GATEWAY_ADMIN_KEY`; cặp cấu hình này bảo vệ luồng quản lý key qua server-side proxy.

Tài liệu hướng dẫn công khai, có HTML để người dùng/AI đọc, nằm tại **https://seedance.maivideo.top/docs**. Đặc tả máy đọc OpenAPI là `/openapi.json`; giao diện Swagger tương tác ở `/swagger` (chọn **Authorize** rồi nhập key, không cần thêm tiền tố `Bearer` trong ô Swagger). Endpoint chính là `POST /v1/videos/generations`; `model` nhận `seedance-2.0` hoặc `seedance-2.5`, `duration` chỉ nhận 5/10/15 giây, và có thể chọn `ratio` cùng `reference_images`. Gateway trả task ID ngay sau khi nhận yêu cầu; poll `GET /v1/videos/{task_id}` tới trạng thái `completed` hoặc `failed`. Gửi tối đa 100 prompt cùng lúc qua `POST /v1/videos/batches`.

Ví dụ gọi API bên ngoài Studio:

~~~bash
curl -X POST "https://seedance.maivideo.top/v1/videos/generations" \
  -H "Authorization: Bearer $SEEDANCE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"seedance-2.5","prompt":"A cinematic shot of a red boat crossing a misty lake.","duration":10,"ratio":"16:9"}'
~~~

API key dùng chung hàng đợi profile Seedance; tốc độ và khả năng tạo video còn phụ thuộc quota/provider và profile khả dụng. Hãy không đưa key vào frontend công khai, source control hoặc log.

## Kết nối tài khoản Seedance

Trang chủ yêu cầu đăng nhập MaiVideo trước khi mở workspace. Dola gọi `/api/auth/me` để kiểm tra phiên đăng nhập và chuyển tiếp cookie/token hiện tại cho các route cần quyền. Màn hình chặn dùng cùng bố cục form như FB Publisher, gồm tab **Đăng kí** và **Đăng nhập**; biểu mẫu gửi trực tiếp tới MaiVideo qua proxy `/api/media/auth/register` hoặc `/api/media/auth/login`. Khi dashboard chạy dưới `seedance.maivideo.top`, cookie parent domain được dùng chung với `maivideo.top`; khi chạy local ở `127.0.0.1`, Dola lưu token vào cookie HttpOnly riêng của localhost.

Khi đã vào workspace, email phiên hiện ở topbar và nút **Đăng xuất** nằm ngay cạnh đó. Nút này gọi `/api/auth/logout` của MaiVideo qua route proxy `/api/maivideo/logout`, xoá cookie/token cục bộ rồi đưa trang về màn hình đăng nhập.

Sau khi đăng nhập, tab **Tạo hàng loạt** chỉ gửi qua **Dola Gateway ở cổng 8200** và tự điều phối bằng các tài khoản Dola đã kết nối; request có `provider` khác `gateway` bị từ chối. Hiện chỉ bật Seedance 2.5 với thời lượng 5s, 10s hoặc 15s; Seedance 2.0 đang tạm ẩn. Dola giữ mã task, polling trạng thái qua `/api/jobs/:id` và proxy file kết quả qua `/api/media/files`. Khi task ở trạng thái lỗi, hàng đợi có nút **Tạo lại** để đưa lại chính task lỗi vào hàng đợi với cùng prompt, model, thời lượng, tỷ lệ và ảnh tham chiếu. Mỗi dòng còn có **Tạo tương tự** để nạp prompt/cấu hình/ảnh tham chiếu sang Studio, **Sửa** để tạo bản chỉnh sửa mới và nút thông tin để xem prompt đầy đủ, task ID, mốc thời gian, metadata output, timings và lỗi; các thao tác này không tự gửi task. Với task đang **Đang chờ**, **Đang gửi** hoặc **Đang render**, có thể tích chọn hàng loạt hoặc bấm **Huỷ & xoá** ở từng dòng; Gateway sẽ dừng worker/poll cục bộ, đóng context Chromium và xoá task khỏi SQLite. Nếu Dola đã nhận conversation thì phía Dola có thể vẫn tiếp tục xử lý và credit không được hoàn lại. MaiVideo được gọi thêm qua API PixVerse image-generation để chuẩn bị ảnh chì khi người dùng bật tùy chọn; MaiVideo không tham gia tạo hoặc polling video Seedance. Các cụm thời lượng dạng chữ trong prompt được tự động loại bỏ; thời lượng thật chỉ đi qua trường cấu hình riêng.

### Phạm vi dữ liệu hàng đợi

`/hang-doi-render` lấy role từ phiên MaiVideo ở phía server. Người dùng thông thường chỉ nhận được các task do chính họ tạo; tài khoản có `role=admin` mới gọi được danh sách toàn bộ task của dự án. Poll trạng thái, xem chi tiết, tạo lại và **Huỷ & xoá** đều áp dụng cùng phạm vi này, nên không thể dùng ID của người khác để thao tác.

`/tai-khoan-seedance` cố ý không áp dụng phạm vi người dùng: danh sách profile, quota nội bộ và luồng đăng nhập vẫn là một account pool dùng chung cho toàn bộ workspace. Đây là phạm vi khác với hàng đợi video.

Task mới được gắn một `owner_id` HMAC ổn định từ định danh MaiVideo. Đặt `DOLA_TASK_OWNER_SECRET` ở `.env.local` của Dola Studio bằng một secret ngẫu nhiên đủ dài và giữ nguyên giá trị đó trong suốt vòng đời database. Các task cũ chưa có `owner_id` vẫn được admin xem được nhưng không hiển thị cho user thường; không tự gán ngược cho user nào để tránh lộ dữ liệu.

Các tab có slug URL cố định để mở hoặc chia sẻ trực tiếp:

- `/tong-quan`
- `/tao-hang-loat`
- `/hang-doi-render`
- `/ket-noi-dich-vu`
- `/tai-khoan-seedance`
- `/cai-dat`

Mở mục **Tài khoản Seedance** trong sidebar. Gateway hỗ trợ hai chế độ:

- **Một tài khoản**: chỉ điền email Google, mật khẩu và TOTP secret nếu có 2FA. Gateway tự tạo mã session nội bộ từ email, không cần đặt tên `acc01`, `acc02`.
- **Nhập hàng loạt**: mỗi dòng theo định dạng `email---password---totp_secret` (hoặc bốn dấu `----`); TOTP có thể để trống, dòng bắt đầu bằng `#` được bỏ qua. Mỗi lần tối đa 50 tài khoản. Gateway tự tạo mã session và tạo mã TOTP cục bộ từ secret Base32/`otpauth://`, không cần gửi secret lên dịch vụ bên thứ ba.

Khi nhập hàng loạt, Gateway chỉ mở một luồng đăng nhập Google tại một thời điểm. Lượt kế tiếp được xếp sau lượt trước và cách tối thiểu 60 giây; tài khoản đang chờ hiển thị trạng thái **Đang chờ lượt**. Giới hạn này chỉ áp dụng cho đăng nhập, không giới hạn số luồng render video.

Tài khoản có trạng thái **Đăng nhập lỗi** hoặc **Hết phiên** sẽ có nút **Đăng nhập lại**. Email, mật khẩu và TOTP được Gateway mã hoá và lưu riêng theo profile; khi chọn profile rồi bấm **Đăng nhập lại đã chọn**, Gateway tự dùng lại thông tin đó để thay session cũ bằng một luồng OAuth mới. Profile tạo từ phiên bản cũ chưa có credential vault sẽ fallback về session Gmail hiện có; gửi lại dòng email/mật khẩu một lần sẽ lưu credential mà không thay session nếu profile đang hoạt động.

Trong danh sách tài khoản, tích chọn nhiều profile rồi bấm **Xoá đã chọn** để xoá session và thư mục profile cùng lúc. Profile đang đăng nhập hoặc đang render sẽ được giữ lại và báo trong kết quả.

Nếu đặt `DOLA_ADMIN_KEY` cho Gateway, nhập đúng key tại ô **Quyền quản trị Gateway**. Nếu để trống `DOLA_ADMIN_KEY` ở môi trường local, không cần nhập key. Khi gửi, Gateway sẽ mở Chromium trên máy chạy Gateway, hoàn tất Google OAuth, lưu session riêng cho từng email và lưu credential vault được mã hoá trên máy Gateway; Dola Studio không lưu mật khẩu/TOTP hoặc danh sách bulk vào localStorage. Nếu Google yêu cầu CAPTCHA, consent hoặc bước 2FA thủ công, hoàn tất trong cửa sổ Chromium đó rồi bấm **Kiểm tra** trên từng tài khoản.

`DOLA_GATEWAY_ADMIN_KEY` trong `.env.local` là lựa chọn server-side để không phải nhập admin key mỗi phiên. Key này khác với `DOLA_GATEWAY_API_KEY` dùng cho API tạo video.

## Ảnh tham chiếu từ thư viện MaiVideo

Trong **Tạo hàng loạt**, bấm **Chọn từ thư viện** ở phần Ảnh tham chiếu để mở thư viện dạng modal. Có thể tìm theo tên, chọn tối đa 30 ảnh, bỏ chọn ngay trên chip xem trước và xoá ảnh khỏi thư viện bằng nút `×`. Kéo thả nhiều ảnh vào vùng upload hoặc copy ảnh bất kỳ rồi nhấn `Ctrl/Cmd+V`; Dola sẽ đưa ảnh vào thư viện MaiVideo và tự chọn chúng làm ảnh tham chiếu. Dola gọi proxy nội bộ tới `/api/media/images`, `/api/media/upload` và `/api/media/files` nên ảnh vẫn đi qua quyền sở hữu/session của MaiVideo; không cần mở thêm CORS hay tunnel riêng.

Nếu thư viện MaiVideo đang gắn với tài khoản, dán `authToken` của phiên MaiVideo vào ô token trong picker rồi bấm **Lưu & tải lại**. Token không nằm trong localStorage; picker dùng `sessionStorage` và cookie HttpOnly của Dola (tối đa 7 ngày). Có thể đặt `MAIVIDEO_AUTH_TOKEN` ở server nếu muốn dùng một token cố định. Session ID MaiVideo đang có trong trình duyệt cũng được chuyển tiếp để Gateway đọc được ảnh; khi chạy local, Gateway dùng allowlist riêng cho proxy `/api/media/files` trên loopback nên không bị nhầm là SSRF.

Khi Dola chạy dưới `*.maivideo.top` và MaiVideo cấp cookie đăng nhập cho parent domain, proxy sẽ tự dùng cookie đó; trong trường hợp local `127.0.0.1` không có cookie chung thì dùng ô token trong picker.

Khi tạo video Seedance có ảnh tham chiếu, Studio mặc định chọn **Tạo ảnh chì đen trắng** và dùng model **Nano Banana 2** (`gemini-3.1-flash`) của MaiVideo. Prompt yêu cầu chỉnh sửa chọn vùng: chỉ chuyển nhân vật thành nét chì đen trắng, còn sản phẩm, logo, chữ và bối cảnh giữ màu, bố cục và vị trí gốc. Trước khi gửi video, Studio tự thêm chỉ dẫn cho Seedance rằng ảnh chì chỉ là guide hình dáng và nhân vật trong video phải được dựng lại bằng màu đầy đủ; có thể nhập màu chính xác tại ô **Màu nhân vật gốc** (ví dụ: da sáng ấm, tóc đen, mắt nâu, áo trắng viền xanh). Bước này gọi API image-generation của MaiVideo cho từng ảnh (`POST /api/v1/image-generation`), gửi ảnh qua trường chuẩn `reference_image_urls: string[]`; với ảnh từ thư viện, Dola chuyển URL proxy thành URL static MaiVideo để MaiVideo tự tải, tự nhận diện JPG/PNG/WEBP… và chuyển thành ảnh chì. API cũng hỗ trợ data URL hoặc base64 thô trong cùng trường này. Sau đó Dola poll job đến khi có `file_url` rồi mới gửi các ảnh đã xử lý sang Dola Gateway. Chọn **Không tạo** để gửi ảnh gốc như trước. Mỗi ảnh xử lý thành công dùng một lượt quota ảnh MaiVideo; nếu bước này lỗi, video không được gửi bằng ảnh gốc thay thế. Có thể đặt `MAIVIDEO_API_KEY` ở server; nếu để trống, Studio dùng token phiên MaiVideo đang đăng nhập.

## Gắn vào Cloudflare Tunnel hiện tại

Không khởi động thêm một cloudflared process với cùng tunnel token. Trong tunnel đang phục vụ MaiVideo, thêm một Public Hostname:

~~~text
Hostname: seedance.maivideo.top
Service:   http://127.0.0.1:3007
~~~

Trong môi trường hiện tại, seedance.maivideo.top đã trả về dashboard ở cổng 3007. Nếu dựng lại tunnel trên máy khác, dùng đúng hostname và origin ở trên.

Dashboard phục vụ trang hướng dẫn `/docs`, đồng thời proxy `/swagger`, `/redoc`, `/openapi.json`, `/v1/*` và `/videos/*` về `DOLA_GATEWAY_URL`. Vì vậy tài liệu, request tạo video và file kết quả đều dùng hostname `seedance.maivideo.top`; không cần mở hostname hoặc cổng public riêng cho Gateway. `/robots.txt` và `/sitemap.xml` công bố đường dẫn tài liệu cho crawler. Các route hiện có cho maivideo.top, html.maivideo.top và fb.maivideo.top giữ nguyên.

## Luồng batch

Toàn bộ nội dung trong ô prompt được gửi như một prompt duy nhất; xuống dòng chỉ là nội dung của prompt, không phải dấu phân cách video. Bộ đếm 12.000 ký tự Unicode bao gồm cả prompt video và nội dung ô **Màu nhân vật gốc**; khi tổng vượt giới hạn, phần dư được tự động cắt ở UI, API và Gateway. Route POST /api/batches ưu tiên endpoint `/v1/videos/batches` để ghi tác vụ trong một transaction. Nếu gặp Gateway cũ chưa có endpoint này, hệ thống fallback về submit một prompt. Dashboard lưu danh sách task trong localStorage, sau đó đọc trạng thái các task đang chạy bằng một request `/api/jobs/status` gộp thay vì mở một request cho từng task. Với task lỗi đã có trên Gateway, POST `/v1/videos/:id/retry` đưa lại chính task logic vào hàng đợi (giữ nguyên mã task và tăng bộ đếm retry), đồng thời tạo conversation provider mới; task lỗi cục bộ (Gateway không nhận request) sẽ fallback về `/api/batches`. UI thay thế dòng lỗi nên không hiển thị job retry trùng. Trạng thái và file thực tế vẫn do gateway lưu trong tasks.db và downloads/. Xoá task active dùng cùng route admin bulk-delete, nhưng Gateway đánh dấu `cancelled`, dừng runtime rồi mới xoá record để task không tự phục hồi sau khi restart.

Các tùy chọn hỗ trợ theo Dola Gateway:

- Seedance 2.5: 5s, 10s hoặc 15s
- Seedance 2.0: tạm thời ẩn trong Studio/Gateway
- 9:16, 16:9, 1:1, 4:3 hoặc 3:4
- Tối đa 30 ảnh tham chiếu từ thư viện MaiVideo

## Kiểm tra

~~~bash
npm run lint
npm run build
~~~

Trang Kết nối dịch vụ gọi health endpoint nội bộ của bốn project và hiển thị latency; không trả cookie, token hay dữ liệu workspace ra trình duyệt.
