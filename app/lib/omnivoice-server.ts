import { buildVoiceLanguages, normalizeVoiceOption, type OmniVoiceCatalog, type OmniVoiceOption } from "./omnivoice";
import { getMaiVideoApiKey } from "./maivideo-api-keys";

type VoicePayload = {
  voices?: unknown;
  items?: unknown;
  data?: unknown;
  result?: unknown;
  message?: string;
  detail?: string;
};

function getMaiVideoBaseUrl() {
  return (process.env.MAIVIDEO_BASE_URL || process.env.MAIVIDEO_API_BASE_URL || "https://maivideo.top").trim().replace(/\/+$/, "");
}

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

function extractVoiceRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;

  const record = payload as VoicePayload;
  const data = record.data && typeof record.data === "object" ? record.data as VoicePayload : null;
  const result = record.result && typeof record.result === "object" ? record.result as VoicePayload : null;
  const candidates = [record.voices, data?.voices, result?.voices, record.items, data?.items, result?.items, record.data, data?.data, record.result, result?.data];
  return candidates.find(Array.isArray) as unknown[] | undefined || null;
}

export async function getOmniVoiceCatalog(): Promise<OmniVoiceCatalog> {
  const apiKey = await getMaiVideoApiKey();
  if (!apiKey) throw new Error("MAIVIDEO_API_KEY_REQUIRED");
  const response = await fetch(`${getMaiVideoBaseUrl()}/api/v1/voices?provider=omnivoice`, {
    headers: { Accept: "application/json", "X-API-Key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({})) as VoicePayload;
  if (!response.ok) throw new Error(payload.detail || payload.message || `MaiVideo voices API failed (${response.status})`);
  const rows = extractVoiceRows(payload);
  if (!rows) throw new Error("MAIVIDEO_VOICE_CATALOG_INVALID_RESPONSE");
  const voices = uniqueVoices(rows);
  if (rows.length > 0 && voices.length === 0) throw new Error("MAIVIDEO_VOICE_CATALOG_UNRECOGNIZED_VOICES");
  return { provider: "omnivoice", voices, languages: buildVoiceLanguages(voices) };
}
