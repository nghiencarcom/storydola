import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMaiVideoApiKey } from "./maivideo-api-keys";

function getMaiVideoBaseUrl() {
  return (process.env.MAIVIDEO_BASE_URL || process.env.MAIVIDEO_API_BASE_URL || "https://maivideo.top").trim().replace(/\/+$/, "");
}

function ttsLanguage(language: string) {
  const supported = new Set(["vi", "en", "zh", "ja", "ko", "fr", "de", "es", "ru"]);
  const base = language.trim().replace(/_/g, "-").split("-")[0]?.toLowerCase();
  return base && supported.has(base) ? base : "auto";
}

export async function synthesizeOmniVoice(text: string, voiceId: string, language: string, outputPath: string) {
  const apiKey = await getMaiVideoApiKey();
  if (!apiKey) throw new Error("MAIVIDEO_API_KEY_REQUIRED");
  if (!voiceId.trim()) throw new Error("Hãy chọn voice OmniVoice từ danh sách MaiVideo.");
  if (!text.trim() || text.length > 20_000) throw new Error("Văn bản TTS phải có từ 1 đến 20.000 ký tự theo giới hạn API MaiVideo.");
  const baseUrl = getMaiVideoBaseUrl();
  const timeoutMs = Math.max(30_000, Math.min(7_200_000, Number(process.env.STORYAI_TTS_TIMEOUT_MS) || 7_200_000));
  const headers: Record<string, string> = {
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/tts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        voice_id: voiceId,
        text,
        provider: "omnivoice",
        language: ttsLanguage(language),
        num_step: 16,
        guidance_scale: 2,
        speed: 1,
        volume: 1,
        pause_comma: 150,
        pause_period: 400,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") throw new Error("Tạo TTS quá thời gian chờ. Hãy thử lại.");
    throw new Error("Không kết nối được MaiVideo TTS API. Hãy kiểm tra kết nối mạng và API key MaiVideo.");
  }

  const raw = await response.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = String(payload.detail || payload.error || raw || `HTTP ${response.status}`).slice(0, 500);
    throw new Error(`MaiVideo TTS ${response.status}: ${detail}`);
  }
  const audioUrl = String(payload.audio_url || "").trim();
  if (!audioUrl) throw new Error("MaiVideo TTS không trả về audio_url.");

  const resolvedAudioUrl = new URL(audioUrl, `${baseUrl}/`);
  if (resolvedAudioUrl.origin !== new URL(baseUrl).origin) {
    throw new Error("MaiVideo TTS trả về audio URL ngoài máy chủ API.");
  }

  const audioResponse = await fetch(resolvedAudioUrl, {
    headers: { Accept: "audio/wav", "X-API-Key": apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!audioResponse.ok) throw new Error(`Không tải được audio MaiVideo (HTTP ${audioResponse.status}).`);

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.part`;
  try {
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    if (audio.byteLength < 44 || audio.subarray(0, 4).toString("ascii") !== "RIFF" || audio.subarray(8, 12).toString("ascii") !== "WAVE") {
      throw new Error("MaiVideo OmniVoice không trả về file WAV hợp lệ.");
    }
    await writeFile(temporaryPath, audio);
    await rename(temporaryPath, outputPath);
  } catch (cause) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw cause;
  }
}
