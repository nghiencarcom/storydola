"use client";

import { useEffect, useId, useMemo, useRef, useState, useCallback, type FormEvent } from "react";
import {
  salesVideoDurationOptions, salesVideoProductSegments, salesVideoLanguages, salesVideoWordCount, salesVideoMaxWordCount,
  salesVideoSplitDialogue, salesVideoDialogueToSrt,
  salesVideoMaiVideoModels, salesVideoModelOptions, salesVideoModels, salesVideoProductExamples, salesVideoTextExamples, salesVideoSupportsDialogue,
  salesVideoCreativeTemplates, salesVideoFileTypes, salesVideoFileLimits, salesVideoNameLimit, salesVideoRatios, salesVideoTemplates,
  salesVideoContentStyles, salesVideoContentFramework, salesVideoClaimCategories, salesVideoImageTypes, salesVideoMaxProductImages, salesVideoScriptPlaceholder,
  salesVideoHookStyles, salesVideoTargetAudiences, salesVideoPainExamples, salesVideoHeroExamples, salesVideoFlawExamples,
} from "../lib/sales-video-templates";
import { clearSalesVideoDraft, loadSalesVideoDraft, saveSalesVideoDraftFields, saveSalesVideoDraftFile } from "../lib/sales-video-drafts";

import type { VideoGenerationModelOption } from "../lib/project-types";
import { isVideoOffPeakRequired } from "../lib/media-generation-settings";
import type { SalesVideoProject } from "../lib/sales-video-storage";
import { SalesVideoTemplateArtwork } from "./sales-video-template-artwork";
import { Icon } from "./ui-icon";

type Access = { maiVideo: boolean; pixverse: boolean; voice: boolean; draftKey: string; codingAgent: { id: string; label: string; model: string; saved: boolean } | null };
type SalesVideoLibraryImage = { id: string; name: string; fileName: string; previewUrl: string; source: string };
const labels = { processing: "Đang xử lý", draft: "Chờ bạn duyệt", ready: "Hoàn tất", failed: "Thất bại" };
function projectStatusLabel(project: SalesVideoProject) {
  if (project.status !== "processing") return labels[project.status];
  return project.phase === "writing" ? "Code Agent đang soạn" : "Model đang tạo video";
}
const salesVideoProductFields = [
  { name: "presenter", label: "Ảnh nhân vật", kind: "image" },
] as const;
const salesVideoProductImageFieldNames = Array.from({ length: salesVideoMaxProductImages }, (_, index) => `product-image-${index + 1}`);

