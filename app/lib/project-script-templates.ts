import { EPISODE_LOCATION_BIBLE_GUIDANCE, IMAGE_SCENE_VARIETY_GUIDANCE } from "./image-scene-guidance";
import { VIDEO_REFERENCE_RULES } from "./video-prompt-policy";
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
Opening hook: [Start the conflict immediately; make the hook clear within 3 seconds, or use up to 5 seconds if the dramatic beat needs more room. Do not pad it.]
Turn: [The discovery, decision, or reversal that changes the stakes.]
End hook: [An earned consequence that gives the next episode a clear starting point.]

A02 · [Next episode title]
Summary: [Continue from A01's ending; do not recap or reset the story.]
Opening hook: [Show the consequence of the previous episode's ending.]
Turn: [What changes the goal, relationship, information, or power?]
End hook: [A specific unresolved consequence that leads into A03.]

[Duplicate the A02 block for every remaining episode in this project.]

CONTINUITY RULES:
- ${IMAGE_SCENE_VARIETY_GUIDANCE}
- ${EPISODE_LOCATION_BIBLE_GUIDANCE}
- Preserve canonical names, ages, faces, costumes, relationships, locations, and prop ownership.
- Use only the names in this project's source and bibles; preserve their spelling exactly and never copy sample names into a new project.
- Connect every scene and episode by cause and effect; carry forward time, place, knowledge, and emotional state.
- Every scene must be exactly 5, 10, or 15 seconds. Dialogue is optional: visual comedy, action-led and intentionally silent scenes need no speech or filler. For spoken scenes, do not impose a words-per-second cap or target word count. Let each complete line follow the character’s voice, intention, emotion, breath and performance. Keep cue times plausible within the scene; if a beat needs more time, choose a longer legal scene or split at a natural turn. Never truncate a natural line or add filler to satisfy a numerical target. For dialogue_led, silence limits are mandatory: EACH continuous gap must be <=3s, and TOTAL silence must be <=4s per 10s scene or <=5s per 15s scene. Count leading, inter-cue and trailing gaps using the union of valid scene-relative cue intervals; exceeding either limit rejects import. Across adjacent dialogue_led scenes, previous trailing silence + any timeline gap + next leading silence must also be <=3s; visual_led/intentional silence breaks this check. Cue start_sec/end_sec are relative to the scene, not the episode timeline. Missing or invalid cues cannot establish speech coverage. visual_led and intentionally silent scenes are exempt from silence checks; mark intentional silence as dialogue_mode visual_led with empty dialogue fields. Keep scene-relative cues when speech exists, allocating turns naturally without mandatory speech density. Split exchanges into 2–4 timed turns when appropriate. Intentional visual-led or silent scenes are exempt and must not receive filler dialogue; leave dialogue_or_voiceover empty, dialogue_segments empty, and voiceover_target_sec at 0. Never put instructions in dialogue fields.
- Each image_prompt is one finished scene image: the exact opening frame at 0 seconds, not a character/location sheet or collage. Use canonical names, describe only the visible blocking/action, composition, required props, project style and selected aspect ratio; the separate bibles define stable appearance and set design.
- When a character reference image is attached, use it as the sole visual identity source; specific age and facial-appearance descriptions are forbidden; general reference-binding/preservation rules are allowed in scene prompts. Frame-specific expression and acting are allowed. If no character image is attached, follow the canonical Character Bible/profile and do not invent or change age or identity. Preserve established age and identity in the Character Bible and character reference prompt.
- Establish fixed left/right positions, landmarks, eyelines, and the 180-degree axis only from the source, location bible, prior scene, opening frame, or explicit blocking. Preserve the established axis through dialogue coverage; cross it only with a motivated visible move/reblocking that re-establishes screen direction. Do not invent fixed set details or exclusions such as “NO doors visible.”
- Each video_prompt continues naturally from its exact initial image for a duration of 5, 10 or 15 seconds. No fixed opening hold, equal time grid, periodic camera change or maximum shot length. A continuous shot is allowed. Describe action, reaction, necessary camera path, SFX and VFX; use precise event timestamps only when synchronization matters. Preserve required effects and their timing. Exact dialogue belongs only in dialogue_segments.
- Choose one named primary camera combo that fits the scene's beat and blocking; put its name plus the actual start framing, camera path/direction/speed, subject tracking, and end framing in camera_movement. Use the JSON sample's camera_combo_guidance as a menu, never a checklist. A secondary move is optional only when a real beat change motivates it and duration allows.
- Prioritize combos #2, #3, #4, #6, #11, #12, #16, #18, #20, and #22 when their movement fits the story; use the other listed combos as fallbacks, not as required coverage.
- Every episode must begin in medias res with immediate conflict; make the hook clear within 3 seconds, or use up to 5 seconds when the dramatic beat needs more room. Do not pad it. Include a meaningful turning point and an earned ending hook. Start each next episode with the consequence of the prior end hook; avoid generic intros and recaps.
- Keep production descriptions and prompts in English. Write dialogue in the selected project video language.`;

/** Included inside every copied episode JSON, so generation does not depend on chat history. */
export const EPISODE_PROMPT_GUIDANCE = {
  scene_duration: "Choose exactly 5, 10 or 15 seconds per scene according to complete action, speech and reaction. The editable skeleton's 15s values are placeholders, not a required duration. After choosing durations, recalculate start_sec/end_sec consecutively from the episode timeline start; end_sec-start_sec must equal duration_sec. Dialogue and event times are scene-relative.",
  natural_timing: "Use irregular, scene-motivated timing, not equal divisions or a preset 2.5s/3s grid. Vary beat lengths and count with action, dialogue, comic setup/payoff and emotional reactions; do not randomize timestamps arbitrarily. A single continuous shot may span the entire 5s/10s/15s clip. Motion may begin immediately; no mandatory opening hold, periodic cut/reframe or maximum shot length. Use exact event times only when synchronization matters. If time ranges are used, make them follow the real events, remain within duration_sec and preserve meaningful progression through the end; a range boundary is not automatically a cut. Do not copy the same timing pattern across scenes.",
  visual_variety: IMAGE_SCENE_VARIETY_GUIDANCE,
  episode_locations: EPISODE_LOCATION_BIBLE_GUIDANCE,
  scene_image_prompt: "Describe one finished initial frame at 0s: canonical names, visible action/expression/blocking, composition, required props, lighting and selected project style/aspect ratio. No collage/contact sheet. With character references, do not describe concrete age or facial traits; expressions and gaze are allowed. Preserve general reference-binding rules. Without an image, follow canonical profiles without invention.",
  character_image_prompt: "For creating the character reference itself only: English base character appearance; the app appends the 1:1 front/back/portrait sheet. Once this reference is attached to a scene, do not restate concrete age/facial traits in scene prompts.",
  location_image_prompt: "English base environment only: specify spatial zones, center landmark, doors/windows on named walls and connections to other places; preserve supplied geography. The app appends the 1:1 north/east/south/west location sheet. No scene-specific action or people.",
  video_prompt: "Write a precise, shootable English prompt: scene duration, causal action and visible reaction, feasible camera plan, action-synced SFX and necessary VFX, prop handling and ending state. Use natural timing, either one continuous shot or motivated variable-length beats. Preserve all required camera movements and effects. Keep exact spoken words only in dialogue_segments; do not repeat their timeline in video_prompt because the API adds it separately. Keep reference rules, genre/style and other static context out of scene-specific prose when the API adds them separately; never copy this entire guidance/menu into video_prompt.",
  action_and_visibility: "State who does what, to which object/person, what becomes perceptible, and the resulting reaction. Important actions must be visible in the chosen framing. If an insert excludes a character/object needed for the next action, specify a feasible reframe or motivated cut before that action is shown. Do not invent action to decorate the scene.",
  camera_precision: "Choose a camera plan that serves the scene; use camera_combo_guidance as a menu, never a checklist. Specify actual start framing, path/direction/speed, tracked subject, focus target and end framing. Choose one concrete target, not 'prop or face' or 'specified framing'. Keep camera_movement and video_prompt consistent. Preserve established geography/eyelines and dialogue axis; do not combine opposing movements or force a change at a time interval. Static framing is allowed when motivated.",
  prop_continuity: "Use blocking and continuity_in/out to identify owners, hand/contact/transfer when relevant, prop position/state and the exact ending state. Objects do not change owner or position without visible causal action. Carry knowledge, emotion, location and time into the next scene. Copy story-critical prop/end-state constraints into video_prompt, not only metadata.",
  sound_and_vfx: "State continuous ambience once. Sync each necessary SFX/VFX to its visible trigger, with event time, duration/fade and placement where needed. Preserve explicitly required VFX; never blanket-replace them with none. If no effect is required, say none once. Effects must fit the selected world/rendering and keep essential acting/props readable. No invented speech, laugh track, comic stings, score, UI or decorative effects.",
  reference_rules: VIDEO_REFERENCE_RULES,
  reference_usage: "The API maps actual uploaded images in order. Use canonical names in scene prose; never invent Image numbers, attachments or characters. With attached character images, concrete ages/facial features are forbidden, while the general REFERENCE RULES above must remain. Do not copy reference-sheet pose/background into scenes. Respect location landmarks/materials and the initial scene state.",
  genre_and_performance: "Follow the project genre/tone and source, not the sample scene. Action/Adventure: readable physical stakes, momentum, terrain scale, and clear spatial blocking. Horror/Mystery-Thriller: controlled reveals, fair visual clues, eyeline precision, and mounting dread without graphic gore. Sci-Fi/Fantasy: coherent world/tech/magic rules and grounded human choices. Drama/Romance: intent, subtext, listening, emotional chemistry, and believable progression. Comedy: readable setup, surprise, and motivated comedic pause without forcing jokes into every beat. Animal-Adventure: species-aware behavior and expressive physical acting. Documentary/Explainer: clear visual evidence, structured progression, and authentic observation. Family: natural relationships and practical shared actions. Genres may mix; choose the rhythm that fits this scene and describe observable acting rather than vague emotional labels alone.",
  dialogue_length_and_rhythm: "Write complete, natural spoken turns in the selected video language. Let each line’s length follow character voice, thought, intention, emotion, breath and performance. Short lines may be forceful; longer lines may carry reasoning or emotional nuance. Do not impose a word-count or words-per-second target; never truncate a thought or add filler to hit a numerical pace. Align cue times to plausible delivery and keep them within the chosen legal scene duration. Punctuation may guide breaths, but do not force pauses into every line.",
  dialogue_as_action_and_subtext: "Dialogue is action, not a recap for the audience. Do not let characters narrate events or explain facts everyone present already knows (exposition dump). Shape each important line on three levels: Text (what is said aloud), Subtext (fear, suspicion or calculation underneath), and Action (what the speaker is doing to the other person: attack, probe, defend, evade, deceive or apply emotional pressure). Make speech advance or complicate the conflict while visuals carry observable events.",
  character_voice_signatures: "Give each character a distinct vocabulary, rhythm and tactic. When these roles appear: a mother-in-law speaks through insinuation, moral pressure, authority and wounded pride; a daughter-in-law is precise, evidence-led and coolly direct; a husband avoids commitment, hesitates and tries to smooth things over; a business-minded character or younger sister is practical, quick to spot leverage and focused on outcomes. Adapt these signatures to the actual characters and source; do not flatten everyone into the same voice.",
  micro_retention: "Start the episode in medias res with immediate conflict; make the hook clear within 3 seconds, or use up to 5 seconds when the dramatic beat needs more room. Do not pad it; no greeting, recap or static scenic lead-in. Keep every 10-second scene active with at least one clear Reveal (new clue/message/object changes what we know), Escalate (pressure rises or a boundary is crossed), or Turn (an unexpected response reverses who has leverage). Ground each beat in the source and show its consequence.",
  episode_cliffhangers: "End the episode on an earned, specific cliffhanger. Choose the form that best fits the story: (1) Knowledge Gap — a shocking secret appears at the last second, before anyone can explain it; (2) Ultimatum — an unnegotiable deadline or consequence; (3) Sudden Intrusion — a person or event arrives at the decisive moment; (4) Unanswered Accusation — a revealing question corners someone into silence before the cut. Do not use a generic tease or cut a sentence mid-line.",
  quality_dos_donts_cheat_sheet: `| Hạng mục | ✅ NÊN | ❌ TRÁNH |
|---|---|---|
| Độ dài lượt thoại | Viết trọn ý theo giọng nhân vật, dụng ý, cảm xúc và nhịp diễn; câu ngắn/dài đều được khi tự nhiên. | Đặt trần số từ/tốc độ, cắt cụt, băm ý hoặc thêm lời để đủ mốc. |
| Bản chất thoại | Mỗi câu quan trọng có Text, Subtext và Action: thăm dò, tấn công, phòng thủ, né tránh hoặc gây áp lực. | Kể lại sự vụ hay giải thích điều khán giả đã biết. |
| Nhịp cảnh 10s | Có ít nhất một Reveal, Escalate hoặc Turn làm đổi thông tin, áp lực hoặc thế chủ động. | Để cảnh bằng phẳng, không có hệ quả hay thay đổi. |
| Mở & kết tập | Va chạm bắt đầu ngay; hook rõ trong 3 giây hoặc dùng tới 5 giây nếu cần; kết bằng một trong bốn kiểu cliffhanger. | Chào hỏi/dạo cảnh tĩnh, kéo dài hook cho đủ mốc hoặc cắt ngang câu thoại giả tạo. |
| JSON cue | Mỗi lượt nói có cue riêng, đúng speaker và thứ tự; dialogue_or_voiceover khớp nội dung cue nối lại. start_sec/end_sec tính từ đầu cảnh. | Gộp nhiều speaker vào một cue hoặc dùng timecode ngoài cảnh. |
| TTS & khoảng nghỉ | Với dialogue_led, mỗi khoảng nghỉ liên tục (đầu, giữa, cuối) ≤3s; tổng nghỉ ≤4s/10s và ≤5s/15s. Cảnh 5s chỉ giới hạn từng khoảng nghỉ. | Nhầm giới hạn một khoảng nghỉ với tổng nghỉ; tính cue theo timeline toàn tập. |
| Nối cảnh thoại | Giữa hai cảnh dialogue_led liền nhau, đuôi cảnh trước + khoảng trống timeline + đầu cảnh sau ≤3s. | Để khoảng lặng nối cảnh vượt ngưỡng. |
| Cảnh im lặng | Dùng visual_led với dialogue_or_voiceover rỗng và dialogue_segments rỗng; giữ khoảng lặng/diễn xuất có chủ đích. | Gắn dialogue_led cho cảnh im lặng hoặc thêm thoại lấp chỗ trống. |`,
  dialogue: "Dialogue is optional: visual comedy, action-led and intentionally silent scenes need no speech or filler. For spoken scenes, do not impose a words-per-second cap or target word count. Let each complete line follow the character’s voice, intention, emotion, breath and performance. Keep cue times plausible within the scene; if a beat needs more time, choose a longer legal scene or split at a natural turn. Never truncate a natural line or add filler to satisfy a numerical target. For dialogue_led, silence limits are mandatory: EACH continuous gap must be <=3s, and TOTAL silence must be <=4s per 10s scene or <=5s per 15s scene. Count leading, inter-cue and trailing gaps using the union of valid scene-relative cue intervals; exceeding either limit rejects import. Across adjacent dialogue_led scenes, previous trailing silence + any timeline gap + next leading silence must also be <=3s; visual_led/intentional silence breaks this check. Cue start_sec/end_sec are relative to the scene, not the episode timeline. Missing or invalid cues cannot establish speech coverage. visual_led and intentionally silent scenes are exempt from silence checks; mark intentional silence as dialogue_mode visual_led with empty dialogue fields. Keep scene-relative cues when speech exists, allocating turns naturally without mandatory speech density. Exact utterances and speaker names belong in dialogue_segments. Silent scenes use empty dialogue fields and voiceover_target_sec=0.",
  prompt_budget: "The final API prompt, including appended dialogue, references, execution and project style, must remain below 5000 characters. Keep sufficient scene detail and leave room for appended context. Remove genuine duplicate instructions, not necessary action/camera/VFX descriptions; no arbitrary short target and no mid-sentence truncation. If it cannot fit without loss, report the conflict for editing instead of silently dropping content.",
  final_check: "Before returning JSON, check: follow the quality_dos_donts_cheat_sheet; keep action visible; use one unambiguous camera/focus plan; avoid contradictory movement; preserve causal prop ownership and precise end state; keep one authoritative dialogue timeline; check that spoken lines feel complete and playable without a word-count or speaking-rate target; enforce dialogue_led continuous gaps <=3s and total silence <=4s/10s or <=5s/15s; exempt visual_led/silent scenes; retain effects and reference rules; avoid concrete age/facial descriptions with references and fixed time grids/forced opening holds. Replace instructional placeholders with source-grounded content, preserve canonical names and IDs, and return valid scene-script.v1 JSON.",
};

// The new-project page and episode modal use the same instruction-only skeleton.
// Function declarations are hoisted; shared guidance above is initialized first.
export const AI_DRAMA_JSON_TEMPLATE = createEpisodeScriptTemplate("A01", 1, 1);

/** Build an editable scene-script.v1 skeleton for one existing project episode. */
export function createEpisodeScriptTemplate(chunkId: string, sceneStart: number, sceneEnd: number, timelineStartSec = 0, projectContext: {
  contentGenre?: string; secondaryGenres?: string[]; visualStyle?: string; imageStyle?: string; language?: string;
  existing_locations?: Array<{ name: string; description: string }>;
} = {}) {
  const normalizedChunkId = chunkId.trim().toUpperCase();
  const naturalVideoPrompt = (purpose: string) =>
    `DURATION: [actual 5/10/15s]. ACTION: [${purpose}; who acts on what, what becomes visible, then the observable reaction]. TIMING: [natural irregular event timing driven by this scene; no equal grid or mandatory 0.5s hold; use timestamps only when needed]. CAMERA: [start shot/angle, feasible path/speed, one precise focus target and ending composition; keep each important action visible; continuous shot allowed]. SFX: [sync cues to actual contact/trigger; ambience once]. VFX: [keep required effect, trigger/time/duration/fade/placement; none once if absent]. PROP/END STATE: [ownership/handling and exact ending positions/state for the next scene]. Follow prompt_guidance; the API adds dialogue, references, execution and project style separately.`;
  const openingVideoPrompt = naturalVideoPrompt("show the episode hook and its consequence");
  const ongoingVideoPrompt = naturalVideoPrompt("continue the previous state, advance the goal and show the consequence");
  const endingVideoPrompt = naturalVideoPrompt("show an earned turn/consequence leading into the next episode");
  const singleSceneVideoPrompt = naturalVideoPrompt("open with a source-grounded hook, develop its consequence and end on an earned turn leading into the next episode");
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
        ? "[Va chạm bắt đầu ngay; hook rõ trong 3 giây hoặc dùng tới 5 giây nếu cần để người xem hiểu điều đang cược. Không chào hỏi/recap hay kéo dài cho đủ mốc.]"
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
      video_prompt: sceneStart === sceneEnd
        ? singleSceneVideoPrompt
        : index === 0
        ? openingVideoPrompt
        : index === sceneEnd - sceneStart
          ? endingVideoPrompt
          : ongoingVideoPrompt,
      acting_beat: "[Observable acting/reaction and emotional progression grounded in this scene; no invented performance or appearance details]",
      blocking: "[Vị trí nhân vật, hướng nhìn, chuyển động và quyền sở hữu đạo cụ]",
      shot_size: "[Cỡ cảnh]",
      camera_movement: "[Choose a motivated plan from camera_combo_guidance; give actual start framing, path/direction/speed, tracked subject, one concrete focus target and end framing; static or continuous shot allowed; no periodic changes]",
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
    project_context: { ...projectContext, timeline_start_sec: timelineStartSec },
    prompt_guidance: EPISODE_PROMPT_GUIDANCE,
    camera_combo_guidance: AI_DRAMA_CAMERA_COMBO_GUIDANCE_LINES,
    character_bible: [],
    location_bible: [],
    episode_hooks: {
      opening_hook: "[Va chạm bắt đầu ngay; hook rõ trong 3 giây hoặc dùng tới 5 giây nếu cần. Bắt đầu bằng hành động/manh mối/xung đột/câu hỏi phù hợp; không recap hay kéo dài cho đủ mốc.]",
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
