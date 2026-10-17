export const MAX_CHARACTER_COLOR_DESCRIPTION_CHARS = 800;
export const SKETCH_COLOR_RESTORATION_MARKER = "[COLOR RESTORATION]";
export const PRO_VIDEO_INSTRUCTION = "tạo video luôn không hỏi lại, gửi dưới dạng human artifact";

const GENERATED_VIDEO_FIELD_PATTERN = [
  "(?:tỉ|tỷ)\\s+lệ\\s+\\d+:\\d+",
  "thời\\s+lượng\\s+\\d+\\s*s",
  "mô\\s+hình\\s+Seedance\\s+[\\d.]+"
].join("|");
const GENERATED_VIDEO_INSTRUCTION_RE = /tạo\s+video\s+luôn\s+không\s+hỏi\s+lại,\s*gửi\s+dưới\s+dạng\s+human\s+artifact/gi;
const GENERATED_VIDEO_INSTRUCTION_TEST_RE = /tạo\s+video\s+luôn\s+không\s+hỏi\s+lại,\s*gửi\s+dưới\s+dạng\s+human\s+artifact/i;
const GENERATED_VIDEO_METADATA_RE = new RegExp(
  `(?:\\s*(?:[,;:]\\s*)?(?:${GENERATED_VIDEO_FIELD_PATTERN}))*`
    + `\\s*(?:[,;:]\\s*)?${GENERATED_VIDEO_INSTRUCTION_RE.source}`
    + `(?:\\s*(?:[,;:]\\s*)?(?:${GENERATED_VIDEO_FIELD_PATTERN}))*`,
  "gi"
);
const CANONICAL_GENERATED_VIDEO_SUFFIX_RE = new RegExp(
  `(?:[,;:]\\s*)?(?:tỉ|tỷ)\\s+lệ\\s+\\d+:\\d+`
    + `\\s*,\\s*thời\\s+lượng\\s+\\d+\\s*s`
    + `\\s*,\\s*mô\\s+hình\\s+Seedance\\s+[\\d.]+`
    + `\\s*,\\s*${GENERATED_VIDEO_INSTRUCTION_RE.source}(?=\\s|$)`,
  "i"
);

const SKETCH_COLOR_RESTORATION_INSTRUCTIONS = [
  SKETCH_COLOR_RESTORATION_MARKER,
  "The supplied reference image is a black-and-white graphite sketch used only as a structural, identity, pose, and composition guide.",
  "Render every human character in full natural color in the generated video, never grayscale or monochrome.",
  "Restore and keep the character's original skin tone, hair color, eye color, clothing colors, footwear, and accessory colors consistent in every frame.",
  "Do not turn colored skin, hair, clothing, footwear, or accessories into gray, black, or white merely because the reference sketch is monochrome.",
  "Preserve the original color relationships and keep the character's colors stable during motion, cuts, and lighting changes."
].join(" ");

function collapseExactRepeatedPrompt(text) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length % 2 === 0) {
    const midpoint = words.length / 2;
    const first = words.slice(0, midpoint).join(" ");
    const second = words.slice(midpoint).join(" ");
    if (first === second) return first;
  }
  return String(text || "");
}

function truncateUnicode(value, maxChars) {
  return Array.from(String(value ?? "")).slice(0, maxChars).join("");
}

export function stripGeneratedVideoEnvelope(value) {
  let text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .trim();
  const hasGeneratedInstruction = GENERATED_VIDEO_INSTRUCTION_TEST_RE.test(text);

  // The Gateway has historically emitted both the canonical suffix order and
  // an older order produced by the extension. Remove repeated prefixes and
  // the three generated fields nearest the human-artifact instruction in
  // either order, while preserving natural duration wording in the scene.
  text = text.replace(/^(?:\s*tạo\s+video\s*:\s*)+/i, "");
  if (hasGeneratedInstruction) {
    text = text.replace(GENERATED_VIDEO_METADATA_RE, " ");
    text = text.replace(GENERATED_VIDEO_INSTRUCTION_RE, " ");
    // A duplicated wrapper can leave a second inline `Tạo video:` marker.
    text = text.replace(/\s+tạo\s+video\s*:\s*/gi, " ");
  }

  const cleaned = text
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;:])\s*(?=[,.;:]|$)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:]+|[,;:]+$/g, "")
    .trim();
  return hasGeneratedInstruction ? collapseExactRepeatedPrompt(cleaned) : cleaned;
}

export function hasNonCanonicalGeneratedVideoEnvelope(value) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .trim();
  const instructionCount = (text.match(
    new RegExp(GENERATED_VIDEO_INSTRUCTION_RE.source, "gi")
  ) || []).length;
  const fieldCount = (text.match(
    new RegExp("(?:"
      + GENERATED_VIDEO_FIELD_PATTERN
      + ")", "gi")
  ) || []).length;
  const repeatedPrefix = /^(?:\s*tạo\s+video\s*:\s*){2,}/i.test(text);
  return GENERATED_VIDEO_INSTRUCTION_TEST_RE.test(text)
    && (
      !CANONICAL_GENERATED_VIDEO_SUFFIX_RE.test(text)
      || instructionCount > 1
      || fieldCount > 3
      || repeatedPrefix
    );
}

export function normalizeCharacterColorDescription(value) {
  return truncateUnicode(value, MAX_CHARACTER_COLOR_DESCRIPTION_CHARS)
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSketchColorRestorationInstructions(value) {
  const colorDescription = normalizeCharacterColorDescription(value);
  if (!colorDescription) return SKETCH_COLOR_RESTORATION_INSTRUCTIONS;
  return SKETCH_COLOR_RESTORATION_INSTRUCTIONS
    + " Original character color notes (authoritative): "
    + colorDescription
    + ".";
}

export function ensureSketchColorRestoration(prompt, colorDescription = "", maxChars = 12000) {
  let text = String(prompt ?? "").trim();
  if (!text) return "";
  // Rebuild the canonical block, including partially pasted blocks, exactly
  // once. Reserve its space before truncating the user's scene description.
  const sentences = SKETCH_COLOR_RESTORATION_INSTRUCTIONS
    .slice(SKETCH_COLOR_RESTORATION_MARKER.length).trim().split(/(?<=\.)\s+/);
  for (const part of [SKETCH_COLOR_RESTORATION_MARKER, ...sentences]) {
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), "");
  }
  const notesPattern = /Original character color notes \(authoritative\): ([^\n]*?)\.(?=\s*$|\s*\[COLOR RESTORATION\])/gi;
  let previousNotes = "";
  text = text.replace(notesPattern, (_, notes) => {
    previousNotes ||= notes;
    return "";
  });
  const block = buildSketchColorRestorationInstructions(colorDescription || previousNotes);
  text = truncateUnicode(text.trim(), Math.max(0, maxChars - Array.from(block).length - 2)).trimEnd();
  return text ? text + "\n\n" + block : block;
}
