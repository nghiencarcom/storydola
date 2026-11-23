"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { STORY_PRESETS } from "../lib/story-presets";
import type { StoryPresetId } from "../lib/story-presets";
import type { StoryProject } from "../lib/project-types";
import { useProjects } from "../lib/project-store";
import { Icon } from "./ui-icon";

function progress(project: { completedScenes: number; totalScenes: number }) {
  return Math.min(100, Math.round((project.completedScenes / Math.max(1, project.totalScenes)) * 100));
}

function updatedLabel(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "vừa cập nhật";
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} giờ trước`;
  return `${Math.round(seconds / 86400)} ngày trước`;
}

export function ProjectsView({ presetFilter }: { presetFilter?: StoryPresetId | "story" } = {}) {
  const { projects, ready, deleteProjects } = useProjects();
  const [query, setQuery] = useState("");
  const [deleteTargets, setDeleteTargets] = useState<StoryProject[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const workspaceProjects = useMemo(() => presetFilter === "story"
    ? projects.filter((project) => project.presetId === "ai-story" || project.presetId === "audio-story")
    : presetFilter ? projects.filter((project) => project.presetId === presetFilter) : projects, [projects, presetFilter]);
  const filtered = useMemo(() => workspaceProjects.filter((project) => `${project.title} ${project.slug}`.toLowerCase().includes(query.toLowerCase())), [workspaceProjects, query]);
  const isDramaWorkspace = presetFilter === "ai-drama";
  const isStoryWorkspace = presetFilter === "story";
  const createHref = isDramaWorkspace ? "/projects/new/ai-drama" : "/projects/new";

  const selectedProjects = filtered.filter(project => selected.has(project.slug));
  const allSelected = filtered.length > 0 && selectedProjects.length === filtered.length;
  function toggleProject(slug: string) {
    setSelected(current => { const next = new Set(current); if (next.has(slug)) next.delete(slug); else next.add(slug); return next; });
  }
  function requestDelete(targets: StoryProject[]) {
    setDeleteError(""); setDeleteMessage(""); setDeleteTargets(targets);
  }
  async function confirmDeleteProject() {
    if (!deleteTargets.length || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const result = await deleteProjects(deleteTargets.map(project => project.slug));
      setSelected(current => new Set([...current].filter(slug => !result.deleted.includes(slug))));
      setDeleteMessage(`Đã xóa ${result.deleted.length} dự án${result.failed.length ? `; ${result.failed.length} dự án chưa xóa được.` : "."}`);
      setDeleteTargets(current => current.filter(project => result.failed.some(failure => failure.slug === project.slug)));
      if (result.failed.length) setDeleteError(result.failed.map(failure => {
        const title = deleteTargets.find(project => project.slug === failure.slug)?.title || failure.slug;
        return `${title}: ${failure.message}`;
      }).join("\n"));
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Không thể xóa project.");
    } finally {
      setDeleting(false);
    }
  }

  return <>
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />WORKSPACE / {isDramaWorkspace ? "PHIM AI" : isStoryWorkspace ? "STORY" : "PROJECTS"}</div><h1>{isDramaWorkspace ? "Phim AI" : isStoryWorkspace ? "Story" : "Dự án của tôi"}</h1><p className="heading-subtitle">{isDramaWorkspace ? "Tạo và tiếp tục các dự án phim với giọng đọc theo nhân vật." : isStoryWorkspace ? "AI Story và Audio Story trong cùng workspace Story." : "Tạo, cấu hình và tiếp tục pipeline kịch bản của bạn."}</p></div><div className="heading-actions"><Link className="primary-button" href={createHref}><Icon name="plus" size={16} />{isDramaWorkspace ? "Tạo project Phim AI" : isStoryWorkspace ? "Tạo Story / Audio Story" : "Tạo dự án mới"}</Link></div></section>
    <nav className="project-mode-tabs project-list-tabs" role="tablist" aria-label="Loại dự án">
      <Link href="/projects" role="tab" aria-selected={!isDramaWorkspace && !isStoryWorkspace} aria-current={!isDramaWorkspace && !isStoryWorkspace ? "page" : undefined} className={!isDramaWorkspace && !isStoryWorkspace ? "active" : ""}>Tất cả dự án</Link>
      <Link href="/ai-drama" role="tab" aria-selected={isDramaWorkspace} aria-current={isDramaWorkspace ? "page" : undefined} className={isDramaWorkspace ? "active" : ""}>Phim AI</Link>
      <Link href="/story" role="tab" aria-selected={isStoryWorkspace} aria-current={isStoryWorkspace ? "page" : undefined} className={isStoryWorkspace ? "active" : ""}>Story</Link>
    </nav>
    <section className="projects-toolbar panel-card"><div className="projects-count"><strong>{ready ? workspaceProjects.length : "—"}</strong><span>{isDramaWorkspace ? "project Phim AI" : isStoryWorkspace ? "project Story" : "dự án trong workspace"}</span></div><div className="project-search"><Icon name="search" size={16} /><input value={query} disabled={deleting} onChange={(event) => { setQuery(event.target.value); setSelected(new Set()); }} placeholder="Tìm theo tên hoặc slug…" aria-label="Tìm dự án" /></div><Link className="secondary-button compact" href={createHref}><Icon name="plus" size={14} />Mới</Link></section>
    {workspaceProjects.length > 0 && <section className="project-bulk-toolbar" aria-label="Chọn và xóa nhiều dự án">
      <label><input type="checkbox" checked={allSelected} disabled={deleting || !filtered.length} ref={input => { if (input) input.indeterminate = selectedProjects.length > 0 && !allSelected; }} onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map(project => project.slug)))} />Chọn tất cả đang hiển thị ({filtered.length})</label>
      <span aria-live="polite">Đã chọn {selectedProjects.length}</span>
      <button type="button" className="secondary-button compact" disabled={deleting || !selectedProjects.length} onClick={() => setSelected(new Set())}>Bỏ chọn</button>
      <button type="button" className="project-delete-confirm" disabled={deleting || !selectedProjects.length} onClick={() => requestDelete(selectedProjects)}><Icon name="trash" size={15} />Xóa đã chọn ({selectedProjects.length})</button>
    </section>}
    {deleteMessage && !deleteTargets.length && <p role="status" className="project-bulk-status">{deleteMessage}</p>}
    <section className="project-grid">{filtered.map((project) => { const preset = STORY_PRESETS[project.presetId]; const pct = progress(project); return <article key={project.slug} className={`project-card panel-card${selected.has(project.slug) ? " project-card-selected" : ""}`}><label className="project-select-checkbox"><input type="checkbox" checked={selected.has(project.slug)} disabled={deleting} onChange={() => toggleProject(project.slug)} aria-label={`Chọn dự án ${project.title}`} /></label><Link href={`/projects/${project.slug}`} className="project-card-link"><div className="project-card-top"><span className={`project-type ${preset.accent}`}>{preset.shortLabel}</span></div><h2>{project.title}</h2><p className="project-slug">/{project.slug}</p><div className="project-card-meta"><span><Icon name="clock" size={14} />{project.durationMinutes} phút</span><span><Icon name="scene" size={14} />{project.totalScenes} cảnh</span></div><div className="project-card-progress"><div className="progress-bar"><span style={{ width: `${pct}%` }} /></div><div><strong>{pct}%</strong><span>{project.completedScenes}/{project.totalScenes} cảnh</span></div></div><div className="project-card-footer"><span className={`project-status ${project.status}`}>{project.status === "draft" ? "Bản nháp" : project.status === "needs_review" ? "Cần review" : project.status === "ready" ? "Sẵn sàng" : project.status === "failed" ? "Lỗi cần xử lý" : "Đang xử lý"}</span><span>{updatedLabel(project.updatedAt)}</span></div></Link><button className="project-delete-button" type="button" title="Xóa dự án" aria-label={`Xóa dự án ${project.title}`} onClick={() => requestDelete([project])} disabled={deleting}><Icon name="trash" size={16} /></button></article>})}{filtered.length === 0 && <div className="empty-page wide"><div className="empty-icon"><Icon name={workspaceProjects.length ? "search" : "folder"} size={22} /></div><h2>{workspaceProjects.length ? "Không tìm thấy dự án" : isDramaWorkspace ? "Chưa có project Phim AI" : isStoryWorkspace ? "Chưa có project Story" : "Chưa có dự án"}</h2><p>{workspaceProjects.length ? "Thử từ khóa khác hoặc tạo một project mới." : isDramaWorkspace ? "Tạo project Phim AI để bắt đầu." : isStoryWorkspace ? "Tạo một project AI Story hoặc Audio Story để bắt đầu." : "Tạo project đầu tiên để bắt đầu pipeline thật."}</p><Link className="primary-button" href={createHref}><Icon name="plus" size={15} />{isDramaWorkspace ? "Tạo project Phim AI" : isStoryWorkspace ? "Tạo project Story" : "Tạo dự án"}</Link></div>}</section>
    {deleteTargets.length > 0 && <div className="project-delete-backdrop">
      <section className="project-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="project-delete-title" aria-describedby="project-delete-description" onKeyDown={event => { if (event.key === "Escape" && !deleting) setDeleteTargets([]); }}>
        <span className="project-delete-icon"><Icon name="trash" size={20} /></span>
        <div className="section-kicker">XÓA DỰ ÁN</div>
        <h2 id="project-delete-title">{deleteTargets.length === 1 ? `Xóa “${deleteTargets[0].title}”?` : `Xóa ${deleteTargets.length} dự án đã chọn?`}</h2>
        <p id="project-delete-description">Dự án cùng kịch bản, ảnh, âm thanh và video đã tạo sẽ bị xóa vĩnh viễn.</p>
        <ul className="project-delete-list">{deleteTargets.map(project => <li key={project.slug}>{project.title}</li>)}</ul>
        {deleteMessage && <p role="status">{deleteMessage}</p>}
        {deleteError && <p className="project-delete-error" role="alert">{deleteError}</p>}
        <div className="project-delete-actions">
          <button className="secondary-button" type="button" onClick={() => { if (!deleting) setDeleteTargets([]); }} disabled={deleting} autoFocus>Hủy</button>
          <button className="project-delete-confirm" type="button" onClick={confirmDeleteProject} disabled={deleting}><Icon name="trash" size={15} />{deleting ? "Đang xóa…" : "Xóa vĩnh viễn"}</button>
        </div>
      </section>
    </div>}
    <section className="projects-info panel-card"><div className="info-icon"><Icon name="spark" size={17} /></div><div><strong>Project slug là nơi lưu toàn bộ dữ liệu</strong><p>Mỗi dự án có URL riêng để mở lại, chỉnh preset, nhập JSON riêng cho từng tập và theo dõi tiến độ.</p></div><span className="info-example">/projects/ten-du-an</span></section>
  </>;
}
