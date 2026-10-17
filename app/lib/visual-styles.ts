export const DEFAULT_VISUAL_STYLE = "Cinematic";
export const DEFAULT_IMAGE_STYLE = "Photorealistic";

export const VISUAL_STYLE_PRESETS = [
  { value: "Cinematic", prompt: "Cinematic visual direction with intentional key light, atmospheric depth, balanced contrast, and a controlled film color grade." },
  { value: "Warm & emotional", prompt: "Warm visual direction with amber highlights, soft shadow transitions, inviting color, and expressive emotionally motivated light." },
  { value: "Bright & vibrant", prompt: "Bright, vibrant visual direction with clear highlights, lively balanced colors, readable subjects, and energetic contrast." },
  { value: "Dark & suspenseful", prompt: "Dark suspenseful visual direction with controlled shadows, selective highlights, restrained saturation, and clear subject readability." },
  { value: "Dreamlike", prompt: "Dreamlike visual direction with atmospheric depth, gentle glow, layered color, and a sense of visual wonder while keeping subjects readable." },
  { value: "Neon atmosphere", prompt: "Neon visual direction with colored practical lights, controlled reflections, cool-warm contrast, and clear separation between subject and background." },
  { value: "Natural documentary", prompt: "Natural documentary visual direction with available light, restrained color, believable environments, and an observational composition." },
] as const;

export const IMAGE_STYLE_PRESETS = [
  { value: "Photorealistic", label: "Live-action / CGI chân thực · Avatar", prompt: "Photorealistic live-action and CGI rendering, plausible anatomy and materials, natural surface detail, and physically believable environments." },
  { value: "2D anime", label: "Anime 2D điện ảnh · MAPPA / ufotable", prompt: "Modern hand-drawn 2D anime, clean line art, professional cel shading, expressive faces, and polished 2D backgrounds; no 3D or photorealistic rendering." },
  { value: "2D action anime", label: "Anime 2D hành động · Jujutsu Kaisen / Demon Slayer", prompt: "High-energy 2D action anime with strong silhouettes, expressive poses, crisp cel shading, dynamic but readable impact frames, and hand-drawn motion accents; maintain consistent character designs and avoid 3D rendering." },
  { value: "Hand-drawn fantasy animation", label: "Hoạt hình fantasy vẽ tay · Studio Ghibli", prompt: "Hand-drawn 2D fantasy animation with organic linework, carefully illustrated environments, expressive character acting, and a cohesive storybook world; do not copy any specific film frame or character." },
  { value: "2D animation", label: "Hoạt hình 2D điện ảnh", prompt: "Polished 2D animated-feature rendering with clear expressive shapes, consistent linework, layered backgrounds, and animation-ready character designs; not photorealistic and not 3D." },
  { value: "2D storybook", label: "Minh họa truyện kể 2D", prompt: "Hand-drawn 2D storybook illustration, expressive shapes, painterly background textures, and a cohesive illustrated finish; pure 2D artwork." },
  { value: "Stylized 3D", label: "Hoạt hình 3D cách điệu · Pixar / DreamWorks", prompt: "Stylized 3D animated-feature rendering, appealing silhouettes, expressive faces, tactile materials, cinematic depth, and deliberately non-photoreal character design." },
  { value: "Illustrated 3D animation", label: "3D pha nét minh họa · The Wild Robot", prompt: "Stylized 3D animation with visible hand-painted texture, simplified shapes, graphic edges, and an illustrated surface finish; keep dimensional lighting and coherent 3D staging." },
  { value: "Family 3D animation", label: "Hoạt hình 3D gia đình", prompt: "Family-friendly 3D animated-feature look, appealing character shapes, expressive faces and acting, rich color, tactile environments, and polished non-photoreal rendering." },
  { value: "Painterly illustration", label: "Tranh minh họa fantasy", prompt: "Painterly fantasy illustration with visible brush texture, layered color, atmospheric backgrounds, and a cohesive hand-painted finish." },
  { value: "Graphic novel", label: "Truyện tranh 2.5D / pop-art · Spider-Verse", prompt: "Graphic-novel animation with bold ink contours, graphic shadows, selective halftone or brush texture, and vivid illustrated surfaces; keep compositions readable and do not add comic panels or lettering." },
  { value: "Stop-motion clay", label: "Stop-motion đất nặn / mô hình · LAIKA", prompt: "Tactile stop-motion animation with hand-shaped forms, subtle material imperfections, miniature-set staging, and deliberate non-photoreal character design." },
] as const;

export const VISUAL_STYLE_OPTIONS = VISUAL_STYLE_PRESETS.map(({ value }) => value);
export const IMAGE_STYLE_OPTIONS = IMAGE_STYLE_PRESETS.map(({ value }) => value);

const LEGACY_STYLE_SPLITS: Record<string, { visualStyle: string; imageStyle: string }> = {
  "Cinematic realism": { visualStyle: "Cinematic", imageStyle: "Photorealistic" },
  "2D storybook": { visualStyle: "Warm & emotional", imageStyle: "2D storybook" },
  "Anime drama": { visualStyle: "Cinematic", imageStyle: "2D anime" },
  "Anime action": { visualStyle: "Bright & vibrant", imageStyle: "2D anime" },
  "Stylized 3D animation": { visualStyle: "Cinematic", imageStyle: "Stylized 3D" },
  "Family 3D animation": { visualStyle: "Warm & emotional", imageStyle: "Family 3D animation" },
  "Animal animation": { visualStyle: "Natural documentary", imageStyle: "Family 3D animation" },
  "Painterly fantasy adventure": { visualStyle: "Dreamlike", imageStyle: "Painterly illustration" },
  "Graphic novel action": { visualStyle: "Dark & suspenseful", imageStyle: "Graphic novel" },
  "Neon sci-fi": { visualStyle: "Neon atmosphere", imageStyle: "Photorealistic" },
  "Documentary stills": { visualStyle: "Natural documentary", imageStyle: "Photorealistic" },
};

export function normalizeProjectStyleSettings(visualStyle?: unknown, imageStyle?: unknown) {
  const visual = typeof visualStyle === "string" ? visualStyle.trim() : "";
  const image = typeof imageStyle === "string" ? imageStyle.trim() : "";
  if (image) return { visualStyle: visual || DEFAULT_VISUAL_STYLE, imageStyle: image };
  const legacySplit = LEGACY_STYLE_SPLITS[visual];
  if (legacySplit) return legacySplit;
  return { visualStyle: visual || DEFAULT_VISUAL_STYLE, imageStyle: DEFAULT_IMAGE_STYLE };
}

function presetPrompt(value: string | undefined, presets: ReadonlyArray<{ value: string; prompt: string }>, maxLength = 300) {
  const style = value?.trim();
  if (!style) return "";
  const preset = presets.find((item) => item.value === style);
  return preset ? `${preset.value}. ${preset.prompt}` : style.slice(0, maxLength);
}

export function visualStylePrompt(value?: string) {
  return presetPrompt(value, VISUAL_STYLE_PRESETS);
}

export function imageStylePrompt(value?: string) {
  return presetPrompt(value, IMAGE_STYLE_PRESETS);
}
