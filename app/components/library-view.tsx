"use client";

import Link from "next/link";
import { STORY_PRESETS } from "../lib/story-presets";
import { Icon } from "./ui-icon";

export function LibraryView() {
  return <>
    <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />LIBRARY / PRESETS</div><h1>Kho cảnh & preset</h1><p className="heading-subtitle">Các bộ Instructions/Knowledge đã nạp cho pipeline viết kịch bản.</p></div><Link className="secondary-button" href="/projects/new"><Icon name="plus" size={15} />Dùng cho dự án mới</Link></section>
    <section className="library-hero panel-card"><div className="library-hero-icon"><Icon name="spark" size={25} /></div><div><div className="section-kicker">RUNTIME KNOWLEDGE</div><h2>Chọn preset theo mục tiêu video</h2><p>Preset được gửi cùng mỗi request chunk, giúp giữ format scene-script.v1 và chất lượng nhất quán trong video dài.</p></div></section>
    <section className="preset-library-grid">{Object.values(STORY_PRESETS).map((preset) => <article key={preset.id} className="library-card panel-card"><div className="library-card-head"><span className={`preset-glyph large ${preset.accent}`}><Icon name={preset.id === "audio-story" ? "play" : preset.id === "ai-drama" ? "scene" : "spark"} size={19} /></span><span className={`preset-runtime ${preset.accent}`}>loaded</span></div><h2>{preset.label}</h2><p>{preset.description}</p><div className="knowledge-tags"><span>Instructions</span><span>Knowledge</span><span>15s scenes</span><span>JSON v1</span></div><div className="library-card-footer"><span>{preset.id === "ai-story" ? "Narrator-led" : preset.id === "audio-story" ? "Voice-first" : "Character-led"}</span><Link href={`/projects/new/${preset.id}`}>Mở luồng tạo <Icon name="arrow" size={13} /></Link></div></article>)}</section>
    <section className="knowledge-files panel-card"><div className="section-kicker">KNOWLEDGE FILES</div><h2>Runtime reference</h2><div className="knowledge-file-list"><div><Icon name="file" size={17} /><span><strong>storyai-presets.md</strong><small>3 preset runtime · scene rules</small></span><em>Loaded</em></div><div><Icon name="file" size={17} /><span><strong>scene-script.v1</strong><small>JSON schema · continuity · timing</small></span><em>Loaded</em></div><div><Icon name="file" size={17} /><span><strong>provider-setup.md</strong><small>OpenAI-compatible server config</small></span><em>Reference</em></div></div></section>
  </>;
}
