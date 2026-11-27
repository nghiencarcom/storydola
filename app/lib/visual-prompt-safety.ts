import { normalizePixversePrompt } from "./pixverse-prompt-rules";

export { normalizePixversePrompt };

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
  // Preserve explicit exclusions and ordinary non-person interactions. Rewriting
  // "no blood" or "hit the button" changes otherwise harmless prompt semantics.
  const preserved: string[] = [];
  const protect = (text: string) => {
    const index = preserved.push(text) - 1;
    return `PROMPTSAFEPLACEHOLDER${index}END`;
  };
  const protectedValue = value
    .replace(/\b(?:no|without|avoid|do not show)\s+(?:(?:graphic|physical|sexual)\s+)?(?:violence|blood|gore|nudity|weapons?)(?:\s*(?:,\s*(?:(?:or|and)\s+)?|(?:or|and)\s+)(?:(?:graphic|physical|sexual)\s+)?(?:violence|blood|gore|nudity|weapons?))*\b/gi, protect)
    .replace(/\b(?:hit|hits|hitting|shoot|shooting)\s+(?:(?:the|a|an|its|his|her|their|against|into|onto)\s+)?(?:(?:wet|mossy|cracked|ancient|rocky|stone|wooden|metal|iron|sandy|muddy|heavy|low|high)\s+)*(?:button|key|switch|photo|photograph|scene|film|brakes?|throttle|gas|ground|floor|deck|water|waves?|surf|rocks?|stones?|boulders?|pebbles?|cliffs?|ledges?|walls?|pillars?|columns?|arches?|ruins?|trees?|trunks?|branches?|turf|mud|sand|dust|debris|gravel|shields?|staffs?|blades?|armors?|plates?|rails?|railings?|tables?|crates?|doors?|gates?|bars|barriers?|surfaces?|targets?|marks?|banks?|shores?|flagstones?)\b/gi, protect)
    .replace(/\b(?:violent|violently|brutal)\s+(?:gusts?|gales?|storms?|winds?|waves?|currents?|splashes?|sprays?|shockwaves?|tremors?|jolts?|recoil|downpour|turbulence)\b/gi, protect)
    .replace(/\bshooting\s+(?:straight\s+|high\s+|rapidly\s+|sharply\s+)?(?:up|upward|upwards|down|downward|out|outward|across|past|through|into\s+the\s+(?:air|sky|water|mist))\b/gi, protect)
    .replace(/\b(?:(?:wide|medium|close|tight|extreme|establishing|tracking|handheld|static|panning|low-angle|high-angle|side-angle|eye-level|over-the-shoulder|pov|aerial|crane|dolly|two|single|reaction|insert|reverse|profile|rear|front)\s+(?:[\w-]+\s+){0,2})?shots?\s+at\s+(?!him\b|her\b|them\b|me\b|us\b|you\b|each\s+other\b)/gi, protect)
    .replace(/\b(?:fog|smoke|dust|ash|mist|vine|weed|ice|snow|sand|mud|rain|steam|cloud)-choked\b/gi, protect)
    .replace(/\b(?:fight|fighting|fights|fought)\s+(?:the\s+)?(?:handlebars?|steering\s+wheel|current|wind|gale|storm|waves?|controls?|reins|gravity|balance|turbulence)\b/gi, protect);
  const pixverseNormalized = normalizePixversePrompt(protectedValue, 100_000).prompt;
  return pixverseNormalized
    .replace(phrasePattern(violenceActionTerms), (_match, prefix: string, term: string) => `${prefix}${promptLanguageReplacement(term, "đối đầu căng thẳng nhưng không tiếp xúc", "tense non-contact confrontation")}`)
    .replace(phrasePattern(nudityTerms), (_match, prefix: string, term: string) => `${prefix}${promptLanguageReplacement(term, "trang phục kín đáo, phù hợp bối cảnh", "fully clothed in modest, age-appropriate clothing")}`)
    .replace(phrasePattern(graphicDetailTerms), (_match, prefix: string, term: string) => `${prefix}${promptLanguageReplacement(term, "sự việc chỉ được gợi qua phản ứng nhân vật và không gian", "the event is implied through character reactions and the setting")}`)
    .replace(phrasePattern(weaponTerms), (_match, prefix: string, term: string) => `${prefix}${promptLanguageReplacement(term, "đạo cụ trung tính", "neutral prop")}`)
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/PROMPTSAFEPLACEHOLDER(\d+)END/g, (_match, index) => preserved[Number(index)])
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

