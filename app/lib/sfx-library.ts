import catalogJson from "../../assets/sfx/catalog.json";
import type { AutoEditOverlayKind, AutoEditPresetId } from "./auto-edit";

export type SfxCategory =
  | "hook_impact"
  | "transition_whoosh"
  | "card_reveal"
  | "highlight_pop"
  | "ui_tech"
  | "reaction_glitch";

export type SfxCatalogItem = {
  id: string;
  filename: string;
  label: string;
  category: SfxCategory;
  durationMs: number;
  peakDb: number;
  usage: string;
};

export const SFX_CATEGORY_LABELS: Record<SfxCategory, string> = {
  hook_impact: "Hook & Điểm nhấn mạnh",
  transition_whoosh: "Chuyển cảnh & Lướt (Whoosh)",
  card_reveal: "Hiện thẻ sản phẩm (Reveal)",
  highlight_pop: "Nảy chữ, Giá & Chuông (Pop/Ding)",
  ui_tech: "Click chuột, Bàn phím & Công nghệ",
  reaction_glitch: "Cảm xúc (Wow/Buzzer) & Glitch",
};

export const SFX_CATALOG: readonly SfxCatalogItem[] = catalogJson.items as SfxCatalogItem[];

const sfxMap = new Map<string, SfxCatalogItem>(SFX_CATALOG.map((item) => [item.id, item]));

export function getSfxById(id?: string | null): SfxCatalogItem | undefined {
  if (!id || id === "none") return undefined;
  return sfxMap.get(id.trim().toLowerCase());
}

export function isValidSfxId(id?: string | null): boolean {
  if (!id) return false;
  if (id === "none") return true;
  return sfxMap.has(id.trim().toLowerCase());
}

export function pickDefaultOverlaySfx(
  overlay: {
    kind: AutoEditOverlayKind;
    priceTag?: string;
    emoji?: string;
    title?: string;
  },
  index: number,
  preset: AutoEditPresetId,
): string {
  if (overlay.kind === "hook_banner") {
    if (preset === "minimal-aesthetic" || preset === "vlog-travel" || preset === "podcast-talk" || preset === "real-estate") {
      return "whoosh-soft";
    }
    if (preset === "fast-tiktok" || preset === "gaming-highlight") return "transition-rise";
    if (preset === "tech-unbox" || preset === "tutorial-saas" || preset === "news-recap" || preset === "edu-course") {
      return "transition-sweep";
    }
    return "reveal-woosh";
  }

  if (overlay.kind === "spotlight_box") {
    return preset === "tech-unbox" || preset === "tutorial-saas" ? "mouse-clicks" : "reveal-click";
  }

  if (overlay.kind === "highlighter") {
    return "swoosh";
  }

  if (overlay.kind === "freeze_frame") {
    return "camera-shutter";
  }

  if (overlay.kind === "product_card") {
    const combined = `${overlay.priceTag || ""} ${overlay.title || ""}`.toLowerCase();
    if (/(?:\d+\s*k\b|vnđ|đồng|\$|giá|ưu đãi|sale|deal|miễn phí|tỷ|triệu)/iu.test(combined) && index === 0) {
      return preset === "minimal-aesthetic" || preset === "real-estate" ? "reveal-chime" : "ding";
    }
    const pools: Record<AutoEditPresetId, string[]> = {
      "ugc-review": ["reveal-sparkle", "whoosh-soft", "reveal-pop", "reveal-chime"],
      "fast-tiktok": ["swoosh", "reveal-pop", "transition-ascending", "reveal-sparkle"],
      "tutorial-saas": ["mouse-clicks", "reveal-click", "reveal-ping", "transition-sweep"],
      "podcast-talk": ["whoosh-soft", "transition-minimal", "reveal-bubble", "reveal-chime"],
      "edu-course": ["swoosh", "reveal-ping", "reveal-click", "transition-minimal"],
      "news-recap": ["transition-sweep", "swoosh", "notification", "reveal-click"],
      "real-estate": ["reveal-chime", "whoosh-soft", "reveal-sparkle", "transition-minimal"],
      "food-mukbang": ["reveal-pop", "reveal-sparkle", "pop", "reveal-chime"],
      "tech-unbox": ["reveal-click", "transition-sweep", "reveal-ping", "mouse-clicks"],
      "vlog-travel": ["whoosh-soft", "transition-minimal", "reveal-bubble", "whoosh-soft"],
      "gaming-highlight": ["transition-ascending", "reveal-pop", "omg-wow", "tada"],
      "minimal-aesthetic": ["reveal-bubble", "whoosh-soft", "transition-minimal", "reveal-ping"],
    };
    const pool = pools[preset] || pools["ugc-review"];
    return pool[index % pool.length];
  }

  if (overlay.kind === "emoji_burst") {
    const em = overlay.emoji || "";
    if (/[😱🤯😮🔥]/u.test(em)) return "omg-wow";
    if (/[❌⛔⚠️🚫]/u.test(em)) return "buzzer";
    if (/[💰💸🤑💎]/u.test(em)) return "money";
    if (/[🎉🏆🥳🚀✅]/u.test(em)) return "tada";
    return "reveal-pop";
  }

  const calloutPool = ["pop", "ding", "notification", "chime"];
  return calloutPool[index % calloutPool.length];
}
