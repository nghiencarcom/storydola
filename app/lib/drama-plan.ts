import type { DramaProjectPlan, ProjectCharacter, ProjectLocation } from "./project-types";
import { characterReferencePrompt, locationReferencePrompt } from "./ai-drama-reference-prompts";
import { sanitizeDramaVisualPrompt } from "./visual-prompt-safety";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function line(value: unknown, max = 1200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeDramaPlan(value: unknown, expectedEpisodes: number): DramaProjectPlan {
  const input = record(value);
  const characters = Array.isArray(input.characters) ? input.characters.map((value) => {
    const item = record(value);
    const name = line(item.name, 80);
    const description = line(item.description, 1200);
    return { name, description, imagePrompt: characterReferencePrompt(name, sanitizeDramaVisualPrompt(line(item.imagePrompt, 3000) || description)) };
  }).filter((item) => item.name).slice(0, 20) : [];
  const locations = Array.isArray(input.locations) ? input.locations.map((value) => {
    const item = record(value);
    const name = line(item.name, 100);
    const description = line(item.description, 1200);
    return { name, description, imagePrompt: locationReferencePrompt(name, sanitizeDramaVisualPrompt(line(item.imagePrompt, 3000) || description)) };
  }).filter((item) => item.name).slice(0, 30) : [];
  const episodes = Array.isArray(input.episodes) ? input.episodes.map((value) => {
    const item = record(value);
    return {
      title: line(item.title, 160),
      summary: line(item.summary, 3000),
      openingHook: line(item.openingHook, 1000),
      turningPoint: line(item.turningPoint, 1000),
      endHook: line(item.endHook, 1000),
    };
  }) : [];
  if (!line(input.videoTitle, 220) || !characters.length || !locations.length || episodes.length !== expectedEpisodes || episodes.some((item) => !item.title || !item.summary)) {
    throw new Error(`AI chưa trả đủ title video, nhân vật, bối cảnh hoặc ${expectedEpisodes} tập/chương. Hãy tạo lại kịch bản.`);
  }
  return {
    videoTitle: line(input.videoTitle, 220),
    logline: line(input.logline, 1200),
    synopsis: line(input.synopsis, 12000),
    characters,
    locations,
    episodes,
    continuityRules: line(input.continuityRules, 5000),
  };
}

export function dramaPlanSourceText(plan: DramaProjectPlan, input: { projectTitle: string; brief: string; durationMinutes: number; chunkSize: number }) {
  const totalScenes = Math.ceil((input.durationMinutes * 60) / 15);
  return [
    `PROJECT: ${input.projectTitle}`,
    `VIDEO TITLE: ${plan.videoTitle}`,
    `TARGET DURATION: ${input.durationMinutes} minutes`,
    `USER IDEA: ${input.brief}`,
    `LOGLINE: ${plan.logline}`,
    `FULL STORY AND ENDING: ${plan.synopsis}`,
    "CHARACTER BIBLE (canonical names and visual identity; voices are assigned by the application, never by AI):",
    ...plan.characters.map((item) => `- ${item.name}: ${item.description}\n  Character image prompt: ${item.imagePrompt}`),
    "LOCATION BIBLE:",
    ...plan.locations.map((item) => `- ${item.name}: ${item.description}\n  Location image prompt: ${item.imagePrompt}`),
    "CHAPTER PLAN (each chapter maps to one project chunk; keep its scene range and causal continuity):",
    ...plan.episodes.map((item, index) => {
      const sceneStart = index * input.chunkSize + 1;
      const sceneEnd = Math.min(totalScenes, sceneStart + input.chunkSize - 1);
      return `A${String(index + 1).padStart(2, "0")} · ${item.title} · S${String(sceneStart).padStart(3, "0")}–S${String(sceneEnd).padStart(3, "0")}\n  ${item.summary}\n  Opening hook: ${item.openingHook}\n  Turn: ${item.turningPoint}\n  End hook: ${item.endHook}`;
    }),
    `CONTINUITY RULES: ${plan.continuityRules}`,
    "For each scene, duration_sec must be exactly 5, 10, or 15, and end_sec - start_sec must match. Choose the shortest legal duration that stages the complete dramatic beat. If the core action takes under 5 seconds, combine it with its immediate setup, reaction, or consequence into one coherent 5-second beat; never use a shorter duration or pad with a frozen frame, empty silence, slow motion, or unrelated filler. Make the video prompt describe purposeful action throughout the full scene. Supply a precise visual image prompt, dialogue_mode (dialogue_led or visual_led), and separate timed dialogue_segments per speaker. Every dialogue_led scene MUST contain at least 10 spoken words at 5 seconds, 20 at 10 seconds, or 30 at 15 seconds. Keep within 10–15, 20–30, or 30–45 words respectively, never exceeding 3 words per second combined. Split exchanges into 2–4 timed turns when the beat supports it. visual_led or intentionally silent scenes are exempt and must not receive filler dialogue. Include a compelling opening hook in the first five seconds of each episode and an earned end hook that becomes the next episode's opening consequence. Do not select TTS voices.",
  ].join("\n\n");
}

function sourceSection(sourceText: string, marker: string, nextMarker: string) {
  const start = sourceText.indexOf(marker);
  if (start < 0) return "";
  const contentStart = start + marker.length;
  const end = nextMarker ? sourceText.indexOf(nextMarker, contentStart) : -1;
  return sourceText.slice(contentStart, end >= 0 ? end : undefined).trim();
}

/**
 * Keep long AI Drama scene-generation requests focused on the target episode.
 * The full source still remains stored in the project; this is only the
 * per-chunk context sent to the script model.
 */
export function buildDramaChunkSourceText({
  sourceText,
  plan,
  chunkIndex,
  characters,
  locations,
}: {
  sourceText: string;
  plan: DramaProjectPlan;
  chunkIndex: number;
  characters?: ProjectCharacter[];
  locations?: ProjectLocation[];
}) {
  const userIdea = sourceSection(sourceText, "USER IDEA:", "\n\nLOGLINE:");
  const sourceLogline = sourceSection(sourceText, "LOGLINE:", "\n\nFULL STORY AND ENDING:");
  const sourceSynopsis = sourceSection(sourceText, "FULL STORY AND ENDING:", "\n\nCHARACTER BIBLE");
  const sourceChapterPlan = sourceSection(sourceText, "CHAPTER PLAN (each chapter maps to one project chunk; keep its scene range and causal continuity):", "\n\nCONTINUITY RULES:");
  const sourceContinuityRules = sourceSection(sourceText, "CONTINUITY RULES:", "");
  const episode = plan.episodes[chunkIndex];
  const chapterPattern = /(?:^|\n\n)(A\d{2} · [^\n]+)(?:\n([\s\S]*?))?(?=\n\nA\d{2} · |$)/g;
  const chapterEntries = [...sourceChapterPlan.matchAll(chapterPattern)];
  const selectedChapter = chapterEntries[chunkIndex];
  const chapterHeaders = chapterEntries.map((match) => match[1]).filter(Boolean);
  const chapterBody = selectedChapter?.[2] || "";
  const chapterField = (label: string) => chapterBody.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
  const selectedEpisode = {
    title: selectedChapter?.[1]?.split(" · ").slice(1, 2).join(" · ") || episode?.title || `Episode ${chunkIndex + 1}`,
    summary: chapterBody.split(/\n\s*Opening hook:/)[0]?.trim() || episode?.summary || "",
    openingHook: chapterField("Opening hook") || episode?.openingHook || "",
    turningPoint: chapterField("Turn") || episode?.turningPoint || "",
    endHook: chapterField("End hook") || episode?.endHook || "",
  };
  const previousEpisode = plan.episodes[chunkIndex - 1];
  const nextEpisode = plan.episodes[chunkIndex + 1];
  const characterProfiles = characters?.length ? characters : plan.characters;
  const locationProfiles = locations?.length ? locations : plan.locations;

  return [
    `PROJECT: ${plan.videoTitle}`,
    userIdea ? `USER IDEA: ${userIdea.slice(0, 4000)}` : "",
    `LOGLINE: ${(sourceLogline || plan.logline).slice(0, 1600)}`,
    `FULL STORY AND ENDING: ${(sourceSynopsis || plan.synopsis).slice(0, 6500)}`,
    `CHARACTER BIBLE:\n${characterProfiles.map((item) => `- ${item.name}: ${item.description}`).join("\n")}`,
    `LOCATION BIBLE:\n${locationProfiles.map((item) => `- ${item.name}: ${item.description}`).join("\n")}`,
    chapterHeaders.length ? `ALL CHAPTERS (titles only):\n${chapterHeaders.map((item, index) => `${index < chunkIndex ? "PAST" : index === chunkIndex ? "CURRENT" : "UPCOMING"} · ${item}`).join("\n")}` : "",
    previousEpisode ? `IMMEDIATE PREVIOUS CHAPTER — CAUSAL HAND-OFF (use generated continuity context as the source of truth when available):\nTitle: ${previousEpisode.title}\nSummary: ${previousEpisode.summary.slice(0, 1400)}\nEnding hook: ${previousEpisode.endHook}\nStart this chapter with the consequence or complication of that ending. Do not recap or reset.` : "",
    `CURRENT CHAPTER A${String(chunkIndex + 1).padStart(2, "0")} · ${selectedEpisode.title}\n${selectedEpisode.summary}\nOpening hook: ${selectedEpisode.openingHook}\nTurning point: ${selectedEpisode.turningPoint}\nEnd hook: ${selectedEpisode.endHook}`,
    nextEpisode ? `NEXT CHAPTER SEED (foreshadow only where natural; do not skip this chapter's payoff):\nTitle: ${nextEpisode.title}\nSummary: ${nextEpisode.summary.slice(0, 1000)}\nOpening hook: ${nextEpisode.openingHook}` : "",
    "DRAMA CRAFT: Connect adjacent scenes by cause and effect; carry action, location/time, props, character knowledge, and emotional state forward. Make each scene change a goal, relationship, information, stakes, or power. Keep dialogue natural, specific to the speaker, concise, and driven by subtext; remove redundant recap and exposition. End this chapter on an earned consequence that gives the next chapter a clear starting point.",
    "DIALOGUE PACING: Mark a scene dialogue_led only when spoken exchange carries its dramatic beat; mark action/discovery/performance-led scenes visual_led. Every dialogue_led scene MUST contain at least 10 spoken words at 5 seconds, 20 at 10 seconds, or 30 at 15 seconds; keep within 10–15, 20–30, or 30–45 words respectively, below 3 words per second combined. Use 2–4 timed turns where appropriate; keep lines story-specific and leave natural reaction pauses. Silent or visual_led scenes are exempt; do not add filler. The episode opening hook must land in its first five seconds, and the ending must create an earned hook passed into the next episode.",
    `CONTINUITY RULES: ${sourceContinuityRules || plan.continuityRules}`,
  ].filter(Boolean).join("\n\n");
}
