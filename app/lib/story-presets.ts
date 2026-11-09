import { MAX_SCENE_DURATION_SEC, type ContinuityContext } from "./project-types";
import { serializeContinuityContext } from "./story-context";
import { voiceLanguagePromptLabel } from "./omnivoice";
import { imageStylePrompt, visualStylePrompt } from "./visual-styles";
import { contentGenrePrompt, storySettingPrompt } from "./content-genres";
import { AI_DRAMA_VIDEO_PROMPT_GUIDANCE } from "./ai-drama-video-prompt-guidance";

export type StoryPresetId = "ai-story" | "audio-story" | "ai-drama";

/** Narrator-led story formats use Flow Ingredients/References, never Frames. */
export function isFlowStoryOnlyPreset(presetId?: StoryPresetId) {
  return presetId === "ai-story" || presetId === "audio-story";
}

export type StoryPreset = {
  id: StoryPresetId;
  label: string;
  shortLabel: string;
  description: string;
  accent: "purple" | "blue" | "orange";
  instructions: string;
  knowledge: string;
};

const sharedKnowledge = `
STORYAI LONG-FORM KNOWLEDGE — SCENE-SCRIPT.V1

- Adapt source transcripts or ideas into an original script. Do not reproduce long copyrighted passages verbatim.
- Each scene has a hard limit of ${MAX_SCENE_DURATION_SEC} seconds. Thirty minutes equals 120 scenes; 60 minutes equals 240 scenes. Split longer beats into additional scenes; never stretch or freeze a shot to fill time.
- The first 5 seconds of each episode must immediately earn attention and put a clear question in the viewer's mind (spoken or implied: who, why, what happens next, can they make it?) through a concrete visual/audio event, clue, conflict, emotional dilemma, rescue/empathy beat, surprise, or fitting comic situation. When useful, pose an in-story dilemma that invites viewers to predict an outcome or choose a side. Choose one or two devices that fit the genre and actual story; make the hook clear, entertaining, and connected to the promised payoff. Never start with a generic greeting, recap, logo, or slow exposition.
- Produce in batches of 10–20 scenes; default to 20 scenes per batch (about five minutes of content).
- Each scene must include: id, start_sec, end_sec, act, purpose, beat_summary, dialogue_or_voiceover, voiceover_target_sec, media_type, image_keyword, video_keyword, image_prompt, video_prompt, continuity_in, continuity_out, source_basis, and risk_flags. For AI Drama, also include dialogue_mode (dialogue_led or visual_led) and dialogue_segments with one cue per character turn and timecodes.
- AI Drama duration invariant: every scene duration_sec must be exactly 5, 10, or 15 seconds, and end_sec - start_sec must equal duration_sec. Select the shortest legal length that fully stages the complete meaningful beat. If one action takes less than 5 seconds, combine it with its immediate setup, reaction, or consequence to create one coherent 5-second beat; never output a shorter duration or fill time with an idle hold, silence, or unrelated action.
- Write dialogue before assigning cue times. Split one cue per actual speaker turn, then estimate each line separately from its read units, delivery pace, punctuation, and short motivated pauses; target at most 3 read units/second and never exceed 3.5. Give longer and shorter lines different time windows when their reading times differ. Do not force a minimum word count, equal cue durations, extra turns, or filler. Keep every cue within the scene and align its speaker/time with video_prompt; choose the shortest legal 5/10/15-second scene duration that fits the complete action, lines, and pauses.
- Keep character, location, prop, and costume IDs stable through continuity_in and continuity_out.
- Write all production descriptions, image prompts, and video prompts in English. Image prompts should specify subject, setting, foreground/midground/background, camera, composition, lighting, mood, materials, style, and aspect ratio without asking for readable text.
- Video prompts should specify motion, camera, lens, speed, acting, ambience, and what must remain consistent with the reference image.
- Choose media_type "video" when a scene requires visible action or camera movement; choose "image" when it can be told with a still or Ken Burns movement.
- Keep image_keyword and video_keyword as specific English stock-search phrases of 4–10 words; do not include stock-brand names.
- Start with a Master Pass: logline, viewer promise, story bible, five-minute chapter outline, and scene manifest.
- For scene batches, return valid schema JSON only, with no markdown fences.
- If only a URL is supplied without a transcript, say that a transcript is required; never pretend to have watched or heard the source.
`;

