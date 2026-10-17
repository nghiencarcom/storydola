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
11 Static Hold → Slow Push-In — interpret the hold as the required 0.5s opening hold, then begin the push as recognition lands; never hold unchanged for several seconds.
12 OTS Push-In + Rack Focus — shift attention across a motivated eyeline to the other speaker.
13 Slow Arc + Gentle Dolly-Out — increase emotional distance after a decision or separation.
14 Push-In + Subtle Handheld Drift — restrained instability for tension, not constant shake.
15 Tilt-Down + Slow Pull-Back — reveal lowered gaze, loss, or isolation.
16 Foreground Reveal + Dolly-In — pass a real foreground occluder to reveal established story information.
17 Rack Focus + Lateral Slide — move focus and reveal an already-present clue or subject.
18 Slow Dolly-In → Static Hold — arrive at an emotional close framing, then hold briefly (up to 1s) at the peak.

ACTION / DYNAMIC:
19 Fast Tracking + Controlled Handheld — readable pursuit or urgent movement; keep geography clear.
20 Whip Pan + Tracking Follow — motivated rapid turn to a newly revealed target, then follow it.
21 Low-Angle Tracking + Side Arc — track a preparation or advance with a controlled side reveal.
22 Push-In + Rapid Pull-Back — use once for a clear shock/reaction; do not make an unintelligible zoom effect.
23 Fast Lateral Tracking + Pan Follow — follow a person/vehicle crossing frame.
24 Crane-Down + Forward Tracking — descend from a genuinely elevated view and join the character's path.
25 180° Arc + Slow Dolly-In — only when the open blocking, duration, and screen-direction continuity support the full arc; otherwise use a smaller arc or motivated cut.

SELECTION AND EXECUTION:
- #2 for forward movement with a gentle reframing pan; #3 for lateral movement and parallax; #4 for shifting focus from evidence/foreground to a reaction; #6 for a supported face-off; #11 for realization after the required opening hold; #12 for dialogue coverage across a motivated eyeline; #16 for revealing an established subject/clue from behind a real foreground obstruction; #18 for arriving at an emotional peak then holding briefly; #20 for a motivated whip to a newly revealed target followed by a readable follow; #22 for one clear shock/reaction using a quick push then pull-back.
- Dialogue/negotiation: prioritize 04 or 12; protect eyelines and the 180-degree axis. Use 06 only when the blocking supports an arc.
- Realization/emotional peak: prioritize 11 or 18. For 11, hold the exact opening frame only 0.5s, then push. For 18, keep the final static hold at or below 1s.
- Clue/reveal: prioritize 04 or 16; use 03 when a lateral move reveals spatial depth. Reveal only information already established in the script.
- Travel/exploration: prioritize 02 or 03; maintain landmarks and direction of travel. Use another tracking combo only if the subject path requires it.
- Sudden target/action surprise: prioritize 20; use 22 for a single motivated shock reaction, never as a repeated zoom effect. Keep geography and action readable.
- If none of the ten priority combos fits the scene's action and opening frame, select the best-supported fallback from 01, 05, 07–10, 13–15, 17, 19, 21, or 23–25 and state its concrete path. Do not force a priority combo onto an unrelated beat.
- Match every move to the opening image, available space, subject path, lens, story style, and selected image style. A combo name is not enough: specify start framing, camera position/path/direction, speed, subject tracking, end framing, and what stays in view.
- Do not combine opposing moves (for example, simultaneous dolly-in and dolly-out), stack redundant push-ins, force a full 180-degree orbit into a short/blocked shot, or add movement only to decorate. Preserve identities, screen direction, eyelines, blocking, hands, and prop ownership.`;

/** Compact execution note for the video provider; the full combo library is for script writing only. */
export const AI_DRAMA_CAMERA_API_GUIDANCE = `CAMERA EXECUTION: Follow the primary camera combo and concrete camera path already named in this scene's SHOT DESCRIPTION. Keep it motivated, physically feasible from the supplied opening frame, and consistent with the timed shots; preserve screen direction, eyelines, character blocking, and prop continuity. Do not invent extra moves or repeat a camera-combo menu.`;

