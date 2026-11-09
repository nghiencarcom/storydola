import { AI_DRAMA_CAMERA_COMBO_GUIDANCE } from "./ai-drama-video-prompt-guidance";

const AI_DRAMA_CAMERA_COMBO_GUIDANCE_LINES = AI_DRAMA_CAMERA_COMBO_GUIDANCE
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

export const AI_DRAMA_SOURCE_SCRIPT_TEMPLATE = `PROJECT: [Project name]
VIDEO TITLE: [Short, curiosity-driven title]
TARGET DURATION: [Project duration in minutes]
VIDEO LANGUAGE: [Use the language selected in project settings]
USER IDEA: [One paragraph describing the premise and what makes this story compelling]

LOGLINE:
[Name the protagonist, their concrete goal, the main obstacle, and what they stand to lose.]

FULL STORY AND ENDING:
[Write the complete story from opening through escalation, climax, and ending. Explain the cause and effect between major turns. Make the ending feel earned; do not leave it as an outline of disconnected events.]

CHARACTER BIBLE:
- [Canonical character name, age]: [Role, goal, fear/flaw, relationship, fixed face/hair/build/clothing, and character arc.]
  description: [Stable visual identity and costume in English; include canonical apparent age.]
  image_prompt: [English base appearance prompt only. The app adds the required 1:1 front-view, back-view, and portrait reference-sheet layout automatically. Do not put scene action, camera directions, sheet/grid instructions, or other characters here.]
- [Add one entry per recurring character. Keep names, ages, faces, hair, body shape, and costumes consistent.]

LOCATION BIBLE:
- [Canonical location name]: [Time period, spatial layout, fixed landmarks, materials, lighting/weather, recurring set props, and details that must remain consistent.]
  description: [Stable environment description in English.]
  image_prompt: [English base environment prompt only. The app adds the required 1:1 north/east/south/west reference sheet automatically. Do not include people, scene-specific action, or sheet/grid instructions here.]
- [Add each recurring location; use its exact canonical name as location_name in every scene.]

CHAPTER PLAN (one chapter per project episode):
A01 · [Episode title]
Summary: [Beginning, escalation, turning point, and outcome of this episode.]
Opening hook: [A concrete question, reveal, conflict, or action in the first five seconds.]
Turn: [The discovery, decision, or reversal that changes the stakes.]
End hook: [An earned consequence that gives the next episode a clear starting point.]

A02 · [Next episode title]
Summary: [Continue from A01's ending; do not recap or reset the story.]
Opening hook: [Show the consequence of the previous episode's ending.]
Turn: [What changes the goal, relationship, information, or power?]
End hook: [A specific unresolved consequence that leads into A03.]

[Duplicate the A02 block for every remaining episode in this project.]

CONTINUITY RULES:
- Preserve canonical names, ages, faces, costumes, relationships, locations, and prop ownership.
- Use only the names in this project's source and bibles; preserve their spelling exactly and never copy sample names into a new project.
- Connect every scene and episode by cause and effect; carry forward time, place, knowledge, and emotional state.
- Every scene must be exactly 5, 10, or 15 seconds. Write dialogue first and split one cue per actual speaker turn. Estimate each cue duration independently from its read units, delivery pace, punctuation, and motivated pauses; target 3 read units/second or less and never exceed 3.5. Do not force minimum word counts, equal cue durations, extra turns, or filler. Keep cues within the scene, in chronological order, and match speaker names/timecodes in video_prompt. Intentional visual-led or silent scenes are exempt; leave dialogue_or_voiceover empty, dialogue_segments empty, and voiceover_target_sec at 0. Never put instructions in dialogue fields.
- Each image_prompt is one finished scene image: the exact opening frame at 0 seconds, not a character/location sheet or collage. Use canonical names, describe only the visible blocking/action, composition, required props, project style and selected aspect ratio; the separate bibles define stable appearance and set design.
- Each video_prompt must continue from that exact opening frame, hold the full composition and visible character positions for the first 0.5 seconds, then cover the entire scene with the exact camera time grid: 5s = 0–2.5 / 2.5–5; 10s = 0–2.5 / 2.5–5 / 5–7.5 / 7.5–10; 15s = 0–3 / 3–6 / 6–9 / 9–12 / 12–15. Every range states shot/angle, timed action or reaction, motivated camera path, diegetic SFX, and VFX (write “none” unless the story explicitly requires an effect). Keep exact spoken words only in dialogue_segments; video_prompt names the on-camera speaker and cue time without repeating dialogue.
- Choose one named primary camera combo that fits the scene's beat and blocking; put its name plus the actual start framing, camera path/direction/speed, subject tracking, and end framing in camera_movement. Use the JSON sample's camera_combo_guidance as a menu, never a checklist. A secondary move is optional only when a real beat change motivates it and duration allows.
- Prioritize combos #2, #3, #4, #6, #11, #12, #16, #18, #20, and #22 when their movement fits the story; use the other listed combos as fallbacks, not as required coverage.
- Every episode must have an opening hook that lands in its first 5 seconds, a meaningful turning point, and an earned end hook. Start each next episode with the consequence of the prior end hook; avoid generic intros and recaps.
- Keep production descriptions and prompts in English. Write dialogue in the selected project video language.`;

