import Link from "next/link";
import { Icon } from "./ui-icon";

export function HelpView() {
  return <>
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />STORYAI / HELP</div><h1>Trợ giúp</h1><p className="heading-subtitle">Cách dùng project slug, preset và pipeline chunk.</p></div></section>
    <section className="help-grid"><article className="help-card panel-card"><span className="help-number">01</span><h2>Tạo project</h2><p>Chọn một luồng tạo riêng cho AI Drama, AI Story hoặc Audio Story. Loại dự án sẽ được khóa sau khi tạo.</p><Link href="/projects/new">Chọn loại dự án <Icon name="arrow" size={13} /></Link></article><article className="help-card panel-card"><span className="help-number">02</span><h2>Màn hình sử dụng</h2><p>Mở URL `/projects/{"<slug>"}` để chỉnh nguồn, chạy chunk và xem tiến độ thật.</p><Link href="/projects">Mở danh sách project <Icon name="arrow" size={13} /></Link></article><article className="help-card panel-card"><span className="help-number">03</span><h2>API key</h2><p>Nhập OpenAI API key trong Cài đặt. Key được mã hóa ở server và không lưu trong source code.</p><Link href="/settings#openai-api-key">Cấu hình OpenAI <Icon name="arrow" size={13} /></Link></article></section>
  </>;
}
