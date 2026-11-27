/** Runtime compatibility for the old injected opening hold, without retiming story events. */
export function naturalizeLegacyOpeningHold(prompt: string) {
  return prompt
    .replace(/Hold the exact opening image and all visible positions for the first 0\.5 seconds\.\s*Then\s*/gi, "")
    .replace(/hold the exact opening frame for 0\.5 seconds, then\s*/gi, "")
    .replace(/hold the over-shoulder opening for 0\.5 seconds, then\s*/gi, "")
    .replace(/Preserve the exact opening image and all visible character positions for 0\.0[–-]0\.5s, then\s*/gi, "")
    .trim();
}

/** Reject explicit appearance prose rather than silently deleting story/acting text.
 * Generation instructions cover the general rule; this guard catches common legacy forms.
 */
export function requireReferenceIdentityOnly(prompt: string, referencedNames: string[]) {
  if (!referencedNames.length) return prompt;
  const age = /\b\d{1,3}[ -]?(?:years?[ -]old|year[ -]old)\b|\b(?:aged|age)\s*[:=]?\s*\d{1,3}\b|\b\d{1,3}\s*tuổi\b|\b(?:young|old|middle-aged|elderly|teenaged|teenage)\s+(?:woman|man|girl|boy|character)\b|(?:người phụ nữ|người đàn ông|cô gái|chàng trai)\s+(?:trẻ|già|trung niên|lớn tuổi)/iu;
  const facial = /\b(?:facial structure|facial features|face shape|eye color|eye colour|skin tone)\s*[:=]|\b(?:oval|round|square|heart-shaped|wrinkled|youthful|angular)\s+face\b|\b(?:blue|brown|green|hazel|almond-shaped)\s+eyes\b|\b(?:high|prominent)\s+cheekbones\b|(?:khuôn mặt|gương mặt)\s+(?:tròn|trái xoan|vuông|góc cạnh|nhăn nheo)|(?:mắt\s+(?:nâu|xanh|đen)|mũi\s+(?:cao|thấp|tẹt))/iu;
  if (age.test(prompt) || facial.test(prompt)) {
    throw new Error(`Prompt có mô tả tuổi/ngoại hình khuôn mặt trong khi đã gắn ảnh nhân vật (${referencedNames.join(", ")}). Hãy bỏ mô tả ngoại hình; giữ nguyên hành động, biểu cảm và hướng nhìn.`);
  }
  return prompt;
}

export const NATURAL_VIDEO_EXECUTION = "EXECUTION: Follow the scene's action, dialogue, camera, SFX and VFX cues for the full clip. Let action, speech and reactions set the rhythm; continuous shots are allowed. Start from the supplied initial state; motion may begin immediately. No mandatory opening hold, equal time grid or periodic reframing. Existing beat boundaries are event cues, not forced cuts. Preserve necessary camera paths, effect triggers/timing, established geography, eyelines, blocking, identities, cause-and-effect and prop ownership. Maintain the dialogue axis unless a motivated visible move re-establishes direction. Sync subtle ambience/foley beneath clear dialogue. No extra speech, lyrics, unsupported sounds, music, effects or overlays unless specified.";

/** General reference locks are allowed; concrete age/facial descriptions are not. */
export const VIDEO_REFERENCE_RULES = "REFERENCE RULES: The current scene image binds opening composition, people, positions, setting, props, lighting and palette; do not reset or replace it. Character images bind face, apparent age, skin tone, hair, proportions and costume (or natural species anatomy, fur/scales, markings and gear for animal/creature characters; never add human clothing to natural animals); no de-aging, recasting, identity swaps, merging, duplication or morphing. Ignore reference-sheet poses/backgrounds. Location images bind layout, landmarks, materials and spatial relationships; render one natural camera view, not a contact sheet. The scene prompt controls subsequent action, reactions and camera; preserve cause-and-effect and prop ownership. Motion may begin immediately.";
