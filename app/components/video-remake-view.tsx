"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { CONTENT_GENRES, STORY_SETTING_OPTIONS } from "../lib/content-genres";
import { planRemakeEpisodes, type RemakeInput, type RemakeJob, type RemakeJobSummary, type RemakeStage, type RemakeTranscript } from "../lib/video-remake";
import { IMAGE_STYLE_PRESETS, VISUAL_STYLE_PRESETS } from "../lib/visual-styles";
import { useProjects } from "../lib/project-store";

const agentLabels = { codex: "Codex", claude: "Claude Code", antigravity: "Antigravity" };
const statusLabels: Record<RemakeStage, string> = {
  queued: "Đang chờ", reading: "Đang đọc video", analyzing: "Code Agent đang phân tích",
  ready: "Sẵn sàng duyệt", failed: "Thất bại",
};
const statusClasses: Record<RemakeStage, string> = {
  queued: "draft", reading: "processing", analyzing: "processing", ready: "ready", failed: "failed",
};
const transcriptLabels: Record<RemakeTranscript, string> = {
  manual: "Transcript bạn cung cấp",
  captions: "Phụ đề của video",
  transcribed: "Transcript tự động",
  silent: "Video không có track âm thanh",
  unavailable: "Chưa có transcript. Nhận xét nội dung dựa trên khung hình.",
};

function seconds(value: number) {
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 3 })}s`;
}

function timeline(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function remakeRequest<T>(options?: RequestInit, id?: string): Promise<T> {
  const response = await fetch(`/api/video-remake${id ? `?id=${encodeURIComponent(id)}` : ""}`, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.message || "Không kết nối được hàng đợi remake. Hãy thử lại.");
  return payload;
}

async function uploadRequest<T>(options?: RequestInit, uploadId?: string, offset?: number): Promise<T> {
  const params = new URLSearchParams();
  if (uploadId) params.set("uploadId", uploadId);
  if (offset !== undefined) params.set("offset", String(offset));
  const query = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`/api/video-remake/upload${query}`, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(payload?.message || "Không tải được video lên StoryAI. Hãy thử lại.");
  return payload;
}

const uploadChunkSize = 8 * 1024 * 1024;
const isActiveStage = (status?: RemakeStage) => status === "queued" || status === "reading" || status === "analyzing";

type PickedLocalRemakeVideo = {
  token: string;
  filename: string;
  displayPath: string;
  extension: string;
  size: number;
};

const noopSubscribe = () => () => {};
function getClientLoopbackSnapshot() {
  const host = window.location.hostname.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} GB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MiB`;
}