const sharedInstructions = `
You are the StoryAI Long-form Script Editor. Follow the English production-language and selected video-spoken-language rules in TASK. Write all narrative/production descriptions, character and location descriptions, scene summaries, continuity notes, acting notes, image prompts, and video prompts in English. Write character names naturally for the selected video-language audience. Write only dialogue and voiceover text in the selected video language. If the source uses another language, adapt its meaning without copying its language into production descriptions.

Workflow:
1. Identify the source type, usage rights, and target audience.
2. For MASTER, create the story bible, outline, and scene manifest first; do not write all 240 scenes in one response.
3. For CHUNK, create only the requested scene IDs and time range.
4. For QA, check missing scenes, duplicate IDs, time ranges, duration, continuity, per-turn dialogue timing and segmentation, and prompts. For AI Drama, reject any scene duration other than exactly 5, 10, or 15 seconds, or any mismatch between duration_sec and its time range.
5. For REPAIR, modify only defective scenes and keep passing scenes unchanged. For AI Drama, repair invalid durations to the shortest suitable legal duration and align the action, dialogue, and video timecodes; do not leave idle tails.

Return the exact scene-script.v1 structure when JSON is requested. Never create scenes outside the requested range.
`;

export const STORY_PRESETS: Record<StoryPresetId, StoryPreset> = {
  "ai-story": {
    id: "ai-story",
    label: "AI Story",
    shortLabel: "Story",
    description: "Truyện kể có narrator, giàu hình ảnh và nhịp giữ chân người xem.",
    accent: "purple",
    instructions: `${sharedInstructions}
AI Story style:
- Structure the story as hook → escalation → midpoint → crisis → resolution.
- Prefer one consistent narrator; make voiceover vivid and emotional without unnecessary length.
- Give each scene one clear beat and a reason to continue watching.
- Maintain character and visual bibles for consistent image/video generation.
- Avoid long dialogue; use dialogue when it changes relationships or advances the plot.
`,
    knowledge: `${sharedKnowledge}
AI STORY DEFAULTS:
- narrator-led, cinematic, emotionally clear
- keep 1–3 main characters consistent throughout
- prioritize visual storytelling and a light cliffhanger at the end of each act
`,
  },
  "audio-story": {
    id: "audio-story",
    label: "Audio Story",
    shortLabel: "Audio",
    description: "Voice-first cho truyện audio, audiobook và video dùng voice-over.",
    accent: "blue",
    instructions: `${sharedInstructions}
Audio Story style:
- Prioritize listenability with concise sentences, natural pronunciation, and clear pacing.
- Clearly distinguish NARRATOR, CHARACTER, and SFX/MUSIC when multiple audio layers are used.
- Give each scene an audio goal; note ambience, effects, and required pauses.
- Do not let visuals overpower audio; image_prompt/video_prompt should illustrate what is heard.
- Check voiceover_target_sec and avoid overly dense TTS lines.
`,
    knowledge: `${sharedKnowledge}
AUDIO STORY DEFAULTS:
- voice-first, measured delivery, clean pronunciation
- support narrator, dialogue, SFX, and music cues
- prioritize realistic speaking time over theoretical word counts
`,
  },
  "ai-drama": {
    id: "ai-drama",
    label: "AI Drama",
    shortLabel: "Drama",
    description: "Kịch bản drama có nhân vật, đối thoại, acting và coverage rõ ràng.",
    accent: "orange",
    instructions: `${sharedInstructions}
AI Drama style:
- Build scenes around objective, conflict, turn, and consequence.
- Make the opening scene of each episode land its planned hook within the first 5 seconds, then deepen the question/stakes across the first 15–30 seconds. Make the opening grow from the prior episode's ending when one exists; do not restart the story or repeat a recap.
- Connect every scene by cause and effect: carry forward the last scene's action, location, time, screen direction, props, knowledge, and emotional state. A scene must answer, complicate, or deliberately defer the previous beat and change a goal, relationship, information, stakes, or power. Use a clear transition for any time/location jump; avoid unrelated set pieces, repeated beats, and arbitrary twists.
- Shape each episode toward a meaningful turn and an earned ending hook. The next episode should begin with the consequence of that hook, then advance a new question; plant clues and pay them off without resolving every thread immediately.
- Make dialogue sound speakable and specific to each character's goal, status, temperament, and relationship. Give each exchange a tactic or emotional shift, use subtext, silence, interruption, and reaction where useful, and remove lines that merely repeat visible action or explain information the audience already knows.
- Set dialogue_mode to dialogue_led when the scene's main beat is carried by a spoken exchange, confrontation, negotiation, or revelation; set it to visual_led when action, discovery, or performance carries the beat and any silence is intentional. Write only the turns the dramatic beat needs; do not enforce word counts or add filler. For dialogue_led scenes, first write each line and identify its speaker turn, then estimate its own cue duration from read units, delivery_pace, punctuation, and a motivated pause. Target at most 3 read units per second and never exceed 3.5; longer lines should normally receive longer windows. Use start_sec/end_sec per cue, not one repeated duration, and keep timecodes chronological, inside the scene, and aligned with each speaker cue in video_prompt. Keep lines specific and story-advancing. visual_led and intentional silence may contain no dialogue.
- Create occasional, story-native moments that invite viewers to infer a clue, predict an outcome, or weigh a character's choice. Keep this invitation inside the drama; do not force generic like/subscribe lines or break the fourth wall unless requested.
- A scene may contain multiple dialogue turns. Return dialogue_segments as [{"speaker_character":"canonical Character Bible name or NARRATOR","text":"one spoken turn in the selected video language","start_sec":0.2,"end_sec":1.35,"delivery_pace":"natural","pause_after_sec":0.25}]. Each cue has its own start/end estimated from that line’s read units, pace, punctuation, and motivated pauses. Timecodes are relative to the scene, chronological, and within its actual duration; do not reuse equal windows for lines with different read lengths. Overlap only when intentional.
- dialogue_or_voiceover is the joined spoken text from dialogue_segments for legacy compatibility. Never combine different speakers into one cue; use one dialogue_segment per speaking turn and assign the correct canonical speaker.
- Describe each scene's acting beat, blocking, shot size, camera movement, and important eyelines/actions in English.
- Preserve continuity for age, hair, clothing, props, and emotional state after every turn.
- Do not change location, time, or subject without a transition beat.
- Keep image/video prompts safe and age-appropriate. Show conflict with expression, distance, dialogue, framing, and reactions; avoid direct depictions of harm or graphic detail. If the source asks for unsafe content, imply it off-screen or through reactions. Do not copy risky wording into image_prompt/video_prompt.
`,
    knowledge: `${sharedKnowledge}
AI DRAMA DEFAULTS:
- character-led, conflict-first, cinematic coverage
- use wide/medium/close-up dialogue coverage where useful
- emotional continuity matters as much as visual continuity
- keep the promise of every hook honest, specific, and paid off by the story
- vary tension and quiet beats so escalation feels earned instead of uniformly loud
`,
  },
};

