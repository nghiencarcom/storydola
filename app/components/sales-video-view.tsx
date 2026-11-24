"use client";

import { useEffect, useId, useMemo, useRef, useState, useCallback, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type FormEvent } from "react";
import {
  salesVideoDurationOptions, salesVideoProductSegments, salesVideoLanguages, salesVideoWordCount, salesVideoMaxWordCount,
  salesVideoSplitDialogue, salesVideoDialogueToSrt,
  salesVideoMaiVideoModels, salesVideoGatewayVideoModels, salesVideoModelOptions, salesVideoModels, salesVideoProductExamples, salesVideoTextExamples, salesVideoSupportsDialogue,
  salesVideoCreativeTemplates, salesVideoFileTypes, salesVideoFileLimits, salesVideoNameLimit, salesVideoRatios, salesVideoTemplates,
  salesVideoClaimCategories, salesVideoImageTypes, salesVideoMaxProductImages, salesVideoScriptPlaceholder,
  salesVideoHookStyles, salesVideoTargetAudiences, salesVideoPainExamples, salesVideoHeroExamples, salesVideoFlawExamples,
} from "../lib/sales-video-templates";
import { clearSalesVideoDraft, loadSalesVideoDraft, saveSalesVideoDraftFields, saveSalesVideoDraftFile } from "../lib/sales-video-drafts";

import type { VideoGenerationModelOption } from "../lib/project-types";
import { isVideoOffPeakRequired, SALES_VIDEO_GATEWAY_VIDEO_MODEL_OPTIONS } from "../lib/media-generation-settings";
import type { SalesVideoProject } from "../lib/sales-video-storage";
import type { OmniVoiceOption } from "../lib/omnivoice";
import { voiceLanguageLabel } from "../lib/omnivoice";
import { SalesVideoTemplateArtwork } from "./sales-video-template-artwork";
import { Icon } from "./ui-icon";

type Access = { maiVideo: boolean; seedanceGateway: boolean; pixverse: boolean; voice: boolean; draftKey: string; codingAgent: { id: string; label: string; model: string; saved: boolean } | null };
type SalesVideoLibraryImage = { id: string; name: string; fileName: string; previewUrl: string; source: string };
type ManualUgcPromptSegment = {
  start: number; duration: number; prompt: string;
  video_overlays?: Array<{ start: number; end: number; text: string; position?: "top" | "center" | "bottom" }>;
};
type ManualUgcJobData = {
  segments: ManualUgcPromptSegment[];
  script: string;
};
type SalesVideoReviewAction = { disabled: boolean; busy: boolean; activate: () => void };
const labels = { processing: "Đang xử lý", draft: "Chờ bạn duyệt", ready: "Hoàn tất", failed: "Thất bại" };
function projectStatusLabel(project: SalesVideoProject) {
  if (project.details?.voiceRegeneration?.status === "processing") return "Đang tạo lại voice";
  if (project.status !== "processing") return labels[project.status];
  return project.phase === "writing" ? "Code Agent đang soạn" : "Model đang tạo video";
}
function isSalesVideoProjectBusy(project: SalesVideoProject) {
  return project.status === "processing" || project.details?.voiceRegeneration?.status === "processing";
}
const salesVideoProductFields = [
  { name: "presenter", label: "Ảnh nhân vật", kind: "image" },
] as const;
const salesVideoProductImageFieldNames = Array.from({ length: salesVideoMaxProductImages }, (_, index) => `product-image-${index + 1}`);

function imageFilesFromTransfer(transfer: DataTransfer) {
  const transferredFiles = Array.from(transfer.files);
  const files = transferredFiles.length ? transferredFiles : Array.from(transfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  return files.filter((file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|avif)$/i.test(file.name));
}

function useImageDropPaste(onFiles: (files: File[]) => void, disabled = false) {
  const [isDragActive, setIsDragActive] = useState(false);
  const onDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (disabled || !Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setIsDragActive(true);
  };
  const onDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (disabled || !Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  };
  const onDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragActive(false);
  };
  const onDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    if (disabled) return;
    const files = imageFilesFromTransfer(event.dataTransfer);
    if (files.length) onFiles(files);
  };
  const onPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    if (disabled) return;
    const files = imageFilesFromTransfer(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    onFiles(files);
  };
  return { isDragActive, onDragEnter, onDragOver, onDragLeave, onDrop, onPaste };
}

function isAllowedSalesVideoImage(file: File) {
  return salesVideoImageTypes.includes(file.type) || /\.(jpe?g|png|webp|avif)$/i.test(file.name);
}

function ProductImagesInput({ mainFile, additionalFiles, maxCount, onMainFileChange, onMainFilesDrop, onAdditionalFilesChange, disabled }: {
  mainFile?: File;
  additionalFiles: File[];
  maxCount: number;
  onMainFileChange: (file?: File) => void;
  onMainFilesDrop: (files: File[]) => void;
  onAdditionalFilesChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const mainInputRef = useRef<HTMLInputElement>(null);
  const additionalInputRef = useRef<HTMLInputElement>(null);
  const mainDrop = useImageDropPaste(onMainFilesDrop, disabled || maxCount < 1);
  const additionalDrop = useImageDropPaste((files) => onAdditionalFilesChange([...additionalFiles, ...files]), disabled || maxCount < 2);
  const { isDragActive: mainDropActive, ...mainDropHandlers } = mainDrop;
  const { isDragActive: additionalDropActive, ...additionalDropHandlers } = additionalDrop;
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
      <section {...mainDropHandlers} className={`sales-product-primary-reference sales-image-drop-target${mainDropActive ? " is-drop-active" : ""}`} aria-label="Ảnh sản phẩm chính — kéo thả hoặc dán ảnh" role="group" tabIndex={disabled ? -1 : 0}
        onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) event.currentTarget.focus(); }}>
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
              Upload ảnh
            </button>
            {mainFile && <button type="button" className="secondary-button compact" onClick={() => onMainFileChange(undefined)} disabled={disabled}>Xóa ảnh</button>}
            <small className="sales-image-drop-hint">Kéo thả hoặc dán ảnh vào đây · ⌘V / Ctrl+V</small>
          </div>
        </div>
      </section>
      <div className="sales-product-reference-title sales-product-secondary-title">
        <strong>Ảnh phụ <em>Tùy chọn</em></strong><span>{additionalFiles.length}/{Math.max(0, maxCount - 1)}</span>
      </div>
      <section {...additionalDropHandlers} className={`sales-product-secondary-references sales-image-drop-target${additionalDropActive ? " is-drop-active" : ""}`} aria-label="Ảnh phụ — kéo thả hoặc dán để thêm ảnh" role="group" tabIndex={disabled ? -1 : 0}
        onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) event.currentTarget.focus(); }}>
        {additionalFiles.length > 0 && <div className="sales-product-image-grid">
          {additionalFiles.map((file, index) => <figure key={`${file.name}-${index}`}>
            {additionalPreviews[index] && <img src={additionalPreviews[index]} alt={`Ảnh tham khảo phụ ${index + 1}`} />}
            <button type="button" className="secondary-button compact sales-product-image-remove" onClick={() => onAdditionalFilesChange(additionalFiles.filter((_, item) => item !== index))} disabled={disabled} title={`Xóa ảnh phụ ${index + 1}`} aria-label={`Xóa ảnh tham khảo phụ ${index + 1}`}>
              <Icon name="close" size={13} />
            </button>
          </figure>)}
        </div>}
        <div className="sales-pose-image-actions">
          <input ref={additionalInputRef} type="file" accept={salesVideoFileTypes.image} multiple hidden aria-label="Chọn ảnh tham khảo phụ cho sản phẩm"
            onChange={(event) => {
              onAdditionalFilesChange([...additionalFiles, ...Array.from(event.currentTarget.files || [])]);
              event.currentTarget.value = "";
            }} />
          <button type="button" className="secondary-button compact" onClick={() => additionalInputRef.current?.click()} disabled={disabled || maxCount < 2}>
            Upload ảnh
          </button>
          {additionalFiles.length > 0 && <button type="button" className="secondary-button compact" onClick={() => onAdditionalFilesChange([])} disabled={disabled}>Xóa tất cả</button>}
          <small className="sales-image-drop-hint">Kéo thả hoặc dán ảnh vào đây để thêm ảnh phụ · ⌘V / Ctrl+V</small>
        </div>
      </section>
    </div>
    {maxCount < 1 ? <small className="sales-product-image-help">Model hiện tại không nhận ảnh tham chiếu.</small>
      : <small className="sales-product-image-help">JPG, PNG, WebP hoặc AVIF · tối đa {salesVideoFileLimits.image / 1024 ** 2} MB/ảnh · tổng 100 MB.</small>}
  </div>;
}

function MediaInput({ name, label, kind, example, file, onFileChange, disabled }: {
  name: string;
  label: string;
  kind: keyof typeof salesVideoFileTypes;
  example: string;
  file?: File;
  onFileChange: (name: string, file?: File, kind?: keyof typeof salesVideoFileTypes) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const imageDrop = useImageDropPaste((selected) => onFileChange(name, selected[0], kind), kind !== "image" || disabled);
  const { isDragActive: imageDropActive, ...imageDropHandlers } = imageDrop;
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
        onChange={(event) => onFileChange(name, event.currentTarget.files?.[0], kind)} />
      <div {...imageDropHandlers} className={`sales-image-input-row sales-image-drop-target${preview ? " has-image" : ""}${imageDropActive ? " is-drop-active" : ""}`} role="group" aria-label={`${label} — kéo thả hoặc dán ảnh`} tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined}
        onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) event.currentTarget.focus(); }}>
        {preview ? <img className="sales-image-input-preview" src={preview} alt={label} /> : <span className="sales-image-input-empty" aria-hidden="true">Ảnh</span>}
        <div className="sales-image-input-copy">
          <strong title={file?.name}>{file?.name || "Chưa chọn ảnh"}</strong>
          <small>{file ? "Ảnh đã sẵn sàng" : `JPG, PNG, WebP hoặc AVIF · tối đa ${salesVideoFileLimits[kind] / 1024 ** 2} MB`}</small>
        </div>
        <div className="sales-image-input-actions">
          <button type="button" className="secondary-button compact" onClick={() => inputRef.current?.click()}>Upload ảnh</button>
          {file && <button type="button" className="secondary-button compact" onClick={() => onFileChange(name, undefined, kind)}>Xóa</button>}
          <small className="sales-image-drop-hint">Kéo thả hoặc dán ảnh vào đây · ⌘V / Ctrl+V</small>
        </div>
      </div>
    </> : <>
      <input ref={inputRef} id={id} name={name} type="file" accept={salesVideoFileTypes[kind]} aria-required="true"
        onChange={(event) => onFileChange(name, event.currentTarget.files?.[0], kind)} />
      <small>Ví dụ {example} · tối đa {salesVideoFileLimits[kind] / 1024 ** 2} MB.</small>
      {file && <button type="button" className="secondary-button compact" onClick={() => onFileChange(name, undefined, kind)}>Xoá tệp đã chọn</button>}
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

