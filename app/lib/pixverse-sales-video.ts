import { videoCheckpoint } from "./sales-video-checkpoint";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const base = "https://app-api.pixverse.ai/openapi/v2";
type Payload = { ErrCode?: number; Resp?: Record<string, unknown> };

// PixVerse IDs are int64. Preserve the exact digits when moving them between API calls.
function resourceId(value: unknown) {
  const id = String(value ?? "");
  if (!/^[1-9][0-9]{0,18}$/.test(id)) throw new Error("PixVerse did not return a resource ID");
  return id;
}
type RawJson = { rawJSON(value: string): unknown };

export function pixverseSalesClient(key: string, signal: AbortSignal) {
  async function request(endpoint: string, body?: FormData | Record<string, unknown>) {
    const headers = { "API-KEY": key, "Ai-trace-id": randomUUID() };
    const response = await fetch(base + endpoint, {
      method: body ? "POST" : "GET",
      headers: { ...headers, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    const raw = await response.text();
    const payload = JSON.parse(raw.replace(/("(?:img_id|media_id|video_id)"\s*:\s*)(\d+)/g, '$1"$2"')) as Payload;
    if (!response.ok || payload.ErrCode !== 0 || !payload.Resp) {
      throw new Error(`PixVerse ${endpoint} failed (${response.status}, ${payload.ErrCode ?? "unknown"})`);
    }
    return payload.Resp;
  }
  async function upload(endpoint: string, field: string, file: File, idField: string) {
    const form = new FormData();
    form.append(field, file);
    return resourceId((await request(endpoint, form))[idField]);
  }
  return {
    uploadImage: (url: string) => upload("/image/upload", "image",
      new File([new Uint8Array(Buffer.from(url.split(",")[1], "base64"))], "reference.webp", { type: "image/webp" }), "img_id"),
    uploadMedia: (file: File) => upload("/media/upload", "file", file, "media_id"),
    async generate(input: { images: string[]; video?: string; audio?: string; prompt: string; duration: number; ratio: string; sound: boolean; background: boolean }) {
      const rawId = (id: string) => (JSON as unknown as RawJson).rawJSON(resourceId(id));
      const imageReferences = input.images.map((id, index) => ({
        img_id: rawId(id), type: input.background ? "background" : "subject", ref_name: `Image${index + 1}`,
      }));
      const common = {
        model: "v6", duration: input.video ? 0 : input.duration, quality: "720p",
        aspect_ratio: input.ratio, prompt: input.prompt.slice(0, 5000), generate_audio_switch: input.sound,
      };
      const checkpoint = await videoCheckpoint();
      const created = checkpoint.existingJobId ? { video_id: checkpoint.existingJobId } : input.audio
        ? await request("/video/avatar/generate", { img_id: rawId(input.images[0]), audio_media_id: rawId(input.audio), prompt: input.prompt.slice(0, 5000), quality: "720p" })
        : input.images.length
          ? await request("/video/fusion/generate", {
            ...common, image_references: imageReferences,
            // PixVerse's V6 Reference-to-Video API requires omni mode when a reference video is present.
            ...(input.video ? { reference_mode: "omni", video_references: [{ video_media_id: rawId(input.video), ref_name: "Video1" }] } : {}),
          })
          : await request("/video/text/generate", common);
      const id = resourceId(created.video_id);
      if (!checkpoint.existingJobId && checkpoint.onJobCreated) await checkpoint.onJobCreated(id);
      const deadline = Date.now() + 15 * 60_000;
      while (Date.now() < deadline) {
        const result = await request(`/video/result/${id}`);
        if (result.status === 1 && typeof result.url === "string") return result.url;
        if ([7, 8].includes(Number(result.status))) throw new Error(`PixVerse video ${id} failed (${result.status})`);
        await delay(5000, undefined, { signal });
      }
      throw new Error(`PixVerse video ${id} timed out`);
    },
  };
}
