export type OmniVoiceOption = {
  id: string;
  name: string;
  language: string;
  gender?: string;
  description?: string;
  provider?: string;
};

export type OmniVoiceLanguage = {
  code: string;
  label: string;
  count: number;
};

export type OmniVoiceCatalog = {
  provider: "omnivoice";
  voices: OmniVoiceOption[];
  languages: OmniVoiceLanguage[];
};

export const VOICE_LANGUAGE_LABELS: Record<string, string> = {
  vi: "Tiếng Việt",
  en: "English (United Kingdom)",
  "en-US": "English (United States)",
  "en-GB": "English (United Kingdom)",
  zh: "Tiếng Trung · 中文",
  "zh-CN": "Tiếng Trung giản thể · 中文",
  "zh-TW": "Tiếng Trung phồn thể · 中文",
  ja: "Tiếng Nhật · 日本語",
  ko: "Tiếng Hàn · 한국어",
  fr: "Tiếng Pháp · Français",
  "fr-FR": "Tiếng Pháp (Pháp) · Français",
  de: "Tiếng Đức · Deutsch",
  es: "Tiếng Tây Ban Nha · Español",
  "es-ES": "Tiếng Tây Ban Nha (Tây Ban Nha) · Español",
  "pt-BR": "Tiếng Bồ Đào Nha (Brazil)",
  pt: "Tiếng Bồ Đào Nha",
  id: "Tiếng Indonesia",
  hi: "Tiếng Hindi · हिन्दी",
  ar: "Tiếng Ả Rập · العربية",
  th: "Tiếng Thái · ไทย",
  it: "Tiếng Ý · Italiano",
  ru: "Tiếng Nga · Русский",
  tr: "Tiếng Thổ Nhĩ Kỳ · Türkçe",
};

export const FALLBACK_VIDEO_LANGUAGES = [
  "vi", "en-US", "en", "zh", "ja", "ko", "fr", "de", "es", "pt-BR", "id", "hi", "ar", "th", "it", "ru", "tr",
];

const PREFERRED_LANGUAGE_ORDER = ["vi", "en-US", "en", "en-GB", "zh", "ja", "ko", "th", "de", "fr", "es", "pt-BR", "id", "hi", "ar"];

export function voiceLanguageLabel(code: string) {
  const normalized = code.trim().replace(/_/g, "-");
  const base = normalized.split("-")[0]?.toLowerCase() || normalized;
  return VOICE_LANGUAGE_LABELS[normalized] || VOICE_LANGUAGE_LABELS[base] || normalized.toUpperCase();
}

const VOICE_LANGUAGE_ENGLISH_NAMES: Record<string, string> = {
  vi: "Vietnamese",
  en: "English (United Kingdom)",
  "en-US": "English (United States)",
  "en-GB": "English (United Kingdom)",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  id: "Indonesian",
  hi: "Hindi",
  ar: "Arabic",
  th: "Thai",
  it: "Italian",
  ru: "Russian",
  tr: "Turkish",
};

export function voiceLanguagePromptLabel(code: string) {
  const normalized = code.trim().replace(/_/g, "-");
  const base = normalized.split("-")[0]?.toLowerCase() || normalized;
  const name = VOICE_LANGUAGE_ENGLISH_NAMES[base] || normalized.toUpperCase();
  if (normalized === "en" || normalized === "en-US" || normalized === "en-GB") {
    return VOICE_LANGUAGE_ENGLISH_NAMES[normalized];
  }
  return `${name} (${normalized})`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function normalizeVoiceOption(value: unknown): OmniVoiceOption | null {
  const item = asRecord(value);
  if (!item) return null;
  const id = String(item.id ?? item.voice_id ?? item.profile_id ?? "").trim();
  const name = String(item.name ?? item.display_name ?? item.label ?? id).trim();
  const language = String(item.language ?? item.lang ?? item.locale ?? "").trim();
  if (!id || !name || !language) return null;
  return {
    id,
    name,
    language,
    gender: item.gender ? String(item.gender) : undefined,
    description: item.description ? String(item.description) : undefined,
    provider: item.provider ? String(item.provider) : "omnivoice",
  };
}

export function buildVoiceLanguages(voices: OmniVoiceOption[]): OmniVoiceLanguage[] {
  const counts = new Map<string, number>();
  for (const voice of voices) counts.set(voice.language, (counts.get(voice.language) || 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => {
      const leftIndex = PREFERRED_LANGUAGE_ORDER.indexOf(left);
      const rightIndex = PREFERRED_LANGUAGE_ORDER.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
      return voiceLanguageLabel(left).localeCompare(voiceLanguageLabel(right), "vi");
    })
    .map(([code, count]) => ({ code, count, label: voiceLanguageLabel(code) }));
}