export function VideoRemakeView({ initialJobId = "" }: { initialJobId?: string }) {
  const router = useRouter();
  const { refresh } = useProjects();
  const detailRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<RemakeJobSummary[]>([]);
  const [job, setJob] = useState<RemakeJob>();
  const [selected, setSelected] = useState(initialJobId);
  const [queueQuery, setQueueQuery] = useState("");
  const [queueStatus, setQueueStatus] = useState<"" | RemakeStage>("");
  const [sceneQuery, setSceneQuery] = useState("");
  const [sceneEpisode, setSceneEpisode] = useState("all");
  const [scenePage, setScenePage] = useState(0);
  const [copiedJobId, setCopiedJobId] = useState("");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sourceMode, setSourceMode] = useState<"url" | "local">("url");
  const [localFile, setLocalFile] = useState<File>();
  const [pickedLocalVideo, setPickedLocalVideo] = useState<PickedLocalRemakeVideo | null>(null);
  const [localPathInput, setLocalPathInput] = useState("");
  const [pickingLocal, setPickingLocal] = useState(false);
  const isLocalHost = useSyncExternalStore(noopSubscribe, getClientLoopbackSnapshot, () => false);
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; size: number }>();
  const uploadId = useRef("");
  const [acting, setActing] = useState<{ jobId: string; action: "retry" | "create-project" | "delete" } | null>(null);
  const actingJobId = acting?.jobId || "";
  const actingAction = acting?.action || "";
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [detailError, setDetailError] = useState("");
  const selectedSummary = jobs.find(({ id }) => id === selected);
  const selectedUpdate = selectedSummary?.updatedAt;
  const selectedOutsideListActive = Boolean(
    selected && !selectedSummary && job?.id === selected && isActiveStage(job.status),
  );

  async function pickNativeLocalVideo() {
    if (pickingLocal || saving) return;
    setPickingLocal(true);
    setError("");
    try {
      const response = await fetch("/api/video-remake/local-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pick-video" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || "Không mở được hộp thoại chọn tệp trên máy.");
      if (!payload?.cancelled && payload?.file) {
        setPickedLocalVideo(payload.file as PickedLocalRemakeVideo);
        setLocalFile(undefined);
        if (fileInputRef.current) fileInputRef.current.value = "";
        uploadId.current = "";
        setUploadProgress(undefined);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setPickingLocal(false);
    }
  }

  async function resolveTypedLocalPath(rawOverride?: string) {
    const candidate = (rawOverride ?? localPathInput).trim();
    if (!candidate) {
      setError("Hãy dán đường dẫn tệp video trên máy (ví dụ /Users/.../video.mp4).");
      return undefined;
    }
    setPickingLocal(true);
    setError("");
    try {
      const response = await fetch("/api/video-remake/local-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve-path", path: candidate }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.file) {
        throw new Error(payload?.message || "Không tìm thấy hoặc không đọc được tệp video trên máy.");
      }
      const resolved = payload.file as PickedLocalRemakeVideo;
      setPickedLocalVideo(resolved);
      setLocalPathInput("");
      setLocalFile(undefined);
      if (fileInputRef.current) fileInputRef.current.value = "";
      uploadId.current = "";
      setUploadProgress(undefined);
      return resolved;
    } catch (cause) {
      setError((cause as Error).message);
      return undefined;
    } finally {
      setPickingLocal(false);
    }
  }

  useEffect(() => {
    setSelected(initialJobId);
    setJob(undefined);
    setDetailError("");
  }, [initialJobId]);

  useEffect(() => {
    setSceneQuery("");
    setSceneEpisode("all");
    setScenePage(0);
  }, [selected]);

  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    if (!localFile) {
      if (input.value) input.value = "";
      return;
    }
    if (input.files?.[0] !== localFile && typeof DataTransfer !== "undefined") {
      try {
        const transfer = new DataTransfer();
        transfer.items.add(localFile);
        input.files = transfer.files;
      } catch { /* Browser prevented programmatic FileList assignment; hidden input stays mounted. */ }
    }
  }, [sourceMode, localFile]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refreshQueue() {
      let shouldPoll = false;
      try {
        const { jobs: nextJobs } = await remakeRequest<{ jobs: RemakeJobSummary[] }>({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setJobs(nextJobs);
        setLoadError("");
        shouldPoll = nextJobs.some(({ status }) => isActiveStage(status)) || selectedOutsideListActive;
      } catch (cause) {
        if (!controller.signal.aborted) {
          setLoadError((cause as Error).message);
          shouldPoll = true;
        }
      }
      if (!controller.signal.aborted && shouldPoll) {
        timer = setTimeout(() => void refreshQueue(), 3000);
      }
    }
    void refreshQueue();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision, selectedOutsideListActive]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function fetchSelectedJob() {
      try {
        const { job: loaded } = await remakeRequest<{ job: RemakeJob }>({ signal: controller.signal }, selected);
        if (controller.signal.aborted) return;
        setJob(loaded);
        setDetailError("");
        if (!selectedSummary && isActiveStage(loaded.status)) {
          timer = setTimeout(() => void fetchSelectedJob(), 3000);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setJob(undefined);
          setDetailError((cause as Error).message);
        }
      }
    }
    void fetchSelectedJob();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selected, selectedUpdate, Boolean(selectedSummary), revision]);

  const selectedJob = job?.id === selected ? job : undefined;
  const detailSummary: RemakeJobSummary | undefined = selectedSummary || (selectedJob ? {
    id: selectedJob.id,
    url: selectedJob.input.url,
    sourceName: selectedJob.localSource?.filename,
    status: selectedJob.status,
    createdAt: selectedJob.createdAt,
    updatedAt: selectedJob.updatedAt,
    error: selectedJob.error,
    progress: selectedJob.progress,
    projectSlug: selectedJob.projectSlug,
    title: selectedJob.result?.draft.title,
    sceneCount: selectedJob.result?.windows.length,
  } : undefined);

  useEffect(() => {
    if (initialJobId && (detailSummary || detailError)) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [initialJobId, detailSummary?.id, Boolean(detailError)]);

  async function copyJobLink(id: string) {
    const url = new URL(`/video-remake/${encodeURIComponent(id)}`, window.location.origin);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopiedJobId(id);
    } catch {
      setDetailError("Không sao chép được link. Hãy sao chép URL trên thanh địa chỉ.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const rawPolicy = fields.get("dialoguePolicy");
    const dialoguePolicy: RemakeInput["dialoguePolicy"] = rawPolicy === "silent_sfx"
      ? "silent_sfx"
      : rawPolicy === "spoken"
        ? "spoken"
        : "auto";
    const options = {
      language: fields.get("language") === "en" ? "en" as const : "vi" as const,
      remakeMode: fields.get("remakeMode") === "creative" ? "creative" as const : "faithful" as const,
      dialoguePolicy,
      imageStyle: String(fields.get("imageStyle") || ""),
      visualStyle: String(fields.get("visualStyle") || ""),
      contentGenre: String(fields.get("contentGenre") || ""),
      storySetting: String(fields.get("storySetting") || ""),
      direction: String(fields.get("direction") || ""),
      transcript: String(fields.get("transcript") || ""),
    };
    const url = String(fields.get("url") || "");
    let directVideo = pickedLocalVideo;
    if (sourceMode === "local" && !directVideo && !localFile && isLocalHost && localPathInput.trim()) {
      directVideo = (await resolveTypedLocalPath(localPathInput)) || null;
      if (!directVideo) return;
    }
    if (sourceMode === "local" && !directVideo && !localFile) {
      setError("Chọn một tệp video trên máy trước khi thêm vào hàng đợi.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let id: string;
      if (sourceMode === "url") {
        const input: RemakeInput = { ...options, url };
        ({ id } = await remakeRequest<{ id: string }>({
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
        }));
      } else if (directVideo) {
        const response = await fetch("/api/video-remake/local-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create-job", token: directVideo.token, ...options }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.id) {
          throw new Error(payload?.message || "Không thể gắn trực tiếp tệp trên máy vào hàng đợi Remake.");
        }
        id = payload.id;
      } else {
        const file = localFile!;
        let sessionId = uploadId.current;
        if (!sessionId) {
          const { upload } = await uploadRequest<{ upload: { uploadId: string; uploaded: number; size: number } }>({
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "begin", filename: file.name, size: file.size, ...options }),
          });
          sessionId = upload.uploadId;
          uploadId.current = sessionId;
        }
        const { upload } = await uploadRequest<{ upload: { uploaded: number; size: number } }>(undefined, sessionId);
        setUploadProgress({ uploaded: upload.uploaded, size: upload.size });
        for (let offset = upload.uploaded; offset < file.size; offset += uploadChunkSize) {
          const end = Math.min(file.size, offset + uploadChunkSize);
          const chunk = file.slice(offset, end);
          const result = await uploadRequest<{ uploaded: number }>({
            method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: chunk,
          }, sessionId, offset);
          setUploadProgress({ uploaded: result.uploaded, size: file.size });
        }
        ({ id } = await uploadRequest<{ id: string }>({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: sessionId, ...options }),
        }));
      }
      form.reset();
      if (fileInputRef.current) fileInputRef.current.value = "";
      setLocalFile(undefined);
      setPickedLocalVideo(null);
      setLocalPathInput("");
      uploadId.current = "";
      setUploadProgress(undefined);
      setDetailError("");
      setSelected(id);
      router.push(`/video-remake/${encodeURIComponent(id)}`);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, action: "retry" | "create-project" | "delete") {
    if (actingJobId === id) return;
    setActing({ jobId: id, action });
    setDetailError("");
    try {
      if (action === "delete") {
        await remakeRequest<{ ok: boolean }>({ method: "DELETE" }, id);
        setJobs((current) => current.filter((entry) => entry.id !== id));
        if (selected === id) {
          setSelected("");
          setJob(undefined);
          setDetailError("");
          router.push("/video-remake");
        }
        setRevision((value) => value + 1);
        return;
      }
      const { slug } = await remakeRequest<{ slug?: string }>({
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }),
      });
      if (slug) {
        await refresh().catch(() => undefined);
        router.push(`/projects/${encodeURIComponent(slug)}`);
      }
      setRevision((value) => value + 1);
    } catch (cause) {
      setDetailError((cause as Error).message);
    } finally {
      setActing((current) => (current?.jobId === id ? null : current));
    }
  }

  const result = selectedJob?.result;
  const agent = selectedJob?.agent;
  const isActingSelected = Boolean(detailSummary && actingJobId === detailSummary.id);
  const normalizedQueueQuery = queueQuery.trim().toLowerCase();
  const filteredJobs = jobs.filter((entry) => {
    if (queueStatus && entry.status !== queueStatus) return false;
    if (!normalizedQueueQuery) return true;
    const searchable = [entry.title, entry.sourceName, entry.url, statusLabels[entry.status]].filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(normalizedQueueQuery);
  });
  const sceneRows = result
    ? result.draft.scenes.flatMap((scene, index) => result.windows[index] ? [{ scene, index, window: result.windows[index] }] : [])
    : [];
  const remakeEpisodes = result ? planRemakeEpisodes(result.windows) : [];
  const normalizedSceneQuery = sceneQuery.trim().toLowerCase();
  const selectedEpisode = remakeEpisodes.find(({ index }) => String(index) === sceneEpisode);
  const filteredSceneRows = sceneRows.filter(({ scene, index }) => {
    if (selectedEpisode && (index + 1 < selectedEpisode.sceneStart || index + 1 > selectedEpisode.sceneEnd)) return false;
    if (!normalizedSceneQuery) return true;
    const searchable = [
      scene.sourceVisuals, scene.sourceStory, scene.sourceRole, scene.purpose, scene.action,
      scene.location, scene.characters.join(" "), scene.dialogue.map(({ speaker, text }) => `${speaker} ${text}`).join(" "),
      scene.shotSize, scene.cameraMovement, scene.actingBeat, scene.imagePrompt, scene.videoPrompt,
    ].filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(normalizedSceneQuery);
  });
  const scenePageSize = 24;
  const scenePageCount = Math.max(1, Math.ceil(filteredSceneRows.length / scenePageSize));
  const visibleScenePage = Math.min(scenePage, scenePageCount - 1);
  const visibleSceneRows = filteredSceneRows.slice(visibleScenePage * scenePageSize, (visibleScenePage + 1) * scenePageSize);

  return <div className="video-remake">
    <section className="page-heading">
      <div>
          <h1>Remake video</h1>
          <p className="heading-subtitle">Dùng link video hoặc chọn tệp trên máy. Video dài được chia thành các mốc nguồn 5 giây và phân tích theo từng lô; Code Agent tự chọn nhịp cảnh mới 5, 10 hoặc 15 giây.</p>
      </div>
    </section>
    <form onSubmit={submit} className="panel-card remake-panel">
      <div className="card-heading"><h2>Video tham khảo</h2></div>
      <div className="remake-source-tabs" role="tablist" aria-label="Cách thêm video">
        <button type="button" role="tab" aria-selected={sourceMode === "url"} onClick={() => setSourceMode("url")}>Dùng link</button>
        <button type="button" role="tab" aria-selected={sourceMode === "local"} onClick={() => setSourceMode("local")}>Chọn video trên máy</button>
      </div>
      <div className="form-grid">
        <label className="form-field full" style={sourceMode === "url" ? undefined : { display: "none" }}>
          <span>Link video</span>
          <input
            name="url"
            type="url"
            required={sourceMode === "url"}
            disabled={sourceMode !== "url"}
            maxLength={2500}
            placeholder="https://…"
            aria-describedby="remake-source-help"
          />
          <small id="remake-source-help">YouTube, Facebook, TikTok, Douyin, Instagram công khai hoặc link trực tiếp đến MP4, MOV, WebM.</small>
        </label>
        <div className="form-field full" style={sourceMode === "local" ? undefined : { display: "none" }}>
          <span>Tệp video trên máy</span>
          {isLocalHost && <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <button
                type="button"
                className="secondary-button"
                disabled={pickingLocal || saving}
                onClick={() => void pickNativeLocalVideo()}
              >
                {pickingLocal ? "Đang mở chọn tệp…" : "Chọn tệp trực tiếp từ máy (0s · Không tải lên · Không giới hạn GB)"}
              </button>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                value={localPathInput}
                disabled={sourceMode !== "local" || saving}
                onChange={(event) => setLocalPathInput(event.currentTarget.value)}
                placeholder="Hoặc dán đường dẫn tệp trên máy (vd: /Users/.../video.mp4)"
                aria-label="Đường dẫn tệp video trên máy"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={pickingLocal || saving || !localPathInput.trim()}
                onClick={() => void resolveTypedLocalPath()}
              >
                Gắn tệp
              </button>
            </div>
            {pickedLocalVideo && <div role="status" style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
              <small>
                <strong>Đã gắn trực tiếp:</strong> {pickedLocalVideo.filename} · {formatFileSize(pickedLocalVideo.size)} ({pickedLocalVideo.displayPath})
              </small>
              <button
                type="button"
                className="text-button"
                onClick={() => setPickedLocalVideo(null)}
              >
                Bỏ chọn
              </button>
            </div>}
          </div>}
          <input
            ref={fileInputRef}
            name="video"
            type="file"
            disabled={sourceMode !== "local"}
            accept=".mp4,.m4v,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              setLocalFile(file);
              if (file) setPickedLocalVideo(null);
              uploadId.current = "";
              setUploadProgress(undefined);
            }}
            aria-describedby="remake-local-help"
          />
          <small id="remake-local-help">
            {isLocalHost
              ? "MP4, MOV, WebM hoặc MKV. Bấm chọn tệp trực tiếp hoặc dán đường dẫn để đọc thẳng trên ổ cứng (không tải lại, không giới hạn dung lượng); hoặc chọn qua hộp tệp trình duyệt bên dưới."
              : "MP4, MOV, WebM hoặc MKV. Đọc theo từng phần, không giới hạn dung lượng tệp."}
          </small>
          {localFile && <small>{localFile.name} · {formatFileSize(localFile.size)}</small>}
          {uploadProgress && <div className="remake-upload-progress" role="status">
            <progress max={uploadProgress.size || 1} value={uploadProgress.uploaded} aria-label="Tiến độ tải video lên" />
            <small>Đang đọc tệp: {Math.floor(uploadProgress.uploaded / Math.max(1, uploadProgress.size) * 100)}% · {uploadProgress.uploaded.toLocaleString("vi-VN")}/{uploadProgress.size.toLocaleString("vi-VN")} byte</small>
          </div>}
        </div>
        <label className="form-field">
          <span>Ngôn ngữ kịch bản</span>
          <select name="language"><option value="vi">Tiếng Việt</option><option value="en">English</option></select>
        </label>
        <label className="form-field">
          <span>Chế độ remake</span>
          <select name="remakeMode" defaultValue="faithful">
            <option value="faithful">Bám sát nhịp &amp; bố cục nguồn</option>
            <option value="creative">Chuyển thể sáng tạo theo định hướng</option>
          </select>
        </label>
        <label className="form-field">
          <span>Lời thoại &amp; âm thanh</span>
          <select name="dialoguePolicy" defaultValue="auto">
            <option value="auto">Tự động theo nguồn (giữ câm/SFX nếu không lời)</option>
            <option value="silent_sfx">Không lời thoại — chỉ diễn xuất, SFX &amp; VFX</option>
            <option value="spoken">Có lời thoại nhân vật</option>
          </select>
        </label>
        <label className="form-field">
          <span>Phong cách hình ảnh</span>
          <select name="imageStyle" defaultValue="">
            <option value="">Tự nhận diện theo video nguồn</option>
            {IMAGE_STYLE_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Thể loại</span>
          <select name="contentGenre" defaultValue="">
            <option value="">Tự nhận diện theo video nguồn</option>
            {CONTENT_GENRES.map((genre) => (
              <option key={genre.value} value={genre.value}>{genre.label}</option>
            ))}
          </select>
        </label>
        <label className="form-field full">
          <span>Định hướng cho phiên bản mới (tùy chọn)</span>
          <textarea name="direction" maxLength={2000} placeholder="Chủ đề, khán giả hoặc kiểu nhân vật bạn muốn phát triển" />
        </label>
        <details className="remake-transcript">
          <summary>Tùy chọn nâng cao &amp; transcript có sẵn</summary>
          <div className="form-grid remake-advanced-grid">
            <label className="form-field">
              <span>Ánh sáng &amp; màu sắc</span>
              <select name="visualStyle" defaultValue="">
                <option value="">Tự nhận diện theo video nguồn</option>
                {VISUAL_STYLE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.value}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Bối cảnh thời đại</span>
              <select name="storySetting" defaultValue="">
                <option value="">Tự nhận diện theo kịch bản</option>
                {STORY_SETTING_OPTIONS.map((setting) => (
                  <option key={setting.value} value={setting.value}>{setting.label}</option>
                ))}
              </select>
            </label>
            <label className="form-field full">
              <span>Lời thoại hoặc phụ đề nguồn</span>
              <textarea name="transcript" maxLength={8000} placeholder="Dán transcript nếu link không có phụ đề hoặc cần chỉnh lời thoại nguồn" />
            </label>
          </div>
        </details>
      </div>
      <div className="remake-actions">
        <button className="primary-button" disabled={saving}>{saving ? sourceMode === "local" ? (uploadProgress?.size ? "Đang tải video lên…" : "Đang chuẩn bị…") : "Đang thêm…" : "Thêm vào hàng đợi"}</button>
        <Link className="text-button" href="/settings">Cài đặt Code Agent CLI</Link>
      </div>
      {error && <p className="remake-error" role="alert">{error}</p>}
    </form>

    <section className="panel-card remake-panel">
      <div className="card-heading"><div><h2>Hàng đợi remake</h2><p className="remake-list-count">{filteredJobs.length === jobs.length ? `${jobs.length} job` : `${filteredJobs.length}/${jobs.length} job`}</p></div></div>
      {loadError && <p className="remake-error" role="alert">{loadError}</p>}
      {!jobs.length && !loadError && <p>Job phân tích sẽ xuất hiện ở đây.</p>}
      {!!jobs.length && <div className="remake-queue-tools">
        <label className="remake-filter-field">
          <span>Tìm job</span>
          <input type="search" value={queueQuery} onChange={(event) => setQueueQuery(event.currentTarget.value)} placeholder="Tên video, nền tảng hoặc link" />
        </label>
        <label className="remake-filter-field remake-status-filter">
          <span>Trạng thái</span>
          <select value={queueStatus} onChange={(event) => setQueueStatus(event.currentTarget.value as "" | RemakeStage)}>
            <option value="">Tất cả</option>
            {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
      </div>}
      <ul className="remake-jobs">
        {filteredJobs.map((entry) => <li key={entry.id}>
          <button type="button" className="remake-job" aria-pressed={selected === entry.id} onClick={() => {
            if (selected === entry.id && detailError) setRevision((value) => value + 1);
            setSelected(entry.id);
            if (selected !== entry.id) router.push(`/video-remake/${encodeURIComponent(entry.id)}`);
            setDetailError("");
          }}>
            <span className="remake-job-copy"><strong>{entry.title || entry.sourceName || (() => { try { return new URL(entry.url).hostname; } catch { return "Video local"; } })()}</strong><small>{entry.sourceName || (() => { try { return new URL(entry.url).hostname.replace(/^www\./, ""); } catch { return "Video trên máy"; } })()} · {entry.sceneCount ? `${entry.sceneCount} cảnh` : "Nhịp tự động"}</small><small>Cập nhật {new Date(entry.updatedAt).toLocaleString("vi-VN")}</small></span>
            <span className={`project-status ${statusClasses[entry.status]}`}>{statusLabels[entry.status]}</span>
          </button>
        </li>)}
      </ul>
      {!!jobs.length && !filteredJobs.length && <p className="remake-empty-filter">Không tìm thấy job phù hợp. Hãy đổi từ khóa hoặc trạng thái.</p>}
    </section>

    {selected && !detailSummary && <section ref={detailRef} id="remake-job-detail" className="panel-card remake-panel remake-detail">
      <div className="card-heading"><h2>Chi tiết job</h2></div>
      {detailError
        ? <p className="remake-error" role="alert">{detailError}</p>
        : <p className="remake-meta" role="status">Đang tải thông tin job…</p>}
    </section>}

    {detailSummary && <section ref={detailRef} id="remake-job-detail" className="panel-card remake-panel remake-detail">
      <div className="card-heading">
        <h2>{result?.draft.title || detailSummary.title || "Chi tiết job"}</h2>
        <div className="remake-detail-links">
          {detailSummary.url ? <a className="text-button" href={detailSummary.url} target="_blank" rel="noreferrer">Mở video nguồn</a>
            : <span className="text-button">Video trên máy · {detailSummary.sourceName}</span>}
          <button type="button" className="text-button" onClick={() => void copyJobLink(detailSummary.id)}>
            {copiedJobId === detailSummary.id ? "Đã sao chép link" : "Sao chép link job"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={isActingSelected}
            onClick={() => void act(detailSummary.id, "delete")}
          >
            {isActingSelected && actingAction === "delete"
              ? (isActiveStage(detailSummary.status) ? "Đang hủy…" : "Đang xóa…")
              : (isActiveStage(detailSummary.status) ? "Hủy job" : "Xóa job")}
          </button>
          {result && (detailSummary.projectSlug
            ? <Link className="primary-button remake-quick-approve" href={`/projects/${encodeURIComponent(detailSummary.projectSlug)}`}>Mở dự án Phim AI</Link>
            : <button type="button" className="primary-button remake-quick-approve" disabled={isActingSelected} onClick={() => void act(detailSummary.id, "create-project")}>{isActingSelected && actingAction === "create-project" ? "Đang tạo dự án…" : `Duyệt & tạo Phim AI · ${remakeEpisodes.length} tập`}</button>)}
        </div>
      </div>
      {detailError && <p className="remake-error" role="alert">{detailError}</p>}
      <p className="remake-meta" role="status">{statusLabels[detailSummary.status]}{agent && ` · ${agentLabels[agent.agent]}${agent.model ? ` · ${agent.model}` : ""}`}{detailSummary.progress && ` · ${detailSummary.progress.completed}/${detailSummary.progress.total} mốc nguồn`}{result && ` · ${result.aspectRatio} · ${transcriptLabels[result.transcript]}`}</p>
      {detailSummary.status === "failed" && <>
        <p className="remake-error">{detailSummary.error}</p>
        <div className="remake-actions">
          <button type="button" className="secondary-button" disabled={isActingSelected} onClick={() => void act(detailSummary.id, "retry")}>{isActingSelected && actingAction === "retry" ? "Đang thử lại…" : "Thử lại"}</button>
          <button type="button" className="text-button" disabled={isActingSelected} onClick={() => void act(detailSummary.id, "delete")}>{isActingSelected && actingAction === "delete" ? "Đang xóa…" : "Xóa job"}</button>
        </div>
      </>}
      {result && <>
        <h3>Phân tích video nguồn</h3>
        <details className="remake-long-section">
          <summary>Xem tóm tắt phân tích nguồn</summary>
          <p>{result.draft.sourceSummary}</p>
        </details>
        <h3>Kịch bản đề xuất</h3>
        <p><strong>{result.draft.logline}</strong></p>
        <details className="remake-long-section">
          <summary>Xem tóm tắt, cấu trúc và thiết kế nhân vật</summary>
          <p>{result.draft.synopsis}</p>
          <dl className="remake-facts">
            {(result.draft.imageStyle || result.draft.visualStyle || result.draft.contentGenre || result.draft.dialoguePolicy) && (
              <div><dt>Phong cách &amp; chế độ âm thanh</dt><dd>{[
                result.draft.dialoguePolicy === "silent_sfx" ? "Không lời thoại (SFX & VFX)" : result.draft.dialoguePolicy === "spoken" ? "Có lời thoại" : "",
                result.draft.imageStyle,
                result.draft.visualStyle,
                result.draft.contentGenre,
                result.draft.storySetting,
              ].filter(Boolean).join(" · ")}</dd></div>
            )}
            <div><dt>Hook mở đầu</dt><dd>{result.draft.openingHook}</dd></div>
            <div><dt>Bước ngoặt</dt><dd>{result.draft.turningPoint}</dd></div>
            <div><dt>Kết thúc</dt><dd>{result.draft.ending}</dd></div>
            <div><dt>Quy tắc nối cảnh</dt><dd>{result.draft.continuity}</dd></div>
          </dl>
          <h4>Nhân vật mới</h4>
          <ul className="remake-characters">{result.draft.characters.map(({ name, description }) => <li key={name}><strong>{name}</strong><p>{description}</p></li>)}</ul>
          <h4>Bối cảnh mới</h4>
          <ul className="remake-characters">{result.draft.locations.map(({ name, description }) => <li key={name}><strong>{name}</strong><p>{description}</p></li>)}</ul>
        </details>
        <h3>Phân cảnh</h3>
        <div className="remake-scene-tools">
          <label className="remake-filter-field">
            <span>Tìm trong cảnh</span>
            <input type="search" value={sceneQuery} onChange={(event) => { setSceneQuery(event.currentTarget.value); setScenePage(0); }} placeholder="Bối cảnh, nhân vật, hành động…" />
          </label>
          <label className="remake-filter-field remake-episode-filter">
            <span>Tập</span>
            <select value={sceneEpisode} onChange={(event) => { setSceneEpisode(event.currentTarget.value); setScenePage(0); }}>
              <option value="all">Toàn bộ video · {remakeEpisodes.length} tập</option>
              {remakeEpisodes.map((episode) => <option value={String(episode.index)} key={episode.index}>
                Tập {String(episode.index + 1).padStart(2, "0")} · {timeline(episode.sourceStart)}–{timeline(episode.sourceEnd)} · {episode.sceneEnd - episode.sceneStart + 1} cảnh
              </option>)}
            </select>
          </label>
          <p className="remake-scene-count" role="status">{filteredSceneRows.length ? `Cảnh ${visibleScenePage * scenePageSize + 1}–${Math.min((visibleScenePage + 1) * scenePageSize, filteredSceneRows.length)} / ${filteredSceneRows.length}${selectedEpisode ? ` trong Tập ${String(selectedEpisode.index + 1).padStart(2, "0")}` : ` trên ${remakeEpisodes.length} tập`}` : "Không có cảnh phù hợp"}</p>
        </div>
        {visibleSceneRows.map(({ scene, index, window }) => {
          const episode = remakeEpisodes.find((item) => index + 1 >= item.sceneStart && index + 1 <= item.sceneEnd);
          return <details className="remake-scene" key={window.start}>
            <summary>Tập {String((episode?.index || 0) + 1).padStart(2, "0")} · Cảnh {index + 1} · Nguồn {seconds(window.sourceStart)}–{seconds(window.sourceEnd)} · Bản mới {seconds(window.duration)}{scene.dialogueMode ? ` · ${scene.dialogueMode === "dialogue_led" ? "Thoại dẫn nhịp" : "Hình ảnh dẫn nhịp"}` : ""}</summary>
            <dl className="remake-facts">
              <div><dt>Hình ảnh nguồn</dt><dd>{scene.sourceVisuals}</dd></div>
              <div><dt>Nội dung và nhịp kể</dt><dd>{scene.sourceStory} {scene.sourceRole}</dd></div>
              <div><dt>Hành động mới · {scene.location}</dt><dd>{scene.action}</dd></div>
              {(scene.shotSize || scene.cameraMovement) && <div><dt>Cỡ cảnh &amp; máy quay</dt><dd>{[scene.shotSize, scene.cameraMovement].filter(Boolean).join(" — ")}</dd></div>}
              {scene.actingBeat && <div><dt>Diễn xuất &amp; trục nhìn</dt><dd>{[scene.actingBeat, scene.eyelineAction].filter(Boolean).join(" · ")}</dd></div>}
              {(scene.sfx || scene.vfx) && <div><dt>SFX &amp; VFX</dt><dd>{[scene.sfx ? `SFX: ${scene.sfx}` : "", scene.vfx && scene.vfx.toLowerCase() !== "none" ? `VFX: ${scene.vfx}` : ""].filter(Boolean).join("\n") || "Không có hiệu ứng đặc biệt"}</dd></div>}
              {scene.dialogue.length > 0 && <div><dt>Lời thoại</dt><dd><ul>{scene.dialogue.map(({ speaker, text, start, end }) => <li key={start}>{seconds(start)}–{seconds(end)} · <strong>{speaker}</strong> {text}</li>)}</ul></dd></div>}
              <div><dt>Prompt ảnh</dt><dd>{scene.imagePrompt}</dd></div>
              <div><dt>Prompt video</dt><dd>{scene.videoPrompt}</dd></div>
            </dl>
          </details>;
        })}
        {filteredSceneRows.length > scenePageSize && <div className="remake-pagination" aria-label="Điều hướng phân cảnh">
          <button type="button" className="secondary-button" disabled={visibleScenePage === 0} onClick={() => setScenePage((page) => Math.max(0, page - 1))}>Cảnh trước</button>
          <span>Trang {visibleScenePage + 1} / {scenePageCount}</span>
          <button type="button" className="secondary-button" disabled={visibleScenePage >= scenePageCount - 1} onClick={() => setScenePage((page) => Math.min(scenePageCount - 1, page + 1))}>Cảnh tiếp</button>
        </div>}
        <div className="remake-actions">
          {detailSummary.projectSlug
            ? <Link className="primary-button" href={`/projects/${encodeURIComponent(detailSummary.projectSlug)}`}>Mở dự án Phim AI</Link>
            : <button type="button" className="primary-button" disabled={isActingSelected} onClick={() => void act(detailSummary.id, "create-project")}>{isActingSelected && actingAction === "create-project" ? "Đang tạo dự án…" : `Duyệt và tạo dự án Phim AI · ${remakeEpisodes.length} tập`}</button>}
          <button type="button" className="secondary-button" disabled={isActingSelected} onClick={() => void act(detailSummary.id, "delete")}>{isActingSelected && actingAction === "delete" ? "Đang xóa…" : "Xóa job"}</button>
        </div>
      </>}
    </section>}
  </div>;
}