function ProductImagesInput({ mainFile, additionalFiles, maxCount, onMainFileChange, onAdditionalFilesChange, disabled }: {
  mainFile?: File;
  additionalFiles: File[];
  maxCount: number;
  onMainFileChange: (file?: File) => void;
  onAdditionalFilesChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const mainInputRef = useRef<HTMLInputElement>(null);
  const additionalInputRef = useRef<HTMLInputElement>(null);
  const [mainPreview, setMainPreview] = useState("");
  const [additionalPreviews, setAdditionalPreviews] = useState<string[]>([]);
  useEffect(() => {
    if (!mainFile) {
      setMainPreview("");
      return;
    }
    const url = URL.createObjectURL(mainFile);
    setMainPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [mainFile]);
  useEffect(() => {
    const urls = additionalFiles.map((file) => URL.createObjectURL(file));
    setAdditionalPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [additionalFiles]);

  return <div className="form-field full sales-product-images-input">
    <div className="sales-product-reference-layout">
      <div className="sales-product-reference-title sales-product-primary-title"><strong>Ảnh chính <em>Bắt buộc</em></strong></div>
      <section className="sales-product-primary-reference" aria-label="Ảnh sản phẩm chính">
        <input ref={mainInputRef} type="file" accept={salesVideoFileTypes.image} hidden aria-label="Chọn ảnh sản phẩm chính"
        onChange={(event) => {
          onMainFileChange(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }} />
        <div className="sales-product-primary-control">
          <div className={`sales-product-primary-preview${mainPreview ? " has-image" : ""}`}>
            {mainPreview ? <img src={mainPreview} alt="Ảnh sản phẩm chính" /> : <span>Chưa có ảnh</span>}
          </div>
          <div className="sales-product-primary-actions">
            <button type="button" className="secondary-button compact" onClick={() => mainInputRef.current?.click()} disabled={disabled || maxCount < 1}>
              {mainFile ? "Thay ảnh chính" : "Tải ảnh chính"}
            </button>
            {mainFile && <button type="button" className="secondary-button compact" onClick={() => onMainFileChange(undefined)} disabled={disabled}>Xóa ảnh</button>}
          </div>
        </div>
      </section>
      <div className="sales-product-reference-title sales-product-secondary-title">
        <strong>Ảnh phụ <em>Tùy chọn</em></strong><span>{additionalFiles.length}/{Math.max(0, maxCount - 1)}</span>
      </div>
      <section className="sales-product-secondary-references" aria-label="Ảnh tham khảo sản phẩm bổ sung">
        {additionalFiles.length > 0 && <div className="sales-product-image-grid">
          {additionalFiles.map((file, index) => <figure key={`${file.name}-${index}`}>
            {additionalPreviews[index] && <img src={additionalPreviews[index]} alt={`Ảnh tham khảo phụ ${index + 1}`} />}
            <figcaption><strong>Ảnh phụ {index + 1}</strong><span title={file.name}>{file.name}</span></figcaption>
            <button type="button" className="secondary-button compact" onClick={() => onAdditionalFilesChange(additionalFiles.filter((_, item) => item !== index))} disabled={disabled} aria-label={`Xóa ảnh tham khảo phụ ${index + 1}`}>Xóa</button>
          </figure>)}
        </div>}
        <div className="sales-pose-image-actions">
          <input ref={additionalInputRef} type="file" accept={salesVideoFileTypes.image} multiple hidden aria-label="Chọn ảnh tham khảo phụ cho sản phẩm"
            onChange={(event) => {
              onAdditionalFilesChange(Array.from(event.currentTarget.files || []));
              event.currentTarget.value = "";
            }} />
          <button type="button" className="secondary-button compact" onClick={() => additionalInputRef.current?.click()} disabled={disabled || maxCount < 2}>
            {additionalFiles.length ? "Chọn lại ảnh phụ" : "Thêm ảnh phụ"}
          </button>
          {additionalFiles.length > 0 && <button type="button" className="secondary-button compact" onClick={() => onAdditionalFilesChange([])} disabled={disabled}>Xóa tất cả</button>}
        </div>
      </section>
    </div>
    {maxCount < 1 ? <small className="sales-product-image-help">Model hiện tại không nhận ảnh tham chiếu.</small>
      : <small className="sales-product-image-help">JPG, PNG, WebP hoặc AVIF · tối đa {salesVideoFileLimits.image / 1024 ** 2} MB/ảnh · tổng 100 MB.</small>}
  </div>;
}

function MediaInput({ name, label, kind, example, file, onFileChange }: {
  name: string;
  label: string;
  kind: keyof typeof salesVideoFileTypes;
  example: string;
  file?: File;
  onFileChange: (name: string, file?: File) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (!file) {
      input.value = "";
      return;
    }
    if (input.files?.[0] === file) return;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    } catch { /* The draft still retains the file if this browser blocks restoring file inputs. */ }
  }, [file]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return <div className={`form-field${kind === "image" ? " sales-image-input" : ""}`}>
    <label htmlFor={id}>{label}<em>Bắt buộc</em></label>
    {kind === "image" ? <>
      <input ref={inputRef} id={id} name={name} type="file" accept={salesVideoFileTypes[kind]} aria-required="true" hidden
        onChange={(event) => onFileChange(name, event.currentTarget.files?.[0])} />
      <div className={`sales-image-input-row${preview ? " has-image" : ""}`}>
        {preview ? <img className="sales-image-input-preview" src={preview} alt={label} /> : <span className="sales-image-input-empty" aria-hidden="true">Ảnh</span>}
        <div className="sales-image-input-copy">
          <strong title={file?.name}>{file?.name || "Chưa chọn ảnh"}</strong>
          <small>{file ? "Ảnh đã sẵn sàng" : `JPG, PNG, WebP hoặc AVIF · tối đa ${salesVideoFileLimits[kind] / 1024 ** 2} MB`}</small>
        </div>
        <div className="sales-image-input-actions">
          <button type="button" className="secondary-button compact" onClick={() => inputRef.current?.click()}>{file ? "Thay ảnh" : "Chọn ảnh"}</button>
          {file && <button type="button" className="secondary-button compact" onClick={() => onFileChange(name)}>Xóa</button>}
        </div>
      </div>
    </> : <>
      <input ref={inputRef} id={id} name={name} type="file" accept={salesVideoFileTypes[kind]} aria-required="true"
        onChange={(event) => onFileChange(name, event.currentTarget.files?.[0])} />
      <small>Ví dụ {example} · tối đa {salesVideoFileLimits[kind] / 1024 ** 2} MB.</small>
      {file && <button type="button" className="secondary-button compact" onClick={() => onFileChange(name)}>Xoá tệp đã chọn</button>}
    </>}
    {preview && kind === "audio" && <audio src={preview} controls preload="metadata" style={{ width: "100%" }} />}
    {preview && kind === "video" && <video src={preview} controls playsInline preload="metadata" style={{ width: "100%", maxHeight: 180 }} />}
  </div>;
}

function mediaExample(name: string, kind: keyof typeof salesVideoFileTypes, numbered: boolean) {
  if (kind === "video") return "clip MP4 quay người mẫu cầm sản phẩm; chọn đoạn dài 10–15 giây, ít cắt cảnh.";
  if (kind === "audio") return "bản ghi MP3 hoặc WAV của một người nói, ít tiếng ồn.";
  if (name === "background") return "ảnh studio trống hoặc ảnh góc cửa hàng muốn dùng làm nền.";
  if (numbered) return "một góc khác của cùng người mẫu và sản phẩm; ảnh được ghép từng cặp theo thứ tự tải lên.";
  return "ảnh người mẫu nhìn về máy quay, rõ mặt và đủ sáng.";
}

function PoseImageSlot({ index, file }: { index: number; file?: File }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return <article className={`sales-pose-image-slot${file ? " is-filled" : ""}`}>
    <strong>Ảnh {index + 1}</strong>
    {preview ? <img src={preview} alt={`Ảnh tạo dáng ${index + 1}`} /> : <span className="sales-pose-image-empty">Chưa có ảnh</span>}
    <small title={file?.name}>{file?.name || "Chọn ảnh theo thứ tự"}</small>
  </article>;
}

function PoseImagesInput({ fields, files, onFilesChange, onOpenLibrary, disabled }: {
  fields: { name: string; label: string }[];
  files: Record<string, File>;
  onFilesChange: (files: File[]) => void;
  onOpenLibrary: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedCount = fields.filter((field) => Boolean(files[field.name]?.size)).length;
  return <div className="form-field full sales-pose-image-input">
    <span>Ảnh tạo dáng <em>Bắt buộc · đủ {fields.length} ảnh</em></span>
    <div className="sales-pose-image-actions">
      <input ref={inputRef} type="file" accept={salesVideoFileTypes.image} multiple hidden aria-label="Chọn nhiều ảnh tạo dáng"
        onChange={(event) => {
          onFilesChange(Array.from(event.currentTarget.files || []));
          event.currentTarget.value = "";
        }} />
      <button type="button" className="primary-button" onClick={() => inputRef.current?.click()} disabled={disabled}>
        {selectedCount ? "Chọn lại ảnh từ máy" : "Chọn nhiều ảnh từ máy"}
      </button>
      <button type="button" className="secondary-button" onClick={onOpenLibrary} disabled={disabled}>Chọn từ Media Library</button>
      {selectedCount > 0 && <button type="button" className="secondary-button compact" onClick={() => onFilesChange([])} disabled={disabled}>Xóa bộ ảnh</button>}
    </div>
    <div className="sales-pose-image-slots">
      {fields.map((field, index) => <PoseImageSlot key={field.name} index={index} file={files[field.name]} />)}
    </div>
    <small>Chọn đủ {fields.length} ảnh theo đúng thứ tự.</small>
  </div>;
}

function SalesVideoTemplateGallery({ onSelect }: { onSelect: (id: string) => void }) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("storyai_sales_gallery_view");
      if (saved === "grid") setViewMode("grid");
      else if (saved === "list" || saved === "dropdown") setViewMode("list");
    } catch {}
  }, []);

  const handleSetViewMode = (mode: "grid" | "list") => {
    setViewMode(mode);
    try {
      localStorage.setItem("storyai_sales_gallery_view", mode);
    } catch {}
  };

  return <section id="sales-template-gallery" className="sales-template-gallery" aria-label="Chọn mẫu video bán hàng">
    <div className="sales-template-gallery-heading">
      <div>
        <span className="section-kicker">MẪU VIDEO</span>
        <h2>Chọn mẫu video</h2>
      </div>
      <div className="sales-template-gallery-actions">
        <div className="sales-view-mode-toggle" role="group" aria-label="Cách hiển thị mẫu">
          <button type="button" className={`sales-view-mode-btn ${viewMode === "grid" ? "active" : ""}`} onClick={() => handleSetViewMode("grid")} aria-pressed={viewMode === "grid"}>
            Thẻ
          </button>
          <button type="button" className={`sales-view-mode-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => handleSetViewMode("list")} aria-pressed={viewMode === "list"}>
            Danh sách
          </button>
        </div>
        <span className="sales-template-count">{salesVideoTemplates.length + salesVideoCreativeTemplates.length} mẫu</span>
      </div>
    </div>

    <section className="sales-template-group" aria-labelledby="sales-product-templates">
      <div className="sales-template-group-heading">
        <h3 id="sales-product-templates">Tạo video bán hàng</h3>
        <span className="sales-template-group-count">{salesVideoTemplates.length} mẫu</span>
      </div>

      {viewMode === "grid" ? (
        <div className="sales-template-grid">
          {salesVideoTemplates.map((template) => (
            <button type="button" className="sales-template-card" key={template.id} onClick={() => onSelect(template.id)}>
              <span className="sales-template-cover">
                <SalesVideoTemplateArtwork id={template.id} />
              </span>
              <span className="sales-template-card-copy">
                <strong>{template.name}</strong>
                <span className="sales-template-card-action" aria-hidden="true">→</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="sales-template-list">
          {salesVideoTemplates.map((template) => (
            <button type="button" className="sales-template-list-item" key={template.id} onClick={() => onSelect(template.id)}>
              <span className="sales-template-list-thumb"><SalesVideoTemplateArtwork id={template.id} /></span>
              <strong>{template.name}</strong>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      )}
    </section>

    <section className="sales-template-group" aria-labelledby="sales-creative-templates">
      <div className="sales-template-group-heading">
        <h3 id="sales-creative-templates">Công cụ video</h3>
        <span className="sales-template-group-count">{salesVideoCreativeTemplates.length} mẫu</span>
      </div>

      {viewMode === "grid" ? (
        <div className="sales-template-grid">
          {salesVideoCreativeTemplates.map((template) => (
            <button type="button" className="sales-template-card" key={template.id} onClick={() => onSelect(template.id)}>
              <span className="sales-template-cover">
                <SalesVideoTemplateArtwork id={template.id} />
              </span>
              <span className="sales-template-card-copy">
                <strong>{template.name}</strong>
                <span className="sales-template-card-action" aria-hidden="true">→</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="sales-template-list">
          {salesVideoCreativeTemplates.map((template) => (
            <button type="button" className="sales-template-list-item" key={template.id} onClick={() => onSelect(template.id)}>
              <span className="sales-template-list-thumb"><SalesVideoTemplateArtwork id={template.id} /></span>
              <strong>{template.name}</strong>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      )}
    </section>
  </section>;
}

type SalesVideoRoute = { templateId?: string; projectId?: string };

function initialReviewPromptSegments(details: SalesVideoProject["details"]) {
  const duration = details?.duration || 15;
  if (details?.promptSegments?.length) return details.promptSegments.map((segment) => ({ ...segment }));
  const durations = salesVideoProductSegments(duration);
  const prompt = details?.prompt || "";
  if (durations.length <= 1) return [{ start: 0, duration: durations[0] || duration, prompt }];

  // Older drafts stored one large prompt. Recover the timed scene beats into
  // independent clip prompts so they are never sent together to the model.
  const reference = prompt.match(/REFERENCE LOCK\s*[—-][^\n]*(?:\n[^\n]*)?/iu)?.[0] || "";
  const marker = "PROMPT CẢNH DO AI SOẠN:";
  const scene = prompt.includes(marker) ? prompt.slice(prompt.indexOf(marker) + marker.length) : prompt;
  const lines = scene.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const allPromptLines = prompt.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const beatPattern = /^(?:\d+[).]\s*)?(\d+(?:[.,]\d+)?)\s*(?:–|-)\s*(\d+(?:[.,]\d+)?)\s*s(?:\s*[,.:]\s*|\s+)(.+)$/iu;
  const beats = lines.flatMap((line) => {
    const match = line.match(beatPattern);
    return match ? [{ start: Number(match[1].replace(",", ".")), end: Number(match[2].replace(",", ".")), text: match[3] }] : [];
  });
  const intro = allPromptLines.filter((line) =>
    /^(?:Bind the product|Use soft|Keep shots|Preserve the product|Show a person)/iu.test(line),
  ).join(" ");
  let start = 0;
  return durations.map((clipDuration, index) => {
    const end = start + clipDuration;
    const selectedBeats = beats.filter((beat) => beat.end > start && beat.start < end).map((beat) => {
      const localStart = Math.max(start, beat.start) - start;
      const localEnd = Math.min(end, beat.end) - start;
      return `${localStart}–${localEnd}s: ${beat.text}`;
    });
    const segmentPrompt = beats.length
      ? [reference, `Create one standalone ${clipDuration}-second vertical UGC clip. Only follow this clip's scene beats; do not create content assigned to another clip.`, intro, ...selectedBeats].filter(Boolean).join("\n\n")
      : index === 0 ? prompt : "";
    const segment = { start, duration: clipDuration, prompt: segmentPrompt };
    start = end;
    return segment;
  });
}

function initialReviewScriptSegments(details: SalesVideoProject["details"]) {
  const duration = details?.duration || 15;
  const promptSegments = initialReviewPromptSegments(details);
  if (details?.scriptSegments?.length === promptSegments.length
    && details.scriptSegments.every((segment, index) => segment.start === promptSegments[index].start && segment.duration === promptSegments[index].duration)) {
    return details.scriptSegments.map((segment) => ({ ...segment }));
  }
  return salesVideoSplitDialogue(details?.script || "", promptSegments, duration, details?.language || "Tiếng Việt");
}

function readSalesVideoRoute(): SalesVideoRoute {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("project") || "";
  const templateId = params.get("template") || "";
  if (projectId || templateId) return { projectId, templateId };
  const legacyHash = window.location.hash.slice(1);
  if (legacyHash === "new") return {};
  if (/^[a-f0-9-]{36}$/i.test(legacyHash)) return { projectId: legacyHash };
  return {};
}

