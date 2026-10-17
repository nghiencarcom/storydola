"use client";

import Link from "next/link";
import { useProjects } from "../lib/project-store";
import { STORY_PRESETS } from "../lib/story-presets";
import type { StoryProject } from "../lib/project-types";
import { Icon, type IconName } from "./ui-icon";

function projectProgress(project: StoryProject) {
  return Math.min(100, Math.max(0, Math.round((project.completedScenes / Math.max(1, project.totalScenes)) * 100)));
}

function statusDetails(status: StoryProject["status"]) {
  switch (status) {
    case "processing": return { label: "Đang xử lý", className: "processing" };
    case "ready": return { label: "Hoàn tất", className: "ready" };
    case "needs_review": return { label: "Cần xem lại", className: "needs_review" };
    case "failed": return { label: "Có lỗi", className: "failed" };
    default: return { label: "Bản nháp", className: "draft" };
  }
}

function updatedLabel(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Vừa cập nhật";
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} giờ trước`;
  return new Date(value).toLocaleDateString("vi-VN", { day: "numeric", month: "short" });
}

export function DashboardOverview() {
  const { projects, ready, error } = useProjects();
  const recentProjects = [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4);
  const needsAttention = projects.filter((project) => project.status === "needs_review" || project.status === "failed").length;
  const metrics: { label: string; value: number; icon: IconName; tone: string }[] = [
    { label: "Tổng dự án", value: projects.length, icon: "folder", tone: "blue" },
    { label: "Đang xử lý", value: projects.filter((project) => project.status === "processing").length, icon: "bolt", tone: "purple" },
    { label: "Cần chú ý", value: needsAttention, icon: "alert", tone: "orange" },
  ];

  return <>
    <section className="page-heading overview-heading">
      <div><h1>Tổng quan</h1><p className="heading-subtitle">Theo dõi nhanh tiến độ và tiếp tục dự án gần đây.</p></div>
      <Link className="primary-button" href="/projects/new"><Icon name="plus" size={16} />Tạo dự án</Link>
    </section>

    {error && <div className="workspace-error"><span>!</span>Không tải được dữ liệu dự án: {error}<button onClick={() => window.location.reload()}>Tải lại</button></div>}

    <section className="overview-stats" aria-label="Tình hình dự án">
      {metrics.map((metric) => <article className="overview-stat panel-card" key={metric.label}>
        <span className={`overview-stat-icon ${metric.tone}`}><Icon name={metric.icon} size={20} /></span>
        <span className="overview-stat-copy"><span>{metric.label}</span><strong>{ready ? metric.value : "—"}</strong></span>
      </article>)}
    </section>

    <section className="overview-projects panel-card">
      <div className="overview-section-heading"><div><h2>Dự án gần đây</h2><p>Mở dự án để tiếp tục công việc.</p></div><Link href="/projects" className="overview-all-link">Tất cả dự án<Icon name="arrow" size={15} /></Link></div>
      {!ready ? <div className="overview-empty">Đang tải danh sách dự án…</div> : recentProjects.length ? <div className="overview-project-list">
        {recentProjects.map((project) => {
          const preset = STORY_PRESETS[project.presetId];
          const progress = projectProgress(project);
          const status = statusDetails(project.status);
          const presetIcon: IconName = project.presetId === "audio-story" ? "play" : project.presetId === "ai-drama" ? "scene" : "spark";
          return <Link href={`/projects/${project.slug}`} className="overview-project-row" key={project.slug}>
            <span className={`overview-project-icon ${preset.accent}`}><Icon name={presetIcon} size={18} /></span>
            <span className="overview-project-copy"><strong>{project.title}</strong><small>{preset.label} · {project.durationMinutes} phút</small></span>
            <span className="overview-project-progress"><span className="progress-bar"><span style={{ width: `${progress}%` }} /></span><small>{project.completedScenes}/{project.totalScenes} cảnh</small></span>
            <span className="overview-project-updated"><span className={`project-status ${status.className}`}>{status.label}</span><small>{updatedLabel(project.updatedAt)}</small></span>
          </Link>;
        })}
      </div> : <div className="overview-empty">
        <span className="overview-empty-icon"><Icon name="folder" size={22} /></span>
        <strong>Chưa có dự án nào</strong>
        <p>Tạo dự án đầu tiên để bắt đầu sản xuất video.</p>
        <Link className="secondary-button compact" href="/projects/new"><Icon name="plus" size={14} />Tạo dự án</Link>
      </div>}
    </section>
  </>;
}
