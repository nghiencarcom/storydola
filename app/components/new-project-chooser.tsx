import Link from "next/link";
import { STORY_PRESETS } from "../lib/story-presets";
import { Icon } from "./ui-icon";

export function NewProjectChooser() {
  return <>
    <section className="page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-dot" />PROJECT SETUP</div>
        <h1>Tạo dự án mới</h1>
        <p className="heading-subtitle">Chọn một quy trình riêng. Loại dự án được cố định khi tạo để giữ đúng cấu trúc kịch bản và media.</p>
      </div>
    </section>
    <section className="create-project-choice-grid" aria-label="Chọn loại dự án">
      {Object.values(STORY_PRESETS).map((preset, index) => {
        const icon = preset.id === "audio-story" ? "play" : preset.id === "ai-drama" ? "scene" : "spark";
        return <Link key={preset.id} className={`create-project-choice panel-card ${preset.accent}`} href={`/projects/new/${preset.id}`}>
          <span className="create-project-choice-index">0{index + 1} / PROJECT TYPE</span>
          <span className={`preset-glyph large ${preset.accent}`}><Icon name={icon} size={22} /></span>
          <h2>{preset.label}</h2>
          <p>{preset.description}</p>
          <span className="create-project-choice-footer">Tạo {preset.label}<Icon name="arrow" size={15} /></span>
        </Link>;
      })}
    </section>
  </>;
}