export function SalesVideoView() {
  const [route, setRoute] = useState<SalesVideoRoute>({});
  const [projects, setProjects] = useState<SalesVideoProject[] | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [catalog, setCatalog] = useState<VideoGenerationModelOption[]>([]);
  const [error, setError] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [deleteTargets, setDeleteTargets] = useState<SalesVideoProject[]>([]);
  const [deleteError, setDeleteError] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deletingProjects, setDeletingProjects] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/sales-video", { cache: "no-store", signal });
      if (!response.ok) throw new Error();
      const data = await response.json() as { projects: SalesVideoProject[]; access: Access };
      setProjects(data.projects);
      setAccess(data.access);
      setError("");
    } catch {
      if (!signal?.aborted) setError("Không tải được dự án. Vui lòng thử lại.");
    }
  }, []);

  useEffect(() => {
    const navigate = () => setRoute(readSalesVideoRoute());
    navigate();
    window.addEventListener("popstate", navigate);
    window.addEventListener("hashchange", navigate);
    const controller = new AbortController();
    void refresh(controller.signal);
    void fetch("/api/media-models", { signal: controller.signal }).then(async (response) => {
      if (response.ok) setCatalog((await response.json()).videoModels || []);
    }).catch(() => {});
    return () => {
      controller.abort();
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", navigate);
    };
  }, [refresh]);

  const pending = projects?.some((project) => project.status === "processing") ?? false;
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 4000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pending, refresh]);

  useEffect(() => {
    if (!projects) return;
    const deletableIds = new Set(projects.filter((project) => project.status !== "processing").map((project) => project.id));
    setSelectedProjectIds((current) => {
      const next = new Set([...current].filter((id) => deletableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [projects]);

  const selected = projects?.find((project) => project.id === route.projectId);
  const videoUrl = selected ? `/api/sales-video/${selected.id}` : "";
  const selectedVideoModelId = selected?.details?.videoModelId || "";
  const selectedPromptMaxLength = selected?.details?.promptMaxLength
    || catalog.find((model) => model.id === selectedVideoModelId || `maivideo:${model.id}` === selectedVideoModelId)?.promptMaxLength
    || (selectedVideoModelId === "higgsfield" ? 10_000 : 5_000);
  const activeTemplateId = route.templateId || "";
  const validTemplate = salesVideoTemplates.some(({ id }) => id === activeTemplateId)
    || salesVideoCreativeTemplates.some(({ id }) => id === activeTemplateId);
  const showComposer = !route.projectId && Boolean(activeTemplateId) && validTemplate;
  const showGallery = !route.projectId && !showComposer;

  function openTemplate(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    url.searchParams.set("template", id);
    url.hash = "";
    window.history.pushState(null, "", url);
    setRoute({ templateId: id });
  }

  function showTemplateGallery() {
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    url.searchParams.delete("template");
    url.hash = "";
    window.history.pushState(null, "", url);
    setRoute({});
  }

  function showProject(projectId: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete("template");
    url.searchParams.set("project", projectId);
    url.hash = "";
    window.history.pushState(null, "", url);
    setRoute({ projectId });
  }

  const deletableProjects = (projects || []).filter((project) => project.status !== "processing");
  const selectedProjects = (projects || []).filter((project) => selectedProjectIds.has(project.id));
  const deletableSelectedProjects = selectedProjects.filter((project) => project.status !== "processing");
  const allDeletableProjectsSelected = deletableProjects.length > 0
    && deletableProjects.every((project) => selectedProjectIds.has(project.id));

  function toggleProjectSelection(projectId: string) {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function toggleAllProjectSelection() {
    setSelectedProjectIds(allDeletableProjectsSelected
      ? new Set()
      : new Set(deletableProjects.map((project) => project.id)));
  }

  function requestDeleteSelectedProjects() {
    if (!deletableSelectedProjects.length) return;
    setDeleteError("");
    setDeleteMessage("");
    setDeleteTargets(deletableSelectedProjects);
  }

  async function confirmDeleteProjects() {
    if (!deleteTargets.length || deletingProjects) return;
    setDeletingProjects(true);
    setDeleteError("");
    try {
      const response = await fetch("/api/sales-video", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: deleteTargets.map((project) => project.id) }),
      });
      const result = await response.json().catch(() => null) as { message?: string; deleted?: string[]; failed?: string[] } | null;
      if (!response.ok) throw new Error(result?.message || "Không xóa được các dự án đã chọn.");

      const deletedIds = Array.isArray(result?.deleted) ? result.deleted : [];
      const failedIds = Array.isArray(result?.failed) ? result.failed : [];
      if (deletedIds.length) {
        setProjects((current) => current?.filter((project) => !deletedIds.includes(project.id)) || null);
        setSelectedProjectIds((current) => new Set([...current].filter((id) => !deletedIds.includes(id))));
      }
      setDeleteMessage(`Đã xóa ${deletedIds.length} dự án.`);
      if (failedIds.length) {
        setDeleteTargets((current) => current.filter((project) => failedIds.includes(project.id)));
        setDeleteError(`Không xóa được ${failedIds.length} dự án. Bạn có thể thử lại.`);
      } else {
        setDeleteTargets([]);
      }
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Không xóa được các dự án đã chọn.");
    } finally {
      setDeletingProjects(false);
    }
  }

  return <>
    <section className={`page-heading sales-video-page-heading${showComposer ? " is-composer" : ""}${showComposer || route.projectId ? " is-sticky" : ""}`}>
      <div>
        {showComposer
          ? <button type="button" className="secondary-button" onClick={showTemplateGallery}>← Chọn mẫu khác</button>
          : route.projectId && <a className="secondary-button" href="/sales-video#sales-template-gallery">← Video bán hàng</a>}
        <h1>{showComposer ? "Tạo dự án video bán hàng" : route.projectId ? selected?.title || "Dự án video bán hàng" : "Video bán hàng"}</h1>
      </div>
      {route.projectId && <a className="primary-button" href="/sales-video#sales-template-gallery">Tạo video mới</a>}
    </section>
    {error && <p role="alert">{error} <button className="secondary-button" onClick={() => void refresh()}>Tải lại</button></p>}
    {showComposer && <SalesVideoComposer key={activeTemplateId} initialTemplateId={activeTemplateId} access={access} catalog={catalog} projects={projects || []}
      onChangeTemplate={showTemplateGallery} onCreated={(project) => {
        setProjects((items) => [project, ...(items || []).filter((item) => item.id !== project.id)]);
        setError("");
      }} />}
    {showGallery && <>
      <SalesVideoTemplateGallery onSelect={openTemplate} />
      {!route.projectId && projects === null && !error && <p role="status">Đang tải dự án…</p>}
      {!route.projectId && projects?.length ? <>
        <div className="sales-projects-heading"><h2>Dự án gần đây</h2><span>{projects.length} dự án</span></div>
        <div className="sales-project-bulk-toolbar" aria-label="Chọn và xóa nhiều dự án">
          <label><input type="checkbox" checked={allDeletableProjectsSelected} disabled={!deletableProjects.length || deletingProjects} ref={(input) => {
            if (input) input.indeterminate = deletableSelectedProjects.length > 0 && !allDeletableProjectsSelected;
          }} onChange={toggleAllProjectSelection} />Chọn tất cả dự án có thể xóa</label>
          <span aria-live="polite">Đã chọn {deletableSelectedProjects.length}</span>
          <button type="button" className="secondary-button compact" disabled={deletingProjects || !deletableSelectedProjects.length} onClick={() => setSelectedProjectIds(new Set())}>Bỏ chọn</button>
          <button type="button" className="project-delete-confirm" disabled={deletingProjects || !deletableSelectedProjects.length} onClick={requestDeleteSelectedProjects}><Icon name="trash" size={15} />Xóa đã chọn ({deletableSelectedProjects.length})</button>
        </div>
        {deleteMessage && <p className="sales-project-delete-status" role="status">{deleteMessage}</p>}
        <div className="sales-project-grid">
          {projects.map((project) => {
            const contentStyle = project.details?.contentStyle;
            const contentStyleLabel = contentStyle
              ? salesVideoContentStyles.find((style) => style.id === contentStyle)?.label || contentStyle
              : "";
            const selectedProject = selectedProjectIds.has(project.id);
            return <article key={project.id} className={`panel-card sales-project-card${selectedProject ? " is-selected" : ""}`}>
              <label className="sales-project-select">
                <input type="checkbox" checked={selectedProject} disabled={deletingProjects || project.status === "processing"} onChange={() => toggleProjectSelection(project.id)} aria-label={`Chọn dự án ${project.title}`} />
              </label>
              <a href={`/sales-video?project=${project.id}`} onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault(); showProject(project.id);
              }} className="sales-project-card-link">
                <div className="sales-project-card-copy">
                  <div className="sales-project-card-heading">
                    <strong>{project.title}</strong>
                    {contentStyleLabel && <span className="sales-project-content-style">{contentStyleLabel}</span>}
                  </div>
                  <span className="sales-project-card-template">{[project.template, project.model].filter(Boolean).join(" · ")}</span>
                </div>
                <span className="sales-project-card-status">{projectStatusLabel(project)} · {new Date(project.createdAt).toLocaleString("vi-VN")}</span>
              </a>
            </article>;
          })}
        </div>
      </> : !route.projectId && projects?.length === 0 ? <div className="sales-projects-empty panel-card"><strong>Chưa có dự án</strong></div> : null}
    </>}
    {route.projectId && !projects ? <p role="status">Đang tải dự án…</p> : selected ? (
      <SalesVideoProjectDetail key={`${selected.id}-${selected.phase || selected.status}`} project={selected} videoUrl={videoUrl}
        promptMaxLength={selectedPromptMaxLength}
        onUpdated={(next) => setProjects((items) => (items || []).map((item) => item.id === next.id ? next : item))} />
    ) : route.projectId && projects ? (
      <p role="status">Không tìm thấy dự án.</p>
    ) : null}
    {deleteTargets.length > 0 && <div className="project-delete-backdrop">
      <section className="project-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sales-video-delete-title" aria-describedby="sales-video-delete-description" onKeyDown={(event) => {
        if (event.key === "Escape" && !deletingProjects) { setDeleteTargets([]); setDeleteError(""); }
      }}>
        <span className="project-delete-icon"><Icon name="trash" size={20} /></span>
        <div className="section-kicker">VIDEO BÁN HÀNG</div>
        <h2 id="sales-video-delete-title">Xóa {deleteTargets.length} dự án đã chọn?</h2>
        <p id="sales-video-delete-description">Video, ảnh tham chiếu và dữ liệu của các dự án này sẽ bị xóa vĩnh viễn.</p>
        <ul className="project-delete-list">{deleteTargets.map((project) => <li key={project.id}>{project.title}</li>)}</ul>
        {deleteMessage && <p role="status">{deleteMessage}</p>}
        {deleteError && <p className="project-delete-error" role="alert">{deleteError}</p>}
        <div className="project-delete-actions">
          <button className="secondary-button" type="button" onClick={() => { if (!deletingProjects) { setDeleteTargets([]); setDeleteError(""); } }} disabled={deletingProjects}>Hủy</button>
          <button className="project-delete-confirm" type="button" onClick={() => void confirmDeleteProjects()} disabled={deletingProjects}><Icon name="trash" size={15} />{deletingProjects ? "Đang xóa…" : "Xóa vĩnh viễn"}</button>
        </div>
      </section>
    </div>}
  </>;
}