/** Return the exact words/phrases in `value` that `sanitizeDramaVisualPrompt` would rewrite. */
export function findUnsafeDramaPromptTerms(value: string): string[] {
  if (!value.trim()) return [];
  const protectedValue = value
    .replace(/\b(?:no|without|avoid|do not show)\s+(?:(?:graphic|physical|sexual)\s+)?(?:violence|blood|gore|nudity|weapons?)(?:\s*(?:,\s*(?:(?:or|and)\s+)?|(?:or|and)\s+)(?:(?:graphic|physical|sexual)\s+)?(?:violence|blood|gore|nudity|weapons?))*\b/gi, " ")
    .replace(/\b(?:hit|hits|hitting|shoot|shooting)\s+(?:(?:the|a|an|its|his|her|their)\s+)?(?:(?:wet|mossy|cracked|ancient|rocky|stone|wooden|metal|iron|sandy|muddy|heavy|low|high)\s+)*(?:button|key|switch|photo|photograph|scene|film|brakes?|throttle|gas|ground|floor|deck|water|stone|stones|rock|rocks|boulder|wall|pillar|column|cliff|ledge|railing|timber|wood|tree|trunk|branch|shield|staff|blade|armor|sand|mud|dirt|dust|debris|crate|table|bars|gate|barrier|surface|target|mark|bank|shore|flagstones?)\b/gi, " ")
    .replace(/\b(?:violent|violently|brutal)\s+(?:gusts?|gales?|storms?|winds?|waves?|currents?|splashes?|sprays?|shockwaves?|tremors?|jolts?|recoil|downpour|turbulence)\b/gi, " ")
    .replace(/\b(?:(?:wide|medium|close|tight|extreme|establishing|tracking|handheld|static|panning|low-angle|high-angle|side-angle|eye-level|over-the-shoulder|pov|aerial|crane|dolly|two|single|reaction|insert|reverse|profile|rear|front)\s+(?:[\w-]+\s+){0,2})?shots?\s+at\s+(?!him\b|her\b|them\b|me\b|us\b|you\b|each\s+other\b)/gi, " ")
    .replace(/\b(?:fog|smoke|dust|ash|mist|vine|weed|ice|snow|sand|mud|rain|steam|cloud)-choked\b/gi, " ")
    .replace(/\b(?:fight|fighting|fights|fought)\s+(?:the\s+)?(?:handlebars?|steering\s+wheel|current|wind|gale|storm|waves?|controls?|reins|gravity|balance|turbulence)\b/gi, " ");
  const allTerms = [...violenceActionTerms, ...nudityTerms, ...graphicDetailTerms, ...weaponTerms];
  const pattern = phrasePattern(allTerms);
  const found: string[] = [];
  for (const match of protectedValue.matchAll(pattern)) {
    const term = (match[2] || "").trim();
    if (term && !found.some((item) => item.toLowerCase() === term.toLowerCase())) found.push(term);
  }
  return found;
}

/** Convert raw combat/impact words into clean kinetic phrasing without mangling sentence grammar. */
export function rewriteKineticActionPromptSafely(value: string): string {
  if (!value.trim() || !findUnsafeDramaPromptTerms(value).length) return value;
  const replacements: Array<[RegExp, string]> = [
    [/\bcounterattacking\b/gi, "countering swiftly"],
    [/\bcounterattacked\b/gi, "countered swiftly"],
    [/\bcounterattacks\b/gi, "counters with a swift lunge"],
    [/\bcounterattack\b/gi, "swift counter-move"],
    [/\bviolently\b/gi, "forcefully"],
    [/\b(?:violent|brutal)\b/gi, "fierce"],
    [/\bbrutality\b/gi, "raw intensity"],
    [/\b(?:physical|graphic|sexual)\s+violence\b/gi, "intense confrontation"],
    [/\bviolence\b/gi, "intense clash"],
    [/\bpunching\b/gi, "driving a heavy forelimb strike"],
    [/\bpunched\b/gi, "drove a heavy strike"],
    [/\bpunches\b/gi, "drives a heavy strike"],
    [/\bpunch\b/gi, "heavy strike"],
    [/\bkicking\b/gi, "sweeping a powerful leg thrust"],
    [/\bkicked\b/gi, "swept a powerful leg thrust"],
    [/\bkicks\b/gi, "sweeps a powerful leg thrust"],
    [/\bkick\b/gi, "sweeping thrust"],
    [/\bslapping\b/gi, "swatting aside"],
    [/\bslapped\b/gi, "swatted aside"],
    [/\bslaps\b/gi, "swats aside"],
    [/\bslap\b/gi, "sharp swat"],
    [/\bhitting\b/gi, "slamming into"],
    [/\bhits\b/gi, "slams into"],
    [/\bhit\b/gi, "impact"],
    [/\battacking\b/gi, "charging forward toward"],
    [/\battacked\b/gi, "charged toward"],
    [/\battacks\b/gi, "lunges forward toward"],
    [/\battack\b/gi, "lunge"],
    [/\bassaulting\b/gi, "pressing forward against"],
    [/\bassaulted\b/gi, "pressed against"],
    [/\bassaults\b/gi, "presses against"],
    [/\bassault\b/gi, "rush"],
    [/\bfighting\b/gi, "clashing with"],
    [/\bfought\b/gi, "clashed with"],
    [/\bfights\b/gi, "clashes with"],
    [/\bfight\b/gi, "clash"],
    [/\b(?:strangling|choking)\b/gi, "grappling tightly"],
    [/\b(?:strangled|choked)\b/gi, "grappled tightly"],
    [/\b(?:strangles|chokes)\b/gi, "grapples tightly"],
    [/\b(?:strangle|choke)\b/gi, "grapple"],
    [/\b(?:stabbing|stabs|stabbed|stab)\b/gi, "thrusts forward"],
    [/\b(?:shooting at|shoots at|shot at|shooting)\b/gi, "aiming toward"],
    [/\b(?:killing|kills|killed|kill|murdering|murders|murdered|murder|dying|death)\b/gi, "overwhelming"],
    [/\b(?:hurting|hurts|hurt|harmed|harm|injuring|injured|injure|wounded|wounds|wound)\b/gi, "staggered"],
    [/\b(?:bleeding|bloody|gory|gore|blood)\b/gi, "dust and impact spray"],
    [/\b(?:corpse|dead body)\b/gi, "fallen figure"],
    [/\b(?:bare-chested|bare chest|topless|naked|nude|nudity)\b/gi, "ruggedly attired"],
    [/\bswords?\b/gi, "forged steel blade"],
    [/\bknives\b|\bknife\b/gi, "forged utility blade"],
    [/\bguns?\b/gi, "holstered sidearm"],
    [/\bweapons?\b/gi, "combat gear"],
  ];
  let next = value;
  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement);
  }
  return findUnsafeDramaPromptTerms(next).length ? sanitizeDramaVisualPrompt(next) : next;
}
