import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMaiVideoApiBaseUrl, getMaiVideoApiKey } from "./maivideo-api-keys";

export async function synthesizeOmniVoice(text: string, voiceId: string, language: string, outputPath: string, userId?: string, signal?: AbortSignal) {
  const baseUrl = getMaiVideoApiBaseUrl();
  const timeoutMs = Math.max(30_000, Math.min(7_200_000, Number(process.env.STORYAI_TTS_TIMEOUT_MS) || 7_200_000));
  const apiKey = await getMaiVideoApiKey(userId);
  if (!apiKey) throw new Error("Chưa lưu API key MaiVideo. Hãy thêm key trong Cài đặt để tạo voice.");
  const normalizedText = text.trim();
  if (!normalizedText) throw new Error("Nội dung tạo voice đang trống.");
  if (Array.from(normalizedText).length > 20_000) throw new Error("Mỗi lượt tạo voice tối đa 20.000 ký tự theo MaiVideo Public API.");
  const languageCode = language.trim().replace(/_/g, "-").split("-")[0]?.toLowerCase() || "auto";
  const supportedLanguages = new Set(["vi", "en", "zh", "ja", "ko", "fr", "de", "es", "ru"]);
  const requestLanguage = supportedLanguages.has(languageCode) ? languageCode : "auto";
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
        text: normalizedText,
        provider: "omnivoice",
        language: requestLanguage,
        speed: 1,
        num_step: 16,
        guidance_scale: 2,
        pause_comma: 150,
        pause_period: 400,
      }),
      signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") throw new Error("Tạo TTS quá thời gian chờ. Hãy thử lại.");
    throw new Error(`Không kết nối được MaiVideo Public API tại ${baseUrl}. Hãy kiểm tra kết nối mạng.`);
  }

  const raw = await response.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = String(payload.detail || payload.message || payload.error || raw || `HTTP ${response.status}`).slice(0, 500);
    if (response.status === 401 || response.status === 403) throw new Error("API key MaiVideo không hợp lệ hoặc chưa được cấp quyền tạo TTS.");
    if (response.status === 429) throw new Error("MaiVideo đang giới hạn số lần tạo voice. Hãy thử lại sau.");
    throw new Error(`MaiVideo TTS API (${response.status}): ${detail}`);
  }
  const audioUrl = String(payload.audio_url || "").trim();
  if (!audioUrl) throw new Error("MaiVideo TTS API không trả về file âm thanh.");
  const resolvedAudioUrl = new URL(audioUrl, `${baseUrl}/`);
  if (resolvedAudioUrl.origin !== new URL(baseUrl).origin) throw new Error("MaiVideo trả về URL audio ngoài domain API; đã chặn gửi API key sang domain khác.");

  const audioResponse = await fetch(resolvedAudioUrl, {
    redirect: "error",
    headers: { Accept: "audio/wav", "X-API-Key": apiKey },
    signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
  });
  if (!audioResponse.ok) throw new Error(`Không tải được audio MaiVideo (HTTP ${audioResponse.status}).`);

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.part`;
  try {
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    if (audio.byteLength < 44) throw new Error("File âm thanh MaiVideo trả về không hợp lệ.");
    await writeFile(temporaryPath, audio);
    await rename(temporaryPath, outputPath);
  } catch (cause) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw cause;
  }
}

export async function synthesizeOmniVoiceFromSrt(srtText: string, voiceId: string, language: string, outputPathBase: string, userId?: string, signal?: AbortSignal) {
  const baseUrl = getMaiVideoApiBaseUrl();
  const timeoutMs = Math.max(30_000, Math.min(7_200_000, Number(process.env.STORYAI_TTS_TIMEOUT_MS) || 7_200_000));
  const apiKey = await getMaiVideoApiKey(userId);
  if (!apiKey) throw new Error("Chưa lưu API key MaiVideo. Hãy thêm key trong Cài đặt để tạo voice.");
  const normalizedSrt = srtText.trim();
  if (!normalizedSrt) throw new Error("Phụ đề SRT đang trống.");
  if (Array.from(normalizedSrt).length > 200_000) throw new Error("Phụ đề SRT vượt giới hạn 200.000 ký tự của MaiVideo.");
  const languageCode = language.trim().replace(/_/g, "-").split("-")[0]?.toLowerCase() || "auto";
  const supportedLanguages = new Set(["vi", "en", "zh", "ja", "ko", "fr", "de", "es", "ru"]);
  const requestLanguage = supportedLanguages.has(languageCode) ? languageCode : "auto";
  const timeoutSignal = () => signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/srt-to-audio`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        voice_id: voiceId,
        provider: "omnivoice",
        srt_text: normalizedSrt,
        language: requestLanguage,
        accurate_timing: true,
        speed: 1,
      }),
      signal: timeoutSignal(),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") throw new Error("Tạo voice từ SRT quá thời gian chờ. Hãy thử lại.");
    if (signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) throw new Error("Đã hủy tạo lại voice.");
    throw new Error(`Không kết nối được MaiVideo Public API tại ${baseUrl}. Hãy kiểm tra kết nối mạng.`);
  }

  const raw = await response.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = String(payload.detail || payload.message || payload.error || raw || `HTTP ${response.status}`).slice(0, 500);
    if (response.status === 401 || response.status === 403) throw new Error("API key MaiVideo không hợp lệ hoặc chưa được cấp quyền tạo voice.");
    if (response.status === 429) throw new Error("MaiVideo đang giới hạn số lần tạo voice. Hãy thử lại sau.");
    throw new Error(`MaiVideo SRT-to-audio API (${response.status}): ${detail}`);
  }

  const audioUrl = String(payload.audio_url || "").trim();
  if (!audioUrl) throw new Error("MaiVideo SRT-to-audio API không trả về file âm thanh.");
  const resolvedAudioUrl = new URL(audioUrl, `${baseUrl}/`);
  if (resolvedAudioUrl.origin !== new URL(baseUrl).origin) throw new Error("MaiVideo trả về URL audio ngoài domain API; đã chặn gửi API key sang domain khác.");

  const audioResponse = await fetch(resolvedAudioUrl, {
    redirect: "error",
    headers: { Accept: "audio/*", "X-API-Key": apiKey },
    signal: timeoutSignal(),
  });
  if (!audioResponse.ok) throw new Error(`Không tải được audio SRT MaiVideo (HTTP ${audioResponse.status}).`);

  const allowedExtensions = new Set([".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac"]);
  const filenameExtension = path.extname(String(payload.filename || "")).toLowerCase();
  const urlExtension = path.extname(resolvedAudioUrl.pathname).toLowerCase();
  const contentType = audioResponse.headers.get("content-type")?.toLowerCase() || "";
  const extension = allowedExtensions.has(filenameExtension) ? filenameExtension
    : allowedExtensions.has(urlExtension) ? urlExtension
      : contentType.includes("mpeg") ? ".mp3" : ".wav";
  const outputPath = `${outputPathBase}${extension}`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.part`;
  try {
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    if (audio.byteLength < 128) throw new Error("File âm thanh SRT MaiVideo trả về không hợp lệ.");
    await writeFile(temporaryPath, audio);
    await rename(temporaryPath, outputPath);
    return outputPath;
  } catch (cause) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw cause;
  }
}
