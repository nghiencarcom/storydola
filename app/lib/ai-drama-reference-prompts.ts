export const PROFILE_REFERENCE_ASPECT_RATIO = "1:1";

function referenceFrameInstruction(aspectRatio: string) {
  return `OUTPUT FRAME: Render the complete reference image in exactly ${aspectRatio}. This required reference frame overrides any different aspect ratio or orientation mentioned earlier. Fit every required view inside the frame without cropping.`;
}

function characterViewBlock(aspectRatio: string) {
  const [width, height] = aspectRatio.split(":").map(Number);
  const layout = width > height
    ? "arranged horizontally in one row"
    : width < height
      ? "stacked vertically in one column"
      : "arranged in a clear three-panel 2×2 composition: front view in the upper-left cell, back view in the upper-right cell, and one wide portrait spanning both cells of the bottom row";
  return `CHARACTER REFERENCE SHEET — REQUIRED THREE CAMERA VIEWS.
Create one clean reference sheet on a plain white or neutral background, ${layout}. The sheet contains exactly three panels and exactly one person repeated across those panels:
1. FRONT VIEW: full body, facing the camera, head to toe visible.
2. BACK VIEW: full body, facing directly away from the camera, head to toe visible.
3. PORTRAIT: one front-facing close-up from the shoulders up, occupying the wide bottom panel.
Keep the same face, apparent age, skin tone, hair, body proportions, modest age-appropriate clothing, footwear and accessories in every view. Use neutral relaxed poses, consistent scale and even studio lighting. Keep the three panels distinct and fully inside the frame. Do not add a fourth view, extra person, scene/action pose, text, labels, logos or watermark.
${referenceFrameInstruction(aspectRatio)}`;
}

function locationViewBlock(aspectRatio: string) {
  const [width, height] = aspectRatio.split(":").map(Number);
  const layout = width > height
    ? "four equal panels arranged horizontally in one row"
    : width < height
      ? "four equal panels stacked vertically in one column"
      : "a clean 2×2 grid";
  return `LOCATION REFERENCE SHEET — REQUIRED FOUR CAMERA DIRECTIONS.
Create one environment reference sheet as ${layout}, showing exactly four equally sized panels of the same location. Keep camera height, lens, distance and the shared center landmark consistent. Label the four directions only by their visual orientation, not with text: NORTH view (camera south of the landmark, facing north), EAST view (camera west, facing east), SOUTH view (camera north, facing south), and WEST view (camera east, facing west).
Keep architecture, spatial layout, paths, materials, fixed landmarks, recurring set props, time of day, weather, lighting and palette consistent in every panel. These are four camera directions in one coherent place, not four alternate designs. Do not omit, duplicate or reorder a direction. No people, text, labels, logos or watermark.
${referenceFrameInstruction(aspectRatio)}`;
}

function cleanBasePrompt(prompt: string, kind: "character" | "location", name: string) {
  const promptWithoutManagedBlock = kind === "character"
    ? prompt.replace(/\n\s*CHARACTER REFERENCE SHEET — REQUIRED THREE CAMERA VIEWS[\s\S]*$/i, "")
    : prompt.replace(/\n\s*LOCATION REFERENCE SHEET — REQUIRED FOUR CAMERA DIRECTIONS[\s\S]*$/i, "");
  return promptWithoutManagedBlock
    .trim()
    .slice(0, 2_100)
    .replace(/(?:^|[\n.])[^.\n]*(?:\bno\b|\bavoid\b|do not|don't)[^.\n]*(?:contact sheet|reference sheet|multi[- ]?view|collage|grid|panels?)[^.\n]*(?:[.]|$)/gi, "\n")
    .replace(/\s*\n\s*\n\s*/g, "\n\n")
    .trim() || `${kind === "character" ? "Character" : "Location"} reference for ${name}. Preserve a coherent, consistent visual identity.`;
}

export function characterReferencePrompt(name: string, prompt: string, aspectRatio = PROFILE_REFERENCE_ASPECT_RATIO) {
  const base = cleanBasePrompt(prompt, "character", name);
  const block = characterViewBlock(aspectRatio);
  const budget = Math.max(0, 3_000 - block.length - 2);
  return `${base.slice(0, budget)}\n\n${block}`.trim();
}

export function locationReferencePrompt(name: string, prompt: string, aspectRatio = PROFILE_REFERENCE_ASPECT_RATIO) {
  const base = cleanBasePrompt(prompt, "location", name);
  const block = locationViewBlock(aspectRatio);
  const budget = Math.max(0, 3_000 - block.length - 2);
  return `${base.slice(0, budget)}\n\n${block}`.trim();
}
