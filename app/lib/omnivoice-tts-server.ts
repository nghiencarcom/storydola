import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function synthesizeOmniVoice(text: string, voiceId: string, language: string, outputPath: string) {
  const baseUrl = (process.env.MAIVIDEO_OMNIVOICE_API_BASE_URL || "http://127.0.0.1:8000").trim().replace(/\/+$/, "");
  const timeoutMs = Math.max(30_000, Math.min(7_200_000, Number(process.env.STORYAI_TTS_TIMEOUT_MS) || 7_200_000));
  const headers: Record<string, string> = {
    "X-HTMLVideo-Internal": "1",
    "X-Session-Id": "public_htmlvideo",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const authToken = String(process.env.MAIVIDEO_OMNIVOICE_AUTH_TOKEN || "").trim();
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
    headers["X-Auth-Token"] = authToken;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/omnivoice/generate-tts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        profile_id: voiceId,
        text,
        provider: "omnivoice",
        language,
        speed: 1,
        num_step: 16,
        guidance_scale: 2,
        pause_comma: 150,
        pause_period: 400,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") throw new Error("Tạo TTS quá thời gian chờ. Hãy thử lại.");
    throw new Error(`Không kết nối được OmniVoice local tại ${baseUrl}. Hãy kiểm tra MaiVideo backend cổng 8000.`);
  }

  const raw = await response.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* handled below */ }
  if (!response.ok) {
    const detail = String(payload.detail || payload.error || raw || `HTTP ${response.status}`).slice(0, 500);
    throw new Error(`OmniVoice ${response.status}: ${detail}`);
  }
  const audioUrl = String(payload.audio_url || "").trim();
  if (!audioUrl) throw new Error("OmniVoice không trả về file âm thanh.");

  const audioResponse = await fetch(new URL(audioUrl, `${baseUrl}/`).toString(), {
    headers: {
      "X-HTMLVideo-Internal": "1",
      "X-Session-Id": "public_htmlvideo",
      ...(authToken ? { Authorization: `Bearer ${authToken}`, "X-Auth-Token": authToken } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!audioResponse.ok) throw new Error(`Không tải được audio OmniVoice (HTTP ${audioResponse.status}).`);

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.part`;
  try {
    const audio = Buffer.from(await audioResponse.arrayBuffer());
    if (audio.byteLength < 44) throw new Error("File âm thanh OmniVoice trả về không hợp lệ.");
    await writeFile(temporaryPath, audio);
    await rename(temporaryPath, outputPath);
  } catch (cause) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw cause;
  }
}