export const AI_DRAMA_VIDEO_PROMPT_GUIDANCE = `AI DRAMA VIDEO_PROMPT RULES:
- Write video_prompt as a concise, shootable SHOT DESCRIPTION only. The video pipeline separately adds the visual-reference map, story genre and setting, project visual style, image style, and authoritative dialogue cues; do not spend prompt space repeating those static sections.
- Start from image_prompt as the exact opening frame. Preserve its full composition, setting, props, lighting, palette, blocking, and every visible person's position from 0.0 to 0.5 seconds. Hold still during that opening half-second; start the first motivated move immediately after 0.5 seconds.
- CAMERA TIME GRID IS A HARD REQUIREMENT. Cover the full scene with consecutive, non-overlapping ranges and use these exact boundaries: 5-second scene: 0.0–2.5s, 2.5–5.0s; 10-second scene: 0.0–2.5s, 2.5–5.0s, 5.0–7.5s, 7.5–10.0s; 15-second scene: 0.0–3.0s, 3.0–6.0s, 6.0–9.0s, 9.0–12.0s, 12.0–15.0s. Never merge adjacent ranges, use 4–6-second beats, omit a range, or end before the exact scene duration. The opening range includes the 0.5-second still hold, then a clearly visible move/reframe before its end. At every later boundary, make a motivated change of shot size, angle, camera position, or focus; no unchanged static composition may last longer than 3.0 seconds. A cut is not required if a continuous move visibly reframes within the required beat.
- In every range, name its timecode, shot size/angle, character action or reaction, camera path/speed, and concise SFX and VFX cues; write VFX: none when that range has no story-justified effect. Keep each cue to one short phrase and state continuous ambience only once. Put changes at exact time-grid boundaries; do not hide several un-timed changes inside one long range. SFX must be diegetic, tied to a visible action or established environment, and timed to its onset/contact/decay; keep a restrained, location-true ambience continuous across cuts and beneath dialogue. Never invent a sound source, intelligible background speech, lyrics, or extra dialogue; do not add a score unless the source explicitly calls for one.
${AI_DRAMA_CAMERA_COMBO_GUIDANCE}
- Adapt shot scale, angle, movement, and pace to the selected genre and emotional beat of this scene. For action, favor readable tracking and purposeful low/POV inserts; for suspense or mystery, use controlled creeps, occluded reveals, and evidence inserts; for romance or drama, favor expressive eyeline coverage, measured arcs, and reaction shots; for comedy, use deliberate reframes and reaction timing. Choose only what fits the actual story—these are options, not a checklist. Every move must clarify geography, reveal information, follow action, or emphasize a reaction; avoid random motion, repetitive push-ins, and changes that break screen direction or continuity.
- In every shot, name the canonical characters and describe concrete action, contact/object handling, cause and result, reaction, useful eyeline, and ending positions. Preserve screen direction, hands, prop ownership, age, identity, costume, and emotional continuity. Do not invent, omit, teleport, duplicate, drop, or silently replace story details.
- VFX are sparse and optional. Add them only when the established story world or an explicit action requires them; time their trigger, duration, and fade to the same beat, keep their scale/material/light consistent with the selected image style, and never obscure faces, props, or action. Do not invent powers, impacts, damage, particles, flares, captions, UI, or overlays. Write VFX: none for ranges without a justified effect rather than decorating the shot.
- dialogue_segments are the only source of spoken words. In video_prompt, mark each canonical on-camera speaker and matching cue time; show natural mouth movement only during that speaker's window. The API prompt adds the exact dialogue cue for lip-sync, while the assigned TTS voice/audio is mixed separately in the final edit. Treat narration/voiceover as off-screen unless the scene explicitly shows its speaker. When no dialogue cue exists, request no additional speech. Keep exact dialogue out of video_prompt.
- Keep meaningful action or reaction through the final timestamp; use a quiet ending only when it is a deliberate story beat, never as filler. Keep movement physically plausible and safe.`;
