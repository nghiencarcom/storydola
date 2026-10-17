const violenceActionTerms = [
  "sexual violence", "sexual assault", "physical violence", "graphic violence", "counterattacking", "counterattacked", "counterattack", "dismemberment", "dismembered", "mutilation", "mutilated", "đập phá", "đánh đập", "đánh nhau", "hành hung", "bóp cổ", "siết cổ", "đẩy ngã", "quật ngã", "xô ngã", "đâm chém", "đâm", "chém", "đấm", "tát", "bắn", "giết", "hạ sát", "tấn công", "violently", "violent", "violence", "torturing", "tortured", "torture", "brutality", "brutal",
  "strangling", "strangled", "strangle", "choking", "choked", "choke", "stabbing", "stabbed", "stabs", "stab", "shooting at", "shooting", "shot at", "shoots at", "murdering", "murdered", "murders", "murder", "raping", "raped", "rape", "killing", "killed", "kills", "kill", "assaulting", "assaulted", "assaults", "assault",
  "attacking", "attacked", "attacks", "attack", "fighting", "fought", "fight", "punching", "punched", "punches", "punch", "kicking", "kicked", "kicks", "kick", "slapping", "slapped", "slaps", "slap", "hitting", "hits", "hit", "hurting", "hurt", "harmed", "harm", "injuring", "injured", "injure", "bạo lực",
];

const graphicDetailTerms = [
  "vết thương", "thương tích", "đổ máu", "máu me", "xác chết", "thi thể", "tử thi", "corpse", "dead body", "wounded", "wounds", "wound", "bleeding", "gory", "gore", "bloody", "blood", "dying", "death",
];

const nudityTerms = [
  "explicit sexual content", "sexual content", "sex scene", "bán khỏa thân", "trần truồng", "khỏa thân", "cởi trần", "hở hang", "không mặc quần áo", "không mặc đồ", "nội y", "đồ lót", "gợi dục", "khêu gợi", "bare-chested", "bare chest", "bare breasts", "underwear", "lingerie", "topless", "nudity", "nude", "naked", "erotic", "sexualized", "sexual", "seductive", "provocative", "revealing", "sexy", "sex",
];

const weaponTerms = ["lưỡi dao", "dao găm", "vũ khí", "súng", "kiếm", "weapon", "gun", "knife", "sword"];

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(terms: string[]) {
  const alternatives = [...terms].sort((left, right) => right.length - left.length).map(escaped).join("|");
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${alternatives})(?=$|[^\\p{L}\\p{N}])`, "giu");
}

function promptLanguageReplacement(term: string, vietnamese: string, english: string) {
  const lower = term.toLocaleLowerCase();
  return /[^\x00-\x7F]/u.test(lower) || ["dao", "sung", "kiem"].includes(lower) ? vietnamese : english;
}

/** Rewrite risky wording in visual prompt text; scene fields outside prompts stay unchanged. */
export function sanitizeDramaVisualPrompt(value: string) {
  return value
    .replace(phrasePattern(violenceActionTerms), (_match, prefix: string, term: string) => `${prefix}${promptLanguageReplacement(term, "đối đầu căng thẳng nhưng không tiếp xúc", "tense non-contact confrontation")}`)
    .replace(phrasePattern(nudityTerms), (_match, prefix: string, term: string) => `${prefix}${promptLanguageReplacement(term, "trang phục kín đáo, phù hợp bối cảnh", "fully clothed in modest, age-appropriate clothing")}`)
    .replace(phrasePattern(graphicDetailTerms), (_match, prefix: string, term: string) => `${prefix}${promptLanguageReplacement(term, "sự việc chỉ được gợi qua phản ứng nhân vật và không gian", "the event is implied through character reactions and the setting")}`)
    .replace(phrasePattern(weaponTerms), (_match, prefix: string, term: string) => `${prefix}${promptLanguageReplacement(term, "đạo cụ trung tính", "neutral prop")}`)
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function sanitizeDramaScenePrompts(scenes: unknown[]) {
  return scenes.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const scene = value as Record<string, unknown>;
    const next = { ...scene };
    for (const key of ["image_prompt", "imagePrompt", "video_prompt", "videoPrompt"]) {
      if (typeof next[key] === "string") next[key] = sanitizeDramaVisualPrompt(next[key] as string);
    }
    return next;
  });
}
