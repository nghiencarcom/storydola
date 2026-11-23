export const AI_DRAMA_CAMERA_COMBO_GUIDANCE = `CAMERA COMBO LIBRARY — PRIORITY ORDER. Prefer the user's priority set #2, #3, #4, #6, #11, #12, #16, #18, #20, #22 whenever one fits the actual scene. Choose ONE primary combo that expresses the beat; put its name plus a concrete, shootable path in camera_movement. Use at most ONE secondary combo only when a real beat change motivates it and duration allows. The remaining combos below are fallbacks when the priority set does not fit. This library is a menu, never a checklist; video_prompt must translate the choice into timed shots and must not paste the whole menu into a scene prompt.

CINEMATIC / REVEAL:
01 Slow Dolly-In + Subtle Tilt-Up — build stature or authority.
02 Tracking Forward + Gentle Pan — move with a character while preserving composition.
03 Lateral Tracking + Counter-Pan — maintain the subject while revealing parallax or spatial depth.
04 Slow Push-In + Rack Focus — shift attention from foreground evidence to a reaction or reveal.
05 Dolly-Out + Crane-Up — reveal the wider location or isolation.
06 Arc Left + Slow Push-In — tighten a supported face-off.
07 Leading Tracking + Gradual Push-In — retreat ahead of an approaching character and gradually close distance.
08 Follow Tracking + Side Arc — follow from behind and ease to a side view.
09 Low Tracking + Tilt-Up — reveal a character with grounded scale; do not imply power the story has not earned.
10 Slow Pan + Dolly-In — uncover a story-relevant person or object while approaching.

DRAMA / EMOTION:
11 Static Hold → Slow Push-In — hold only if the acting motivates a pause, then push as recognition lands; no mandatory opening freeze.
12 OTS Push-In + Rack Focus — shift attention across a motivated eyeline to the other speaker.
13 Slow Arc + Gentle Dolly-Out — increase emotional distance after a decision or separation.
14 Push-In + Subtle Handheld Drift — restrained instability for tension, not constant shake.
15 Tilt-Down + Slow Pull-Back — reveal lowered gaze, loss, or isolation.
16 Foreground Reveal + Dolly-In — pass a real foreground occluder to reveal established story information.
17 Rack Focus + Lateral Slide — move focus and reveal an already-present clue or subject.
18 Slow Dolly-In → Static Hold — arrive at an emotional close framing, then settle at the peak for as long as the performance motivates.

ACTION / DYNAMIC:
19 Fast Tracking + Controlled Handheld — readable pursuit or urgent movement; keep geography clear.
20 Whip Pan + Tracking Follow — motivated rapid turn to a newly revealed target, then follow it.
21 Low-Angle Tracking + Side Arc — track a preparation or advance with a controlled side reveal.
22 Push-In + Rapid Pull-Back — use once for a clear shock/reaction; do not make an unintelligible zoom effect.
23 Fast Lateral Tracking + Pan Follow — follow a person/vehicle crossing frame.
24 Crane-Down + Forward Tracking — descend from a genuinely elevated view and join the character's path.
25 180° Arc + Slow Dolly-In — only when the open blocking, duration, and screen-direction continuity support the full arc; otherwise use a smaller arc or motivated cut.

SELECTION AND EXECUTION:
- #2 for forward movement with a gentle reframing pan; #3 for lateral movement and parallax; #4 for shifting focus from evidence/foreground to a reaction; #6 for a supported face-off; #11 for a motivated pause followed by realization; #12 for dialogue coverage across a motivated eyeline; #16 for revealing an established subject/clue from behind a real foreground obstruction; #18 for arriving at an emotional peak then holding briefly; #20 for a motivated whip to a newly revealed target followed by a readable follow; #22 for one clear shock/reaction using a quick push then pull-back.
- Dialogue/negotiation: prioritize 04 or 12; preserve established eyelines and the 180-degree axis. Use 06 only when the blocking supports an arc; do not assume fixed left/right positions when the scene has not established them.
- Realization/emotional peak: prioritize 11 or 18. For 11 or 18, let any hold follow the performance and emotional beat; impose no fixed hold duration.
- Clue/reveal: prioritize 04 or 16; use 03 when a lateral move reveals spatial depth. Reveal only information already established in the script.
- Travel/exploration: prioritize 02 or 03; maintain landmarks and direction of travel. Use another tracking combo only if the subject path requires it.
- Sudden target/action surprise: prioritize 20; use 22 for a single motivated shock reaction, never as a repeated zoom effect. Keep geography and action readable.
- If none of the ten priority combos fits the scene's action and opening frame, select the best-supported fallback from 01, 05, 07–10, 13–15, 17, 19, 21, or 23–25 and state its concrete path. Do not force a priority combo onto an unrelated beat.
- Match every move to the opening image, available space, subject path, lens, story style, and selected image style. A combo name is not enough: specify start framing, camera position/path/direction, speed, subject tracking, end framing, and what stays in view.
- Ground screen geography in the source, opening frame, prior-scene reference, location reference, or explicit blocking. Preserve established left/right positions, landmarks, eyelines, and the 180-degree axis for dialogue coverage. Cross the axis only with a motivated visible move or reblocking, then re-establish screen direction. Do not invent fixed positions or background exclusions such as “NO doors visible.”
- Do not combine opposing moves (for example, simultaneous dolly-in and dolly-out), stack redundant push-ins, force a full 180-degree orbit into a short/blocked shot, or add movement only to decorate. Preserve identities, screen direction, eyelines, blocking, hands, and prop ownership.`;

