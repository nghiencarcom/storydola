import { buildVoiceLanguages, normalizeVoiceOption, type OmniVoiceCatalog, type OmniVoiceOption } from "./omnivoice";

function getMaiVideoBaseUrl() {
  return (process.env.MAIVIDEO_HTMLVIDEO_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
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

export async function getOmniVoiceCatalog(): Promise<OmniVoiceCatalog> {
  const response = await fetch(`${getMaiVideoBaseUrl()}/api/bootstrap`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`MaiVideo bootstrap failed (${response.status})`);
  const payload = await response.json() as {
    settings?: { omnivoiceVoices?: unknown[] };
    omnivoiceDefaultVoiceOptions?: unknown[];
  };
  const savedVoices = Array.isArray(payload.settings?.omnivoiceVoices) ? payload.settings.omnivoiceVoices : [];
  const defaultVoices = Array.isArray(payload.omnivoiceDefaultVoiceOptions) ? payload.omnivoiceDefaultVoiceOptions : [];
  // Keep saved clone voices and MaiVideo's built-in multilingual presets. The
  // latter are what make languages such as Thai, German, Hindi and Arabic
  // selectable even before the user has uploaded a custom voice profile.
  const voices = uniqueVoices([...savedVoices, ...defaultVoices]);
  return { provider: "omnivoice", voices, languages: buildVoiceLanguages(voices) };
}
