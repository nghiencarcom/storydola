"use client";

import Link from "next/link";
import { useProjects } from "../lib/project-store";
import { STORY_PRESETS } from "../lib/story-presets";
import { Icon } from "./ui-icon";

export function TasksView() {
  const { projects, provider } = useProjects();
  const activeProjects = projects.filter((project) => project.status === "processing" || project.status === "draft");
  return <>
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />WORKSPACE / QUEUE</div><h1>Tác vụ đang chạy</h1><p className="heading-subtitle">Theo dõi những project đang chờ hoặc đang gọi LLM server-side.</p></div><span className="queue-live"><span className="live-dot" />Queue online</span></section>
    <section className="queue-summary"><div className="queue-stat panel-card"><span className="stat-label">Đang chạy</span><strong>{projects.filter((project) => project.status === "processing").length}</strong><small>project</small></div><div className="queue-stat panel-card"><span className="stat-label">Đang chờ</span><strong>{projects.filter((project) => project.status === "draft").length}</strong><small>project</small></div><div className="queue-stat panel-card"><span className="stat-label">Đã hoàn tất</span><strong>{projects.filter((project) => project.status === "ready").length}</strong><small>project</small></div><div className="queue-stat panel-card"><span className="stat-label">Provider routes</span><strong>{provider ? provider.fallbackModels.length + 1 : "—"}</strong><small>server models</small></div></section>
    <section className="task-list panel-card"><div className="card-heading"><div><div className="section-kicker">JOB QUEUE</div><h2>Project jobs</h2></div><span className="task-refresh"><Icon name="refresh" size={14} /> Tự cập nhật</span></div>{activeProjects.map((project) => { const preset = STORY_PRESETS[project.presetId]; const percentage = Math.round((project.completedScenes / Math.max(1, project.totalScenes)) * 100); return <div className="task-row" key={project.slug}><div className={`task-icon ${preset.accent}`}><Icon name="bolt" size={16} /></div><div className="task-main"><div className="task-title"><strong>{project.title}</strong><span className={`project-status ${project.status}`}>{project.status === "draft" ? "Chờ chạy" : "Đang chạy"}</span></div><p>{preset.label} · {project.completedScenes}/{project.totalScenes} cảnh · {project.scriptModel}</p><div className="progress-bar"><span style={{ width: `${percentage}%` }} /></div></div><span className="task-percent">{percentage}%</span><Link href={`/projects/${project.slug}`} className="row-more"><Icon name="arrow" size={16} /></Link></div>})}{activeProjects.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="check" size={20} /></div><strong>Không có tác vụ đang chạy</strong><span>Tạo project mới để bắt đầu.</span></div>}</section>
  </>;
}
