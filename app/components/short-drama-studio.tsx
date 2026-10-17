"use client";

import { useEffect, useState } from "react";
import type { ShortDramaScriptAnalysis, ShortDramaSuggestion, StoryProject } from "../lib/project-types";
import { useProjects } from "../lib/project-store";
import { Icon } from "./ui-icon";

const SCORE_LABELS: Array<[keyof ShortDramaScriptAnalysis["scores"], string]> = [
  ["hook", "Hook mở đầu"],
  ["protagonist", "Nhân vật chính"],
  ["conflict", "Xung đột"],
  ["escalation", "Leo thang"],
  ["turns", "Bước ngoặt"],
  ["payoff", "Payoff"],
  ["dialogue", "Lời thoại"],
  ["visual", "Khả năng dựng hình"],
];

const BEAT_LABELS: Record<ShortDramaScriptAnalysis["beats"][number]["key"], string> = {
  hook: "Hook",
  inciting_incident: "Biến cố mở màn",
  escalation: "Leo thang",
  turning_point: "Bước ngoặt",
  crisis: "Khủng hoảng",
  payoff: "Payoff / kết",
};

const CATEGORY_LABELS: Record<ShortDramaSuggestion["category"], string> = {
  hook: "Hook",
  stakes: "Stakes",
  character: "Nhân vật",
  conflict: "Xung đột",
  escalation: "Leo thang",
  turn: "Bước ngoặt",
  payoff: "Payoff",
  dialogue: "Lời thoại",
};

function scriptStudioError(value: unknown) {
  return value instanceof Error ? value.message : "Có lỗi khi xử lý kịch bản.";
}

