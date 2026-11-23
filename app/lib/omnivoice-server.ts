import { buildVoiceLanguages, normalizeVoiceOption, type OmniVoiceCatalog, type OmniVoiceOption } from "./omnivoice";
import { getMaiVideoApiBaseUrl, getMaiVideoApiKey } from "./maivideo-api-keys";

function uniqueVoices(values: unknown[]): OmniVoiceOption[] {
  const seen = new Set<string>();
  const voices: OmniVoiceOption[] = [];
  for (const value of values) {
    const voice = normalizeVoiceOption(value);
    if (!voice || seen.has(voice.id)) continue;
    seen.add(voice.id);
    voices.push(voice);
  }
  return voices;
}

export async function getOmniVoiceCatalog(): Promise<OmniVoiceCatalog> {
  const apiKey = await getMaiVideoApiKey();
  if (!apiKey) throw new Error("Chưa lưu API key MaiVideo. Hãy thêm key trong Cài đặt để tải danh sách voice.");
  const response = await fetch(`${getMaiVideoApiBaseUrl()}/api/v1/voices?provider=omnivoice`, {
    cache: "no-store",
    headers: { Accept: "application/json", "X-API-Key": apiKey },
    signal: AbortSignal.timeout(10000),
  });
  const raw = await response.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* handled below */ }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("API key MaiVideo không hợp lệ hoặc chưa được cấp quyền xem voice.");
    if (response.status === 429) throw new Error("MaiVideo đang giới hạn số lần gọi API. Hãy thử lại sau.");
    const detail = String(payload.detail || payload.message || payload.error || raw || `HTTP ${response.status}`).slice(0, 400);
    throw new Error(`Không tải được danh sách voice từ MaiVideo (HTTP ${response.status}): ${detail}`);
  }
  const voices = uniqueVoices(Array.isArray(payload.voices) ? payload.voices : []);
  return { provider: "omnivoice", voices, languages: buildVoiceLanguages(voices) };
}