type SalesVideoRoute = { templateId?: string; projectId?: string; similarProjectId?: string };

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
  const similarProjectId = params.get("similar") || "";
  if (projectId || templateId || similarProjectId) return { projectId, templateId, similarProjectId };
  const legacyHash = window.location.hash.slice(1);
  if (legacyHash === "new") return {};
  if (/^[a-f0-9-]{36}$/i.test(legacyHash)) return { projectId: legacyHash };
  return {};
}

export function SalesVideoView() {
  const [route, setRoute] = useState<SalesVideoRoute>({});
  const [projects, setProjects] = useState<SalesVideoProject[] | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [catalog, setCatalog] = useState<VideoGenerationModelOption[]>(SALES_VIDEO_GATEWAY_VIDEO_MODEL_OPTIONS);
  const [error, setError] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [deleteTargets, setDeleteTargets] = useState<SalesVideoProject[]>([]);
  const [deleteError, setDeleteError] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deletingProjects, setDeletingProjects] = useState(false);
  const [reviewAction, setReviewAction] = useState<SalesVideoReviewAction | null>(null);

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
      if (response.ok) {
        const data = await response.json() as { videoModels?: VideoGenerationModelOption[] };
        const models = Array.isArray(data.videoModels) ? data.videoModels : [];
        const modelKeys = new Set(models.map((model) => `${model.provider || "maivideo"}:${model.id}`));
        setCatalog([...models, ...SALES_VIDEO_GATEWAY_VIDEO_MODEL_OPTIONS.filter((model) => !modelKeys.has(`${model.provider}:${model.id}`))]);
      }
    }).catch(() => {});
    return () => {
      controller.abort();
      window.removeEventListener("popstate", navigate);
      window.removeEventListener("hashchange", navigate);
    };
  }, [refresh]);

  const pending = projects?.some(isSalesVideoProjectBusy) ?? false;
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
    const deletableIds = new Set(projects.filter((project) => !isSalesVideoProjectBusy(project)).map((project) => project.id));
    setSelectedProjectIds((current) => {
      const next = new Set([...current].filter((id) => deletableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [projects]);

  const selected = projects?.find((project) => project.id === route.projectId);
  const similarProject = route.similarProjectId ? projects?.find((project) => project.id === route.similarProjectId) : undefined;
  const selectedProductTemplate = salesVideoTemplates.find(({ id }) => id === selected?.details?.templateId)
    || salesVideoTemplates.find(({ name }) => name === selected?.template);
  const videoUrl = selected ? `/api/sales-video/${selected.id}` : "";
  const selectedVideoModelId = selected?.details?.videoModelId || "";
  const selectedPromptMaxLength = selected?.details?.promptMaxLength
    || catalog.find((model) => model.id === selectedVideoModelId || `maivideo:${model.id}` === selectedVideoModelId)?.promptMaxLength
    || (selectedVideoModelId === "higgsfield" ? 10_000 : 5_000);
  const activeTemplateId = route.templateId || "";
  const validTemplate = salesVideoTemplates.some(({ id }) => id === activeTemplateId)
    || salesVideoCreativeTemplates.some(({ id }) => id === activeTemplateId);
  const showComposer = !route.projectId && Boolean(activeTemplateId) && validTemplate
    && (!route.similarProjectId || Boolean(similarProject));
  const showGallery = !route.projectId && !route.similarProjectId && !showComposer;

  function openTemplate(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    url.searchParams.delete("similar");
    url.searchParams.set("template", id);
    url.hash = "";
    window.history.pushState(null, "", url);
    setRoute({ templateId: id });
  }

  function showTemplateGallery() {
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    url.searchParams.delete("template");
    url.searchParams.delete("similar");
    url.hash = "";
    window.history.pushState(null, "", url);
    setRoute({});
  }

  function showProject(projectId: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete("template");
    url.searchParams.delete("similar");
    url.searchParams.set("project", projectId);
    url.hash = "";
    window.history.pushState(null, "", url);
    setRoute({ projectId });
  }

  function showSimilarProject(project: SalesVideoProject, templateId: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    url.searchParams.set("template", templateId);
    url.searchParams.set("similar", project.id);
    url.hash = "";
    window.history.pushState(null, "", url);
    setRoute({ templateId, similarProjectId: project.id });
  }

  const deletableProjects = (projects || []).filter((project) => !isSalesVideoProjectBusy(project));
  const selectedProjects = (projects || []).filter((project) => selectedProjectIds.has(project.id));
  const deletableSelectedProjects = selectedProjects.filter((project) => !isSalesVideoProjectBusy(project));
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
      {route.projectId && <div className="sales-video-page-heading-actions">
        {selected?.status === "draft" && selected.phase === "review" && <button type="button" className="primary-button"
          onClick={() => reviewAction?.activate()} disabled={!reviewAction || reviewAction.disabled} aria-busy={reviewAction?.busy || false}>
          {reviewAction?.busy ? "Đang tạo video…" : "Tạo Video"}
        </button>}
        {selected && selectedProductTemplate && <button type="button" className="secondary-button"
          onClick={() => showSimilarProject(selected, selectedProductTemplate.id)}
          disabled={selected.status === "processing"}>
          Làm tương tự
        </button>}
        <a className="primary-button" href="/sales-video#sales-template-gallery">Tạo project mới</a>
      </div>}
    </section>
    {error && <p role="alert">{error} <button className="secondary-button" onClick={() => void refresh()}>Tải lại</button></p>}
    {route.similarProjectId && !projects && <p role="status">Đang tải dữ liệu project gốc…</p>}
    {route.similarProjectId && projects && !similarProject && <p role="status">Không tìm thấy project gốc để làm tương tự. <button type="button" className="secondary-button" onClick={showTemplateGallery}>Chọn mẫu khác</button></p>}
    {showComposer && <SalesVideoComposer key={`${activeTemplateId}:${similarProject?.id || "new"}`} initialTemplateId={activeTemplateId} access={access} catalog={catalog} projects={projects || []} similarProject={similarProject}
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
            const selectedProject = selectedProjectIds.has(project.id);
            return <article key={project.id} className={`panel-card sales-project-card${selectedProject ? " is-selected" : ""}`}>
              <label className="sales-project-select">
                <input type="checkbox" checked={selectedProject} disabled={deletingProjects || isSalesVideoProjectBusy(project)} onChange={() => toggleProjectSelection(project.id)} aria-label={`Chọn dự án ${project.title}`} />
              </label>
              <a href={`/sales-video?project=${project.id}`} onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault(); showProject(project.id);
              }} className="sales-project-card-link">
                <div className="sales-project-card-copy">
                  <div className="sales-project-card-heading">
                    <strong>{project.title}</strong>
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
        maiVideoConfigured={Boolean(access?.maiVideo)}
        onReviewActionChange={setReviewAction}
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

function SalesVideoProjectDetail({ project, videoUrl, promptMaxLength, maiVideoConfigured, onReviewActionChange, onUpdated }: {
  project: SalesVideoProject;
  videoUrl: string;
  promptMaxLength: number;
  maiVideoConfigured: boolean;
  onReviewActionChange: (action: SalesVideoReviewAction | null) => void;
  onUpdated: (project: SalesVideoProject) => void;
}) {
  const details = project.details;
  const [promptSegments, setPromptSegments] = useState(() => initialReviewPromptSegments(details));
  const [scriptSegments, setScriptSegments] = useState(() => initialReviewScriptSegments(details));
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [generating, setGenerating] = useState(false);
  const [retryingClip, setRetryingClip] = useState<number | null>(null);
  const [stitching, setStitching] = useState(false);
  const [error, setError] = useState("");
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceSubmitting, setVoiceSubmitting] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceOptions, setVoiceOptions] = useState<OmniVoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<Promise<void> | null>(null);
  const duration = details?.duration || 15;
  const language = details?.language || "Tiếng Việt";
  const voiceJob = details?.voiceRegeneration;
  const videoRevision = voiceJob?.updatedAt || project.createdAt;
  const finalVideoUrl = `${videoUrl}?v=${encodeURIComponent(videoRevision)}`;
  const postProcessingSummary = [
    project.postProcessing?.textOverlay?.cues?.length ? `Text/Emoji từ ${project.postProcessing.textOverlay.cues.length} cue Video overlay` : "",
    project.postProcessing?.movingWatermark?.enabled ? `watermark di chuyển “${project.postProcessing.movingWatermark.text}”` : "",
    project.postProcessing?.logo?.enabled ? "logo" : "",
  ].filter(Boolean).join(" · ");
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
  const videoSegments = details?.promptSegments?.length
    ? details.promptSegments
    : details?.generatedSegments?.length
      ? details.generatedSegments
      : details?.prompt
        ? [{ start: 0, duration, prompt: details.prompt }]
        : [];
  const videoSegmentResults = videoSegments.map((segment, index) => details?.segmentResults?.[index] || {
    start: segment.start,
    duration: segment.duration,
    status: project.status === "ready" ? "ready" as const : "pending" as const,
    error: undefined,
  });
  const allClipsReady = videoSegmentResults.length > 0 && videoSegmentResults.every((segment) => segment.status === "ready");
  const canRegenerateClips = Boolean(details?.references?.presenter) && (project.status === "ready" || project.status === "failed")
    && voiceJob?.status !== "processing";

  async function openVoiceDialog() {
    setVoiceDialogOpen(true);
    setVoiceError("");
    if (voiceOptions.length) return;
    setVoiceLoading(true);
    try {
      const response = await fetch("/api/omnivoice/voices", { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(result?.voices)) throw new Error(result?.message || "Không tải được danh sách voice MaiVideo.");
      const loaded = result.voices as OmniVoiceOption[];
      setVoiceOptions(loaded);
      const languageCode = /việt|vietnam/i.test(language) ? "vi"
        : /english|tiếng anh/i.test(language) ? "en"
          : /thái|thai/i.test(language) ? "th"
            : /nhật|japanese/i.test(language) ? "ja"
              : /hàn|korean/i.test(language) ? "ko"
                : /trung|chinese/i.test(language) ? "zh"
                  : /pháp|french/i.test(language) ? "fr"
                    : /đức|german/i.test(language) ? "de"
                      : /tây ban nha|spanish/i.test(language) ? "es" : "";
      const defaultVoice = loaded.find((voice) => voice.id === voiceJob?.voiceId)
        || loaded.find((voice) => voice.language.toLowerCase().replace(/_/g, "-").split("-")[0] === languageCode)
        || loaded[0];
      setVoiceId(defaultVoice?.id || "");
    } catch (cause) {
      setVoiceError(cause instanceof Error ? cause.message : "Không tải được danh sách voice MaiVideo.");
    } finally {
      setVoiceLoading(false);
    }
  }

  async function regenerateVoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!voiceId || voiceSubmitting) return;
    setVoiceSubmitting(true);
    setVoiceError("");
    try {
      const response = await fetch(`/api/sales-video/${project.id}/voice`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voiceId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.project?.id) throw new Error(result?.message || "Không gửi được yêu cầu tạo voice.");
      setVoiceDialogOpen(false);
      onUpdated(result.project as SalesVideoProject);
    } catch (cause) {
      setVoiceError(cause instanceof Error ? cause.message : "Không gửi được yêu cầu tạo voice.");
    } finally {
      setVoiceSubmitting(false);
    }
  }

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

  const generate = useCallback(async () => {
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
  }, [generating, tooLong, persist, promptSegments, scriptSegments, script, onUpdated]);

  async function regenerateClip(index: number) {
    if (!canRegenerateClips || retryingClip !== null || stitching) return;
    setRetryingClip(index);
    setError("");
    try {
      const response = await fetch(`/api/sales-video/ugc/${project.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retrySegmentIndex: index }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.project?.id) throw new Error(result?.message || "Không gửi được yêu cầu tạo lại clip.");
      onUpdated(result.project as SalesVideoProject);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không gửi được yêu cầu tạo lại clip.");
    } finally {
      setRetryingClip(null);
    }
  }

  async function restitchVideo() {
    if (!allClipsReady || stitching || retryingClip !== null || voiceJob?.status === "processing") return;
    setStitching(true);
    setError("");
    try {
      const response = await fetch(`/api/sales-video/ugc/${project.id}/stitch`, { method: "POST" });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.project?.id) throw new Error(result?.message || "Không ghép lại được video.");
      onUpdated(result.project as SalesVideoProject);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không ghép lại được video.");
    } finally {
      setStitching(false);
    }
  }

  useEffect(() => {
    if (project.status === "draft" && project.phase === "review" && details) {
      onReviewActionChange({
        disabled: generating || saveState === "error" || tooLong || !promptsReady,
        busy: generating,
        activate: () => { void generate(); },
      });
    } else {
      onReviewActionChange(null);
    }
  }, [details, generate, generating, onReviewActionChange, project.phase, project.status, promptsReady, saveState, tooLong]);

  useEffect(() => () => onReviewActionChange(null), [onReviewActionChange]);

  return <section className="form-section panel-card sales-project-detail">
    <div className="sales-project-status-row">
      <span className={`sales-project-status is-${project.status}`} role="status">{projectStatusLabel(project)}</span>
      <span>{[project.template, project.model, `${duration} giây`, details?.ratio].filter(Boolean).join(" · ")}</span>
      <a className="secondary-button compact" href="/sales-video#sales-template-gallery">Tạo job khác</a>
    </div>
    {project.error && <p role="alert">{project.error}</p>}
    {postProcessingSummary && <p className="sales-project-post-processing-note">Hậu kỳ FFmpeg: {postProcessingSummary}.</p>}
    {voiceJob?.status === "processing" && <p className="sales-project-post-processing-note" role="status">Đang tạo voice {voiceJob.voiceName} từ SRT; video và các lớp FFmpeg sẽ được giữ nguyên.</p>}
    {voiceJob?.status === "ready" && <p className="sales-project-post-processing-note" role="status">Đã tạo lại voice bằng MaiVideo · {voiceJob.voiceName}.</p>}
    {voiceJob?.status === "failed" && <p className="sales-form-error" role="alert">Tạo lại voice thất bại: {voiceJob.error || "Hãy thử lại."}</p>}
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
    </div>}
    {project.status === "ready" && <section className="sales-project-stitched-video">
      <div className="sales-project-video-heading"><div><h2>Video đã ghép</h2><p>Bản video đầy đủ sau khi ghép các clip.</p></div>
        <div className="sales-project-video-actions">
          <a className="secondary-button compact" href={`${videoUrl}?download=1&v=${encodeURIComponent(videoRevision)}`}>Tải MP4</a>
          {details?.audio && details.subtitleSrt && <button type="button" className="secondary-button compact" onClick={() => void openVoiceDialog()}
            disabled={!maiVideoConfigured || voiceJob?.status === "processing" || stitching || !details.subtitleSrt.trim()}
            title={!maiVideoConfigured ? "Cấu hình MaiVideo API key trong Cài đặt để tạo lại voice." : undefined}>
            {voiceJob?.status === "processing" ? "Đang tạo voice…" : voiceJob?.status === "failed" ? "Thử tạo lại voice" : "Tạo lại voice"}
          </button>}
        </div>
      </div>
      <video className="sales-project-final-video" key={finalVideoUrl} controls playsInline preload="metadata" src={finalVideoUrl} />
    </section>}
    {project.status !== "draft" && videoSegments.length > 0 && <section className="sales-project-clips">
      <div className="sales-project-video-heading"><div><h2>Các clip 15 giây</h2><p>Mỗi clip có thể xem riêng và tạo lại khi cần.</p></div>
        {details?.needsStitching && <button type="button" className="primary-button" onClick={() => void restitchVideo()} disabled={!allClipsReady || stitching || retryingClip !== null || project.status === "processing" || voiceJob?.status === "processing"}>
          {stitching ? "Đang ghép video…" : "Ghép video lại"}
        </button>}
      </div>
      {details?.needsStitching && !allClipsReady && <small className="sales-project-stitch-hint">Hãy tạo xong tất cả clip trước khi ghép lại.</small>}
      <div className="sales-project-clips-grid">
        {videoSegments.map((segment, index) => {
          const result = videoSegmentResults[index];
          const clipUrl = `/api/sales-video/${project.id}/segments/${index}`;
          const statusLabel = result.status === "ready" ? "Đã tạo" : result.status === "processing" ? "Đang tạo lại" : result.status === "failed" ? "Tạo thất bại" : "Chưa tạo";
          return <article className="sales-project-clip" key={`${segment.start}-${index}`}>
            <div className="sales-project-clip-heading"><strong>Clip {index + 1} · giây {segment.start}–{segment.start + segment.duration}</strong><span className={`sales-project-clip-status is-${result.status}`}>{statusLabel}</span></div>
            {result.status === "ready" ? <>
              <video controls playsInline preload="metadata" src={clipUrl} />
              {result.error && <p className="sales-project-clip-message" role="status">{result.error}</p>}
              <a className="secondary-button compact" href={`${clipUrl}?download=1`}>Tải clip {index + 1}</a>
            </> : <p className="sales-project-clip-message">{result.error || (result.status === "processing" ? "Model đang tạo lại clip này." : result.status === "failed" ? "Clip này chưa tạo thành công." : project.status === "processing" ? "Clip đang chờ lượt tạo." : "Chưa có file clip.")}</p>}
            {canRegenerateClips && result.status !== "processing" && <button type="button" className="secondary-button" onClick={() => void regenerateClip(index)} disabled={retryingClip !== null || stitching || voiceJob?.status === "processing"}>
              {retryingClip === index ? "Đang gửi…" : "Tạo lại clip 15s"}
            </button>}
          </article>;
        })}
      </div>
      {error && <p role="alert" className="sales-form-error">{error}</p>}
    </section>}
    {project.status === "ready" && <>
      {project.postProcessing?.textOverlay?.cues?.length ? <details className="sales-project-output-details">
        <summary>Video overlay được chèn bằng FFmpeg</summary>
        <ol className="sales-project-overlay-cues">{project.postProcessing.textOverlay.cues.map((cue, index) => <li key={`${cue.start}-${index}`}>
          <span>{cue.start.toFixed(1)}–{cue.end.toFixed(1)}s</span><strong>{cue.text}</strong><small>{cue.position || "bottom"}</small>
        </li>)}</ol>
      </details> : null}
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
    {voiceDialogOpen && <div className="sales-video-voice-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !voiceSubmitting) setVoiceDialogOpen(false); }}>
      <form className="sales-video-voice-dialog" role="dialog" aria-modal="true" aria-labelledby="sales-video-voice-title" onSubmit={(event) => void regenerateVoice(event)}>
        <header><div><span className="section-kicker">MAIVIDEO · SRT TO AUDIO</span><h2 id="sales-video-voice-title">Tạo lại voice</h2></div>
          <button type="button" aria-label="Đóng" onClick={() => setVoiceDialogOpen(false)} disabled={voiceSubmitting}>×</button></header>
        <p>Tạo giọng đọc mới từ phụ đề SRT hiện có, thay audio trong MP4 và giữ nguyên hình ảnh, Text/Emoji, watermark, logo.</p>
        <label className="form-field"><span>Giọng đọc</span>
          <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} disabled={voiceLoading || voiceSubmitting || !voiceOptions.length}>
            {voiceLoading ? <option value="">Đang tải danh sách giọng…</option>
              : voiceOptions.length ? voiceOptions.map((voice) => <option key={voice.id} value={voice.id}>
                {voice.name} · {voiceLanguageLabel(voice.language)}{voice.gender ? ` · ${voice.gender}` : ""}
              </option>) : <option value="">Không có giọng khả dụng</option>}
          </select>
        </label>
        {!maiVideoConfigured && <small>Cấu hình MaiVideo API key trong Cài đặt trước khi tạo lại voice.</small>}
        {voiceError && <p role="alert" className="sales-form-error">{voiceError}</p>}
        <footer><button type="button" className="secondary-button" onClick={() => setVoiceDialogOpen(false)} disabled={voiceSubmitting}>Hủy</button>
          <button type="submit" className="primary-button" disabled={!maiVideoConfigured || voiceLoading || voiceSubmitting || !voiceId}>
            {voiceSubmitting ? "Đang gửi…" : "Tạo voice từ SRT"}
          </button></footer>
      </form>
    </div>}
  </section>;
}

function SalesVideoComposer({ initialTemplateId, access, catalog, projects, similarProject, onChangeTemplate, onCreated }: {
  initialTemplateId: string;
  access: Access | null;
  catalog: VideoGenerationModelOption[];
  projects: SalesVideoProject[];
  similarProject?: SalesVideoProject;
  onChangeTemplate: () => void;
  onCreated: (project: SalesVideoProject) => void;
}) {
  const templateId = initialTemplateId;
  const selectedTemplate = salesVideoTemplates.find(({ id }) => id === templateId);
  const creative = salesVideoCreativeTemplates.find(({ id }) => id === templateId);
  const mediaFields = creative?.files ?? salesVideoProductFields;
  const mediaFieldNames = useMemo(() => creative ? mediaFields.map(({ name }) => name) : ["presenter", "image", ...salesVideoProductImageFieldNames, "watermarkLogo"], [creative, mediaFields]);
  const poseImageFields = creative && (creative.workflow === "poses" || creative.workflow === "narration")
    ? creative.files.filter((field) => field.kind === "image")
    : [];
  const draftOwner = access?.draftKey || "";
  const draftTemplateId = similarProject ? `${templateId}:similar:${similarProject.id}` : templateId;
  const [selectedModel, setModel] = useState("");
  const [ratio, setRatio] = useState<string>(salesVideoRatios[0]);
  const [prompt, setPrompt] = useState("");
  const [product, setProduct] = useState("");
  const [facts, setFacts] = useState("");
  const [painPoint, setPainPoint] = useState("");
  const [heroBenefit, setHeroBenefit] = useState("");
  const [minorFlaw, setMinorFlaw] = useState("");
  const [productAnalysisBusy, setProductAnalysisBusy] = useState(false);
  const [productAnalysisMessage, setProductAnalysisMessage] = useState("");
  const [productAnalysisError, setProductAnalysisError] = useState("");
  const [targetAudience, setTargetAudience] = useState<string>(salesVideoTargetAudiences[0].id);
  const [hookStyle, setHookStyle] = useState<string>(salesVideoHookStyles[0].id);
  const [userExperience, setUserExperience] = useState("");
  const [script, setScript] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [postProcessTextOverlayEnabled, setPostProcessTextOverlayEnabled] = useState(false);
  const [postProcessMovingWatermarkEnabled, setPostProcessMovingWatermarkEnabled] = useState(false);
  const [postProcessWatermarkText, setPostProcessWatermarkText] = useState("StoryAI");
  const [postProcessLogoEnabled, setPostProcessLogoEnabled] = useState(false);
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
  const [copyStatus, setCopyStatus] = useState("");
  const [manualImportOpen, setManualImportOpen] = useState(false);
  const [manualImportText, setManualImportText] = useState("");
  const [manualImportError, setManualImportError] = useState("");
  const [manualImportStatus, setManualImportStatus] = useState("");
  const [manualUgcJob, setManualUgcJob] = useState<ManualUgcJobData | null>(null);

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

  async function analyzeProductLink() {
    if (productAnalysisBusy || busy || !productUrl.trim()) return;
    setProductAnalysisBusy(true);
    setProductAnalysisMessage("");
    setProductAnalysisError("");
    try {
      const response = await fetch("/api/sales-video/ugc/analyze-product", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ productUrl: productUrl.trim(), product: product.trim(), facts: facts.trim(), templateId }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("Không đọc được phản hồi phân tích.");
      }
      const data = payload as { message?: unknown; suggestions?: unknown };
      if (!response.ok) {
        throw new Error(typeof data.message === "string" ? data.message : "Chưa phân tích được link sản phẩm.");
      }
      if (!data.suggestions || typeof data.suggestions !== "object" || Array.isArray(data.suggestions)) {
        throw new Error("Code Agent chưa trả về đủ gợi ý.");
      }
      const suggestions = data.suggestions as Record<string, unknown>;
      const suggestedPainPoint = typeof suggestions.painPoint === "string" ? suggestions.painPoint.trim().slice(0, 300) : "";
      const suggestedHeroBenefit = typeof suggestions.heroBenefit === "string" ? suggestions.heroBenefit.trim().slice(0, 300) : "";
      const suggestedMinorFlaw = typeof suggestions.minorFlaw === "string" ? suggestions.minorFlaw.trim().slice(0, 300) : "";
      const hasSuggestion = Boolean(suggestedPainPoint || suggestedHeroBenefit || suggestedMinorFlaw);
      if (suggestedPainPoint) setPainPoint((current) => current.trim() ? current : suggestedPainPoint);
      if (suggestedHeroBenefit) setHeroBenefit((current) => current.trim() ? current : suggestedHeroBenefit);
      if (suggestedMinorFlaw) setMinorFlaw((current) => current.trim() ? current : suggestedMinorFlaw);
      setProductAnalysisMessage(hasSuggestion
        ? "Đã phân tích link và điền gợi ý vào các ô còn trống. Nội dung bạn đã nhập được giữ nguyên; nhược điểm chỉ được gợi ý khi trang có căn cứ."
        : "Đã đọc trang nhưng chưa tìm thấy gợi ý đủ căn cứ. Bạn có thể bổ sung thông số sản phẩm hoặc nhập nội dung thủ công.");
    } catch (cause) {
      setProductAnalysisError(cause instanceof Error ? cause.message : "Không phân tích được link sản phẩm.");
    } finally {
      setProductAnalysisBusy(false);
    }
  }

  async function copyManualJobData() {
    try {
      const guideResponse = await fetch("/api/sales-video/ugc", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
      });
      const guideResult: unknown = await guideResponse.json().catch(() => null);
      if (!guideResult || typeof guideResult !== "object" || Array.isArray(guideResult)) {
        throw new Error("Không đọc được nội dung file hướng dẫn UGC.");
      }
      const guideData = guideResult as { sourceFileName?: unknown; format?: unknown; content?: unknown; message?: unknown };
      if (!guideResponse.ok) {
        throw new Error(typeof guideData.message === "string" ? guideData.message : "Không tải được file hướng dẫn UGC.");
      }
      if (typeof guideData.sourceFileName !== "string" || guideData.format !== "text/plain"
        || typeof guideData.content !== "string" || !guideData.content.trim()) {
        throw new Error("File hướng dẫn UGC đang trống hoặc không hợp lệ.");
      }
      if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");

      const targetAudienceLabel = salesVideoTargetAudiences.find(({ id }) => id === targetAudience)?.label || targetAudience;
      const hookStyleLabel = salesVideoHookStyles.find(({ id }) => id === hookStyle)?.label || hookStyle;
      const segmentPlan = salesVideoProductSegments(selectedDuration, model?.modelMeta, videoQuality);
      const payload = {
        schema: "storyai.manual-ugc-job.v1",
        template: { id: templateId, name: selectedTemplate?.name || "Video review" },
        product: {
          name: product.trim(),
          url: productUrl.trim(),
          verifiedFacts: facts.trim(),
          userExperience: userExperience.trim(),
          customerProblem: painPoint.trim(),
          keyBenefit: heroBenefit.trim(),
          consideration: minorFlaw.trim(),
        },
        creative: {
          claimCategory,
          targetAudience: targetAudienceLabel,
          openingHook: hookStyleLabel,
          script: script.trim(),
          extraInstructions: editableProductPrompt,
        },
        video: {
          modelId: model?.id || selectedModel,
          model: model?.label || "",
          durationSeconds: selectedDuration,
          aspectRatio: ratio,
          dialogueLanguage: language,
          audio: supportsAudio,
          quality: videoQuality,
          segments: segmentPlan.map((segmentDuration, index) => {
            const isFirst = index === 0;
            const isLast = index === segmentPlan.length - 1;
            const hookEnd = Math.min(3, Math.max(1, Math.round(segmentDuration * 0.2)));
            const demoEnd = Math.max(hookEnd, Math.round(segmentDuration * 0.72));
            const flawStart = Math.round(segmentDuration * 0.55);
            const flawEnd = Math.max(flawStart, Math.round(segmentDuration * 0.8));
            const role = segmentPlan.length === 1
              ? `Standalone UGC arc: hook 0–${hookEnd}s, verified product demo ${hookEnd}–${demoEnd}s, soft CTA ${demoEnd}–${segmentDuration}s`
              : isFirst
                ? `The Thumb-Stop Hook & Problem Setup (In Medias Res, 35mm Medium Shot, reveal @Image2 ${hookEnd}–${demoEnd}s, prepare match-cut during final second of this ${segmentDuration}s clip)`
                : isLast
                  ? "Visible Demo Payoff & Soft CTA (warm settled Medium Shot, natural interaction with @Image2, approachable low-friction advice; do not imply unprovided usage/results)"
                  : `Deep-Dive Hands-On Demo (45° Macro Close-Up / POV, tactile interaction with @Image2; if user supplied a real flaw, mention it around ${flawStart}–${flawEnd}s without inventing tests or claims)`;
            return {
              start: segmentPlan.slice(0, index).reduce((sum, value) => sum + value, 0),
              duration: segmentDuration,
              role,
              prompt: "",
            };
          }),
        },
        attachments: {
          presenter: files.presenter?.name || null,
          mainProductImage: mainProductImage?.name || null,
          additionalProductImages: additionalProductImageFiles.map((file) => file.name),
          note: "Tên ảnh tham chiếu chỉ để đối chiếu; ảnh cần được tải lên riêng khi tạo job thủ công.",
        },
      };
      const manualInstructions = [
        "NHIỆM VỤ: Soạn nội dung cho job video review UGC dựa trên dữ liệu JSON và toàn bộ hướng dẫn văn bản thuần bên dưới.",
        "ĐỌC HƯỚNG DẪN: áp dụng đầy đủ phần HƯỚNG DẪN UGC bên dưới và chọn module ngành hàng phù hợp.",
        "GIỮ NGUYÊN: schema, template, toàn bộ product, creative.claimCategory, model, thời lượng, tỷ lệ khung hình, ngôn ngữ, chất lượng và attachments.",
        "CHỈ ĐƯỢC ĐIỀN prompt cho từng clip trong video.segments và creative.script. Không thêm, xóa, sắp xếp lại clip hoặc thay start/duration đã cho.",
        "Viết prompt hình ảnh từng clip bằng tiếng Anh theo cấu trúc 5 khối: [REFERENCE LOCK] -> [CAMERA & FRAMING] -> [ACTION & CHOREOGRAPHY (timecoded)] -> [ENVIRONMENT & LIGHTING] -> [VIDEO OVERLAY TIMELINE & SFX TIMELINE]. Bám sát 'role' phân vai cho từng clip. Viết lời thoại bằng ngôn ngữ đã chọn cho một người dẫn duy nhất. Không tạo thoại hỏi đáp, người hỏi ngoài khung hình hoặc nhãn vai.",
        "TEXT OVERLAY: Trong VIDEO OVERLAY TIMELINE, viết chữ in hoa 2–5 từ kèm 1–2 emoji giật tít, nêu lợi ích tốc độ hoặc đánh nỗi đau (VD: 'QUAY ĐÊM HẠT NHƯ CÁT? 😩', 'BẬT MÁY 1 GIÂY ⚡', 'CỰC ĐẦM TAY! 🏆'). CẤM mô tả lại hành động mắt thấy như 'XOAY MÀN HÌNH', 'CẦM BÌNH', 'MỞ NẮP'.",
        "Chỉ dùng thông tin xác minh và trải nghiệm người dùng có trong dữ liệu job; không bịa thông số, công dụng, giá, ưu đãi, chứng nhận hoặc trải nghiệm.",
        "Trả về duy nhất toàn bộ JSON job hợp lệ, không Markdown, không code fence, không giải thích. Ảnh tham chiếu được tải lên riêng trong StoryAI.",
      ].join("\n");
      const clipboardText = [
        "DỮ LIỆU JOB (JSON)",
        JSON.stringify(payload, null, 2),
        "HƯỚNG DẪN UGC (VĂN BẢN THUẦN)",
        guideData.content,
        "YÊU CẦU CHO AI",
        manualInstructions,
      ].join("\n\n");

      await navigator.clipboard.writeText(clipboardText);
      setMessage("");
      setCopyStatus(`Đã sao chép JSON job kèm hướng dẫn text thuần (${guideData.content.length.toLocaleString("vi-VN")} ký tự, xuống dòng thật). Ảnh tham chiếu tải lên riêng.`);
    } catch (error) {
      setCopyStatus("");
      setMessage(error instanceof Error && error.message !== "CLIPBOARD_UNAVAILABLE"
        ? error.message
        : "Không thể sao chép vào clipboard. Hãy kiểm tra quyền clipboard của trình duyệt.");
    }
  }

  function importManualJobData() {
    setManualImportError("");
    setManualImportStatus("");
    let imported: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(manualImportText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Dán một đối tượng JSON hợp lệ.");
      imported = parsed as Record<string, unknown>;
    } catch (error) {
      setManualImportError(error instanceof Error ? error.message : "JSON không hợp lệ.");
      return;
    }
    if (imported.schema !== "storyai.manual-ugc-job.v1") {
      setManualImportError("Không nhận diện được định dạng. Hãy dùng JSON từ nút “Sao chép JSON + hướng dẫn”.");
      return;
    }
    const importedTemplate = imported.template && typeof imported.template === "object" ? imported.template as Record<string, unknown> : {};
    if (typeof importedTemplate.id === "string" && importedTemplate.id !== templateId) {
      setManualImportError("JSON thuộc mẫu nội dung khác. Hãy mở đúng mẫu rồi nhập lại.");
      return;
    }
    const importedProduct = imported.product && typeof imported.product === "object" ? imported.product as Record<string, unknown> : {};
    const importedCreative = imported.creative && typeof imported.creative === "object" ? imported.creative as Record<string, unknown> : {};
    const importedVideo = imported.video && typeof imported.video === "object" ? imported.video as Record<string, unknown> : {};
    const getString = (source: Record<string, unknown>, key: string) => typeof source[key] === "string" ? source[key] as string : undefined;
    if (getString(importedProduct, "name") !== undefined) setProduct(getString(importedProduct, "name")!);
    if (getString(importedProduct, "url") !== undefined) setProductUrl(getString(importedProduct, "url")!);
    if (getString(importedProduct, "verifiedFacts") !== undefined) setFacts(getString(importedProduct, "verifiedFacts")!);
    if (getString(importedProduct, "userExperience") !== undefined) setUserExperience(getString(importedProduct, "userExperience")!);
    if (getString(importedProduct, "customerProblem") !== undefined) setPainPoint(getString(importedProduct, "customerProblem")!);
    if (getString(importedProduct, "keyBenefit") !== undefined) setHeroBenefit(getString(importedProduct, "keyBenefit")!);
    if (getString(importedProduct, "consideration") !== undefined) setMinorFlaw(getString(importedProduct, "consideration")!);
    if (getString(importedCreative, "script") !== undefined) setScript(getString(importedCreative, "script")!);
    if (getString(importedCreative, "extraInstructions") !== undefined) {
      setProductPromptOverride(getString(importedCreative, "extraInstructions")!);
      setProductPromptEdited(Boolean(getString(importedCreative, "extraInstructions")));
    }
    const importedClaimCategory = getString(importedCreative, "claimCategory");
    if (importedClaimCategory && salesVideoClaimCategories.some((category) => category.id === importedClaimCategory)) setClaimCategory(importedClaimCategory);
    const audience = getString(importedCreative, "targetAudience");
    const audienceOption = salesVideoTargetAudiences.find((item) => item.id === audience || item.label === audience);
    if (audienceOption) setTargetAudience(audienceOption.id);
    const hook = getString(importedCreative, "openingHook");
    const hookOption = salesVideoHookStyles.find((item) => item.id === hook || item.label === hook);
    if (hookOption) setHookStyle(hookOption.id);
    const modelId = getString(importedVideo, "modelId");
    if (modelId) setModel(modelId);
    const importedRatio = getString(importedVideo, "aspectRatio");
    if (importedRatio && salesVideoRatios.includes(importedRatio as typeof salesVideoRatios[number])) setRatio(importedRatio);
    const importedLanguage = getString(importedVideo, "dialogueLanguage");
    if (importedLanguage && salesVideoLanguages.includes(importedLanguage as typeof salesVideoLanguages[number])) setLanguage(importedLanguage);
    if (typeof importedVideo.durationSeconds === "number") setDuration(importedVideo.durationSeconds);

    const videoSegments = Array.isArray(importedVideo.segments) ? importedVideo.segments : [];
    const importedSegments = videoSegments.some((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).prompt === "string" && Boolean((item as Record<string, unknown>).prompt))
      ? videoSegments
      : Array.isArray(imported.segments) ? imported.segments : Array.isArray(imported.promptSegments) ? imported.promptSegments : videoSegments;
    const parsedSegments = importedSegments.flatMap((item): ManualUgcPromptSegment[] => {
      if (!item || typeof item !== "object") return [];
      const segment = item as Record<string, unknown>;
      const overlays = Array.isArray(segment.video_overlays) ? segment.video_overlays.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const cue = item as Record<string, unknown>;
        if (typeof cue.start !== "number" || typeof cue.end !== "number" || typeof cue.text !== "string" || !cue.text.trim()) return [];
        const position: "top" | "center" | "bottom" = cue.position === "top" || cue.position === "center" || cue.position === "bottom" ? cue.position : "bottom";
        return [{ start: cue.start, end: cue.end, text: cue.text.trim(), position }];
      }) : [];
      return Number.isInteger(segment.start) && Number.isInteger(segment.duration) && typeof segment.prompt === "string" && segment.prompt.trim()
        ? [{ start: segment.start as number, duration: segment.duration as number, prompt: segment.prompt.trim(), video_overlays: overlays }]
        : [];
    });
    const importedScript = getString(imported, "script") ?? getString(importedCreative, "script") ?? "";
    setScript(importedScript);
    setManualUgcJob(parsedSegments.length ? { segments: parsedSegments, script: importedScript } : null);
    setMessage("");
    setCopyStatus("");
    setManualImportStatus(parsedSegments.length
      ? "Đã nhập dữ liệu và prompt clip. Ảnh tham chiếu cần tải lên riêng."
      : "Đã nhập thông tin. Để tạo job không cần CLI, hãy bổ sung prompt trong từng video.segments rồi nhập JSON lại.");
    setManualImportOpen(false);
  }

  useEffect(() => {
    let active = true;
    setDraftReady(false);
    setDraftWarning("");

    const applySavedFields = (saved: Awaited<ReturnType<typeof loadSalesVideoDraft>>["fields"]) => {
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
      if (typeof saved.postProcessTextOverlayEnabled === "boolean") setPostProcessTextOverlayEnabled(saved.postProcessTextOverlayEnabled);
      if (typeof saved.postProcessMovingWatermarkEnabled === "boolean") setPostProcessMovingWatermarkEnabled(saved.postProcessMovingWatermarkEnabled);
      if (typeof saved.postProcessWatermarkText === "string") setPostProcessWatermarkText(saved.postProcessWatermarkText);
      if (typeof saved.postProcessLogoEnabled === "boolean") setPostProcessLogoEnabled(saved.postProcessLogoEnabled);
      if (typeof saved.claimCategory === "string" && salesVideoClaimCategories.some(({ id }) => id === saved.claimCategory)) setClaimCategory(saved.claimCategory);
      if (typeof saved.language === "string" && salesVideoLanguages.includes(saved.language as typeof salesVideoLanguages[number])) setLanguage(saved.language);
      if (typeof saved.duration === "number") setDuration(saved.duration);
      if (typeof saved.sourceStart === "string") setSourceStart(saved.sourceStart);
      if (typeof saved.productPromptOverride === "string") setProductPromptOverride(saved.productPromptOverride);
      if (typeof saved.productPromptEdited === "boolean") setProductPromptEdited(saved.productPromptEdited);
    };

    const applySavedDraft = (draft: Awaited<ReturnType<typeof loadSalesVideoDraft>>) => {
      const saved = draft.fields;
      applySavedFields(saved);
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
      if (similarProject) {
        const expectedProductImages = Math.max(1, Math.min(salesVideoMaxProductImages,
          similarProject.details?.productImageCount || similarProject.details?.references?.products?.length || 1));
        if (!restoredFiles.presenter || Array.from({ length: expectedProductImages }, (_, index) => salesVideoProductImageFieldNames[index]).some((name) => !restoredFiles[name])) {
          setDraftWarning("Không khôi phục được một số ảnh tham chiếu. Hãy chọn lại những ảnh còn thiếu trước khi tạo video.");
        }
      }
      setDraftReady(true);
    };

    const restore = async () => {
      if (similarProject) {
        const draft = await loadSalesVideoDraft(draftOwner, draftTemplateId, mediaFieldNames);
        if (!active) return;
        if (Object.keys(draft.fields).length) {
          applySavedDraft(draft);
          return;
        }

        const details = similarProject.details;
        const fallbackClaimCategory = templateId === "supplements" ? "health" : "general";
        setModel(details?.videoModelId || "higgsfield");
        setRatio(salesVideoRatios.find((value) => value === details?.ratio) || salesVideoRatios[0]);
        setProduct(details?.product || similarProject.title || "");
        setFacts(details?.facts || "");
        setPainPoint(details?.painPoint || "");
        setHeroBenefit(details?.heroBenefit || "");
        setMinorFlaw(details?.minorFlaw || "");
        setTargetAudience(salesVideoTargetAudiences.find(({ id }) => id === details?.targetAudience)?.id || salesVideoTargetAudiences[0].id);
        setHookStyle(salesVideoHookStyles.find(({ id }) => id === details?.hookStyle)?.id || salesVideoHookStyles[0].id);
        setUserExperience(details?.userExperience || "");
        setScript(details?.script || "");
        setProductUrl(details?.productUrl || "");
        setPostProcessTextOverlayEnabled(Boolean(similarProject.postProcessing?.textOverlay?.enabled || similarProject.postProcessing?.textOverlay?.cues?.length || similarProject.postProcessing?.textOverlay?.text));
        setPostProcessMovingWatermarkEnabled(Boolean(similarProject.postProcessing?.movingWatermark?.enabled));
        setPostProcessWatermarkText(similarProject.postProcessing?.movingWatermark?.text || "StoryAI");
        setPostProcessLogoEnabled(Boolean(similarProject.postProcessing?.logo?.enabled));
        setClaimCategory(salesVideoClaimCategories.find(({ id }) => id === details?.claimCategory)?.id || fallbackClaimCategory);
        setLanguage(salesVideoLanguages.find((value) => value === details?.language) || salesVideoLanguages[0]);
        setDuration(typeof details?.duration === "number" && Number.isInteger(details.duration) ? details.duration : 15);
        setPrompt("");
        setSourceStart("0");
        setProductPromptOverride("");
        setProductPromptEdited(false);

        const productImageCount = Math.max(1, Math.min(salesVideoMaxProductImages,
          details?.productImageCount || details?.references?.products?.length || 1));
        const referenceRequests: Array<{ field: string; url: string; filename: string }> = [
          { field: "presenter", url: `/api/sales-video/${similarProject.id}/references/presenter`, filename: "presenter.webp" },
          ...Array.from({ length: productImageCount }, (_, index) => ({
            field: salesVideoProductImageFieldNames[index],
            url: `/api/sales-video/${similarProject.id}/references/${index === 0 ? "product" : `product-${index + 1}`}`,
            filename: `product-${index + 1}.webp`,
          })),
        ];
        const imageResults = await Promise.all(referenceRequests.map(async ({ field, url, filename }) => {
          try {
            const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
            if (!response.ok) return { field, file: undefined };
            const blob = await response.blob();
            if (!blob.size) return { field, file: undefined };
            return { field, file: new File([blob], filename, { type: blob.type || "image/webp" }) };
          } catch {
            return { field, file: undefined };
          }
        }));
        if (!active) return;
        const restoredFiles = Object.fromEntries(imageResults.flatMap(({ field, file }) => file ? [[field, file]] : [])) as Record<string, File>;
        setFiles(restoredFiles);
        if (imageResults.some(({ file }) => !file)) {
          setDraftWarning("Không tải lại được một số ảnh tham chiếu. Hãy chọn lại những ảnh còn thiếu trước khi tạo video.");
        }
        if (draftOwner) {
          await Promise.all(referenceRequests.map(({ field }) => saveSalesVideoDraftFile(draftOwner, draftTemplateId, field, restoredFiles[field])));
        }
        if (active) setDraftReady(true);
        return;
      }

      if (!draftOwner) return;
      const draft = await loadSalesVideoDraft(draftOwner, draftTemplateId, mediaFieldNames);
      if (active) applySavedDraft(draft);
    };

    void restore().catch(() => {
      if (!active) return;
      setDraftWarning("Không tải được bản nháp trên thiết bị này.");
      setDraftReady(true);
    });
    return () => { active = false; };
  }, [draftOwner, draftTemplateId, templateId, mediaFieldNames.join("|"), similarProject]);

  useEffect(() => {
    if (!draftReady || !draftOwner || busy) return;
    const timer = window.setTimeout(() => {
      const savedFiles = mediaFieldNames.filter((name) => files[name]);
      void saveSalesVideoDraftFields(draftOwner, draftTemplateId, {
        selectedModel,
        ratio, prompt, product, facts, userExperience,
        painPoint, heroBenefit, minorFlaw, targetAudience, hookStyle,
        script, productUrl,
        postProcessTextOverlayEnabled, postProcessMovingWatermarkEnabled, postProcessWatermarkText, postProcessLogoEnabled,
        claimCategory: selectedTemplate?.id === "supplements" ? "health" : claimCategory, language, duration, sourceStart,
        productPromptOverride, productPromptEdited, savedFiles: JSON.stringify(savedFiles),
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftReady, draftOwner, draftTemplateId, busy, selectedModel, ratio, prompt, product, facts, painPoint, heroBenefit, minorFlaw, targetAudience, hookStyle, userExperience, script, productUrl, postProcessTextOverlayEnabled, postProcessMovingWatermarkEnabled, postProcessWatermarkText, postProcessLogoEnabled, claimCategory, language, duration, sourceStart, productPromptOverride, productPromptEdited, files, mediaFieldNames, mediaFields, selectedTemplate?.id]);

  function updateFile(name: string, file?: File, kind?: keyof typeof salesVideoFileTypes) {
    if (file && kind) {
      if (!file.size) {
        setMessage(`“${file.name || "Ảnh đã dán"}” không có dữ liệu hợp lệ.`);
        return;
      }
      if (kind === "image" && !isAllowedSalesVideoImage(file)) {
        setMessage(`“${file.name || "Ảnh đã dán"}” không phải ảnh JPG, PNG, WebP hoặc AVIF hợp lệ.`);
        return;
      }
      if (file.size > salesVideoFileLimits[kind]) {
        setMessage(`Tệp ${kind === "image" ? "ảnh" : "đã chọn"} tối đa ${salesVideoFileLimits[kind] / 1024 ** 2} MB.`);
        return;
      }
      const otherBytes = Object.entries(files).reduce((total, [existingName, existing]) => total + (existingName === name ? 0 : existing.size), 0);
      if (otherBytes + file.size > 100 * 1024 ** 2) {
        setMessage("Tổng dung lượng tệp không được vượt quá 100 MB.");
        return;
      }
    }
    setFiles((current) => {
      const next = { ...current };
      if (file) next[name] = file;
      else delete next[name];
      return next;
    });
    setMessage("");
    if (draftOwner) void saveSalesVideoDraftFile(draftOwner, draftTemplateId, name, file).then((saved) => {
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
      if (!file.size || !isAllowedSalesVideoImage(file)) {
        setMessage(`“${file.name || "Ảnh đã dán"}” không phải ảnh JPG, PNG, WebP hoặc AVIF hợp lệ.`);
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
    salesVideoProductImageFieldNames.forEach((name, index) => void saveSalesVideoDraftFile(draftOwner, draftTemplateId, name, filesBySlot[index]));
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
      void saveSalesVideoDraftFile(draftOwner, draftTemplateId, field.name, selected[index]).then((saved) => {
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
  const gatewayVideoModels = salesVideoGatewayVideoModels(catalog, creative, ratio, Boolean(selectedTemplate));
  const pixverseReferenceWorkflow = creative?.workflow === "remake" || creative?.workflow === "background";
  const options = [
    ...models.filter((id) => id === "higgsfield").map((id) => ({ id, label: selectedTemplate ? salesVideoModels[id] : `${salesVideoModels[id]} · tối đa 15 giây mỗi clip`, available: true, modelMeta: undefined as VideoGenerationModelOption | undefined })),
    ...gatewayVideoModels.map((item) => {
      const providerLabel = item.provider === "flow" ? "Flow" : "Muse.ai";
      const label = `${item.label.toLowerCase().includes(providerLabel.toLowerCase()) ? item.label : `${item.label} · ${providerLabel}`}${salesVideoSupportsDialogue(item) ? "" : " · không thoại"}`;
      return { id: `${item.provider}:${item.id}`, label, available: Boolean(access?.seedanceGateway), modelMeta: item };
    }),
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
  const selectedDuration = durationOptions.includes(duration) ? duration : durationOptions.reduce(
    (closest, candidate) => Math.abs(candidate - duration) < Math.abs(closest - duration) ? candidate : closest,
    durationOptions[0] ?? 15,
  );
  useEffect(() => {
    if (durationOptions.length && !durationOptions.includes(duration)) setDuration(selectedDuration);
  }, [durationOptions, duration, selectedDuration]);
  const manualSegmentDurations = salesVideoProductSegments(selectedDuration, model?.modelMeta, videoQuality);
  const longVideoPlanLabel = manualSegmentDurations.length > 0 && manualSegmentDurations.every((segmentDuration) => segmentDuration === manualSegmentDurations[0])
    ? `${manualSegmentDurations.length} clip × ${manualSegmentDurations[0]} giây`
    : `${manualSegmentDurations.length} clip (${manualSegmentDurations.join(" + ")} giây)`;
  const manualPromptsReady = Boolean(manualUgcJob && manualUgcJob.segments.length === manualSegmentDurations.length
    && manualUgcJob.segments.every((segment, index) => segment.start === manualSegmentDurations.slice(0, index).reduce((sum, value) => sum + value, 0)
      && segment.duration === manualSegmentDurations[index] && Boolean(segment.prompt.trim())));
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
    && model?.available && durationOptions.length && !scriptTooLong && !productAnalysisBusy
    && (!selectedTemplate || Boolean(access?.codingAgent) || manualPromptsReady) && (creative?.workflow !== "narration" || access?.voice)
    && (!selectedTemplate || !productImagesExceedModelLimit)
    && (!selectedTemplate || !postProcessLogoEnabled || Boolean(files.watermarkLogo?.size))
    && (!selectedTemplate || !postProcessWatermarkText.trim() || postProcessWatermarkText.length <= 48));
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
      form.set("userExperience", userExperience.trim());
      form.set("painPoint", painPoint.trim());
      form.set("heroBenefit", heroBenefit.trim());
      form.set("minorFlaw", minorFlaw.trim());
      form.set("targetAudience", targetAudience);
      form.set("hookStyle", hookStyle);
      form.set("autoUgc", "1");
      form.set("productUrl", productUrl.trim());
      form.set("claimCategory", selectedTemplate.id === "supplements" ? "health" : claimCategory);
      form.set("prompt", "");
      form.set("postProcessTextOverlayEnabled", postProcessTextOverlayEnabled ? "1" : "0");
      form.set("postProcessMovingWatermarkEnabled", postProcessMovingWatermarkEnabled ? "1" : "0");
      form.set("postProcessWatermarkText", postProcessWatermarkText.trim());
      form.set("postProcessLogoEnabled", postProcessLogoEnabled ? "1" : "0");
      if (postProcessLogoEnabled && files.watermarkLogo) form.set("postProcessLogo", files.watermarkLogo, files.watermarkLogo.name);
      else form.delete("postProcessLogo");
      if (manualPromptsReady && manualUgcJob) {
        form.set("manualDraft", JSON.stringify({ segments: manualUgcJob.segments, script: manualUgcJob.script || script }));
      }
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
      totalFileBytes = presenter.size + productImageFiles.reduce((total, file) => total + file.size, 0)
        + (postProcessLogoEnabled ? files.watermarkLogo?.size || 0 : 0);
      if (postProcessLogoEnabled && !files.watermarkLogo?.size) {
        setMessage("Chọn ảnh logo để chèn vào video.");
        return;
      }
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
      if (!selectedTemplate) await clearSalesVideoDraft(draftOwner, draftTemplateId, mediaFieldNames);
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
            {creative ? <div key={creative.id} className="form-grid full">
              <div className="sales-form-step full"><span>01</span><div><strong>Tệp đầu vào</strong></div></div>
              {poseImageFields.length ? <>
                <PoseImagesInput fields={poseImageFields} files={files} onFilesChange={handlePoseFilesChange}
                  onOpenLibrary={() => void openMediaLibrary()} disabled={libraryActionBusy} />
                {creative.files.filter((field) => field.kind !== "image").map((field) => <MediaInput key={field.name} {...field} file={files[field.name]} onFileChange={updateFile} disabled={busy || !draftReady}
                  example={mediaExample(field.name, field.kind, false)} />)}
              </> : creative.files.map((field) => <MediaInput key={field.name} {...field} file={files[field.name]} onFileChange={updateFile}
                disabled={busy || !draftReady} example={creative.workflow === "remake" && field.kind === "video" ? "cảnh quảng cáo quay gần, một người, ít cắt cảnh. Video phải đủ dài cho đoạn được chọn." : mediaExample(field.name, field.kind, false)} />)}
              {creative.text && <div className="form-field full">
                <label htmlFor="sales-video-prompt">{creative.text}{creative.defaultText ? <em>Không bắt buộc</em> : null}</label>
                <textarea id="sales-video-prompt" name="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)}
                  placeholder={creative.defaultText || example} maxLength={salesVideoNameLimit} required={!creative.defaultText} />
                {example && <div><button type="button" className="secondary-button" onClick={() => setPrompt(example)}>Dùng ví dụ</button></div>}
              </div>}
            </div> : <>
              <div className="sales-form-step full"><span>01</span><div><strong>Ảnh tham chiếu</strong></div></div>
              <div className="sales-reference-assets-layout full">
                <MediaInput name="presenter" kind="image" label="Ảnh nhân vật" file={files.presenter} onFileChange={updateFile} disabled={busy || !draftReady}
                  example="ảnh người giới thiệu sản phẩm." />
                <ProductImagesInput mainFile={mainProductImage} additionalFiles={additionalProductImageFiles} maxCount={maxProductImages}
                  onMainFileChange={(file) => updateProductImages(file, additionalProductImageFiles)}
                  onMainFilesDrop={(selected) => updateProductImages(selected[0], [...additionalProductImageFiles, ...selected.slice(1)])}
                  onAdditionalFilesChange={(selected) => updateProductImages(mainProductImage, selected)} disabled={busy || !draftReady} />
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
                    onChange={(event) => {
                      setProductUrl(event.target.value);
                      setProductAnalysisMessage("");
                      setProductAnalysisError("");
                    }} maxLength={2000} disabled={productAnalysisBusy}
                    placeholder="https://…" />
                </label>
                <label className="form-field">
                  <span>Tính năng / thông số xác minh <em>Tùy chọn</em></span>
                  <input type="text" name="productFacts" value={facts} onChange={(event) => setFacts(event.target.value.slice(0, 1000))}
                    placeholder="Ví dụ: Inox 304, giữ nhiệt 24h, nắp chống tràn..." maxLength={1000} />
                </label>
              </div>
              <div className="sales-product-analysis-actions full">
                <button type="button" className="secondary-button compact" onClick={() => void analyzeProductLink()}
                  disabled={!draftReady || busy || productAnalysisBusy || !productUrl.trim() || !access?.codingAgent}
                  aria-busy={productAnalysisBusy}>
                  {productAnalysisBusy ? "Đang đọc và phân tích…" : "Đọc link & gợi ý nội dung"}
                </button>
                <small>{access?.codingAgent ? "Gợi ý bằng Code Agent đang chọn. Thông tin đã nhập sẽ được giữ nguyên." : "Cần cài và cấu hình Code Agent CLI để phân tích link."}</small>
                {productAnalysisMessage && <p className="sales-product-analysis-status" role="status">{productAnalysisMessage}</p>}
                {productAnalysisError && <p className="sales-product-analysis-status sales-script-warning" role="alert">{productAnalysisError}</p>}
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
                  <span>Nhược điểm cần cân nhắc <em>Tùy chọn</em></span>
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
                      placeholder={salesVideoScriptPlaceholder()} />
                    {supportsAudio
                      ? <small>{maximumScriptWords === null ? `${scriptWords} từ · không áp trần tốc độ đọc cho tiếng Việt.` : `${scriptWords} / ${maximumScriptWords} từ cho ${selectedDuration} giây.`}</small>
                      : <small>Model này không tạo giọng nói; kịch bản chỉ được dùng làm ngữ cảnh cho hình ảnh.</small>}
                    {scriptTooLong && <small className="sales-script-warning" role="alert">Lời thoại vượt giới hạn {maximumScriptWords} từ của ngôn ngữ này. Hãy rút gọn để vừa nhịp đọc.</small>}
                    {overlyLongSentences.length > 0 && <small className="sales-script-warning" role="alert">Có {overlyLongSentences.length} câu dài hơn 22 từ. Bạn có thể ngắt câu để giọng đọc tự nhiên hơn.</small>}
                  </label>
                </div>
              </details>
              <section className="sales-video-post-processing full" aria-label="Hậu kỳ Text và Emoji">
                <div className="sales-video-post-processing-options">
                  <div className="sales-video-post-processing-option">
                    <label className="sales-video-post-processing-toggle">
                      <input type="checkbox" checked={postProcessTextOverlayEnabled}
                        onChange={(event) => setPostProcessTextOverlayEnabled(event.target.checked)} />
                      <span><strong>Chèn Text/Emoji bằng FFmpeg sau khi ghép video</strong>
                        <small>Lấy nội dung từ Video overlay do Code Agent tạo; không chèn cue vào prompt gửi model.</small></span>
                    </label>
                  </div>
                  <div className="sales-video-post-processing-option">
                    <label className="sales-video-post-processing-toggle">
                      <input type="checkbox" checked={postProcessMovingWatermarkEnabled}
                        onChange={(event) => setPostProcessMovingWatermarkEnabled(event.target.checked)} />
                      <span><strong>Watermark di chuyển ngẫu nhiên</strong>
                        <small>Di chuyển định kỳ qua các vị trí trong video để khó bị che khuất.</small></span>
                    </label>
                    {postProcessMovingWatermarkEnabled && <label className="form-field sales-video-post-processing-extra">
                      <span>Nội dung watermark</span>
                      <input type="text" value={postProcessWatermarkText} maxLength={32}
                        onChange={(event) => setPostProcessWatermarkText(event.target.value.slice(0, 32))} placeholder="StoryAI" />
                    </label>}
                  </div>
                  <div className="sales-video-post-processing-option">
                    <label className="sales-video-post-processing-toggle">
                      <input type="checkbox" checked={postProcessLogoEnabled}
                        onChange={(event) => setPostProcessLogoEnabled(event.target.checked)} />
                      <span><strong>Chèn logo</strong>
                        <small>Logo sẽ được chèn ở góc dưới bên phải video.</small></span>
                    </label>
                    {postProcessLogoEnabled && <label className="form-field sales-video-post-processing-extra">
                      <span>Ảnh logo <em>PNG, WebP, JPG hoặc AVIF · tối đa 50 MB</em></span>
                      <input type="file" accept={salesVideoImageTypes.join(",")} onChange={(event) => updateFile("watermarkLogo", event.target.files?.[0], "image")} />
                      {files.watermarkLogo && <small>{files.watermarkLogo.name}</small>}
                    </label>}
                  </div>
                </div>
              </section>
            </>}
            <div className="sales-form-step full"><span>{selectedTemplate ? "03" : "02"}</span><div><strong>Model và định dạng video</strong></div></div>
            <div className={`sales-video-model-fields full${selectedTemplate ? " is-ugc" : ""}`}>
              <label className={`form-field${!selectedTemplate && creative?.workflow !== "remake" ? " full" : ""}`}>
                <span>Model tạo video <em>Bắt buộc</em></span>
                <select name="model" value={model?.id || ""} onChange={(event) => {
                  setModel(event.target.value);
                }}>
                  {options.map((item) => <option value={item.id} key={item.id} disabled={!item.available}>{item.label}{item.available ? "" : " (chưa cấu hình)"}</option>)}
                </select>
              </label>
              {selectedTemplate && supportsAudio && <label className="form-field">
                <span>Ngôn ngữ thoại <em>Bắt buộc</em></span>
                <select name="language" value={language} onChange={(event) => setLanguage(event.target.value)}>
                  {salesVideoLanguages.map((lang) => <option key={lang}>{lang}</option>)}
                </select>
              </label>}
              {selectedTemplate && !supportsAudio && <input type="hidden" name="language" value={language} />}
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
            <input type="hidden" name="quality" value={videoQuality} />
            <input type="hidden" name="videoSpeed" value="fast" />
            <input type="hidden" name="videoOffPeak" value={videoOffPeak ? "true" : "false"} />
            {creative?.workflow === "remake" && <label className="form-field">
              <span>Bắt đầu từ (giây)</span>
              <input name="sourceStart" type="number" min="0" max="3600" step="0.1" value={sourceStart} onChange={(event) => setSourceStart(event.target.value)} />
            </label>}
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
            {!supportsAudio && creative?.workflow !== "narration" && <p role="status">Model này tạo video không có thoại.</p>}
            {access && !access.seedanceGateway && gatewayVideoModels.length > 0 && <p><a href="/settings">Cấu hình tài khoản Seedance</a> để dùng thêm model Flow/Muse.</p>}
            {access && !model?.available && model?.id.startsWith("maivideo:") && <p role="status">Chưa cấu hình khóa MaiVideo để dùng PixVerse V6 Reference.</p>}
            {access && !model?.available && !model?.id.startsWith("maivideo:") && <p role="status">Chưa cấu hình khóa PixVerse Platform cho model nhận video hoặc âm thanh tham chiếu.</p>}
            {access && !access.maiVideo && maiVideoModels.length > 0 && !pixverseReferenceWorkflow && <p><a href="/settings">Cài đặt khóa MaiVideo</a> để dùng thêm các model từ Phim AI.</p>}
            {access && !access.voice && creative?.workflow === "narration" && <p role="status">Máy chủ chưa cấu hình dịch vụ giọng mẫu.</p>}
            {!draftReady && <p className="sales-draft-status" role="status">Đang khôi phục bản nháp…</p>}
            {creative?.text && !requiredPromptReady && <p>Nhập lời thoại để tiếp tục.</p>}
            {selectedTemplate && access && !access.codingAgent && !manualPromptsReady && <p role="alert">Chưa tìm thấy Code Agent CLI. Dùng “Nhập JSON job” với prompt clip đã soạn để tạo thủ công.</p>}
            {draftWarning && <p className="sales-script-warning" role="alert">{draftWarning}</p>}
            {busy && <p role="status">Đang tải tệp và lưu dự án…</p>}
            {queuedProject && <p role="status">{manualPromptsReady ? "Bản nháp thủ công đã sẵn sàng." : "Đã lưu job nháp."} <a href={`/sales-video?project=${queuedProject.id}`}>{manualPromptsReady ? "Kiểm tra prompt và duyệt để tạo video" : "Theo dõi Code Agent và duyệt nội dung"}</a>. Bạn có thể tiếp tục nhập job khác.</p>}
            {copyStatus && <p role="status">{copyStatus}</p>}
            {manualImportStatus && <p role="status">{manualImportStatus}</p>}
            {manualUgcJob && !manualPromptsReady && <p className="sales-script-warning" role="alert">Prompt clip không khớp thời lượng hoặc model hiện chọn. Nhập lại dữ liệu theo lịch clip trong JSON mới nhất đã sao chép.</p>}
            {projects.some((project) => project.status === "processing" || project.status === "draft") && <div className="sales-ugc-queue" aria-label="Job UGC đang xử lý">
              <strong>Job đang chạy, chờ duyệt hoặc chờ tạo video</strong>
              {projects.filter((project) => project.status === "processing" || project.status === "draft").slice(0, 5).map((project) => <a key={project.id} href={`/sales-video?project=${project.id}`}>
                <span>{project.title}</span><small>{projectStatusLabel(project)}</small>
              </a>)}
              {projects.filter((project) => project.status === "processing" || project.status === "draft").length > 5 && <small>Và {projects.filter((project) => project.status === "processing" || project.status === "draft").length - 5} job khác…</small>}
            </div>}
            {message && <p className="sales-form-error" role="alert">{message}</p>}
          </div>
          <div className="sales-form-footer-actions">
            {selectedTemplate && selectedDuration >= 20 && selectedDuration <= 60 && manualSegmentDurations.length > 1 && <span className="sales-long-video-note">
              Video {selectedDuration} giây sẽ tự chia thành {longVideoPlanLabel}, rồi ghép thành một video hoàn chỉnh.
            </span>}
            {selectedTemplate && <button type="button" className="secondary-button" onClick={() => void copyManualJobData()} disabled={!draftReady || busy}>
              Sao chép JSON + hướng dẫn
            </button>}
            {selectedTemplate && <button type="button" className="secondary-button" onClick={() => { setManualImportError(""); setManualImportOpen(true); }} disabled={!draftReady || busy}>
              Nhập JSON job
            </button>}
            <button type="submit" className="primary-button" disabled={!canSubmit || busy}>{busy ? "Đang thêm job…" : manualPromptsReady ? "Tạo job thủ công" : selectedTemplate ? "Thêm job UGC vào hàng đợi" : "Tạo dự án và video"}</button>
          </div>
        </div>
        {manualImportOpen && <div className="sales-media-library-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setManualImportOpen(false); }}>
          <section className="sales-manual-import-modal" role="dialog" aria-modal="true" aria-labelledby="sales-manual-import-title">
            <header>
              <div><h2 id="sales-manual-import-title">Nhập JSON job</h2><p>Nút sao chép tạo phần JSON job và hướng dẫn UGC dạng text thuần riêng. Gửi toàn bộ cho AI, rồi chỉ dán JSON AI trả về vào đây. Ảnh tải riêng.</p></div>
              <button type="button" aria-label="Đóng nhập JSON job" onClick={() => setManualImportOpen(false)}>×</button>
            </header>
            <textarea autoFocus aria-label="JSON dữ liệu job" value={manualImportText} onChange={(event) => { setManualImportText(event.target.value); setManualImportError(""); }} rows={16} spellCheck={false} placeholder="Dán JSON job vào đây…" />
            {manualImportError && <p className="sales-form-error" role="alert">{manualImportError}</p>}
            <footer>
              <span>Để tạo không cần CLI, JSON cần có video.segments với prompt cho từng clip.</span>
              <div><button type="button" className="secondary-button" onClick={() => setManualImportOpen(false)}>Hủy</button>
                <button type="button" className="primary-button" onClick={importManualJobData}>Nhập dữ liệu</button></div>
            </footer>
          </section>
        </div>}
      </form>
  );
}
