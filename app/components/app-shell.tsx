"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProjects } from "../lib/project-store";
import { Icon, type IconName } from "./ui-icon";
import { UserMenu } from "./user-menu";

const navItems: { icon: IconName; label: string; href: string }[] = [
  { icon: "grid", label: "Tổng quan", href: "/dashboard" },
  { icon: "folder", label: "Dự án của tôi", href: "/projects" },
  { icon: "scene", label: "AI Drama", href: "/ai-drama" },
  { icon: "clock", label: "Timelapse", href: "/timelapse" },
  { icon: "spark", label: "Story", href: "/story" },
  { icon: "bolt", label: "Tác vụ đang chạy", href: "/tasks" },
  { icon: "settings", label: "Cài đặt", href: "/settings" },
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === "/dashboard" || pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { projects, error } = useProjects();
  const queuedTaskCount = projects.reduce((sum, project) => sum + project.chunks.filter((chunk) => chunk.status === "processing" || chunk.status === "queued").length, 0);
  const currentProject = pathname.startsWith("/projects/") ? projects.find((project) => pathname.includes(project.slug)) : undefined;
  const pageName = pathname.startsWith("/projects/new") ? pathname.endsWith("/ai-drama") ? "Tạo AI Drama" : pathname.endsWith("/audio-story") ? "Tạo Audio Story" : pathname.endsWith("/ai-story") ? "Tạo AI Story" : "Chọn loại dự án" : pathname.startsWith("/projects/") && pathname.includes("/settings") ? "Tùy chỉnh dự án" : currentProject?.title || (pathname === "/projects" ? "Dự án của tôi" : pathname === "/ai-drama" ? "AI Drama" : pathname === "/timelapse" ? "Timelapse" : pathname === "/story" ? "Story" : pathname === "/library" ? "Kho cảnh & preset" : pathname === "/tasks" ? "Tác vụ đang chạy" : pathname === "/settings" ? "Cài đặt" : "Tổng quan");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row"><img className="brand-logo" src="/branding/maivideo-logo-accurate-header.png" alt="MaiVideo" /></div>
        <div className="nav-label">Sản xuất</div>
        <nav className="main-nav">{navItems.map((item) => <Link key={item.href} href={item.href} className={`nav-item ${isActive(pathname, item.href) ? "active" : ""}`}><span className="nav-icon"><Icon name={item.icon} size={18} /></span><span>{item.label}</span>{item.href === "/tasks" && queuedTaskCount > 0 && <span className="nav-count">{queuedTaskCount}</span>}</Link>)}</nav>
        <div className="nav-label library-label">Thư viện</div>
        <nav className="main-nav"><Link href="/library" className={`nav-item ${isActive(pathname, "/library") ? "active" : ""}`}><span className="nav-icon"><Icon name="layers" size={18} /></span><span>Kho cảnh & preset</span></Link></nav>
      </aside>
      <main className="main-content">
        <header className="topbar"><div className="breadcrumbs">{pathname.startsWith("/projects/") ? <><Link href="/projects">Dự án</Link><Icon name="chevron" size={14} /><strong>{pageName}</strong></> : <><Link href="/dashboard">MaiVideo</Link><Icon name="chevron" size={14} /><strong>{pageName}</strong></>}</div><div className="topbar-actions"><Link href="/help" className="icon-button" aria-label="Trợ giúp"><Icon name="help" size={18} /></Link><UserMenu /></div></header>
        <div className={`page-wrap ${pathname === "/timelapse" ? "timelapse-page-wrap" : ""}`}>{error && <div className="workspace-error"><span>!</span>Không tải được dữ liệu server: {error}<button onClick={() => window.location.reload()}>Tải lại</button></div>}{children}</div>
      </main>
    </div>
  );
}
