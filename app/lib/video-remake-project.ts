import { normalizeContentGenre, normalizeStorySetting } from "./content-genres";
import { buildContinuityQaReport } from "./continuity-qa";
import { dramaPlanSourceText, normalizeDramaPlan } from "./drama-plan";
import { normalizeEntityName } from "./entity-name";
import { reconcileEpisodeLocations } from "./episode-locations";
import { validateEpisode } from "./episode-script-validation";
import { MAX_PROJECT_CHUNK_SIZE, type ProjectChunk } from "./project-types";
import { evaluateChunkScenes } from "./scene-ai-review";
import { makeActivity, makeProject, saveChunkOutput, updateDataForUser } from "./server-store";
import { continuityContextFromOutput } from "./story-context";
import { normalizeProjectStyleSettings } from "./visual-styles";
import { planRemakeEpisodes, type RemakeJob } from "./video-remake";

function englishStockKeywords(text: string, fallback: string) {
  const words = text
    .replace(/@/gu, "")
    .match(/[A-Za-z][A-Za-z0-9'-]{2,}/gu)
    ?.filter((word) => !/^(?:the|and|with|from|into|over|under|near|side|shot|frame|camera|primary|combo|axis|screen|left|right|single|opening|finished|end|state)$/iu.test(word));
  return words?.length ? [...new Set(words)].slice(0, 8).join(" ").slice(0, 120) : fallback.slice(0, 120);
}

function composeRemakeVideoPrompt(scene: RemakeJob["result"] extends infer R ? R extends { draft: { scenes: Array<infer S> } } ? S : never : never) {
  const base = scene.videoPrompt.trim();
  const extras: string[] = [];
  if (scene.sfx && !/\bSFX\s*:/i.test(base)) extras.push(`SFX: ${scene.sfx}`);
  if (scene.vfx && !/\bVFX\s*:/i.test(base)) extras.push(`VFX: ${scene.vfx}`);
  return extras.length ? `${base}\n${extras.join("\n")}` : base;
}

export async function createRemakeProject(owner: string, job: RemakeJob & { result: NonNullable<RemakeJob["result"]> }) {
  const { draft, windows, aspectRatio } = job.result;
  const slug = `remake-${job.id}`;
  const durationSeconds = windows[windows.length - 1].end;
  const durationMinutes = Number((durationSeconds / 60).toFixed(3));
  const episodePlan = planRemakeEpisodes(windows);
  const chunkSize = Math.min(MAX_PROJECT_CHUNK_SIZE, Math.max(1, Math.ceil(windows.length / episodePlan.length)));
  const contentGenre = normalizeContentGenre(job.input.contentGenre || draft.contentGenre);
  const storySetting = normalizeStorySetting(job.input.storySetting || draft.storySetting);
  const { visualStyle, imageStyle } = normalizeProjectStyleSettings(
    job.input.visualStyle || draft.visualStyle,
    job.input.imageStyle || draft.imageStyle,
  );
  const episodes = episodePlan.map((plannedEpisode, index) => {
    if (episodePlan.length === 1) {
      return { title: draft.title, summary: draft.synopsis, openingHook: draft.openingHook, turningPoint: draft.turningPoint, endHook: draft.ending };
    }
    const first = draft.scenes[plannedEpisode.sceneStart - 1];
    const last = draft.scenes[plannedEpisode.sceneEnd - 1];
    const turningPoint = draft.scenes[Math.floor((plannedEpisode.sceneStart + plannedEpisode.sceneEnd) / 2) - 1].action;
    return {
      title: `${draft.title.slice(0, 145)} · Tập ${index + 1}`,
      summary: [first.action, first === last ? "" : last.action].filter(Boolean).join("\n"),
      openingHook: index === 0 ? draft.openingHook : first.action,
      turningPoint,
      endHook: index === episodePlan.length - 1 ? draft.ending : last.continuityOut,
    };
  });
  const dramaPlan = normalizeDramaPlan({
    ...draft, videoTitle: draft.title, continuityRules: draft.continuity, episodes,
  }, episodePlan.length);

  return updateDataForUser(owner, async (data) => {
    if (data.projects.some((item) => item.slug === slug)) return slug;
    const project = makeProject({
      title: draft.title, sourceUrl: job.localSource ? "" : job.input.url, presetId: "ai-drama", scriptMode: "ai",
      remakeJobId: job.id,
      durationMinutes, chunkSize, language: job.input.language, aspectRatio,
      contentGenre, secondaryGenres: [], storySetting, settingNotes: "",
      visualStyle, imageStyle,
      mediaGeneration: { videoUseSceneImageReference: false },
      sourceText: dramaPlanSourceText(dramaPlan, {
        projectTitle: draft.title, brief: job.input.direction || draft.logline,
        durationMinutes, chunkSize, language: job.input.language,
        totalScenes: windows.length,
        episodeRanges: episodePlan.map(({ sceneStart, sceneEnd }) => ({ sceneStart, sceneEnd })),
      }),
    }, slug);
    const timestamp = project.createdAt;
    const chunks: ProjectChunk[] = episodePlan.map((episode, index) => ({
      id: `A${String(index + 1).padStart(2, "0")}`,
      sceneStart: episode.sceneStart,
      sceneEnd: episode.sceneEnd,
      generatedScenes: 0,
      status: "queued" as const,
      updatedAt: timestamp,
    }));
    const referenceFields = {
      referenceImagePath: "", referenceImageName: "", referenceImageMimeType: "", createdAt: timestamp, updatedAt: timestamp,
    };
    project.videoTitle = draft.title;
    project.dramaPlan = dramaPlan;
    project.scriptProvider = "Code Agent CLI";
    const agentLabel = { codex: "Codex", claude: "Claude Code", antigravity: "Antigravity" }[job.agent.agent];
    project.scriptModel = job.agent.model ? `${agentLabel} · ${job.agent.model}` : agentLabel;
    project.characters = dramaPlan.characters.map((item, index) => ({ ...item, ...referenceFields, id: `char-ai-${index + 1}` }));
    project.locations = dramaPlan.locations.map((item, index) => ({ ...item, ...referenceFields, id: `loc-ai-${index + 1}` }));
    const characterIds = new Map(project.characters.map(({ name, id }) => [normalizeEntityName(name), id]));
    const canonicalCharacterNames = new Map(project.characters.map(({ name }) => [normalizeEntityName(name), name]));
    const locationDescriptions = new Map(project.locations.map(({ name, description, imagePrompt }) => [normalizeEntityName(name), description || imagePrompt]));
    const canonicalLocationNames = new Map(project.locations.map(({ name }) => [normalizeEntityName(name), name]));
    const episodeStarts = new Set(episodePlan.map(({ sceneStart }) => sceneStart));
    const episodeEnds = new Set(episodePlan.map(({ sceneEnd }) => sceneEnd));
    const scenes = draft.scenes.map((scene, index) => {
      const sceneNum = index + 1;
      const window = windows[index];
      const dialogueMode = scene.dialogueMode || (scene.dialogue.length ? "dialogue_led" : "visual_led");
      const rawPrimarySpeaker = scene.dialogue[0]?.speaker || "";
      const primarySpeaker = rawPrimarySpeaker ? (canonicalCharacterNames.get(normalizeEntityName(rawPrimarySpeaker)) || rawPrimarySpeaker) : "";
      const resolvedCharacters = scene.characters.map((name) => canonicalCharacterNames.get(normalizeEntityName(name)) || name);
      const resolvedCharacterIds = scene.characters
        .map((name) => characterIds.get(normalizeEntityName(name)))
        .filter((id): id is string => Boolean(id));
      const locationKey = normalizeEntityName(scene.location);
      const resolvedLocationName = canonicalLocationNames.get(locationKey) || scene.location;
      const act = sceneNum === 1 || episodeStarts.has(sceneNum)
        ? "Opening hook"
        : sceneNum === draft.scenes.length
          ? "Payoff"
          : episodeEnds.has(sceneNum)
            ? "Episode end hook"
            : "Development";
      return {
        id: `S${String(sceneNum).padStart(3, "0")}`,
        start_sec: window.start, end_sec: window.end, duration_sec: window.duration,
        act,
        purpose: scene.purpose, beat_summary: scene.action, media_type: "video",
        dialogue_mode: dialogueMode,
        speaker_character: dialogueMode === "visual_led" && scene.dialogue.length === 0 ? "NONE" : primarySpeaker,
        dialogue_or_voiceover: scene.dialogue.map(({ text }) => text).join("\n"),
        dialogue_segments: scene.dialogue.map(({ speaker, text, start, end }) => {
          const speakerKey = normalizeEntityName(speaker);
          return {
            speaker_character: canonicalCharacterNames.get(speakerKey) || speaker,
            speaker_character_id: characterIds.get(speakerKey),
            text,
            start_sec: start,
            end_sec: end,
          };
        }),
        voiceover_target_sec: scene.dialogue.at(-1)?.end || 0,
        characters: resolvedCharacters, character_ids: resolvedCharacterIds,
        location_name: resolvedLocationName,
        location_description: locationDescriptions.get(locationKey) || "",
        image_keyword: englishStockKeywords(scene.imagePrompt, scene.location),
        video_keyword: englishStockKeywords(scene.actingBeat || scene.videoPrompt, scene.action),
        image_prompt: scene.imagePrompt, video_prompt: composeRemakeVideoPrompt(scene),
        acting_beat: scene.actingBeat || scene.action,
        blocking: scene.blocking || scene.continuityIn,
        shot_size: scene.shotSize || "",
        camera_movement: scene.cameraMovement || "",
        eye_line_action: scene.eyelineAction || "",
        continuity_in: scene.continuityIn, continuity_out: scene.continuityOut,
        source_basis: `${window.sourceStart}–${window.sourceEnd}s · ${scene.sourceRole}`,
        risk_flags: [],
      };
    });
    project.durationSeconds = durationSeconds;
    project.durationMinutes = durationMinutes;
    project.totalScenes = project.completedScenes = scenes.length;
    project.totalChunks = project.completedChunks = chunks.length;
    project.chunks = chunks;
    project.status = "needs_review";
    for (const [index, chunk] of chunks.entries()) {
      const outline = dramaPlan.episodes[index];
      const episodeScenes = scenes.slice(chunk.sceneStart - 1, chunk.sceneEnd);
      const { episode, message } = validateEpisode({
        schema: "scene-script.v1", chunk_id: chunk.id, episode_title: outline.title, chunk_summary: outline.summary,
        episode_hooks: { opening_hook: outline.openingHook, turning_point: outline.turningPoint, end_hook: outline.endHook },
        character_bible: dramaPlan.characters.map(({ name, description, imagePrompt }) => ({ name, description, image_prompt: imagePrompt })),
        location_bible: dramaPlan.locations.map(({ name, description, imagePrompt }) => ({ name, description, image_prompt: imagePrompt })),
        continuity_state: {
          story_so_far: outline.summary, active_characters: [], active_locations: [], open_threads: [],
          next_chunk_plan: dramaPlan.episodes[index + 1]?.openingHook || "",
        },
        scenes: episodeScenes,
      }, true);
      if (!episode) throw new Error(message || "Không nhập được cảnh remake vào Phim AI.");

      chunk.title = outline.title;
      chunk.generatedScenes = episodeScenes.length;
      chunk.status = "completed";
      chunk.updatedAt = timestamp;
      const reconciled = reconcileEpisodeLocations(project.locations, episode.payload, timestamp);
      project.locations = reconciled.locations;
      const review = await evaluateChunkScenes({ project, chunk, scenes: reconciled.scenes, useModel: false });
      const payload = { ...episode.payload, scenes: review.scenes };
      const spokenScenes = episodeScenes.filter((scene) => scene.dialogue_segments.length).length;
      chunk.tts = { status: spokenScenes ? "idle" : "not_needed", completed: 0, failed: 0, total: spokenScenes, updatedAt: timestamp };
      chunk.outputPath = await saveChunkOutput(slug, chunk.id, payload);
      project.aiReviewCount = (project.aiReviewCount || 0) + review.summary.needsChanges;
      project.continuityContext = continuityContextFromOutput({
        payload, chunkId: chunk.id, sceneEnd: chunk.sceneEnd, previousContext: project.continuityContext,
      });
    }
    project.continuityQa = await buildContinuityQaReport(project);
    data.projects.unshift(project);
    data.activities.unshift(makeActivity({
      projectSlug: slug, kind: "project", title: "Đã tạo Phim AI từ bản remake",
      detail: `${scenes.length} cảnh · ${durationSeconds} giây · ${agentLabel} CLI`, status: "success",
    }));
    return slug;
  });
}
