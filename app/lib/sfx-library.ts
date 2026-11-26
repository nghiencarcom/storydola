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
    if (preset === "minimal-aesthetic") return "whoosh-soft";
    if (preset === "fast-tiktok") return "transition-rise";
    if (preset === "tech-unbox") return "transition-sweep";
    return "reveal-woosh";
  }

  if (overlay.kind === "product_card") {
    const combined = `${overlay.priceTag || ""} ${overlay.title || ""}`.toLowerCase();
    if (/(?:\d+\s*k\b|vnđ|đồng|\$|giá|ưu đãi|sale|deal|miễn phí)/iu.test(combined) && index === 0) {
      return preset === "minimal-aesthetic" ? "reveal-chime" : "ding";
    }
    const pools: Record<AutoEditPresetId, string[]> = {
      "ugc-review": ["reveal-sparkle", "whoosh-soft", "reveal-pop", "reveal-chime"],
      "fast-tiktok": ["swoosh", "reveal-pop", "transition-ascending", "reveal-sparkle"],
      "minimal-aesthetic": ["reveal-bubble", "whoosh-soft", "transition-minimal", "reveal-ping"],
      "tech-unbox": ["reveal-click", "transition-sweep", "reveal-ping", "mouse-clicks"],
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