export function ShortDramaStudio({ project, sourceDirty }: { project: StoryProject; sourceDirty: boolean }) {
  const { refresh } = useProjects();
  const studio = project.scriptStudio;
  const analysis = studio?.analysis;
  const [draftText, setDraftText] = useState(studio?.draftText || project.sourceText);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(Boolean(analysis));

  useEffect(() => {
    setDraftText(studio?.draftText || project.sourceText);
  }, [project.slug, project.sourceText, studio?.draftUpdatedAt]);

  async function postAction(action: string, extra: Record<string, unknown> = {}) {
    const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/script-studio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Không thể xử lý Script Studio.");
    return payload;
  }

  async function analyzeScript() {
    setAnalyzing(true);
    setError("");
    setNotice("");
    try {
      await postAction("analyze");
      await refresh();
      setNotice("Đã phân tích xong. Kịch bản gốc vẫn được giữ nguyên.");
      setExpanded(true);
    } catch (cause) {
      setError(scriptStudioError(cause));
    } finally {
      setAnalyzing(false);
    }
  }

  function applySuggestionToDraft(suggestion: ShortDramaSuggestion) {
    setError("");
    setNotice("");
    const first = draftText.indexOf(suggestion.anchor);
    if (first < 0) {
      setError("Không tìm thấy đoạn gốc trong bản nháp. Hãy khôi phục bản nháp từ kịch bản hiện hành rồi thử lại.");
      return;
    }
    if (draftText.indexOf(suggestion.anchor, first + suggestion.anchor.length) >= 0) {
      setError("Đoạn gốc xuất hiện nhiều lần trong bản nháp nên không thể thay an toàn. Bạn có thể tự chỉnh trực tiếp ở ô bản nháp.");
      return;
    }
    setDraftText(`${draftText.slice(0, first)}${suggestion.replacement}${draftText.slice(first + suggestion.anchor.length)}`);
    setNotice(`Đã áp dụng gợi ý “${suggestion.title}” vào bản nháp; kịch bản gốc chưa thay đổi.`);
  }

  async function saveDraft() {
    if (!analysis) return;
    setSavingDraft(true);
    setError("");
    setNotice("");
    try {
      await postAction("save-draft", { draftText, baseHash: analysis.sourceHash });
      await refresh();
      setNotice("Đã lưu bản nháp riêng. Bản kịch bản đang dùng chưa thay đổi.");
    } catch (cause) {
      setError(scriptStudioError(cause));
    } finally {
      setSavingDraft(false);
    }
  }

  async function applyDraft() {
    if (!studio?.draftText) {
      setError("Hãy lưu bản nháp trước khi áp dụng.");
      return;
    }
    const confirmed = window.confirm("Áp dụng bản nháp làm kịch bản hiện hành? StoryAI sẽ lưu bản hiện tại vào lịch sử và làm mới tiến độ chunk, review, queue video và render để tạo lại theo kịch bản mới. Các file cũ không bị xóa.");
    if (!confirmed) return;
    setApplying(true);
    setError("");
    setNotice("");
    try {
      await postAction("apply-draft");
      await refresh();
      setNotice("Đã áp dụng phiên bản mới. Bản trước được giữ trong lịch sử kịch bản.");
    } catch (cause) {
      setError(scriptStudioError(cause));
    } finally {
      setApplying(false);
    }
  }

  async function restoreVersion(versionId: string, label: string) {
    const confirmed = window.confirm(`Khôi phục “${label}” làm kịch bản hiện hành? Phiên bản đang dùng được giữ trong lịch sử; tiến độ cảnh/queue/render sẽ được làm mới.`);
    if (!confirmed) return;
    setRestoringVersionId(versionId);
    setError("");
    setNotice("");
    try {
      await postAction("restore-version", { versionId });
      await refresh();
      setNotice(`Đã khôi phục ${label}.`);
    } catch (cause) {
      setError(scriptStudioError(cause));
    } finally {
      setRestoringVersionId("");
    }
  }

  if ((project.scriptMode || "ai") !== "manual") return null;
  const validAnalysis = analysis?.sourceHash === studio?.analysis?.sourceHash ? analysis : undefined;
  const scoreEntries = validAnalysis ? SCORE_LABELS : [];
  const hasSavedDraft = Boolean(studio?.draftText === draftText && studio.draftBaseHash === analysis?.sourceHash);

  return (
    <section className="short-drama-studio panel-card" aria-labelledby="short-drama-studio-title">
      <div className="short-drama-heading">
        <div>
          <div className="section-kicker">SHORT DRAMA STUDIO · ANALYZE ONLY</div>
          <h2 id="short-drama-studio-title">Làm kịch bản cuốn hút hơn</h2>
        </div>
        <button className="secondary-button compact" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Thu gọn" : "Mở studio"}</button>
      </div>
      {expanded && <>
        <div className="short-drama-privacy"><Icon name="alert" size={15} /><span>Kịch bản đã lưu sẽ được gửi tới Script LLM để phân tích.</span></div>
        <div className="short-drama-toolbar">
          <span>{project.sourceText.trim() ? `${project.sourceText.length.toLocaleString("vi-VN")} ký tự · ${project.durationMinutes} phút mục tiêu` : "Chưa có kịch bản"}</span>
          <button className="primary-button" type="button" onClick={() => void analyzeScript()} disabled={analyzing || sourceDirty || !project.sourceText.trim()}>
            <Icon name="spark" size={15} />{analyzing ? "Đang phân tích…" : validAnalysis ? "Phân tích lại" : "Phân tích kịch bản"}
          </button>
        </div>
        {sourceDirty && <p className="short-drama-hint">Lưu kịch bản trước khi phân tích.</p>}
        {error && <p className="short-drama-message error" role="alert">{error}</p>}
        {notice && <p className="short-drama-message success" role="status">{notice}</p>}
        {validAnalysis && <>
          <div className="short-drama-score-row">
            <div className="short-drama-overall"><span>ĐỘ CUỐN HÚT</span><strong>{validAnalysis.overallScore}<small>/100</small></strong><p>{validAnalysis.summary}</p></div>
            <div className="short-drama-scores">{scoreEntries.map(([key, label]) => <div key={key}><span>{label}</span><strong>{validAnalysis.scores[key]}</strong><i><b style={{ width: `${validAnalysis.scores[key]}%` }} /></i></div>)}</div>
          </div>
          <div className="short-drama-logline"><strong>Logline</strong><span>{validAnalysis.logline}</span></div>
          <div className="short-drama-beats"><strong>Nhịp câu chuyện</strong><div>{validAnalysis.beats.map((beat) => <span className={`short-drama-beat ${beat.status}`} key={beat.key}><i />{BEAT_LABELS[beat.key]}<small>{beat.status === "present" ? "Có" : beat.status === "weak" ? "Yếu" : "Thiếu"}</small><em>{beat.note}</em></span>)}</div></div>
          <div className="short-drama-insights">
            {validAnalysis.strengths.length > 0 && <div className="short-drama-insight strengths"><strong>Điểm đang hiệu quả</strong><ul>{validAnalysis.strengths.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
            {validAnalysis.mainRisks.length > 0 && <div className="short-drama-insight risks"><strong>Rủi ro giữ chân</strong><ul>{validAnalysis.mainRisks.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
          </div>
          {validAnalysis.suggestions.length > 0 && <div className="short-drama-suggestions">
            <div className="short-drama-subheading"><div><strong>Gợi ý chỉnh sửa</strong></div><span>{validAnalysis.suggestions.length}</span></div>
            {validAnalysis.suggestions.map((suggestion) => {
              const alreadyApplied = !draftText.includes(suggestion.anchor) && draftText.includes(suggestion.replacement);
              return <article className="short-drama-suggestion" key={suggestion.id}>
                <div className="short-drama-suggestion-head"><span>{CATEGORY_LABELS[suggestion.category]}</span><strong>{suggestion.title}</strong></div>
                <p>{suggestion.reason}</p>
                <div className="short-drama-patch"><div><small>ĐOẠN GỐC</small><blockquote>{suggestion.anchor}</blockquote></div><div><small>PHƯƠNG ÁN</small><blockquote>{suggestion.replacement}</blockquote></div></div>
                {suggestion.expectedImpact && <small className="short-drama-impact">Tác động dự kiến: {suggestion.expectedImpact}</small>}
                <button className="text-button" type="button" onClick={() => applySuggestionToDraft(suggestion)} disabled={alreadyApplied}>{alreadyApplied ? "Đã đưa vào bản nháp" : "Dùng gợi ý trong bản nháp →"}</button>
              </article>;
            })}
          </div>}
          <div className="short-drama-draft">
            <div className="short-drama-subheading"><div><strong>Bản nháp</strong></div><span className={hasSavedDraft ? "short-drama-saved" : "short-drama-unsaved"}>{hasSavedDraft ? "Đã lưu" : "Chưa lưu"}</span></div>
            <textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} aria-label="Bản nháp kịch bản short drama" />
            <div className="short-drama-draft-actions">
              <button className="secondary-button compact" type="button" onClick={() => setDraftText(project.sourceText)} disabled={savingDraft || applying}>Khôi phục nội dung gốc vào nháp</button>
              <button className="secondary-button compact" type="button" onClick={() => void saveDraft()} disabled={savingDraft || applying || !draftText.trim()}>{savingDraft ? "Đang lưu…" : "Lưu bản nháp"}</button>
              <button className="primary-button" type="button" onClick={() => void applyDraft()} disabled={applying || savingDraft || !hasSavedDraft || draftText === project.sourceText}>{applying ? "Đang áp dụng…" : "Áp dụng làm kịch bản hiện hành"}</button>
            </div>
            <small className="short-drama-reset-note">Áp dụng sẽ làm mới review, queue và render.</small>
          </div>
        </>}
        {(studio?.versions?.length || 0) > 0 && <details className="short-drama-history">
          <summary>Lịch sử kịch bản · {studio?.versions?.length || 0} phiên bản đã lưu</summary>
          <div>{[...(studio?.versions || [])].reverse().map((version) => <article key={version.id}><span><strong>{version.label}</strong><small>{new Date(version.createdAt).toLocaleString("vi-VN")} · {version.sourceText.length.toLocaleString("vi-VN")} ký tự</small></span><button className="secondary-button compact" type="button" onClick={() => void restoreVersion(version.id, version.label)} disabled={Boolean(restoringVersionId) || applying}>{restoringVersionId === version.id ? "Đang khôi phục…" : "Khôi phục"}</button></article>)}</div>
        </details>}
      </>}
    </section>
  );
}
