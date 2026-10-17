import { AI_DRAMA_CAMERA_COMBO_GUIDANCE } from "./ai-drama-video-prompt-guidance";

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
- Connect every scene and episode by cause and effect; carry forward time, place, knowledge, and emotional state.
- Every scene must be exactly 5, 10, or 15 seconds. For dialogue-led scenes, the dialogue must contain at least 10 words at 5 seconds, 20 words at 10 seconds, or 30 words at 15 seconds; target 10–15, 20–30, or 30–45 words respectively, with no more than 3 words per second combined. Split exchanges into 2–4 timed turns when appropriate. Intentional visual-led or silent scenes are exempt and must not receive filler dialogue.
- Each image_prompt is one finished scene image: the exact opening frame at 0 seconds, not a character/location sheet or collage. Use canonical names, describe only the visible blocking/action, composition, required props, project style and selected aspect ratio; the separate bibles define stable appearance and set design.
- Each video_prompt must continue from that exact opening frame, hold the full composition and visible character positions for the first 0.5 seconds, then cover the entire scene with the exact camera time grid: 5s = 0–2.5 / 2.5–5; 10s = 0–2.5 / 2.5–5 / 5–7.5 / 7.5–10; 15s = 0–3 / 3–6 / 6–9 / 9–12 / 12–15. Every range states shot/angle, timed action or reaction, motivated camera path, diegetic SFX, and VFX (write “none” unless the story explicitly requires an effect). Keep exact spoken words only in dialogue_segments; video_prompt names the on-camera speaker and cue time without repeating dialogue.
- Choose one named primary camera combo that fits the scene's beat and blocking; put its name plus the actual start framing, camera path/direction/speed, subject tracking, and end framing in camera_movement. Use the JSON sample's camera_combo_guidance as a menu, never a checklist. A secondary move is optional only when a real beat change motivates it and duration allows.
- Prioritize combos #2, #3, #4, #6, #11, #12, #16, #18, #20, and #22 when their movement fits the story; use the other listed combos as fallbacks, not as required coverage.
- Every episode must have an opening hook that lands in its first 5 seconds, a meaningful turning point, and an earned end hook. Start each next episode with the consequence of the prior end hook; avoid generic intros and recaps.
- Keep production descriptions and prompts in English. Write dialogue in the selected project video language.`;

export const AI_DRAMA_JSON_TEMPLATE = JSON.stringify({
  schema: "scene-script.v1",
  chunk_id: "A01",
  episode_title: "Who Opened the Locked Archive?",
  prompt_guidance: {
    character_image_prompt: "English base visual description only; the app appends the required 1:1 three-view character sheet (front, back, portrait). Do not ask for a scene or add sheet layout instructions.",
    location_image_prompt: "English base environment description only; the app appends the required 1:1 four-direction location sheet (north, east, south, west). Do not include people or scene-specific action.",
    scene_image_prompt: "Exactly one finished frame at 0 seconds, with canonical characters, visible blocking, props, composition, project style, and selected aspect ratio. Never make a reference sheet or collage.",
    video_prompt: "Select ONE primary camera combo, prioritizing #2, #3, #4, #6, #11, #12, #16, #18, #20, or #22 when it fits; otherwise choose a suitable fallback. Name it and describe its physical path in camera_movement. The combo list is a menu, never a checklist. Follow the exact 5s/10s/15s camera grid, preserve the opening frame and visible positions for 0.5s, and give every range shot, action, camera, SFX, and VFX. Keep exact dialogue in dialogue_segments only.",
  },
  camera_combo_guidance: AI_DRAMA_CAMERA_COMBO_GUIDANCE,
  character_bible: [
    {
      name: "Mina",
      description: "32-year-old Vietnamese woman, observant archivist, straight black bob, warm brown eyes, slim build, charcoal cardigan over a cream blouse, dark trousers; same face and costume in every reference view.",
      image_prompt: "Photorealistic cinematic appearance reference for Mina: a 32-year-old Vietnamese woman with a straight black bob, warm brown eyes, slim build, charcoal cardigan over a cream blouse, and dark trousers. Natural proportions, calm neutral expression, understated everyday styling.",
    },
    {
      name: "Eli",
      description: "34-year-old Vietnamese man, archive technician, short wavy black hair, lean build, navy work jacket and dark shirt; same face and costume in every reference view.",
      image_prompt: "Photorealistic cinematic appearance reference for Eli: a 34-year-old Vietnamese man with short wavy black hair, lean build, navy work jacket, and dark shirt. Natural proportions, calm neutral expression, understated everyday styling.",
    },
  ],
  location_bible: [{
    name: "Old City Archive",
    description: "A narrow ground-floor archive entrance with a dark oak door, brass lock, stone floor, amber wall lamp, and a long shadowed corridor; late evening.",
    image_prompt: "Photorealistic cinematic environment reference for the Old City Archive entrance: narrow stone corridor, dark oak door with brass lock, one amber wall lamp, worn stone floor, and a shadowed corridor beyond. Preserve this exact layout and fixed landmarks across views.",
  }],
  episode_hooks: {
    opening_hook: "Mina finds fresh scratches around a door that should still be locked.",
    turning_point: "The only key is in Mina's hand, so the break-in must involve someone inside.",
    end_hook: "A second set of wet footprints appears behind Mina, leading deeper into the archive.",
  },
  chunk_summary: "Mina finds evidence that someone entered the locked archive before her.",
  continuity_state: {
    story_so_far: "Mina and Eli arrive at the locked archive and find fresh scratches around its door.",
    active_characters: [{ name: "Mina", appearance: "32-year-old Vietnamese archivist; straight black bob; charcoal cardigan and cream blouse.", costume: "Charcoal cardigan, cream blouse, dark trousers.", goal: "Find out who entered the archive.", emotional_state: "Alert, turning suspicious.", location: "Old City Archive entrance." }],
    active_locations: [{ name: "Old City Archive", description: "Narrow stone corridor, oak door, brass lock, amber wall lamp; late evening." }],
    important_props: [{ name: "Brass key", owner: "Mina", status: "In Mina's right hand." }],
    open_threads: ["Who opened the archive from inside?"],
    next_chunk_plan: "Continue at the same door immediately after Mina confronts Eli; resolve his reaction without resetting the scene.",
  },
  scenes: [{
    id: "S001",
    start_sec: 0,
    end_sec: 5,
    duration_sec: 5,
    act: "Opening hook",
    purpose: "Reveal the break-in and force Mina to question her only ally.",
    beat_summary: "Mina notices fresh scratches around the locked door and challenges Eli.",
    dialogue_mode: "dialogue_led",
    dialogue_or_voiceover: "Mina: Who had the second key? You promised nobody else knew this door.",
    dialogue_segments: [{
      speaker_character: "Mina",
      text: "Who had the second key? You promised nobody else knew this door.",
      start_sec: 0.5,
      end_sec: 4.7
    }],
    voiceover_target_sec: 4.2,
    media_type: "video",
    characters: ["Mina", "Eli"],
    location_name: "Old City Archive",
    location_description: "Narrow stone corridor, dark oak door, brass lock, amber wall lamp; late evening.",
    image_keyword: "woman finds scratched archive door",
    video_keyword: "detective confronts ally at archive",
    image_prompt: "One finished cinematic medium two-shot at the Old City Archive entrance, the literal opening frame at 0 seconds: Mina stands beside the scratched oak door with the brass key in her right hand; Eli is one step behind her, both fully visible. Amber wall lamp, narrow stone corridor, late-evening shadows, balanced photorealistic film lighting. Compose for the project's selected aspect ratio. Show only this single scene frame, not a reference sheet or collage.",
    video_prompt: "0.0–2.5s: Shot: medium two-shot, eye level, Mina nearest the scratched door and Eli one step behind. Action: preserve this complete opening composition and both positions for 0.0–0.5s; Mina then studies the scratches while Eli watches her. Camera: execute combo 11, a slow 35mm push toward Mina after the hold, keeping Eli and the door in frame. SFX: quiet archive corridor room tone, continuous. VFX: none. 2.5–5.0s: Shot: reverse over Eli's shoulder toward Mina, preserving the 180-degree axis. Action: Mina turns to confront Eli and tightens her right hand around the brass key; Eli avoids her eyes. Mina's on-camera dialogue cue runs 0.5–4.7s; natural mouth movement only during that cue, with exact words supplied by dialogue_segments. Camera: motivated cut, then a subtle rack focus from the key to Mina's eyes, ending on her resolved expression. SFX: faint key ring tick as Mina tightens her grip. VFX: none. Preserve identities, positions, door, key ownership, and cause-and-effect; do not add speech or props.",
    acting_beat: "Mina shifts from concern to suspicion; Eli tries to hide his unease.",
    blocking: "Mina stands beside the door with the key in her right hand; Eli remains one step behind and to her left.",
    shot_size: "Medium two-shot",
    camera_movement: "11 Static Hold → Slow Push-In; preserve the supplied frame for exactly 0.5s, then make a restrained 35mm push toward Mina while keeping Eli and the door in frame; end with a motivated reverse OTS cut across the same axis.",
    eye_line_action: "Mina studies the scratches, then fixes her gaze on Eli; Eli looks away.",
    continuity_in: "Mina and Eli have just arrived at the locked archive entrance. Mina holds the brass key.",
    continuity_out: "Mina suspects Eli knows who entered; the door remains locked and the key stays with Mina.",
    source_basis: "A01 opening hook in the supplied story outline.",
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
    "Use one named primary camera combo from camera_combo_guidance for the entire scene; a secondary move is optional only if the story beat changes. Keep exact dialogue only in dialogue_segments; here name each on-camera speaker and cue time without repeating their lines. State continuous ambience once. No extra speech, unsupported sounds, or props.",
  ].join(" ");
  const ongoingVideoPrompt = [
    videoBeat("0.0", "3.0", "continue directly from the previous scene and preserve its established state", true),
    videoBeat("3.0", "6.0", "advance the cause-and-effect action and show reactions"),
    videoBeat("6.0", "9.0", "reveal information or complicate the current goal"),
    videoBeat("9.0", "12.0", "escalate toward the scene turn"),
    videoBeat("12.0", "15.0", "end with a change that motivates the next scene"),
    "Use one named primary camera combo from camera_combo_guidance for the entire scene; a secondary move is optional only if the story beat changes. Keep exact dialogue only in dialogue_segments; here name each on-camera speaker and cue time without repeating their lines. State continuous ambience once. No extra speech, unsupported sounds, or props.",
  ].join(" ");
  const endingVideoPrompt = [
    videoBeat("0.0", "3.0", "continue directly from the previous scene and preserve its established state", true),
    videoBeat("3.0", "6.0", "advance the immediate consequence"),
    videoBeat("6.0", "9.0", "reveal or complicate the central question"),
    videoBeat("9.0", "12.0", "build toward the episode's end hook"),
    videoBeat("12.0", "15.0", "show an earned discovery or consequence that leads directly into the next episode"),
    "Use one named primary camera combo from camera_combo_guidance for the entire scene; a secondary move is optional only if the story beat changes. Keep exact dialogue only in dialogue_segments; here name each on-camera speaker and cue time without repeating their lines. State continuous ambience once. No extra speech, unsupported sounds, or props.",
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
      dialogue_mode: "dialogue_led",
      dialogue_or_voiceover: "[Tên nhân vật]: [Lời thoại đúng ngôn ngữ video. dialogue_led tối thiểu 10 từ/5s, 20 từ/10s, 30 từ/15s; mục tiêu lần lượt 10–15, 20–30, 30–45 từ.]",
      dialogue_segments: [{
        speaker_character: "[Tên nhân vật theo Character Bible]",
        text: "[Cảnh 15s: tối thiểu 30, mục tiêu 30–45 từ. Cảnh 10s: tối thiểu 20, mục tiêu 20–30 từ. Cảnh 5s: tối thiểu 10, mục tiêu 10–15 từ. Chỉ tính lời thoại, không tính tên người nói.]",
        start_sec: 0.5,
        end_sec: 14.5,
      }],
      voiceover_target_sec: 15,
      media_type: "video",
      characters: ["[Tên nhân vật đúng Character Bible]"],
      location_name: "[Tên bối cảnh đúng Location Bible]",
      location_description: "[Bố cục/đặc điểm nhận diện ổn định của địa điểm này]",
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
      video_prompt: "Select ONE primary named camera combo, prioritizing #2, #3, #4, #6, #11, #12, #16, #18, #20, or #22 when it fits the story beat; otherwise use a suitable fallback. Describe its actual physical path in camera_movement. Preserve the opening frame/positions for 0.5s and follow exact grids: 5s = 0–2.5/2.5–5; 10s = 0–2.5/2.5–5/5–7.5/7.5–10; 15s = 0–3/3–6/6–9/9–12/12–15. Every beat names shot, action/reaction, camera, SFX, and VFX. Exact dialogue belongs only in dialogue_segments.",
    },
    camera_combo_guidance: AI_DRAMA_CAMERA_COMBO_GUIDANCE,
    character_bible: [{
      name: "[Tên nhân vật chuẩn]",
      description: "[Tuổi, diện mạo cố định, tóc, vóc dáng, trang phục và dấu hiệu nhận diện bằng tiếng Anh]",
      image_prompt: "[English base appearance prompt only; the app automatically adds a 1:1 front/back/portrait reference sheet. No scene action, layout directions, or other characters.]",
    }],
    location_bible: [{
      name: "[Tên bối cảnh chuẩn]",
      description: "[Thời đại, sơ đồ không gian, mốc kiến trúc, vật liệu, ánh sáng/thời tiết và đạo cụ cố định bằng tiếng Anh]",
      image_prompt: "[English base environment prompt only; the app automatically adds a 1:1 north/east/south/west reference sheet. No people or scene-specific action.]",
    }],
    episode_hooks: {
      opening_hook: "[Hook cụ thể phải thể hiện trong 0–5 giây của cảnh mở tập; bắt đầu bằng hành động/manh mối/xung đột/câu hỏi phù hợp, không recap.]",
      turning_point: "[Bước ngoặt làm đổi mục tiêu, thông tin hoặc thế chủ động.]",
      end_hook: "[Hệ quả hoặc phát hiện chưa được giải quyết, khiến muốn xem tập sau; tập sau phải mở bằng hệ quả này.]",
    },
    chunk_summary: "[Tóm tắt tập: mở đầu, diễn biến, bước ngoặt và kết quả; nối tiếp tập trước]",
    continuity_state: {
      story_so_far: "[Tóm tắt sự kiện đã xảy ra, không recap trong tập sau]",
      active_characters: [{ name: "[Tên nhân vật]", appearance: "[Nhận diện cố định]", costume: "[Trang phục hiện tại]", goal: "[Mục tiêu]", emotional_state: "[Cảm xúc cuối tập]", location: "[Vị trí cuối tập]" }],
      active_locations: [{ name: "[Tên bối cảnh]", description: "[Trạng thái thời gian/không gian cuối tập]" }],
      important_props: [{ name: "[Đạo cụ]", owner: "[Người đang giữ]", status: "[Vị trí/trạng thái cuối tập]" }],
      open_threads: ["[Câu hỏi hoặc tình huống dẫn sang tập sau]"],
      next_chunk_plan: "[Cảnh đầu tập tiếp nối trực tiếp hệ quả này]",
    },
      scenes,
  }, null, 2);
}