/** Compact execution note for the video provider; the full combo library is for script writing only. */
export const AI_DRAMA_CAMERA_API_GUIDANCE = `CAMERA EXECUTION: Follow the primary camera combo and concrete camera path already named in this scene's SHOT DESCRIPTION. Keep it motivated and physically feasible from the supplied opening frame. Preserve only source-established left/right positions, landmarks, screen direction, eyelines, blocking, and prop continuity; maintain the 180-degree axis for dialogue unless a motivated visible move crosses it and re-establishes direction. Do not invent background exclusions such as “NO doors visible,” extra moves, or a camera-combo menu.`;

export const AI_DRAMA_VIDEO_PROMPT_GUIDANCE = `AI DRAMA VIDEO_PROMPT RULES:
- Write video_prompt as a concise, shootable SHOT DESCRIPTION only. The video pipeline separately adds the visual-reference map, story genre and setting, project visual style, image style, and authoritative dialogue cues; do not spend prompt space repeating those static sections.
- Start from image_prompt as the exact initial state: composition, setting, props, lighting, palette and blocking. Motion may begin immediately. Do not require a 0.5s opening hold or frozen frame.
- Ground left/right positions, landmarks, and screen direction in the source, opening frame, prior-scene/location references, or explicit blocking. Preserve the established 180-degree axis and eyelines for dialogue coverage; cross it only through a motivated visible move or reblocking that re-establishes screen direction. Do not invent fixed positions or background exclusions such as “NO doors visible.”
- NATURAL PACING: Scene duration is exactly 5, 10 or 15 seconds. Let action, dialogue, comedy timing and reactions determine the rhythm. A single continuous shot may span the entire clip. Do not impose an equal time grid, a maximum shot length, periodic cuts/reframes or a fixed opening hold. Use precise timestamps only where needed to synchronize dialogue, contact, SFX, VFX or a story-critical event. Describe meaningful action/reaction through the scene end without filler.
- Describe shot size/angle, concrete action/reaction and necessary camera path/speed, SFX and VFX with enough precision to shoot the scene. Preserve every required camera move and effect including trigger, timing, duration and fade when relevant. Use natural variable-length beats or a continuous camera plan. State ambience once. Sync diegetic sounds to action; keep dialogue clear. No invented speech, lyrics, unsupported sound or score. No VFX unless grounded in the scene; do not replace specified VFX with none.
${AI_DRAMA_CAMERA_COMBO_GUIDANCE}
- Adapt shot scale, angle, movement, and pace to the selected genre and emotional beat of this scene. For action, favor readable tracking and purposeful low/POV inserts; for suspense or mystery, use controlled creeps, occluded reveals, and evidence inserts; for romance or drama, favor expressive eyeline coverage, measured arcs, and reaction shots; for comedy, use deliberate reframes and reaction timing. Choose only what fits the actual story—these are options, not a checklist. Every move must clarify geography, reveal information, follow action, or emphasize a reaction; avoid random motion, repetitive push-ins, and changes that break screen direction or continuity.
- In every shot, name the canonical characters and describe concrete action, contact/object handling, cause and result, reaction, useful eyeline, and ending positions. Preserve screen direction, hands, prop ownership, identity, costume, and emotional continuity. Do not invent, omit, teleport, duplicate, drop, or silently replace story details.
- When a character reference image is attached, it is the sole visual identity source: Specific age and facial-appearance descriptions are forbidden in scene prompts. General REFERENCE RULES binding face, apparent age, skin tone, hair, proportions and costume to the assigned images, including no de-aging/recasting, are allowed and must be preserved. Use only canonical names and image tokens for identification; acting, expression and gaze are allowed. Without an attached character image, follow canonical profile details without invention.
- VFX are sparse and optional. Add them only when the established story world or an explicit action requires them; time their trigger, duration, and fade to the same beat, keep their scale/material/light consistent with the selected image style, and never obscure faces, props, or action. Do not invent powers, impacts, damage, particles, flares, captions, UI, or overlays. Write VFX: none for ranges without a justified effect rather than decorating the shot.
- dialogue_segments are the only source of spoken words. In video_prompt, mark each canonical on-camera speaker and matching cue time; show natural mouth movement only during that speaker's window. The API prompt adds the exact dialogue cue for lip-sync, while the assigned TTS voice/audio is mixed separately in the final edit. Treat narration/voiceover as off-screen unless the scene explicitly shows its speaker. When no dialogue cue exists, request no additional speech. Keep exact dialogue out of video_prompt.
- Keep meaningful action or reaction through the final timestamp; use a quiet ending only when it is a deliberate story beat, never as filler. Keep movement physically plausible and safe.`;