function SalesVideoProjectDetail({ project, videoUrl, promptMaxLength, onUpdated }: {
  project: SalesVideoProject;
  videoUrl: string;
  promptMaxLength: number;
  onUpdated: (project: SalesVideoProject) => void;
}) {
  const details = project.details;
  const [promptSegments, setPromptSegments] = useState(() => initialReviewPromptSegments(details));
  const [scriptSegments, setScriptSegments] = useState(() => initialReviewScriptSegments(details));
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<Promise<void> | null>(null);
  const duration = details?.duration || 15;
  const language = details?.language || "Tiếng Việt";
  const script = scriptSegments.map((segment) => segment.script).filter(Boolean).join("\n");
  const words = salesVideoWordCount(script, language);
  const maxWords = salesVideoMaxWordCount(duration, language);
  const tooLong = Boolean(details?.audio && scriptSegments.some((segment) => {
    const segmentMaxWords = salesVideoMaxWordCount(segment.duration, language);
    return segmentMaxWords !== null && salesVideoWordCount(segment.script, language) > segmentMaxWords;
  }));
  const subtitleSrt = details?.audio ? salesVideoDialogueToSrt(scriptSegments, language) : "";
  const promptsReady = promptSegments.length > 0 && promptSegments.every((segment) => Boolean(segment.prompt.trim()));
  const presenterUrl = details?.references?.presenter || `/api/sales-video/${project.id}/references/presenter`;
  const productReferenceUrls = details?.references?.products?.length
    ? details.references.products
    : [details?.references?.product || `/api/sales-video/${project.id}/references/product`];
  const primaryProductUrl = details?.references?.primaryProduct || productReferenceUrls[0];
  const additionalProductUrls = details?.references?.additionalProducts || productReferenceUrls.slice(1);

  const persist = useCallback(async () => {
    setSaveState("saving");
    try {
      const response = await fetch(`/api/sales-video/ugc/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptSegments, scriptSegments, script }),
      });
      if (!response.ok) throw new Error();
      setSaveState("saved");
    } catch {
      setSaveState("error");
      throw new Error("Không lưu được chỉnh sửa vào bản nháp.");
    }
  }, [project.id, promptSegments, scriptSegments, script]);

  useEffect(() => {
    if (project.status !== "draft" || project.phase !== "review") return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const save = persist().catch(() => undefined);
      pendingSave.current = save;
    }, 550);
    return () => window.clearTimeout(timer.current);
  }, [persist, project.status, project.phase]);

  async function generate() {
    if (generating || tooLong) return;
    setGenerating(true);
    setError("");
    window.clearTimeout(timer.current);
    try {
      await pendingSave.current;
      await persist();
      const response = await fetch(`/api/sales-video/ugc/${project.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptSegments, scriptSegments, script }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.project?.id) throw new Error(result?.message || "Không gửi được yêu cầu tạo video.");
      onUpdated(result.project as SalesVideoProject);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được yêu cầu tạo video.");
    } finally {
      setGenerating(false);
    }
  }

  return <section className="form-section panel-card sales-project-detail">
    <div className="sales-project-status-row">
      <span className={`sales-project-status is-${project.status}`} role="status">{projectStatusLabel(project)}</span>
      <span>{[project.template, project.model, `${duration} giây`, details?.ratio].filter(Boolean).join(" · ")}</span>
      <a className="secondary-button compact" href="/sales-video#sales-template-gallery">Tạo job khác</a>
    </div>
    {project.error && <p role="alert">{project.error}</p>}
    {project.status === "processing" && project.phase === "writing" && <div className="sales-project-waiting" role="status">
      <strong>Code Agent đang chuẩn bị prompt và lời thoại</strong>
    </div>}
    {project.status === "processing" && project.phase === "generating" && <div className="sales-project-waiting" role="status">
      <strong>Model video đang xử lý job</strong>
    </div>}
    {details && <>
      <div className="sales-project-metadata">
        <div><small>SẢN PHẨM</small><strong>{details.product || project.title}</strong>
          {details.productUrl && <a href={details.productUrl} target="_blank" rel="noreferrer">Mở link sản phẩm</a>}</div>
        <div><small>THỜI LƯỢNG / NGÔN NGỮ</small><strong>{duration} giây · {language}</strong><span>{details.ratio || "9:16"}</span></div>
        <div><small>MODEL VIDEO</small><strong>{project.model || details.videoModelId}</strong><span>{details.codingAgent ? `Code Agent: ${details.codingAgent}${details.codingModel ? ` · ${details.codingModel}` : ""}${details.codingQuality ? ` · ${details.codingQuality}` : ""}${details.codingSpeed ? ` · ${details.codingSpeed}` : ""}` : ""}</span></div>
        {details.contentStyle && <div><small>KIỂU NỘI DUNG / CÔNG THỨC</small><strong>{salesVideoContentStyles.find(({ id }) => id === details.contentStyle)?.label || details.contentStyle}</strong><span>{details.copyFramework || salesVideoContentFramework(details.contentStyle)}</span></div>}
        {details.facts && <div className="sales-project-facts"><small>THÔNG TIN SẢN PHẨM</small><span>{details.facts}</span></div>}
        {details.painPoint && <div className="sales-project-facts"><small>NỖI ĐAU ĐỜI THƯỜNG / HOOK</small><span>{details.painPoint}</span></div>}
        {details.heroBenefit && <div className="sales-project-facts"><small>ĐIỂM ĂN TIỀN / HERO BENEFIT</small><span>{details.heroBenefit}</span></div>}
        {details.minorFlaw && <div className="sales-project-facts"><small>NHƯỢC ĐIỂM NHỎ ĐÒN BẨY NIỀM TIN</small><span>{details.minorFlaw}</span></div>}
        {details.userExperience && <div className="sales-project-facts"><small>TRẢI NGHIỆM THỰC TẾ ĐƯỢC CUNG CẤP</small><span>{details.userExperience}</span></div>}
      </div>
      <div className="sales-project-references">
        <figure><img src={presenterUrl} alt="Ảnh nhân vật tham chiếu" /><figcaption>Ảnh nhân vật</figcaption></figure>
        <figure><img src={primaryProductUrl} alt="Ảnh sản phẩm chính" /><figcaption>Ảnh sản phẩm chính</figcaption></figure>
        {additionalProductUrls.map((url, index) => <figure key={`${url}-${index}`}><img src={url} alt={`Ảnh tham khảo phụ ${index + 1}`} /><figcaption>Ảnh tham khảo phụ {index + 1}</figcaption></figure>)}
      </div>
    </>}
    {project.status === "draft" && project.phase === "review" && details && <div className="sales-project-review">
      <div className="sales-project-review-heading"><div><h2>Kiểm tra nội dung trước khi tạo video</h2></div><small aria-live="polite">{saveState === "saving" ? "Đang lưu…" : saveState === "error" ? "Chưa lưu được" : "Đã lưu"}</small></div>
      {details.audio && <div className="sales-project-dialogue-review">
        <div className="sales-project-dialogue-heading"><strong>Lời thoại chia theo clip · {language}</strong><small>{maxWords === null ? `${words} từ · không áp trần tốc độ đọc` : `Tổng ${words} / ${maxWords} từ · theo giới hạn ngôn ngữ`}</small></div>
        {scriptSegments.map((segment, index) => {
          const clipMaxWords = salesVideoMaxWordCount(segment.duration, language);
          const clipWords = salesVideoWordCount(segment.script, language);
          const clipTooLong = clipMaxWords !== null && clipWords > clipMaxWords;
          return <label className="form-field sales-project-dialogue-segment" key={`${segment.start}-${index}`}>
            <span>Lời thoại clip {index + 1} · giây {segment.start}–{segment.start + segment.duration}<em>{segment.duration} giây</em></span>
            <textarea value={segment.script} onChange={(event) => setScriptSegments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, script: event.target.value } : item))} maxLength={2000} rows={4} />
            <small>{clipMaxWords === null ? `${clipWords} từ` : `${clipWords} / ${clipMaxWords} từ`}</small>
            {clipTooLong && <small className="sales-script-warning" role="alert">Lời thoại clip này vượt nhịp đọc; hãy rút gọn trước khi tạo.</small>}
          </label>;
        })}
        <details className="sales-project-srt-preview" open>
          <summary>Phụ đề SRT</summary>
          <pre>{subtitleSrt || "Chưa có lời thoại để tạo mốc SRT."}</pre>
        </details>
      </div>}
      {!details.audio && <p role="status">Model đã chọn không hỗ trợ lời thoại có tiếng.</p>}
      <div className="sales-project-segment-editors">
        {promptSegments.map((segment, index) => <label className="form-field sales-project-segment-editor" key={`${segment.start}-${index}`}>
          <span>Prompt clip {index + 1} · giây {segment.start}–{segment.start + segment.duration} <em>{segment.duration} giây · gửi riêng</em></span>
          <textarea className="sales-project-prompt-editor" value={segment.prompt} onChange={(event) => setPromptSegments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: event.target.value } : item))} maxLength={promptMaxLength} rows={10} />
          <small>{segment.prompt.length.toLocaleString("vi-VN")} / {promptMaxLength.toLocaleString("vi-VN")} ký tự</small>
        </label>)}
      </div>
      {error && <p role="alert" className="sales-form-error">{error}</p>}
      <button type="button" className="primary-button" disabled={generating || saveState === "error" || tooLong || !promptsReady} onClick={() => void generate()}>
        {generating ? "Đang gửi tạo video…" : "Duyệt nội dung và tạo video"}
      </button>
    </div>}
    {project.status === "ready" && <>
      <video key={videoUrl} controls playsInline preload="metadata" src={videoUrl} />
      <a className="primary-button" href={videoUrl + "?download=1"}>Tải MP4</a>
      {(details?.promptSegments?.length || details?.generatedSegments?.length || details?.prompt) && <details className="sales-project-output-details"><summary>Xem prompt và lời thoại đã tạo</summary>
        <h3>Prompt gửi riêng cho từng clip</h3><div className="sales-project-segment-prompts">
          {(details.generatedSegments?.length ? details.generatedSegments : details.promptSegments?.length ? details.promptSegments : [{ start: 0, duration, prompt: details.prompt || "" }]).map((segment, index) => <details key={`${segment.start}-${index}`}>
            <summary>Clip {index + 1} · giây {segment.start}–{segment.start + segment.duration}</summary><pre>{segment.prompt}</pre>
          </details>)}
        </div>
        {details.audio && <>
          <h3>Lời thoại theo clip</h3>
          {(details.scriptSegments || []).map((segment, index) => <details key={`${segment.start}-${index}`}><summary>Clip {index + 1} · giây {segment.start}–{segment.start + segment.duration}</summary><pre>{segment.script}</pre></details>)}
          <h3>Phụ đề SRT</h3><pre>{details.subtitleSrt || "Chưa có dữ liệu SRT"}</pre>
        </>}
      </details>}
    </>}
    {project.status === "failed" && (details?.prompt || details?.promptSegments?.length) && <details className="sales-project-output-details"><summary>Xem bản nháp và ảnh tham chiếu</summary>
      <h3>Prompt clip</h3>{(details.promptSegments?.length ? details.promptSegments : [{ start: 0, duration, prompt: details.prompt || "" }]).map((segment, index) => <details key={`${segment.start}-${index}`}><summary>Clip {index + 1} · giây {segment.start}–{segment.start + segment.duration}</summary><pre>{segment.prompt}</pre></details>)}<h3>Lời thoại</h3><pre>{details.script}</pre>
    </details>}
  </section>;
}