export const AI_DRAMA_JSON_TEMPLATE = JSON.stringify({
  schema: "scene-script.v1",
  chunk_id: "A01",
  episode_title: "[Episode title]",
  prompt_guidance: {
    character_image_prompt: "English base visual description only; the app appends the required 1:1 three-view character sheet (front, back, portrait). Do not ask for a scene or add sheet layout instructions.",
    location_image_prompt: "English base environment description only; the app appends the required 1:1 four-direction location sheet (north, east, south, west). Do not include people or scene-specific action.",
    scene_image_prompt: "Exactly one finished frame at 0 seconds, with only the canonical characters and location actually present in this scene. Never make a reference sheet or collage.",
    video_prompt: "Select ONE primary camera combo that fits; name it and describe its physical path in camera_movement. Preserve the opening frame and follow the exact duration-specific camera grid. Keep spoken words only in dialogue_segments. Add speaker names and cue times that match the final dialogue_segments; do not repeat lines in the prompt. If dialogue_segments is empty, keep the scene silent with no speech or narration.",
    dialogue: "Dialogue is optional. For speech, write the lines first, split one cue per actual speaker turn, and estimate start_sec/end_sec independently from read units, delivery_pace, punctuation, and motivated pauses. Do not reuse equal durations for different-length lines, force minimum counts, or add filler. Keep cues within duration_sec and synchronized with video_prompt. For a silent or visual_led scene, use dialogue_mode=visual_led, dialogue_or_voiceover=\"\", and dialogue_segments=[]. Never put instructions, placeholders, or narration in dialogue fields.",
  },
  camera_combo_guidance: AI_DRAMA_CAMERA_COMBO_GUIDANCE_LINES,
  character_bible: [],
  location_bible: [],
  episode_hooks: {
    opening_hook: "[A concrete action, visual reveal, or question in the first five seconds.]",
    turning_point: "[The decision or discovery that changes the episode's direction.]",
    end_hook: "[An earned consequence that leads directly into the next episode.]",
  },
  chunk_summary: "[Beginning, escalation, turning point, and outcome of this episode.]",
  continuity_state: {
    story_so_far: "[What has happened so far, without recapping it in the next episode.]",
    active_characters: [],
    active_locations: [],
    important_props: [],
    open_threads: [],
    next_chunk_plan: "[Continue directly from this episode's final consequence.]",
  },
  scenes: [{
    id: "S001",
    start_sec: 0,
    end_sec: 5,
    duration_sec: 5,
    act: "Opening hook",
    purpose: "A small visual surprise creates a clear comic question.",
    beat_summary: "A paper boat circles back to its starting point just as the rain begins.",
    dialogue_mode: "visual_led",
    dialogue_or_voiceover: "",
    dialogue_segments: [],
    voiceover_target_sec: 0,
    media_type: "video",
    characters: [],
    location_name: "",
    location_description: "",
    image_keyword: "paper boat circles in a rain puddle",
    video_keyword: "paper boat drifts in a small loop",
    image_prompt: "One finished opening frame at 0 seconds: a small paper boat sits in a rain puddle beside a curb, a single circular ripple beginning to turn it back toward its starting point. Clear readable composition, playful family-friendly comedy, polished cinematic animation, selected project aspect ratio. No text or collage.",
    video_prompt: "0.0–2.5s: Shot: low close-up at puddle level. Action: hold the opening frame for 0.5s, then let the paper boat drift in a tiny circle. Camera: slow lateral track following the boat. SFX: soft rain and a light water trickle. VFX: none. 2.5–5.0s: Shot: same close-up, slightly wider. Action: the boat returns to its starting point as one larger raindrop nudges it around again. Camera: settle into a gentle static hold. SFX: one soft plip from the raindrop. VFX: none. Silent visual gag; no speech or narration.",
    acting_beat: "A visual gag builds through a simple repeated motion.",
    blocking: "The paper boat remains within the puddle and returns to the same curb-side position.",
    shot_size: "Low close-up",
    camera_movement: "Gentle lateral track with the paper boat, then settle into a static close-up at its starting point.",
    eye_line_action: "No visible character; direct attention to the boat's circular path.",
    continuity_in: "The paper boat rests in the puddle as rain begins.",
    continuity_out: "The boat returns to its starting point as the puddle continues to ripple.",
    source_basis: "Illustrative silent visual scene used only to show the JSON fields.",
    risk_flags: []
  }]
}, null, 2);

