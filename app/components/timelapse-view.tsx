"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./ui-icon";

type TimelapseImage = { id: string; name: string; url: string; sourceId?: string };
type VideoState = { status: "ready" | "generating" | "failed"; url?: string; error?: string; durationSec?: number };
type PromptScene = { name?: string; video_prompt?: string };
type PromptDocument = { continuity?: string; scenes?: PromptScene[] };
type LibraryImage = { id: string; name: string; fileName: string; previewUrl: string; source: string };
type PersistedTimelapse = { workflowId: string; images: TimelapseImage[]; promptsJson: string; durationSec: number; videos: Record<string, VideoState> };

const STORAGE_KEY = "storyai.timelapse.v1";
const DURATIONS = [6, 8, 10];

function newId() {
  return globalThis.crypto?.randomUUID?.().replace(/-/g, "") || `tl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function samplePrompts(pairCount: number) {
  const scenes = Array.from({ length: Math.max(1, pairCount) }, (_, index) => {
    const from = index === 0 ? "Then 1" : `Now ${index}`;
    const to = `Now ${index + 1}`;
    return {
      name: `Transition ${index + 1} · ${from} to ${to}`,
      video_prompt: "Create one continuous photorealistic timelapse transition. Use the first reference image as the exact opening frame and the second reference image as the exact final frame. Show a gradual, physically plausible progression from the visible starting state to the visible ending state. Animate only changes supported by the two references; do not add new structures, objects, people, damage, or environmental changes that are absent from the ending frame. Keep the camera locked in the same position, lens, framing, perspective, and horizon. Preserve the site's layout, identity, and lighting continuity. Show workers and tools only where appropriate to the visible work, moving with believable cause and effect; avoid duplicated people, flicker, warping, floating objects, sudden jumps, and morphing. End with a stable frame that matches the second reference image as closely as possible."
    };
  });
  return JSON.stringify({
    continuity: "Treat the first and last reference images as authoritative keyframes. Preserve the same location, camera position, framing, perspective, and visual identity throughout. Make only the changes needed to move plausibly from the first image to the second. Do not invent content that conflicts with either reference.",
    scenes,
  }, null, 2);
}

function parsePromptDocument(source: string) {
  try {
    const parsed = JSON.parse(source) as PromptDocument;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.scenes)) return { document: null, error: "JSON cần có một mảng scenes." };
    const scenes = parsed.scenes.filter((scene) => scene && typeof scene === "object");
    return { document: { ...parsed, scenes }, error: "" };
  } catch {
    return { document: null, error: "JSON chưa hợp lệ. Kiểm tra dấu ngoặc kép, dấu phẩy và ngoặc nhọn." };
  }
}

function temporalLabel(index: number) {
  return index === 0 ? "Then 1" : `Now ${index}`;
}

function transitionId(fromId: string, toId: string) {
  return `${fromId}_${toId}`;
}

export function TimelapseView() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [storageKey, setStorageKey] = useState(STORAGE_KEY);
  const [workflowId, setWorkflowId] = useState("");
  const [images, setImages] = useState<TimelapseImage[]>([]);
  const [promptsJson, setPromptsJson] = useState(() => samplePrompts(5));
  const [durationSec, setDurationSec] = useState(10);
  const [videos, setVideos] = useState<Record<string, VideoState>>({});
  const [loaded, setLoaded] = useState(false);
  const [imageActionBusy, setImageActionBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const activeVideoJobsRef = useRef(new Map<string, Promise<boolean>>());
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [libraryImages, setLibraryImages] = useState<LibraryImage[]>([]);
  const [libraryPreviewErrors, setLibraryPreviewErrors] = useState<Record<string, boolean>>({});
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      let scopedKey = `${STORAGE_KEY}.guest`;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (typeof payload.user?.id === "string") scopedKey = `${STORAGE_KEY}.${encodeURIComponent(payload.user.id)}`;
      } catch { /* Keep the browser-local guest key when the session endpoint is unavailable. */ }
      if (!active) return;
      setStorageKey(scopedKey);
      try {
        const raw = window.localStorage.getItem(scopedKey);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<PersistedTimelapse>;
          if (typeof saved.workflowId === "string" && Array.isArray(saved.images)) {
            setWorkflowId(saved.workflowId);
            setImages(saved.images.filter((image): image is TimelapseImage => Boolean(image?.id && image?.url)));
            if (typeof saved.promptsJson === "string") setPromptsJson(saved.promptsJson);
            if (DURATIONS.includes(Number(saved.durationSec))) setDurationSec(Number(saved.durationSec));
            if (saved.videos && typeof saved.videos === "object") {
              setVideos(Object.fromEntries(Object.entries(saved.videos).map(([id, video]) => [id, video?.status === "generating" ? { status: "failed", error: "Tab đã được tải lại khi Flow đang tạo. Hãy thử tạo lại transition này." } : video])) as Record<string, VideoState>);
            }
          }
        }
      } catch {
        window.localStorage.removeItem(scopedKey);
      }
      setLoaded(true);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const saved: PersistedTimelapse = { workflowId, images, promptsJson, durationSec, videos };
    window.localStorage.setItem(storageKey, JSON.stringify(saved));
  }, [loaded, storageKey, workflowId, images, promptsJson, durationSec, videos]);

  const transitions = useMemo(() => images.slice(0, -1).map((from, index) => ({
    from,
    to: images[index + 1],
    index,
    id: transitionId(from.id, images[index + 1].id),
    fromLabel: temporalLabel(index),
    toLabel: temporalLabel(index + 1),
  })), [images]);
  const parsedPrompts = useMemo(() => parsePromptDocument(promptsJson), [promptsJson]);
  const promptScenes = parsedPrompts.document?.scenes || [];
  const validPrompts = promptScenes.filter((scene) => typeof scene.video_prompt === "string" && scene.video_prompt.trim()).length;
  const readyCount = transitions.filter((transition) => videos[transition.id]?.status === "ready").length;
  const generatingCount = transitions.filter((transition) => videos[transition.id]?.status === "generating").length;

  function ensureWorkflowId() {
    if (workflowId) return workflowId;
    const id = newId();
    setWorkflowId(id);
    return id;
  }

  async function addUploadedFiles(files: FileList | File[]) {
    const selectedFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!selectedFiles.length) {
      setMessage({ tone: "error", text: "Chọn ảnh PNG, JPG hoặc WebP." });
      return;
    }
    setImageActionBusy(true);
    setMessage(null);
    const currentWorkflow = ensureWorkflowId();
    let added = 0;
    try {
      for (const file of selectedFiles) {
        const form = new FormData();
        const id = newId();
        form.set("workflowId", currentWorkflow);
        form.set("imageId", id);
        form.set("file", file);
        const response = await fetch("/api/timelapse/images", { method: "POST", body: form });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || `Không thể tải ảnh ${file.name}.`);
        setImages((current) => [...current, { ...payload.image, name: file.name } as TimelapseImage]);
        added += 1;
      }
      setMessage({ tone: "success", text: `Đã thêm ${added} ảnh theo thứ tự đã chọn.` });
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể tải ảnh lên." });
    } finally {
      setImageActionBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function openLibrary() {
    setLibraryOpen(true);
    setLibraryError("");
    setLibraryPreviewErrors({});
    if (libraryImages.length) return;
    setLibraryLoading(true);
    try {
      const response = await fetch("/api/maivideo/media-library", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tải được Media Library.");
      setLibraryImages(Array.isArray(payload.images) ? payload.images as LibraryImage[] : []);
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : "Không tải được Media Library.");
    } finally {
      setLibraryLoading(false);
    }
  }

  function toggleLibraryImage(id: string) {
    setSelectedLibraryIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function addLibrarySelection() {
    const selected = selectedLibraryIds.map((id) => libraryImages.find((image) => image.id === id)).filter((image): image is LibraryImage => Boolean(image));
    if (!selected.length) return;
    setImageActionBusy(true);
    setMessage(null);
    const currentWorkflow = ensureWorkflowId();
    let added = 0;
    try {
      for (const image of selected) {
        const form = new FormData();
        const id = newId();
        form.set("workflowId", currentWorkflow);
        form.set("imageId", id);
        form.set("libraryId", image.id);
        const response = await fetch("/api/timelapse/images", { method: "POST", body: form });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || `Không thể thêm ${image.name}.`);
        setImages((current) => [...current, { ...payload.image, name: image.name, sourceId: image.id } as TimelapseImage]);
        added += 1;
      }
      setSelectedLibraryIds([]);
      setLibraryOpen(false);
      setMessage({ tone: "success", text: `Đã thêm ${added} ảnh từ Media Library.` });
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : "Không thể thêm ảnh từ thư viện.");
    } finally {
      setImageActionBusy(false);
    }
  }

  function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    setImages((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function removeImage(image: TimelapseImage) {
    if (imageActionBusy || batchBusy || generatingCount > 0) return;
    if (!window.confirm(`Xóa ảnh nguồn “${image.name}” khỏi workflow?`)) return;
    setImageActionBusy(true);
    setMessage(null);
    try {
      if (workflowId) {
        const response = await fetch(`/api/timelapse/images/${encodeURIComponent(workflowId)}/${encodeURIComponent(image.id)}`, { method: "DELETE" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || "Không xóa được ảnh nguồn.");
      }
      setImages((current) => current.filter((item) => item.id !== image.id));
      setVideos((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.includes(image.id))));
      setMessage({ tone: "success", text: `Đã xóa ảnh nguồn “${image.name}”.` });
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không xóa được ảnh nguồn." });
    } finally {
      setImageActionBusy(false);
    }
  }

  function downloadAllReadyVideos() {
    const readyTransitions = transitions.filter((transition) => videos[transition.id]?.status === "ready" && videos[transition.id]?.url);
    if (!readyTransitions.length) {
      setMessage({ tone: "error", text: "Chưa có video hoàn tất để tải xuống." });
      return;
    }
    readyTransitions.forEach((transition, fileIndex) => {
      const anchor = document.createElement("a");
      anchor.href = videos[transition.id]!.url!;
      anchor.download = `image${fileIndex + 1}.mp4`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
    setMessage({ tone: "success", text: `Đã gửi ${readyTransitions.length} video để tải xuống với tên image1.mp4 đến image${readyTransitions.length}.mp4 theo thứ tự Transition.` });
  }

  async function deleteWorkflow() {
    if (imageActionBusy || batchBusy || generatingCount > 0) return;
    if (!window.confirm(`Xóa workflow này cùng ${images.length} ảnh và ${readyCount} video? Thao tác này không thể hoàn tác.`)) return;
    setImageActionBusy(true);
    setMessage(null);
    try {
      if (workflowId) {
        const response = await fetch(`/api/timelapse/workflows/${encodeURIComponent(workflowId)}`, { method: "DELETE" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || "Không xóa được workflow.");
      }
      setWorkflowId("");
      setImages([]);
      setVideos({});
      setPromptsJson(samplePrompts(5));
      setDurationSec(10);
      setSelectedLibraryIds([]);
      setMessage({ tone: "success", text: "Đã xóa workflow, ảnh nguồn và video Timelapse." });
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "Không xóa được workflow." });
    } finally {
      setImageActionBusy(false);
    }
  }

  function useEnglishTemplate() {
    setPromptsJson(samplePrompts(transitions.length || 1));
    setMessage({ tone: "success", text: `Đã tạo JSON mẫu English cho ${transitions.length || 1} transition.` });
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(promptsJson);
      setMessage({ tone: "success", text: "Đã copy JSON." });
    } catch {
      setMessage({ tone: "error", text: "Trình duyệt không cho phép copy clipboard." });
    }
  }

  function updateScenePrompt(index: number, value: string) {
    if (!parsedPrompts.document) return;
    const document = structuredClone(parsedPrompts.document);
    document.scenes ||= [];
    while (document.scenes.length <= index) document.scenes.push({ name: `Transition ${document.scenes.length + 1}`, video_prompt: "" });
    document.scenes[index] = { ...document.scenes[index], video_prompt: value };
    setPromptsJson(JSON.stringify(document, null, 2));
  }

  function runOneTransition(transition: (typeof transitions)[number]): Promise<boolean> {
    const activeJob = activeVideoJobsRef.current.get(transition.id);
    if (activeJob) return activeJob;
    const task = (async () => {
      const prompt = typeof promptScenes[transition.index]?.video_prompt === "string" ? promptScenes[transition.index].video_prompt!.trim() : "";
      if (!prompt) return false;
      setVideos((current) => ({ ...current, [transition.id]: { status: "generating" } }));
      try {
        const response = await fetch("/api/timelapse/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId: ensureWorkflowId(), transitionId: transition.id, fromImageId: transition.from.id, toImageId: transition.to.id, prompt, continuity: parsedPrompts.document?.continuity || "", aspectRatio: "16:9", durationSec }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || "Không tạo được video Transition.");
        setVideos((current) => ({ ...current, [transition.id]: { status: "ready", url: payload.videoUrl, durationSec: Number(payload.durationSec) || durationSec } }));
        return true;
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : "Không tạo được video Transition.";
        setVideos((current) => ({ ...current, [transition.id]: { status: "failed", error } }));
        return false;
      }
    })().finally(() => {
      activeVideoJobsRef.current.delete(transition.id);
    });
    activeVideoJobsRef.current.set(transition.id, task);
    return task;
  }

  async function generateAllTransitions() {
    if (batchBusy || !transitions.length) return;
    setBatchBusy(true);
    let failed = 0;
    for (const transition of transitions) {
      const prompt = promptScenes[transition.index]?.video_prompt?.trim();
      if (!prompt) {
        failed += 1;
        setVideos((current) => ({ ...current, [transition.id]: { status: "failed", error: "Thiếu video_prompt trong JSON." } }));
        continue;
      }
      if (!await runOneTransition(transition)) failed += 1;
    }
    setBatchBusy(false);
    setMessage(failed ? { tone: "error", text: `${transitions.length - failed}/${transitions.length} Transition đã hoàn tất; ${failed} mục cần kiểm tra.` } : { tone: "success", text: `Đã tạo xong ${transitions.length} Transition bằng Flow.` });
  }

  const canGenerate = transitions.length > 0 && !parsedPrompts.error && transitions.every((transition) => Boolean(promptScenes[transition.index]?.video_prompt?.trim()));

  return <>
    <div className="timelapse-workspace">
      <section className="timelapse-hero">
        <div className="timelapse-hero-copy">
          <div className="timelapse-hero-kicker"><span />STORYAI · GOOGLE FLOW</div>
          <h1>Timelapse</h1>
          <p>Tạo video liền mạch từ các ảnh theo thứ tự thời gian. Mỗi cặp ảnh liên tiếp tạo thành một Transition.</p>
        </div>
        <div className="timelapse-hero-aside">
          <span className="timelapse-model-pill"><span className="timelapse-model-dot" />Flow Omni 1.1 Flash</span>
          <div className="timelapse-hero-stats">
            <div><strong>{images.length}</strong><span>ảnh nguồn</span></div>
            <div><strong>{readyCount}/{transitions.length}</strong><span>video hoàn tất</span></div>
          </div>
        </div>
      </section>

      {message && <div className={`timelapse-message ${message.tone}`} role="status"><span>{message.tone === "success" ? "✓" : "!"}</span>{message.text}<button type="button" aria-label="Đóng thông báo" onClick={() => setMessage(null)}>×</button></div>}

      <section className="timelapse-card panel-card timelapse-config-card">
        <div className="timelapse-section-heading"><div><span className="timelapse-step">01</span><div><h2>Cài đặt Timelapse</h2><p>Chọn thông số Transition và nhập prompt cho từng cặp ảnh.</p></div></div><span className={`timelapse-count-pill ${canGenerate ? "ready" : ""}`}>{validPrompts} prompt hợp lệ{transitions.length ? ` · cần ${transitions.length}` : " · chờ ảnh"}</span></div>
        <div className="timelapse-transition-config">
          <div className="timelapse-transition-config-head"><div><h3>Transition</h3><p>Mỗi video dùng một <code>video_prompt</code> trong JSON.</p></div><span>FLOW · 1080p</span></div>
          <div className="timelapse-settings-grid">
            <label><span>Model tạo video</span><div className="timelapse-fixed-setting"><strong>Flow Omni 1.1 Flash</strong><small>Google Flow</small></div></label>
            <label><span>Chất lượng</span><div className="timelapse-fixed-setting"><strong>1080p</strong><small>Cố định</small></div></label>
            <label><span>Thời lượng</span><select value={durationSec} onChange={(event) => setDurationSec(Number(event.target.value))}>{DURATIONS.map((duration) => <option key={duration} value={duration}>{duration} giây</option>)}</select></label>
            <div className="timelapse-batch-setting"><span>Tạo video</span><button className="primary-button" type="button" onClick={() => void generateAllTransitions()} disabled={!canGenerate || batchBusy || imageActionBusy}><Icon name={batchBusy ? "clock" : "play"} size={15} />{batchBusy ? "Đang tạo video…" : `Tạo video hàng loạt (${transitions.length})`}</button></div>
          </div>
        </div>
        <div className="timelapse-json-inline">
          <div className="timelapse-json-inline-head"><div><h3>Prompt Transition theo cặp (JSON)</h3><p>Mỗi mục trong <code>scenes</code> tương ứng với một cặp ảnh liền kề.</p></div><div className="timelapse-json-actions"><button className="secondary-button compact" type="button" onClick={useEnglishTemplate}><Icon name="spark" size={14} />Dùng mẫu English</button><button className="secondary-button compact" type="button" onClick={() => void copyJson()}><Icon name="copy" size={14} />Copy JSON</button></div></div>
          <textarea className="timelapse-json-editor" aria-label="Prompt từng Transition JSON" value={promptsJson} onChange={(event) => setPromptsJson(event.target.value)} spellCheck={false} />
          <div className="timelapse-json-footer"><span className={parsedPrompts.error ? "error" : ""}>{parsedPrompts.error || `${promptScenes.length} mục scenes · ${validPrompts} video_prompt`}</span><span>Tối đa 200 Transition</span></div>
        </div>
      </section>

      <section className="timelapse-card panel-card timelapse-workflow-card">
        <div className="timelapse-source-heading"><div><h2>Ảnh nguồn Timelapse</h2><p>Upload hoặc chọn ảnh theo thứ tự Then 1 → Now 1 → Now 2… Mỗi cặp ảnh liền kề tạo thành một Transition.</p></div><span className="timelapse-count-pill">{images.length} ảnh · {transitions.length} Transition</span></div>
        <div className="timelapse-toolbar">
          <div className="timelapse-toolbar-actions">
            <input ref={fileInputRef} type="file" accept="image/*,.avif" multiple hidden onChange={(event) => event.target.files && void addUploadedFiles(event.target.files)} />
            <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={imageActionBusy}><Icon name="upload" size={15} />{imageActionBusy ? "Đang thêm ảnh…" : "Upload nhiều ảnh"}</button>
            <button className="secondary-button" type="button" onClick={() => void openLibrary()} disabled={imageActionBusy}><Icon name="image" size={15} />Media Library</button>
            <button className="secondary-button compact timelapse-download-all" type="button" onClick={downloadAllReadyVideos} disabled={!readyCount}><Icon name="download" size={14} />Tải video hàng loạt ({readyCount})</button>
            <button className="secondary-button compact timelapse-delete-workflow" type="button" onClick={() => void deleteWorkflow()} disabled={!images.length || imageActionBusy || batchBusy || generatingCount > 0}><Icon name="trash" size={14} />Xóa workflow ({images.length})</button>
          </div>
          <span className="timelapse-toolbar-note">Thứ tự ảnh quyết định các Transition · Dùng mũi tên trên ảnh để sắp xếp</span>
        </div>
        {images.length ? <div className="timelapse-pair-groups">{Array.from({ length: Math.ceil(images.length / 2) }, (_, pairIndex) => {
          const firstImageIndex = pairIndex * 2;
          const pairImages = images.slice(firstImageIndex, firstImageIndex + 2);
          const pairTransitions = transitions.filter((transition) => transition.index >= firstImageIndex && transition.index < firstImageIndex + 2);
          const pairCaption = pairImages.length > 1 ? `${temporalLabel(firstImageIndex)} → ${temporalLabel(firstImageIndex + 1)}` : `${temporalLabel(firstImageIndex)} · chờ ảnh tiếp theo`;
          return <article className="timelapse-pair-row" key={`pair-${firstImageIndex}`}>
            <header className="timelapse-pair-row-head"><div><h3>Ảnh {pairCaption}</h3><p>{pairTransitions.length ? pairTransitions.map((transition) => `${transition.fromLabel} → ${transition.toLabel}`).join(" · ") : "Thêm ảnh kế tiếp để tạo Transition"}</p></div><span className={`timelapse-pair-ready ${pairImages.length > 1 ? "ready" : ""}`}>{pairImages.length > 1 ? "Có ảnh liền kề" : "Đang chờ ảnh"}</span></header>
            <div className="timelapse-pair-row-content">
              <div className="timelapse-source-pair-grid">{pairImages.map((image, offset) => {
                const imageIndex = firstImageIndex + offset;
                return <article className="timelapse-source-slot-card" key={image.id}>
                  <div className="timelapse-source-slot-head"><span className={`timelapse-image-tag ${imageIndex === 0 ? "then" : "now"}`}>{temporalLabel(imageIndex)}</span><span className="timelapse-source-slot-filename" title={image.name}>{image.name}</span><div className="timelapse-image-actions"><button type="button" title="Chuyển lên trước" aria-label={`Chuyển ${temporalLabel(imageIndex)} lên trước`} disabled={imageIndex === 0 || batchBusy || imageActionBusy || generatingCount > 0} onClick={() => moveImage(imageIndex, -1)}><Icon name="arrow" size={13} /></button><button type="button" title="Chuyển xuống sau" aria-label={`Chuyển ${temporalLabel(imageIndex)} xuống sau`} disabled={imageIndex === images.length - 1 || batchBusy || imageActionBusy || generatingCount > 0} onClick={() => moveImage(imageIndex, 1)}><Icon name="arrow" size={13} /></button><button className="timelapse-delete-source-image" type="button" title="Xóa ảnh nguồn" aria-label={`Xóa ảnh nguồn ${temporalLabel(imageIndex)}`} disabled={batchBusy || imageActionBusy || generatingCount > 0} onClick={() => void removeImage(image)}><Icon name="trash" size={12} /><span>Xóa ảnh</span></button></div></div>
                  <span className="timelapse-source-slot-label">Ảnh nguồn</span>
                  <div className="timelapse-source-slot-image"><img src={image.url} alt={image.name} /></div>
                  <div className="timelapse-image-name" title={image.name}>{image.name}</div>
                </article>;
              })}{pairImages.length === 1 && <div className="timelapse-source-slot-empty"><span className="timelapse-empty-icon"><Icon name="image" size={22} /></span><strong>{temporalLabel(firstImageIndex + 1)}</strong><small>Thêm ảnh tiếp theo để tạo cặp</small></div>}</div>
              <div className="timelapse-pair-transition-grid">{pairTransitions.length ? pairTransitions.map((transition) => {
                const video = videos[transition.id];
                const scene = promptScenes[transition.index];
                const prompt = typeof scene?.video_prompt === "string" ? scene.video_prompt : "";
                return <article className="timelapse-transition-card timelapse-transition-card-compact" key={transition.id}>
                  <header className="timelapse-compact-transition-head"><div><h4>Transition · {transition.fromLabel} → {transition.toLabel}</h4><p>{transition.fromLabel} → {transition.toLabel} · Flow Omni</p></div></header>
                  <div className="timelapse-compact-transition-actions"><button className="timelapse-compact-generate" type="button" onClick={() => void runOneTransition(transition)} disabled={!prompt.trim() || video?.status === "generating" || imageActionBusy}><Icon name={video?.status === "ready" ? "refresh" : video?.status === "generating" ? "clock" : "play"} size={13} />{video?.status === "ready" ? "Tạo lại video" : video?.status === "generating" ? "Đang tạo…" : video?.status === "failed" ? "Thử lại" : "Tạo video"}</button><span className={`timelapse-status ${video?.status || "waiting"}`}>{video?.status === "ready" ? "Hoàn thành" : video?.status === "generating" ? "Đang tạo" : video?.status === "failed" ? "Lỗi" : "Chưa tạo"}</span><details className="timelapse-compact-prompt"><summary>Prompt riêng</summary><textarea aria-label={`Prompt video ${transition.index + 1}`} value={prompt} onChange={(event) => updateScenePrompt(transition.index, event.target.value)} disabled={!parsedPrompts.document} placeholder="Sửa video_prompt trong JSON ở trên…" />{!parsedPrompts.document && <small>Sửa JSON hợp lệ trước khi chỉnh prompt tại đây.</small>}</details></div>
                  <p className="timelapse-compact-prompt-preview" title={prompt}>{prompt || "Chưa có video_prompt cho Transition này."}</p>
                  <div className={`timelapse-video-preview ${video?.status === "ready" ? "has-video" : ""}`}>{video?.status === "ready" && video.url ? <video src={video.url} controls preload="metadata" /> : video?.status === "generating" ? <div className="timelapse-video-placeholder"><span className="timelapse-spinner" /><strong>Flow đang tạo video…</strong><small>Giữ tab này mở cho đến khi hoàn tất.</small></div> : <div className="timelapse-video-placeholder"><Icon name="play" size={20} /><strong>Video {transition.fromLabel} → {transition.toLabel}</strong><small>{durationSec} giây · 1080p</small></div>}</div>
                  {video?.error && <div className="timelapse-video-error">{video.error}</div>}
                  <div className="timelapse-transition-footer"><span>{video?.status === "ready" ? `Flow Omni · ${video.durationSec || durationSec}s · 1080p` : `${durationSec} giây · 1080p`}</span>{video?.status === "ready" && video.url && <a className="secondary-button compact" href={video.url} download={`timelapse-transition-${transition.index + 1}.mp4`}><Icon name="download" size={13} />Tải video</a>}</div>
                </article>;
              }) : <div className="timelapse-pair-transition-empty"><Icon name="arrow" size={17} /><span>Thêm ảnh liền kề để tạo Transition.</span></div>}</div>
            </div>
          </article>;
        })}</div> : <div className="timelapse-image-empty"><span className="timelapse-empty-icon"><Icon name="image" size={25} /></span><strong>Thêm ảnh theo trình tự Then → Now</strong><p>Tải ảnh lên hoặc chọn nhiều ảnh trong Media Library. Thứ tự tại đây xác định các cặp Transition.</p><div><button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={imageActionBusy}><Icon name="upload" size={15} />Chọn ảnh</button><button className="secondary-button" type="button" onClick={() => void openLibrary()}><Icon name="image" size={15} />Chọn từ Media Library</button></div></div>}
      </section>
    </div>
    {libraryOpen && <div className="timelapse-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLibraryOpen(false); }}><section className="timelapse-library-modal" role="dialog" aria-modal="true" aria-labelledby="timelapse-library-title"><header><div><span className="section-kicker">MEDIA LIBRARY</span><h2 id="timelapse-library-title">Chọn ảnh nguồn</h2><p>Chọn ảnh theo thứ tự Then → Now. Bạn có thể sắp xếp lại sau.</p></div><button type="button" aria-label="Đóng Media Library" onClick={() => setLibraryOpen(false)}>×</button></header>{libraryLoading ? <div className="timelapse-library-state"><span className="timelapse-spinner" />Đang tải Media Library…</div> : libraryError ? <div className="timelapse-library-state error">{libraryError}<button className="secondary-button compact" type="button" onClick={() => { setLibraryImages([]); void openLibrary(); }}>Thử lại</button></div> : libraryImages.length ? <div className="timelapse-library-grid">{libraryImages.map((image) => <button type="button" key={image.id} className={`timelapse-library-item ${selectedLibraryIds.includes(image.id) ? "selected" : ""}`} onClick={() => toggleLibraryImage(image.id)}><div className={`timelapse-library-thumb ${libraryPreviewErrors[image.id] ? "error" : ""}`}>{libraryPreviewErrors[image.id] ? <small>Không tải được ảnh xem trước</small> : <img src={image.previewUrl} alt={image.name} loading="lazy" decoding="async" onError={() => setLibraryPreviewErrors((current) => ({ ...current, [image.id]: true }))} />}</div><span>{image.name}</span><i>{selectedLibraryIds.includes(image.id) ? "✓" : "+"}</i></button>)}</div> : <div className="timelapse-library-state">Chưa có ảnh trong Media Library.</div>}<footer><span>{selectedLibraryIds.length} ảnh đã chọn</span><div><button className="secondary-button" type="button" onClick={() => setLibraryOpen(false)}>Hủy</button><button className="primary-button" type="button" onClick={() => void addLibrarySelection()} disabled={!selectedLibraryIds.length || imageActionBusy}>{imageActionBusy ? "Đang thêm…" : "Thêm ảnh đã chọn"}</button></div></footer></section></div>}
  </>;
}
