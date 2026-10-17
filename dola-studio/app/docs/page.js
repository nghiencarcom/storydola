import Link from "next/link";

export const metadata = {
  metadataBase: new URL("https://seedance.maivideo.top"),
  title: "Seedance Video API — Tài liệu cho nhà phát triển | Dola Studio",
  description: "Hướng dẫn tích hợp API tạo video Seedance của MaiVideo: xác thực API key, tạo video, gửi hàng loạt, theo dõi trạng thái và xử lý lỗi.",
  alternates: { canonical: "/docs" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Seedance Video API — Dola Studio",
    description: "Tài liệu công khai cho API tạo video Seedance, gồm hướng dẫn tích hợp và đặc tả OpenAPI.",
    url: "/docs",
    type: "website"
  }
};

const exampleTask = `{
  "id": "video_…",
  "status": "queued",
  "model": "seedance-2.5",
  "duration": 10,
  "prompt": "A cinematic shot of a red boat crossing a misty lake."
}`;

export default function ApiDocsPage() {
  return (
    <main className="api-docs-page">
      <header className="api-docs-header">
        <Link className="api-docs-brand" href="/" aria-label="Dola Studio — trang chủ">
          <span className="api-docs-brand-mark">D</span>
          <span>Dola Studio <small>DEVELOPER DOCS</small></span>
        </Link>
        <nav aria-label="Liên kết tài liệu">
          <a href="#quick-start">Bắt đầu</a>
          <a href="#create-video">Endpoints</a>
          <a href="/openapi.json">OpenAPI JSON</a>
          <a className="api-docs-swagger-link" href="/swagger">Swagger UI</a>
        </nav>
      </header>

      <div className="api-docs-layout">
        <aside className="api-docs-sidebar" aria-label="Mục lục">
          <span>TRÊN TRANG</span>
          <a href="#quick-start">Bắt đầu nhanh</a>
          <a href="#authentication">Xác thực</a>
          <a href="#create-video">Tạo video</a>
          <a href="#batch">Tạo hàng loạt</a>
          <a href="#polling">Theo dõi task</a>
          <a href="#retry">Thử lại task</a>
          <a href="#errors">Lỗi thường gặp</a>
        </aside>

        <article className="api-docs-content">
          <p className="api-docs-eyebrow">MAIVIDEO · SEEDANCE API · V1</p>
          <h1>Seedance Video API</h1>
          <p className="api-docs-lead">
            Tạo và theo dõi video Seedance bất đồng bộ bằng API key cá nhân của MaiVideo.
            Trang này là tài liệu HTML công khai; máy đọc có thể dùng thêm đặc tả <a href="/openapi.json">OpenAPI JSON</a>.
          </p>
          <div className="api-docs-actions">
            <a className="api-docs-button api-docs-button-primary" href="#quick-start">Bắt đầu tích hợp</a>
            <a className="api-docs-button" href="/swagger">Mở Swagger UI</a>
          </div>

          <section className="api-docs-callout">
            <strong>API base URL</strong>
            <code>https://seedance.maivideo.top</code>
            <p>Giữ nguyên hostname này cho cả API request và URL video kết quả.</p>
          </section>

          <section id="quick-start" className="api-docs-section">
            <h2>Bắt đầu nhanh</h2>
            <ol>
              <li>Đăng nhập MaiVideo Studio, mở <strong>Cài đặt → API cá nhân</strong>. Key đầu tiên được tạo tự động khi mở mục này.</li>
              <li>Sao chép và lưu key ngay. Key đầy đủ chỉ hiển thị một lần; nếu mất, hãy thu hồi key cũ và tạo key mới.</li>
              <li>Gửi request tạo video với header <code>Authorization: Bearer YOUR_API_KEY</code>, sau đó dùng task ID để poll trạng thái.</li>
            </ol>
            <p><strong>Lưu ý credit:</strong> API key chỉ xác thực người gọi, không tự cấp credit hoặc quota riêng. Video sử dụng credit của các profile Seedance đang kết nối với Gateway; quota thực tế còn phụ thuộc profile và nhà cung cấp.</p>
          </section>

          <section id="authentication" className="api-docs-section">
            <h2>Xác thực</h2>
            <p>Mọi endpoint dưới <code>/v1/videos</code> yêu cầu API key trong HTTP Authorization header. Không gửi key trong query string hoặc mã frontend công khai.</p>
            <pre><code>{`Authorization: Bearer YOUR_API_KEY`}</code></pre>
            <p>Key được gắn với tài khoản MaiVideo đã tạo key. Tài khoản chỉ đọc và thử lại các task thuộc quyền của mình.</p>
          </section>

          <section id="create-video" className="api-docs-section">
            <h2>Tạo một video</h2>
            <p><code>POST /v1/videos/generations</code> nhận prompt và cấu hình video. Thành công trả về task ID ngay; việc render tiếp tục trong hàng đợi.</p>
            <div className="api-docs-endpoint"><span>POST</span><code>/v1/videos/generations</code></div>
            <h3>Request body</h3>
            <dl className="api-docs-fields">
              <div><dt><code>prompt</code> · string · bắt buộc</dt><dd>Nội dung mô tả video.</dd></div>
              <div><dt><code>model</code> · string</dt><dd><code>seedance-2.0</code> hoặc <code>seedance-2.5</code>; mặc định là <code>seedance-2.5</code>.</dd></div>
              <div><dt><code>duration</code> · integer</dt><dd>Chỉ nhận <code>5</code>, <code>10</code> hoặc <code>15</code> giây. Mặc định <code>15</code>; API không hỗ trợ tạo video 30 giây.</dd></div>
              <div><dt><code>ratio</code> · string</dt><dd>Tỷ lệ khung hình: <code>9:16</code>, <code>16:9</code>, <code>1:1</code>, <code>4:3</code> hoặc <code>3:4</code>.</dd></div>
              <div><dt><code>reference_images</code> · string[]</dt><dd>Danh sách tối đa 30 URL ảnh mà Gateway có thể truy cập; có thể bỏ qua nếu không dùng ảnh tham chiếu.</dd></div>
            </dl>
            <h3>Ví dụ cURL</h3>
            <pre><code>{`curl -X POST "https://seedance.maivideo.top/v1/videos/generations" \\
  -H "Authorization: Bearer $SEEDANCE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"seedance-2.5","prompt":"A cinematic shot of a red boat crossing a misty lake.","duration":10,"ratio":"16:9"}'`}</code></pre>
            <h3>Phản hồi thành công · HTTP 200</h3>
            <pre><code>{exampleTask}</code></pre>
          </section>

          <section id="batch" className="api-docs-section">
            <h2>Tạo nhiều video</h2>
            <p><code>POST /v1/videos/batches</code> nhận từ 1 đến 100 prompt. Các cấu hình model, duration, ratio và ảnh tham chiếu được dùng chung cho cả batch.</p>
            <div className="api-docs-endpoint"><span>POST</span><code>/v1/videos/batches</code></div>
            <pre><code>{`{
  "model": "seedance-2.5",
  "prompts": [
    "A red boat crossing a misty lake at sunrise.",
    "A lighthouse beam cutting through the night fog."
  ],
  "duration": 10,
  "ratio": "16:9"
}`}</code></pre>
            <p>Phản hồi có <code>batch_id</code>, phần <code>summary</code> và mảng <code>jobs</code>; lưu các ID trong <code>jobs</code> để theo dõi.</p>
          </section>

          <section id="polling" className="api-docs-section">
            <h2>Theo dõi trạng thái</h2>
            <p>Poll <code>GET /v1/videos/{"{task_id}"}</code> định kỳ. Các trạng thái thường gặp là <code>queued</code>, <code>submitting</code>, <code>processing</code>, <code>completed</code> và <code>failed</code>. Dừng poll khi task hoàn tất hoặc lỗi.</p>
            <div className="api-docs-endpoint"><span>GET</span><code>/v1/videos/{"{task_id}"}</code></div>
            <p>Khi hoàn tất, phản hồi có <code>video_url</code>. Khi lỗi, xem <code>error</code> và <code>failure_code</code>. Có thể xem tối đa 100 task mỗi request bằng <code>GET /v1/videos/status?ids=id1,id2</code> (ID phân cách bằng dấu phẩy).</p>
          </section>

          <section id="retry" className="api-docs-section">
            <h2>Thử lại task lỗi</h2>
            <p><code>POST /v1/videos/{"{task_id}"}/retry</code> chỉ áp dụng cho task <code>failed</code> mà key hiện tại được phép truy cập. Gateway đưa chính task đó trở lại hàng đợi và giữ nguyên ID logic.</p>
            <div className="api-docs-endpoint"><span>POST</span><code>/v1/videos/{"{task_id}"}/retry</code></div>
            <p>Body có thể bỏ trống. Nếu cần cập nhật ảnh tham chiếu, gửi <code>reference_images</code> trong JSON body.</p>
          </section>

          <section id="errors" className="api-docs-section">
            <h2>Lỗi thường gặp</h2>
            <dl className="api-docs-fields api-docs-errors">
              <div><dt><code>401</code> · Unauthorized</dt><dd>Thiếu API key hoặc key không hợp lệ/đã bị thu hồi.</dd></div>
              <div><dt><code>403</code> · Forbidden</dt><dd>Key không có quyền truy cập task hoặc tham số chỉ dành cho quản trị viên.</dd></div>
              <div><dt><code>404</code> · Not Found</dt><dd>Không tìm thấy task trong phạm vi quyền của key.</dd></div>
              <div><dt><code>422</code> · Validation Error</dt><dd>Prompt, model, thời lượng, tỷ lệ hoặc URL ảnh không hợp lệ.</dd></div>
              <div><dt><code>429</code> · Rate Limited</dt><dd>Đã chạm quota/giới hạn hàng đợi hoặc hiện không còn profile khả dụng vì giới hạn provider.</dd></div>
              <div><dt><code>503</code> · Service Unavailable</dt><dd>Gateway chưa có profile Seedance khả dụng để nhận tác vụ.</dd></div>
            </dl>
          </section>

          <footer className="api-docs-footer">
            <span>Thông tin endpoint và schema chính xác được công bố trong OpenAPI.</span>
            <a href="/openapi.json">Mở OpenAPI JSON →</a>
          </footer>
        </article>
      </div>
    </main>
  );
}
