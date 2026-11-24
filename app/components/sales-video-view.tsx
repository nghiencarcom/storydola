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
import { SalesVideoTemplateArtwork } from "./sales-video-template-artwork";
import { Icon } from "./ui-icon";

type Access = { maiVideo: boolean; seedanceGateway: boolean; pixverse: boolean; voice: boolean; draftKey: string; codingAgent: { id: string; label: string; model: string; saved: boolean } | null };
type SalesVideoLibraryImage = { id: string; name: string; fileName: string; previewUrl: string; source: string };
type ManualUgcPromptSegment = { start: number; duration: number; prompt: string };
type ManualUgcJobData = {
  segments: ManualUgcPromptSegment[];
  script: string;
};
type SalesVideoReviewAction = { disabled: boolean; busy: boolean; activate: () => void };
const labels = { processing: "Đang xử lý", draft: "Chờ bạn duyệt", ready: "Hoàn tất", failed: "Thất bại" };
function projectStatusLabel(project: SalesVideoProject) {
  if (project.status !== "processing") return labels[project.status];
  return project.phase === "writing" ? "Code Agent đang soạn" : "Model đang tạo video";
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
          onFilesChange(Array