/** Build an editable scene-script.v1 skeleton for one existing project episode. */
export function createEpisodeScriptTemplate(chunkId: string, sceneStart: number, sceneEnd: number, timelineStartSec = 0) {
  const normalizedChunkId = chunkId.trim().toUpperCase();
  const videoBeat = (start: string, end: string, purpose: string, opening = false) =>
    `${start}–${end}s: Shot: [shot size and angle]. Action: ${opening ? "Preserve the exact opening image and all visible character positions for 0.0–0.5s, then " : ""}[${purpose}]. Camera: [execute the single primary combo named in camera_movement; specify path/speed or motivated cut and reframe without breaking screen direction]. SFX: [one timed diegetic sound cue, or none beyond established ambience]. VFX: [none unless an explicit story event requires one].`;
  const openingVideoPrompt = [
    videoBeat("0.0", "3.0", "show the episode hook immediately, then its first reaction", true),
    videoBeat("3.0", "6.0", "advance the hook through a clue, response, or obstacle"),
    videoBeat("6.0", "9.0", "show the next cause-and-effect action and reaction"),
    videoBeat("9.0", "12.0", "escalate the stakes with a visible change"),
    videoBeat("12.0", "15.0", "end on a consequential turn that motivates the next beat"),
    "Use one named primary camera combo from camera_combo_guidance for the entire scene; a secondary move is optional only if the story beat changes. Keep exact dialogue only in dialogue_segments. Add on-camera speaker cues here only for actual non-empty dialogue segments; when dialogue_segments is empty, show the scene silently with no speech or narration. Never put instructions or placeholders in dialogue fields. State continuous ambience once. No unsupported sounds or props.",
  ].join(" ");
  const ongoingVideoPrompt = [
    videoBeat("0.0", "3.0", "continue directly from the previous scene and preserve its established state", true),
    videoBeat("3.0", "6.0", "advance the cause-and-effect action and show reactions"),
    videoBeat("6.0", "9.0", "reveal information or complicate the current goal"),
    videoBeat("9.0", "12.0", "escalate toward the scene turn"),
    videoBeat("12.0", "15.0", "end with a change that motivates the next scene"),
    "Use one named primary camera combo from camera_combo_guidance for the entire scene; a secondary move is optional only if the story beat changes. Keep exact dialogue only in dialogue_segments. Add on-camera speaker cues here only for actual non-empty dialogue segments; when dialogue_segments is empty, show the scene silently with no speech or narration. Never put instructions or placeholders in dialogue fields. State continuous ambience once. No unsupported sounds or props.",
  ].join(" ");
  const endingVideoPrompt = [
    videoBeat("0.0", "3.0", "continue directly from the previous scene and preserve its established state", true),
    videoBeat("3.0", "6.0", "advance the immediate consequence"),
    videoBeat("6.0", "9.0", "reveal or complicate the central question"),
    videoBeat("9.0", "12.0", "build toward the episode's end hook"),
    videoBeat("12.0", "15.0", "show an earned discovery or consequence that leads directly into the next episode"),
    "Use one named primary camera combo from camera_combo_guidance for the entire scene; a secondary move is optional only if the story beat changes. Keep exact dialogue only in dialogue_segments. Add on-camera speaker cues here only for actual non-empty dialogue segments; when dialogue_segments is empty, show the scene silently with no speech or narration. Never put instructions or placeholders in dialogue fields. State continuous ambience once. No unsupported sounds or props.",
  ].join(" ");
  const scenes = Array.from({ length: Math.max(1, sceneEnd - sceneStart + 1) }, (_, index) => {
    const sceneNumber = sceneStart + index;
    const timelineStart = timelineStartSec + index * 15;
    const timelineEnd = timelineStart + 15;
    const sceneId = `S${String(sceneNumber).padStart(3, "0")}`;
    return {
      id: sceneId,
      start_sec: timelineStart,
      end_sec: timelineEnd,
      duration_sec: 15,
      act: index === 0 ? "Opening hook" : index === sceneEnd - sceneStart ? "Episode end hook" : "[Phát triển / bước ngoặt / cao trào]",
      purpose: index === 0
        ? "[Hook phải xuất hiện ngay trong 0–5s: hành động, câu hỏi, manh mối hoặc xung đột khiến người xem muốn biết tiếp. Không chào hỏi/recap.]"
        : index === sceneEnd - sceneStart
          ? "[Kết tập bằng hệ quả hoặc phát hiện cụ thể, tạo câu hỏi và nối trực tiếp sang tập sau.]"
          : "[Mục tiêu kịch tính của cảnh và điều thay đổi sau cảnh]",
      beat_summary: index === 0
        ? "[Mở thẳng vào hook của tập; nêu hành động/manh mối và câu hỏi khán giả sẽ muốn được giải đáp.]"
        : index === sceneEnd - sceneStart
          ? "[Mô tả hệ quả hoặc phát hiện cuối tập; gieo end hook có căn cứ trong diễn biến.]"
          : "[Mô tả hành động, phản ứng và kết quả theo quan hệ nhân quả]",
      dialogue_mode: "visual_led",
      dialogue_or_voiceover: "",
      dialogue_segments: [],
      voiceover_target_sec: 0,
      media_type: "video",
      characters: [],
      location_name: "",
      location_description: "",
      image_keyword: "[Từ khóa hình ảnh chính]",
      video_keyword: "[Từ khóa hành động/chuyển động chính]",
      image_prompt: "[English: describe exactly ONE finished 0-second opening frame; use canonical character names, frame-specific action/expression/blocking, shot size/angle, foreground/midground/background, required props, project style, and selected aspect ratio. Let separate Character/Location Bible references define stable appearance and set design. Never request a reference sheet, grid, collage, or multiple moments here.]",
      video_prompt: index === 0
        ? openingVideoPrompt
        : index === sceneEnd - sceneStart
          ? endingVideoPrompt
          : ongoingVideoPrompt,
      acting_beat: "[Biểu cảm và chuyển biến cảm xúc của từng nhân vật]",
      blocking: "[Vị trí nhân vật, hướng nhìn, chuyển động và quyền sở hữu đạo cụ]",
      shot_size: "[Cỡ cảnh]",
      camera_movement: "[One named primary combo from camera_combo_guidance plus actual start framing, camera path/direction/speed, subject tracking, and end framing]",
      eye_line_action: "[Hướng nhìn và thời điểm đổi hướng nhìn]",
      continuity_in: "[Trạng thái nối tiếp từ cảnh trước: nhân vật, địa điểm, cảm xúc và đạo cụ]",
      continuity_out: "[Trạng thái để cảnh sau tiếp tục tự nhiên]",
      source_basis: `${normalizedChunkId} · [Đoạn kịch bản nguồn làm căn cứ cho cảnh này]`,
      risk_flags: [],
    };
  });

  return JSON.stringify({
    schema: "scene-script.v1",
    chunk_id: normalizedChunkId,
    episode_title: "[Tên tập ngắn, gợi tò mò và gắn với nội dung thật]",
    prompt_guidance: {
      scene_image_prompt: "Exactly one finished opening frame at 0 seconds. Stable appearance and location layout belong in the separate bibles, not repeated as a contact sheet.",
      character_image_prompt: "English base character appearance only; the app appends the 1:1 front/back/portrait reference sheet.",
      location_image_prompt: "English base environment only; the app appends the 1:1 north/east/south/west reference sheet.",
      video_prompt: "Select ONE primary named camera combo that fits the story beat and describe its path in camera_movement. Preserve the opening frame for 0.5s and follow the duration-specific grid: 5s = 0–2.5/2.5–5; 10s = 0–2.5/2.5–5/5–7.5/7.5–10; 15s = 0–3/3–6/6–9/9–12/12–15. Every beat names shot, action/reaction, camera, SFX, and VFX. Exact dialogue belongs only in dialogue_segments. Add speaker cues only for actual lines; if dialogue_segments is empty, do not add speech or narration.",
    dialogue: "Dialogue is optional. For speech, write the lines first, split one cue per actual speaker turn, and estimate start_sec/end_sec independently from read units, delivery_pace, punctuation, and motivated pauses. Do not reuse equal durations for different-length lines, force minimum counts, or add filler. Keep cues within duration_sec and synchronized with video_prompt. For a silent or visual_led scene, use dialogue_mode=visual_led, dialogue_or_voiceover=\"\", and dialogue_segments=[]. Never put instructions, placeholders, or narration in dialogue fields.",
    },
    camera_combo_guidance: AI_DRAMA_CAMERA_COMBO_GUIDANCE_LINES,
    character_bible: [],
    location_bible: [],
    episode_hooks: {
      opening_hook: "[Hook cụ thể phải thể hiện trong 0–5 giây của cảnh mở tập; bắt đầu bằng hành động/manh mối/xung đột/câu hỏi phù hợp, không recap.]",
      turning_point: "[Bước ngoặt làm đổi mục tiêu, thông tin hoặc thế chủ động.]",
      end_hook: "[Hệ quả hoặc phát hiện chưa được giải quyết, khiến muốn xem tập sau; tập sau phải mở bằng hệ quả này.]",
    },
    chunk_summary: "[Tóm tắt tập: mở đầu, diễn biến, bước ngoặt và kết quả; nối tiếp tập trước]",
    continuity_state: {
      story_so_far: "[Tóm tắt sự kiện đã xảy ra, không recap trong tập sau]",
      active_characters: [],
      active_locations: [],
      important_props: [],
      open_threads: [],
      next_chunk_plan: "[Cảnh đầu tập tiếp nối trực tiếp hệ quả này]",
    },
      scenes,
  }, null, 2);
}