export const DEFAULT_PRESET_ID: StoryPresetId = "ai-story";

export function buildChunkPrompt({
  preset,
  sourceUrl,
  sourceText,
  projectTitle,
  chunkId,
  sceneStart,
  sceneEnd,
  totalScenes,
  contentGenre,
  secondaryGenres,
  storySetting,
  settingNotes,
  visualStyle,
  imageStyle,
  aspectRatio,
  language,
  voiceName,
  continuityContext,
  episodeOpeningScene,
}: {
  preset: StoryPreset;
  sourceUrl?: string;
  sourceText?: string;
  projectTitle?: string;
  chunkId: string;
  sceneStart: number;
  sceneEnd: number;
  totalScenes?: number;
  contentGenre?: string;
  secondaryGenres?: string[];
  storySetting?: string;
  settingNotes?: string;
  visualStyle?: string;
  imageStyle?: string;
  aspectRatio?: string;
  language?: string;
  voiceName?: string;
  continuityContext?: ContinuityContext;
  episodeOpeningScene?: number;
}) {
  const previousContext = continuityContext
    ? `
PREVIOUS CHUNK CONTEXT — SOURCE OF TRUTH FOR CONTINUITY:
${serializeContinuityContext(continuityContext)}

This chunk is a direct continuation. Do not rename established characters,
locations, props, costumes or visual rules. Start from the next scene after
previous_context.sceneEnd and resolve or intentionally carry forward its open
threads. If the source and the generated continuity state appear to conflict,
keep the established generated state unless the source explicitly requires a
correction, and record that correction in continuity_state.
`
    : `
PREVIOUS CHUNK CONTEXT:
No earlier chunk is available. Establish the canonical character, location,
prop, costume and visual identities in continuity_state so later chunks can
continue from them.
`;
  const projectLanguage = language || "vi";
  const openingScene = episodeOpeningScene ?? sceneStart;
  const includesEpisodeOpening = sceneStart <= openingScene && sceneEnd >= openingScene;
  const episodeOpeningPrompt = includesEpisodeOpening
    ? `EPISODE OPENING — FIRST 5 SECONDS ARE MANDATORY: The episode-opening scene is S${String(openingScene).padStart(3, "0")}. If SOURCE TRANSCRIPT / BRIEF provides the current episode's Opening hook, dramatize that hook in seconds 0–5; make it filmable and immediately understandable. Otherwise create a hook that fits the source: start in medias res with one vivid action/image, an urgent question or clue, a rescue/empathy beat, a surprising or funny situation that fits the tone, or a dramatic/controversial choice rooted in the story. The viewer must immediately wonder who/why/what happens next or whether the character will succeed; this question can be spoken or raised by the image/action. When useful, frame an in-story dilemma that makes viewers predict the outcome or choose a side without a generic call to comment. Create curiosity and a clear emotional response; make the audience want the next beat. Connect the hook to the real story conflict and pay it off or develop it later. No greeting, logo, recap, slow setup, or unrelated shock. The hook need not use every device or force humor into a serious story. Put the strongest action/dialogue in seconds 0–5; if this scene runs longer, use the remaining seconds to show consequence, reaction, or escalation. Make video_prompt and any dialogue timing agree with the hook; spoken dialogue, if used, must be in the selected video language.`
    : "";
  const sceneDurationRules = preset.id === "ai-drama"
    ? `- Create exactly ${sceneEnd - sceneStart + 1} scenes. Every AI Drama scene MUST include duration_sec as exactly 5, 10, or 15; never emit another value. Set end_sec - start_sec equal to duration_sec. Choose the shortest legal duration that fully stages the meaningful visual action, reaction, and dialogue; do not choose 15 by default. Use 5 seconds for one brief, complete beat; 10 when setup and consequence need more room; 15 only when the whole dramatic beat genuinely needs it. If the core action takes under 5 seconds, combine it with its immediate setup, reaction, or consequence into one coherent 5-second beat. Do not create a shorter beat and rely on a frozen frame, empty silence, slow motion, or unrelated filler to reach a legal duration. Split an overlong beat into the next requested scene. Make every video_prompt describe purposeful action throughout its full legal duration. Rebuild scene timecodes as one continuous timeline.
- Every AI Drama scene must include dialogue_mode: dialogue_led when the main beat is carried by spoken exchange, confrontation, negotiation, or revelation; visual_led when action, discovery, or performance carries the beat and silence is intentional. Do not enforce a minimum dialogue length, number of turns, or filler. Write the actual exchange first, then time each speaker turn independently from its read units, delivery pace, punctuation, and motivated pause. Target no more than 3 read units/second; 3.5 is the hard ceiling. Longer lines generally need longer windows, so avoid assigning the same duration to visibly different line lengths.
- For AI Drama, dialogue_segments must have one cue per actual speaker turn: speaker_character, text, start_sec, end_sec, delivery_pace (measured, natural, or brisk), and optional pause_after_sec. Use canonical character names; use NARRATOR only when the speaker cannot be identified. Split exchanges in speaking order. Silent scenes must have an empty dialogue_segments array. Keep cues within duration_sec and avoid unintended overlap. Match every on-camera speaker cue and cue time in video_prompt to the final dialogue_segments; keep camera/action time ranges covering the final duration.`
    : `- Create exactly ${sceneEnd - sceneStart + 1} scenes. Each scene has a hard maximum of ${MAX_SCENE_DURATION_SEC} seconds including voiceover pacing and tail padding; target about 13–14.5 seconds. If one beat would exceed the limit, split it into the next scene instead of writing a long voiceover.`;

  return `${preset.instructions}

REFERENCE KNOWLEDGE:
${preset.knowledge}

TASK:
- project_title: ${projectTitle || "Untitled StoryAI Project"}
- chunk_id: ${chunkId}
- scene_range: S${String(sceneStart).padStart(3, "0")}–S${String(sceneEnd).padStart(3, "0")}
- total_scenes: ${totalScenes || "not specified"}
- story_genres: ${contentGenrePrompt(contentGenre, secondaryGenres)}
- story_setting: ${storySettingPrompt(storySetting, settingNotes)}
- visual_direction: ${visualStylePrompt(visualStyle) || "not specified"}
- image_style: ${imageStylePrompt(imageStyle) || "not specified"}
- aspect_ratio: ${aspectRatio || "not specified"}
- production_language: English
- video_spoken_language: ${voiceLanguagePromptLabel(projectLanguage)}
LANGUAGE AND OUTPUT RULES (MANDATORY): Write all story descriptions, scene summaries, character/location descriptions, acting notes, continuity notes, image_prompt, and video_prompt in English. Preserve every character name and proper noun the user supplied in the idea/source exactly; do not translate, anglicize, or replace them. If the user supplied no names, choose names appropriate for the selected video-language audience. Use the same canonical name everywhere. Write dialogue_segments.text and dialogue_or_voiceover only in ${voiceLanguagePromptLabel(projectLanguage)}, translating/adapting source dialogue faithfully when necessary. Do not use the voice profile's catalog language as the spoken language; the selected video_spoken_language controls speech. Keep every instruction inside image_prompt and video_prompt in English.
${preset.id === "ai-drama" ? "- TTS voice is assigned by the application to each character. Never choose, name, or change a voice in the script." : `- voice_name: ${voiceName || "OmniVoice default"}`}
- media_pipeline: prefer stock image/video; use MaiVideo AI only when requested or when stock cannot satisfy the scene.
- source_url: ${sourceUrl || "not provided"}
- episode_opening_scene: S${String(openingScene).padStart(3, "0")}
${episodeOpeningPrompt}
${sceneDurationRules}
- For AI Drama, image_prompt describes exactly one scene frame in English: the literal opening frame at 0 seconds of the corresponding video_prompt. Use canonical character names and describe only frame-specific action, emotion, blocking, shot size/angle, foreground/midground/background composition, necessary props, lighting, mood, style, and aspect ratio. Do not repeat appearance, face, hair, body shape, or clothing from the Character Bible; do not repeat architecture, layout, or materials from the Location Bible. The pipeline will attach selected reference images or add profile descriptions as a fallback. Do not request a multi-panel layout for a scene image.
- For AI Drama, treat the finished scene image as the literal opening frame and authority for location, composition, lighting, palette, visible props, and initial blocking. Begin video_prompt from that frame; when people are visible, hold their original composition and positions briefly before any crop or camera move. Any new framing must follow a described camera move or explicit cut. Character reference images are binding identity and costume references: preserve the same recognizable face, apparent age, hair, proportions, and outfit in every shot; never de-age, recast, swap, merge, duplicate, or morph a character. Do not ask for another location image or restate static character/location descriptions in video_prompt; do not contradict the references or introduce unassigned characters/props.
${AI_DRAMA_VIDEO_PROMPT_GUIDANCE}
- Keep AI Drama visual prompts age-appropriate and platform-safe. Use modest clothing and show conflict through performance, distance, eyelines, framing, and reactions. Avoid direct depictions of harm or graphic details. If the brief requires unsafe content, imply it off-screen or through reactions. Do not copy risky source wording into image_prompt/video_prompt.
- For AI Drama, dialogue_segments are the source of truth for spoken lines and timing. Each cue must use a canonical speaker_character, text in the selected ${voiceLanguagePromptLabel(projectLanguage)} video-spoken language, and start_sec/end_sec within the scene duration. Include delivery_pace when possible (measured, natural, brisk), and pause_after_sec only for a motivated pause. Estimate each line independently after writing it; do not assign identical windows to different-length lines. Split actual speaker turns in order; avoid overlap unless intentional. Keep video_prompt speaker cue names and times synced to these final cue times.
- Keep visual motion, sound direction, and dialogue aligned with duration_sec. A justified ambience bed may continue across the shot; do not leave an idle visual tail after the action is complete or stretch speech to fill it.
- For AI Drama, each scene must also include concise, shootable acting_beat, blocking, shot_size, camera_movement, and eye_line_action fields; do not leave these details only in video_prompt.
- For AI Drama, every scene must include location_name using the exact canonical name from the LOCATION BIBLE, plus location_description when useful. Assign one primary location to every scene so the application can add that location's canonical visual description to the prompt sent for scene-image generation. An existing location reference image may also be attached, but do not require a pre-generated image. If the story moves to a new recurring place, add it to the location bible and use that canonical name consistently.
- Treat scene IDs and timecodes as one continuous timeline, never as a new story
  starting at the beginning of each chunk.
- For AI Drama, carry cause-and-effect and character intent across adjacent scenes; do not use a new scene or episode as a reset. Make transitions legible, let reactions follow the action that caused them, and keep dialogue natural, character-specific, concise, and subtextual. Use a clue, dilemma, or prediction opportunity only when it arises organically from the plot; never add a generic audience CTA.
- Return JSON only with this top-level shape:
  { "schema": "scene-script.v1", "chunk_id": "${chunkId}", "scenes": [],
    "chunk_summary": "...", "continuity_state": {} }
- Each scene must include media_type, image_keyword, and video_keyword so the pipeline can find relevant stock assets. AI Drama scenes must also include duration_sec (exactly 5, 10, or 15). Keywords and all production text must be in English; dialogue and voiceover must be in the selected video-spoken language.
- continuity_state must be a complete hand-off for the next chunk, not just a
  delta. Include story_so_far, active_characters (name, appearance, costume,
  goal, emotional_state, location), active_locations, important_props,
  open_threads, and next_chunk_plan. Keep it concise and factual.
${previousContext}

SOURCE TRANSCRIPT / BRIEF:
${sourceText || "No transcript was supplied. Return NEEDS_TRANSCRIPT instead of inventing source content."}
`;
}