function SalesVideoComposer({ initialTemplateId, access, catalog, projects, onChangeTemplate, onCreated }: {
  initialTemplateId: string;
  access: Access | null;
  catalog: VideoGenerationModelOption[];
  projects: SalesVideoProject[];
  onChangeTemplate: () => void;
  onCreated: (project: SalesVideoProject) => void;
}) {
  const templateId = initialTemplateId;
  const selectedTemplate = salesVideoTemplates.find(({ id }) => id === templateId);
  const creative = salesVideoCreativeTemplates.find(({ id }) => id === templateId);
  const mediaFields = creative?.files ?? salesVideoProductFields;
  const mediaFieldNames = creative ? mediaFields.map(({ name }) => name) : ["presenter", "image", ...salesVideoProductImageFieldNames];
  const poseImageFields = creative && (creative.workflow === "poses" || creative.workflow === "narration")
    ? creative.files.filter((field) => field.kind === "image")
    : [];
  const draftOwner = access?.draftKey || "";
  const [selectedModel, setModel] = useState("");
  const [ratio, setRatio] = useState<string>(salesVideoRatios[0]);
  const [prompt, setPrompt] = useState("");
  const [product, setProduct] = useState("");
  const [facts, setFacts] = useState("");
  const [painPoint, setPainPoint] = useState("");
  const [heroBenefit, setHeroBenefit] = useState("");
  const [minorFlaw, setMinorFlaw] = useState("");
  const [targetAudience, setTargetAudience] = useState<string>(salesVideoTargetAudiences[0].id);
  const [hookStyle, setHookStyle] = useState<string>(salesVideoHookStyles[0].id);
  const [userExperience, setUserExperience] = useState("");
  const [script, setScript] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [contentStyle, setContentStyle] = useState<string>(salesVideoContentStyles[0].id);
  const [claimCategory, setClaimCategory] = useState<string>(templateId === "supplements" ? "health" : "general");
  const [queuedProject, setQueuedProject] = useState<SalesVideoProject>();
  const [productPromptOverride, setProductPromptOverride] = useState("");
  const [productPromptEdited, setProductPromptEdited] = useState(false);
  const [language, setLanguage] = useState<string>(salesVideoLanguages[0]);
  const [duration, setDuration] = useState<number>(() => salesVideoCreativeTemplates.find(({ id }) => id === initialTemplateId)?.defaultSeconds ?? 15);
  const [sourceStart, setSourceStart] = useState("0");
  const [files, setFiles] = useState<Record<string, File>>({});
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [libraryImages, setLibraryImages] = useState<SalesVideoLibraryImage[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [libraryActionBusy, setLibraryActionBusy] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftWarning, setDraftWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const overlyLongSentences = useMemo(() => {
    if (!/(vietnam|việt)/i.test(language) || !script.trim()) return [];
    // Only check if a continuous spoken clause (between commas, periods, etc.) is excessively long (> 22 words) without a breath pause
    const clauses = script.split(/[.,\n!?]+/u).map((s) => s.trim()).filter(Boolean);
    return clauses.filter((s) => s.split(/\s+/u).length > 22);
  }, [script, language]);

  function applyExampleValues() {
    const exampleProduct = salesVideoProductExamples[templateId] || "Bình nước inox 750 ml";
    const examplePain = salesVideoPainExamples[templateId] || "Dùng đồ rẻ thì nhanh hỏng, mua đồ xịn thì quá đắt.";
    const exampleHero = salesVideoHeroExamples[templateId] || "Thiết kế nhỏ gọn vừa lòng bàn tay, hoàn thiện kim loại chắc chắn.";
    const exampleFlaw = salesVideoFlawExamples[templateId] || "Hộp đóng gói hơi đơn giản, nhưng chất lượng bên trong rất đầm tay.";
    setProduct(exampleProduct);
    setPainPoint(examplePain);
    setHeroBenefit(exampleHero);
    setMinorFlaw(exampleFlaw);
    if (!facts.trim()) {
      setFacts("Chất liệu cao cấp đã kiểm định, dung tích tiêu chuẩn, bảo hành chính hãng.");
    }
    setMessage("");
  }

  useEffect(() => {
    if (!draftOwner) return;
    let active = true;
    setDraftReady(false);
    void loadSalesVideoDraft(draftOwner, templateId, mediaFieldNames).then((draft) => {
      if (!active) return;
      const saved = draft.fields;
      if (typeof saved.selectedModel === "string") setModel(saved.selectedModel);
      if (typeof saved.ratio === "string" && salesVideoRatios.includes(saved.ratio as typeof salesVideoRatios[number])) setRatio(saved.ratio);
      if (typeof saved.prompt === "string") setPrompt(saved.prompt);
      if (typeof saved.product === "string") setProduct(saved.product);
      if (typeof saved.facts === "string") setFacts(saved.facts);
      if (typeof saved.painPoint === "string") setPainPoint(saved.painPoint);
      if (typeof saved.heroBenefit === "string") setHeroBenefit(saved.heroBenefit);
      if (typeof saved.minorFlaw === "string") setMinorFlaw(saved.minorFlaw);
      if (typeof saved.targetAudience === "string" && salesVideoTargetAudiences.some(({ id }) => id === saved.targetAudience)) setTargetAudience(saved.targetAudience);
      if (typeof saved.hookStyle === "string" && salesVideoHookStyles.some(({ id }) => id === saved.hookStyle)) setHookStyle(saved.hookStyle);
      if (typeof saved.userExperience === "string") setUserExperience(saved.userExperience);
      if (typeof saved.script === "string") setScript(saved.script);
      if (typeof saved.productUrl === "string") setProductUrl(saved.productUrl);
      if (typeof saved.contentStyle === "string" && salesVideoContentStyles.some(({ id }) => id === saved.contentStyle)) setContentStyle(saved.contentStyle);
      if (typeof saved.claimCategory === "string" && salesVideoClaimCategories.some(({ id }) => id === saved.claimCategory)) setClaimCategory(saved.claimCategory);
      if (typeof saved.language === "string" && salesVideoLanguages.includes(saved.language as typeof salesVideoLanguages[number])) setLanguage(saved.language);
      if (typeof saved.duration === "number") setDuration(saved.duration);
      if (typeof saved.sourceStart === "string") setSourceStart(saved.sourceStart);
      if (typeof saved.productPromptOverride === "string") setProductPromptOverride(saved.productPromptOverride);
      if (typeof saved.productPromptEdited === "boolean") setProductPromptEdited(saved.productPromptEdited);
      const restoredFiles = { ...draft.files };
      if (!restoredFiles[salesVideoProductImageFieldNames[0]] && restoredFiles.image) {
        restoredFiles[salesVideoProductImageFieldNames[0]] = restoredFiles.image;
        delete restoredFiles.image;
      }
      setFiles(restoredFiles);
      try {
        const expectedFiles = JSON.parse(String(saved.savedFiles || "[]")) as string[];
        if (expectedFiles.some((name) => !restoredFiles[name] && !(name === "image" && restoredFiles[salesVideoProductImageFieldNames[0]]))) setDraftWarning("Không khôi phục được một số tệp đính kèm. Hãy chọn lại các tệp đó trước khi tạo video.");
      } catch { /* Older drafts do not contain a saved file list. */ }
      setDraftReady(true);
    }).catch(() => {
      if (active) {
        setDraftWarning("Không tải được bản nháp trên thiết bị này.");
        setDraftReady(true);
      }
    });
    return () => { active = false; };
  }, [draftOwner, templateId, mediaFieldNames.join("|")]);

  useEffect(() => {
    if (!draftReady || !draftOwner || busy) return;
    const timer = window.setTimeout(() => {
      const savedFiles = mediaFieldNames.filter((name) => files[name]);
      void saveSalesVideoDraftFields(draftOwner, templateId, {
        selectedModel,
        ratio, prompt, product, facts, userExperience,
        painPoint, heroBenefit, minorFlaw, targetAudience, hookStyle,
        script, productUrl, contentStyle,
        claimCategory: selectedTemplate?.id === "supplements" ? "health" : claimCategory, language, duration, sourceStart,
        productPromptOverride, productPromptEdited, savedFiles: JSON.stringify(savedFiles),
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftReady, draftOwner, busy, templateId, selectedModel, ratio, prompt, product, facts, painPoint, heroBenefit, minorFlaw, targetAudience, hookStyle, userExperience, script, productUrl, contentStyle, claimCategory, language, duration, sourceStart, productPromptOverride, productPromptEdited, files, mediaFields, selectedTemplate?.id]);

  function updateFile(name: string, file?: File) {
    setFiles((current) => {
      const next = { ...current };
      if (file) next[name] = file;
      else delete next[name];
      return next;
    });
    if (draftOwner) void saveSalesVideoDraftFile(draftOwner, templateId, name, file).then((saved) => {
      if (!saved) setDraftWarning("Trình duyệt không lưu được một số tệp nháp. Sau khi tải lại, hãy chọn lại tệp đó.");
    });
  }

  function updateProductImages(mainFile?: File, selectedAdditional: File[] = []) {
    const selected = [mainFile, ...selectedAdditional].filter((file): file is File => Boolean(file));
    if (selected.length > maxProductImages) {
      setMessage(`Model đang chọn nhận tối đa ${maxProductImages} ảnh sản phẩm, gồm một ảnh chính và ảnh tham khảo phụ.`);
      return;
    }
    for (const file of selected) {
      const extensionAllowed = /\.(jpe?g|png|webp|avif)$/i.test(file.name);
      if (!file.size || (file.type && !salesVideoImageTypes.includes(file.type) && !extensionAllowed)) {
        setMessage(`“${file.name}” không phải ảnh JPG, PNG, WebP hoặc AVIF hợp lệ.`);
        return;
      }
      if (file.size > salesVideoFileLimits.image) {
        setMessage(`Mỗi ảnh tối đa ${salesVideoFileLimits.image / 1024 ** 2} MB.`);
        return;
      }
    }
    const totalBytes = (files.presenter?.size || 0) + selected.reduce((total, file) => total + file.size, 0);
    if (totalBytes > 100 * 1024 ** 2) {
      setMessage("Tổng dung lượng ảnh không được vượt quá 100 MB.");
      return;
    }
    setFiles((current) => {
      const next = { ...current };
      salesVideoProductImageFieldNames.forEach((name) => delete next[name]);
      if (mainFile) next[salesVideoProductImageFieldNames[0]] = mainFile;
      selectedAdditional.forEach((file, index) => { next[salesVideoProductImageFieldNames[index + 1]] = file; });
      return next;
    });
    const filesBySlot = [mainFile, ...selectedAdditional];
    salesVideoProductImageFieldNames.forEach((name, index) => void saveSalesVideoDraftFile(draftOwner, templateId, name, filesBySlot[index]));
    setMessage("");
  }

  function storePoseImages(selected: File[]) {
    setFiles((current) => {
      const next = { ...current };
      poseImageFields.forEach((field, index) => {
        if (selected[index]) next[field.name] = selected[index];
        else delete next[field.name];
      });
      return next;
    });
    poseImageFields.forEach((field, index) => {
      void saveSalesVideoDraftFile(draftOwner, templateId, field.name, selected[index]).then((saved) => {
        if (!saved) setDraftWarning("Trình duyệt không lưu được một số tệp nháp. Sau khi tải lại, hãy chọn lại tệp đó.");
      });
    });
  }

  function assignPoseImages(selected: File[]) {
    if (!poseImageFields.length) return "Mẫu video này không nhận bộ ảnh tạo dáng.";
    if (selected.length > poseImageFields.length) return `Mẫu này nhận tối đa ${poseImageFields.length} ảnh. Hãy chọn lại đúng số ảnh cần dùng.`;
    if (selected.length > 0 && selected.length !== poseImageFields.length) return `Mẫu này cần đủ ${poseImageFields.length} ảnh. Bạn vừa chọn ${selected.length}; hãy chọn lại đủ ảnh cùng một lần.`;
    for (const file of selected) {
      const extensionAllowed = /\.(jpe?g|png|webp|avif)$/i.test(file.name);
      if (file.size <= 0 || (file.type && !salesVideoImageTypes.includes(file.type) && !extensionAllowed)) {
        return `“${file.name}” không phải ảnh JPG, PNG, WebP hoặc AVIF hợp lệ.`;
      }
      if (file.size > salesVideoFileLimits.image) return `Mỗi ảnh tối đa ${salesVideoFileLimits.image / 1024 ** 2} MB.`;
    }
    const imageNames = new Set(poseImageFields.map(({ name }) => name));
    const otherFileBytes = Object.entries(files).reduce((total, [name, file]) => total + (imageNames.has(name) ? 0 : file.size), 0);
    const selectedBytes = selected.reduce((total, file) => total + file.size, 0);
    if (otherFileBytes + selectedBytes > 100 * 1024 ** 2) return "Tổng dung lượng tệp không được vượt quá 100 MB.";
    storePoseImages(selected);
    return "";
  }

  function handlePoseFilesChange(selected: File[]) {
    if (!selected.length) {
      assignPoseImages([]);
      setMessage("Đã xóa bộ ảnh tạo dáng.");
      return;
    }
    const issue = assignPoseImages(selected);
    if (issue) {
      setMessage(issue);
      return;
    }
    setMessage(`Đã gán ${selected.length} ảnh theo thứ tự vào Ảnh 1–${selected.length}.`);
  }

  async function openMediaLibrary() {
    setLibraryOpen(true);
    setLibraryError("");
    if (libraryImages.length) return;
    setLibraryLoading(true);
    try {
      const response = await fetch("/api/maivideo/media-library", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tải được Media Library.");
      setLibraryImages(Array.isArray(payload.images) ? payload.images as SalesVideoLibraryImage[] : []);
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : "Không tải được Media Library.");
    } finally {
      setLibraryLoading(false);
    }
  }

  function toggleLibraryImage(id: string) {
    setLibraryError("");
    setSelectedLibraryIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= poseImageFields.length) return current;
      return [...current, id];
    });
  }

  async function addLibraryImages() {
    const selected = selectedLibraryIds.map((id) => libraryImages.find((image) => image.id === id))
      .filter((image): image is SalesVideoLibraryImage => Boolean(image));
    if (!selected.length) return;
    setLibraryActionBusy(true);
    setLibraryError("");
    try {
      const selectedFiles = await Promise.all(selected.map(async (image, index) => {
        const response = await fetch(`/api/maivideo/media-library/download?id=${encodeURIComponent(image.id)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 401 ? "Phiên MaiVideo đã hết hạn. Hãy đăng nhập lại rồi thử tiếp." : `Không tải được ảnh “${image.name}” từ Media Library.`);
        const blob = await response.blob();
        const mimeType = blob.type.toLowerCase();
        if (!salesVideoImageTypes.includes(mimeType)) throw new Error(`“${image.name}” có định dạng không hỗ trợ. Dùng ảnh JPG, PNG, WebP hoặc AVIF.`);
        if (!blob.size || blob.size > salesVideoFileLimits.image) throw new Error(`“${image.name}” vượt giới hạn ${salesVideoFileLimits.image / 1024 ** 2} MB.`);
        const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" } as Record<string, string>)[mimeType] || "jpg";
        const fileName = (image.fileName || image.name || `image-${index + 1}.${extension}`).split(/[\\/]/).pop() || `image-${index + 1}.${extension}`;
        return new File([blob], fileName, { type: mimeType });
      }));
      const issue = assignPoseImages(selectedFiles);
      if (issue) {
        setLibraryError(issue);
        return;
      }
      setLibraryOpen(false);
      setSelectedLibraryIds([]);
      setMessage(`Đã gán ${selectedFiles.length} ảnh từ Media Library theo thứ tự Ảnh 1–${selectedFiles.length}.`);
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : "Không thể thêm ảnh từ Media Library.");
    } finally {
      setLibraryActionBusy(false);
    }
  }

  function closeMediaLibrary() {
    if (libraryActionBusy) return;
    setLibraryOpen(false);
  }

  const models = salesVideoModelOptions(creative);
  const maiVideoModels = salesVideoMaiVideoModels(catalog, creative, ratio);
  const pixverseReferenceWorkflow = creative?.workflow === "remake" || creative?.workflow === "background";
  const options = [
    ...models.filter((id) => id === "higgsfield").map((id) => ({ id, label: selectedTemplate ? salesVideoModels[id] : `${salesVideoModels[id]} · tối đa 15 giây mỗi clip`, available: true, modelMeta: undefined as VideoGenerationModelOption | undefined })),
    ...maiVideoModels.map((item) => {
      const max = item.id === "wan-3.0" ? 30 : Math.min(15, item.maxDurationSec);
      const capability = salesVideoSupportsDialogue(item) ? "" : " · không thoại";
      const label = selectedTemplate ? `${item.label} · MaiVideo${capability}` : `${item.label} · MaiVideo API · tối đa ${max} giây mỗi clip${capability}`;
      return { id: `maivideo:${item.id}`, label, available: pixverseReferenceWorkflow && item.id === "v6" || Boolean(access?.maiVideo), modelMeta: item };
    }),
    ...models.filter((id) => id !== "higgsfield").map((id) => ({ id, label: selectedTemplate ? `${salesVideoModels[id]} · PixVerse` : `${salesVideoModels[id]} · PixVerse Platform · tối đa 15 giây mỗi clip`, available: Boolean(access?.pixverse), modelMeta: undefined as VideoGenerationModelOption | undefined })),
  ];
  const model = options.find((option) => option.id === selectedModel && option.available)
    ?? options.find((option) => option.available) ?? options[0];
  const videoQuality = model?.id === "higgsfield"
    ? "720p"
    : model?.modelMeta?.qualities.includes("720p") ? "720p" : model?.modelMeta?.qualities[0] || "";
  const offPeakRequired = Boolean(model?.modelMeta && isVideoOffPeakRequired(model.modelMeta.id, model.modelMeta.label));
  const videoOffPeak = offPeakRequired;
  const durationOptions = salesVideoDurationOptions(model?.modelMeta, creative, Boolean(selectedTemplate), model?.modelMeta?.id || model?.id || "", videoQuality);
  const selectedDuration = durationOptions.includes(duration) ? duration : durationOptions.at(-1) ?? 15;
  const supportsAudio = salesVideoSupportsDialogue(model?.modelMeta);
  const maxProductImages = Math.min(salesVideoMaxProductImages, Math.max(0, (model?.modelMeta?.maxReferenceImages || 7) - 1));
  const mainProductImage = files[salesVideoProductImageFieldNames[0]];
  const additionalProductImageFiles = useMemo(() => salesVideoProductImageFieldNames.slice(1)
    .map((name) => files[name]).filter((file): file is File => Boolean(file)), [files]);
  const productImageFiles = useMemo(() => [mainProductImage, ...additionalProductImageFiles]
    .filter((file): file is File => Boolean(file)), [mainProductImage, additionalProductImageFiles]);
  const productImagesExceedModelLimit = productImageFiles.length > maxProductImages;
  const editableProductPrompt = productPromptEdited ? productPromptOverride : "";
  const scriptWords = selectedTemplate ? salesVideoWordCount(script, language) : 0;
  const maximumScriptWords = salesVideoMaxWordCount(selectedDuration, language);
  const scriptTooLong = Boolean(selectedTemplate && supportsAudio && script.trim() && maximumScriptWords !== null && scriptWords > maximumScriptWords);
  const requiredFilesReady = selectedTemplate
    ? Boolean(files.presenter?.size && mainProductImage?.size)
    : mediaFields.every((field) => Boolean(files[field.name]?.size));
  const requiredPromptReady = !creative?.text || Boolean(creative.defaultText) || Boolean(prompt.trim());
  const canSubmit = Boolean(draftReady && !libraryOpen && !libraryActionBusy && requiredFilesReady && (creative || product.trim()) && requiredPromptReady
    && model?.available && durationOptions.length && !scriptTooLong
    && (!selectedTemplate || Boolean(access?.codingAgent)) && (creative?.workflow !== "narration" || access?.voice)
    && (!selectedTemplate || !productImagesExceedModelLimit));
  const example = salesVideoTextExamples[templateId];

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canSubmit) return;
    setMessage("");
    const form = new FormData(event.currentTarget);
    form.set("title", product.trim().slice(0, 120) || selectedTemplate?.name || creative?.name || "Video bán hàng");
    form.set("prompt", selectedTemplate ? editableProductPrompt : prompt);
    form.set("script", script);
    if (selectedTemplate) {
      form.set("product", product.trim());
      form.set("productFacts", facts.trim());
      form.set("userExperience", "");
      form.set("painPoint", painPoint.trim());
      form.set("heroBenefit", heroBenefit.trim());
      form.set("minorFlaw", minorFlaw.trim());
      form.set("targetAudience", targetAudience);
      form.set("hookStyle", hookStyle);
      form.set("autoUgc", "1");
      form.set("productUrl", productUrl.trim());
      form.set("contentStyle", contentStyle);
      form.set("claimCategory", selectedTemplate.id === "supplements" ? "health" : claimCategory);
      form.set("prompt", "");
    }
    let totalFileBytes = 0;
    if (selectedTemplate) {
      const presenter = files.presenter || form.get("presenter");
      if (!(presenter instanceof File) || !presenter.size || presenter.size > salesVideoFileLimits.image) {
        setMessage(`Ảnh nhân vật là tệp bắt buộc, tối đa ${salesVideoFileLimits.image / 1024 ** 2} MB.`);
        return;
      }
      if (!mainProductImage?.size || productImagesExceedModelLimit) {
        setMessage(`Chọn ảnh sản phẩm chính và tối đa ${Math.max(0, maxProductImages - 1)} ảnh tham khảo phụ cho model đang chọn.`);
        return;
      }
      totalFileBytes = presenter.size + productImageFiles.reduce((total, file) => total + file.size, 0);
      form.set("presenter", presenter, presenter.name);
      form.delete("image");
      form.set("primaryProductImage", mainProductImage, mainProductImage.name);
      form.delete("additionalProductImage");
      additionalProductImageFiles.forEach((file) => form.append("additionalProductImage", file, file.name));
    } else {
      for (const field of mediaFields) {
        const file = files[field.name] || form.get(field.name);
        const limit = salesVideoFileLimits[field.kind];
        if (!(file instanceof File) || !file.size || file.size > limit) {
          setMessage(`${field.label} là tệp bắt buộc, tối đa ${limit / 1024 ** 2} MB.`);
          return;
        }
        totalFileBytes += file.size;
        form.set(field.name, file, file.name);
      }
    }
    if (totalFileBytes > 100 * 1024 ** 2) {
      setMessage("Tổng dung lượng tệp không được vượt quá 100 MB.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(selectedTemplate ? "/api/sales-video/ugc" : "/api/sales-video", { method: "POST", body: form });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.project?.id !== "string") {
        throw new Error(result?.message || "Không nhận được video từ máy chủ.");
      }
      if (!selectedTemplate) await clearSalesVideoDraft(draftOwner, templateId, mediaFieldNames);
      setQueuedProject(result.project);
      onCreated(result.project);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tạo được video.");
    } finally {
      setBusy(false);
    }
  }

  return (
      <form className="sales-video-composer form-section panel-card" onSubmit={generate} aria-busy={busy}>
        <fieldset disabled={busy || !draftReady} style={{ padding: 0, margin: 0, minWidth: 0, border: 0 }}>
          <div className="form-grid">
            <div className="sales-video-template-selected full">
              <input type="hidden" name="template" value={templateId} />
              <SalesVideoTemplateArtwork id={templateId} />
              <div><small>MẪU ĐÃ CHỌN</small><strong>{selectedTemplate?.name || creative?.name}</strong></div>
              <button type="button" className="secondary-button" onClick={onChangeTemplate}>Đổi mẫu</button>
            </div>
            {creative ? <div key={creative.id} className="form-grid full" style={{ gridColumn: "1 / -1", marginTop: 0 }}>
              <div className="sales-form-step full"><span>01</span><div><strong>Tệp đầu vào</strong></div></div>
              {poseImageFields.length ? <>
                <PoseImagesInput fields={poseImageFields} files={files} onFilesChange={handlePoseFilesChange}
                  onOpenLibrary={() => void openMediaLibrary()} disabled={libraryActionBusy} />
                {creative.files.filter((field) => field.kind !== "image").map((field) => <MediaInput key={field.name} {...field} file={files[field.name]} onFileChange={updateFile}
                  example={mediaExample(field.name, field.kind, false)} />)}
              </> : creative.files.map((field) => <MediaInput key={field.name} {...field} file={files[field.name]} onFileChange={updateFile}
                example={creative.workflow === "remake" && field.kind === "video" ? "cảnh quảng cáo quay gần, một người, ít cắt cảnh. Video phải đủ dài cho đoạn được chọn." : mediaExample(field.name, field.kind, false)} />)}
              {creative.text && <div className="form-field full">
                <label htmlFor="sales-video-prompt">{creative.text}{creative.defaultText ? <em>Không bắt buộc</em> : null}</label>
                <textarea id="sales-video-prompt" name="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)}
                  placeholder={creative.defaultText || example} maxLength={salesVideoNameLimit} required={!creative.defaultText} />
                {example && <div><button type="button" className="secondary-button" onClick={() => setPrompt(example)}>Dùng ví dụ</button></div>}
              </div>}
            </div> : <>
              <div className="sales-form-step full"><span>01</span><div><strong>Ảnh tham chiếu</strong></div></div>
              <div className="sales-reference-assets-layout full">
                <MediaInput name="presenter" kind="image" label="Ảnh nhân vật" file={files.presenter} onFileChange={updateFile}
                  example="ảnh người giới thiệu sản phẩm." />
                <ProductImagesInput mainFile={mainProductImage} additionalFiles={additionalProductImageFiles} maxCount={maxProductImages}
                  onMainFileChange={(file) => updateProductImages(file, additionalProductImageFiles)}
                  onAdditionalFilesChange={(selected) => updateProductImages(mainProductImage, selected)} disabled={busy} />
              </div>
              {productImagesExceedModelLimit && <p className="sales-script-warning full" role="alert">Model đã chọn chỉ nhận {maxProductImages} ảnh sản phẩm kèm ảnh nhân vật. Giảm số ảnh hoặc chọn model khác.</p>}
              <label className="form-field full">
                <span>Tên sản phẩm <em>Bắt buộc</em></span>
                <input type="text" name="product" value={product} onChange={(event) => setProduct(event.target.value.slice(0, 120))}
                  placeholder={salesVideoProductExamples[templateId] || "Ví dụ: Bình nước inox 750 ml"} maxLength={120} required />
              </label>
              <div className="sales-retention-grid full">
                <label className="form-field">
                  <span>Link sản phẩm <em>Tùy chọn</em></span>
                  <input type="text" inputMode="url" value={productUrl}
                    onChange={(event) => setProductUrl(event.target.value)} maxLength={2000}
                    placeholder="https://…" />
                </label>
                <label className="form-field">
                  <span>Tính năng / thông số xác minh <em>Tùy chọn</em></span>
                  <input type="text" name="productFacts" value={facts} onChange={(event) => setFacts(event.target.value.slice(0, 1000))}
                    placeholder="Ví dụ: Inox 304, giữ nhiệt 24h, nắp chống tràn..." maxLength={1000} />
                </label>
              </div>
              <div className="sales-form-step full">
                <span>02</span>
                <div><strong>Nội dung video</strong></div>
                <button type="button" className="secondary-button compact" onClick={applyExampleValues}>Điền ví dụ</button>
              </div>
              <div className="sales-retention-grid full">
                <label className="form-field">
                  <span>Đối tượng & Xưng hô</span>
                  <select name="targetAudience" value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)}>
                    {salesVideoTargetAudiences.map((aud) => (
                      <option key={aud.id} value={aud.id}>{aud.label} ({aud.pronoun})</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Kiểu mở đầu</span>
                  <select name="hookStyle" value={hookStyle} onChange={(event) => setHookStyle(event.target.value)}>
                    {salesVideoHookStyles.map((style) => (
                      <option key={style.id} value={style.id}>{style.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="form-field full">
                <span>Vấn đề khách hàng thường gặp <em>Khuyên dùng</em></span>
                <input type="text" name="painPoint" value={painPoint} onChange={(event) => setPainPoint(event.target.value.slice(0, 300))}
                  placeholder={salesVideoPainExamples[templateId] || "Ví dụ: Dùng đồ rẻ thì nhanh hỏng, mua đồ xịn thì quá đắt."} maxLength={300} />
              </label>
              <label className="form-field full">
                <span>Điểm nổi bật của sản phẩm <em>Khuyên dùng</em></span>
                <input type="text" name="heroBenefit" value={heroBenefit} onChange={(event) => setHeroBenefit(event.target.value.slice(0, 300))}
                  placeholder={salesVideoHeroExamples[templateId] || "Ví dụ: Thiết kế nhỏ gọn vừa lòng bàn tay, hoàn thiện kim loại chắc chắn."} maxLength={300} />
              </label>
              <div className="form-field full sales-retention-flaw-card">
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Điểm cần cân nhắc <em>Tùy chọn</em></span>
                  <input type="text" name="minorFlaw" value={minorFlaw} onChange={(event) => setMinorFlaw(event.target.value.slice(0, 300))}
                    placeholder={salesVideoFlawExamples[templateId] || "Ví dụ: Hộp đóng gói hơi đơn giản, nhưng chất lượng bên trong rất đầm tay."} maxLength={300} />
                </label>
              </div>
              <details className="sales-video-optional-details full">
                <summary>Thông tin bổ sung: lời thoại</summary>
                <div className="sales-video-optional-body">
                  <label className="form-field full sales-script-field">
                    <span>Kịch bản / lời thoại <em>Không bắt buộc</em></span>
                    <textarea name="script" value={script} onChange={(event) => setScript(event.target.value)} maxLength={2000}
                      placeholder={salesVideoScriptPlaceholder("review")} />
                    {supportsAudio
                      ? <small>{maximumScriptWords === null ? `${scriptWords} từ · không áp trần tốc độ đọc cho tiếng Việt.` : `${scriptWords} / ${maximumScriptWords} từ cho ${selectedDuration} giây.`}</small>
                      : <small>Model này không tạo giọng nói; kịch bản chỉ được dùng làm ngữ cảnh cho hình ảnh.</small>}
                    {scriptTooLong && <small className="sales-script-warning" role="alert">Lời thoại vượt giới hạn {maximumScriptWords} từ của ngôn ngữ này. Hãy rút gọn để vừa nhịp đọc.</small>}
                    {overlyLongSentences.length > 0 && <small className="sales-script-warning" role="alert">Có {overlyLongSentences.length} câu dài hơn 22 từ. Bạn có thể ngắt câu để giọng đọc tự nhiên hơn.</small>}
                  </label>
                </div>
              </details>
            </>}
            <div className="sales-form-step full"><span>{selectedTemplate ? "03" : "02"}</span><div><strong>Model và định dạng video</strong></div></div>
            <label className={`form-field${creative?.workflow === "remake" ? "" : " full"}`}>
              <span>Model tạo video <em>Bắt buộc</em></span>
              <select name="model" value={model?.id || ""} onChange={(event) => {
                setModel(event.target.value);
              }}>
                {options.map((item) => <option value={item.id} key={item.id} disabled={!item.available}>{item.label}{item.available ? "" : " (chưa cấu hình)"}</option>)}
              </select>
            </label>
            <input type="hidden" name="quality" value={videoQuality} />
            <input type="hidden" name="videoSpeed" value="fast" />
            <input type="hidden" name="videoOffPeak" value={videoOffPeak ? "true" : "false"} />
            {creative?.workflow === "remake" && <label className="form-field">
              <span>Bắt đầu từ (giây)</span>
              <input name="sourceStart" type="number" min="0" max="3600" step="0.1" value={sourceStart} onChange={(event) => setSourceStart(event.target.value)} />
            </label>}
            {selectedTemplate && <label className="form-field">
              <span>Ngôn ngữ thoại <em>Bắt buộc</em></span>
              <select name="language" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {salesVideoLanguages.map((lang) => <option key={lang}>{lang}</option>)}
              </select>
            </label>}
            <label className="form-field">
              <span>Thời lượng video <em>Bắt buộc</em></span>
              <select name="duration" value={selectedDuration} onChange={(event) => setDuration(Number(event.target.value))} disabled={!durationOptions.length}>
                {durationOptions.map((seconds) => <option key={seconds} value={seconds}>{seconds} giây</option>)}
              </select>
              {!durationOptions.length && <small role="status">Model này không có thời lượng phù hợp với mẫu đã chọn.</small>}
            </label>
            <label className="form-field">
              <span>Tỷ lệ khung hình <em>Bắt buộc</em></span>
              <select name="ratio" value={ratio} onChange={(event) => setRatio(event.target.value)}>
                {salesVideoRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio} · {ratio === "9:16" ? "Dọc" : "Ngang"}</option>)}
              </select>
            </label>
          </div>
        </fieldset>
        {libraryOpen && <div className="sales-media-library-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMediaLibrary(); }}>
          <section className="sales-media-library-modal" role="dialog" aria-modal="true" aria-labelledby="sales-media-library-title">
            <header>
              <div><span className="section-kicker">MEDIA LIBRARY</span><h2 id="sales-media-library-title">Chọn ảnh tạo dáng</h2></div>
              <button type="button" aria-label="Đóng Media Library" onClick={closeMediaLibrary}>×</button>
            </header>
            {libraryLoading ? <div className="sales-media-library-state">Đang tải Media Library…</div>
              : libraryError ? <div className="sales-media-library-state is-error">{libraryError}
                <button type="button" className="secondary-button compact" onClick={() => { setLibraryImages([]); void openMediaLibrary(); }}>Thử lại</button>
              </div>
                : libraryImages.length ? <div className="sales-media-library-grid">{libraryImages.map((image) => {
                  const selectedIndex = selectedLibraryIds.indexOf(image.id);
                  const selected = selectedIndex >= 0;
                  const limitReached = selectedLibraryIds.length >= poseImageFields.length;
                  return <button type="button" key={image.id} className={`sales-media-library-item${selected ? " is-selected" : ""}`}
                    onClick={() => toggleLibraryImage(image.id)} disabled={libraryActionBusy || (!selected && limitReached)} aria-pressed={selected}>
                    <img src={image.previewUrl} alt={image.name} loading="lazy" decoding="async" />
                    <span title={image.name}>{image.name}</span>
                    <i>{selected ? `Ảnh ${selectedIndex + 1}` : "+"}</i>
                  </button>;
                })}</div>
                  : <div className="sales-media-library-state">Chưa có ảnh trong Media Library.</div>}
              <footer><span>{selectedLibraryIds.length}/{poseImageFields.length} ảnh đã chọn · Chọn đủ số ảnh của mẫu</span>
              <div><button type="button" className="secondary-button" onClick={closeMediaLibrary}>Hủy</button>
                <button type="button" className="primary-button" onClick={() => void addLibraryImages()} disabled={selectedLibraryIds.length !== poseImageFields.length || libraryLoading || libraryActionBusy}>
                  {libraryActionBusy ? "Đang thêm ảnh…" : `Gán ${selectedLibraryIds.length} ảnh`}
                </button></div>
            </footer>
          </section>
        </div>}
        <div className="sales-form-footer">
          <div className="sales-form-feedback">
            {!selectedTemplate && !supportsAudio && creative?.workflow !== "narration" && <p role="status">Model này không tạo giọng nói.</p>}
            {access && !model?.available && model?.id.startsWith("maivideo:") && <p role="status">Chưa cấu hình khóa MaiVideo để dùng PixVerse V6 Reference.</p>}
            {access && !model?.available && !model?.id.startsWith("maivideo:") && <p role="status">Chưa cấu hình khóa PixVerse Platform cho model nhận video hoặc âm thanh tham chiếu.</p>}
            {access && !access.maiVideo && maiVideoModels.length > 0 && !pixverseReferenceWorkflow && <p><a href="/settings">Cài đặt khóa MaiVideo</a> để dùng thêm các model từ Phim AI.</p>}
            {access && !access.voice && creative?.workflow === "narration" && <p role="status">Máy chủ chưa cấu hình dịch vụ giọng mẫu.</p>}
            {!draftReady && <p className="sales-draft-status" role="status">Đang khôi phục bản nháp…</p>}
            {creative?.text && !requiredPromptReady && <p>Nhập lời thoại để tiếp tục.</p>}
            {selectedTemplate && access && !access.codingAgent && <p role="alert">Chưa tìm thấy Code Agent CLI. Hãy kết nối CLI và lưu cấu hình trong <a href="/settings#agent-cli-connection">Cài đặt Code Agent</a>.</p>}
            {draftWarning && <p className="sales-script-warning" role="alert">{draftWarning}</p>}
            {busy && <p role="status">Đang tải tệp và lưu dự án…</p>}
            {queuedProject && <p role="status">Đã lưu job nháp. <a href={`/sales-video?project=${queuedProject.id}`}>Theo dõi Code Agent và duyệt nội dung</a>. Bạn có thể tiếp tục nhập job khác.</p>}
            {projects.some((project) => project.status === "processing" || project.status === "draft") && <div className="sales-ugc-queue" aria-label="Job UGC đang xử lý">
              <strong>Job đang chạy, chờ duyệt hoặc chờ tạo video</strong>
              {projects.filter((project) => project.status === "processing" || project.status === "draft").slice(0, 5).map((project) => <a key={project.id} href={`/sales-video?project=${project.id}`}>
                <span>{project.title}</span><small>{projectStatusLabel(project)}</small>
              </a>)}
              {projects.filter((project) => project.status === "processing" || project.status === "draft").length > 5 && <small>Và {projects.filter((project) => project.status === "processing" || project.status === "draft").length - 5} job khác…</small>}
            </div>}
            {message && <p className="sales-form-error" role="alert">{message}</p>}
          </div>
          <button type="submit" className="primary-button" disabled={!canSubmit || busy}>{busy ? "Đang thêm job…" : selectedTemplate ? "Thêm job UGC vào hàng đợi" : "Tạo dự án và video"}</button>
        </div>
      </form>
  );
}
