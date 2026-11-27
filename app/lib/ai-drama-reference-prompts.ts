export const PROFILE_REFERENCE_ASPECT_RATIO = "1:1";

function referenceFrameInstruction(aspectRatio: string) {
  return `OUTPUT FRAME: Render the complete reference image in exactly ${aspectRatio}. This required reference frame overrides any different aspect ratio or orientation mentioned earlier. Fit every required view inside the frame without cropping.`;
}

export function isNaturalCreatureCharacterPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/\n\s*CHARACTER REFERENCE SHEET — REQUIRED THREE CAMERA VIEWS[\s\S]*$/i, "")
    .trim();
  if (!cleaned) return false;
  const explicitHuman = /\b(?:human|person|woman|man|girl|boy|lady|gentleman|teenager|elderly|grandmother|grandfather|chef|courier|detective|officer|doctor|student|villager|người|phụ nữ|đàn ông|cô gái|chàng trai|bà cụ|ông cụ)\b/iu.test(cleaned)
    && !/\b(?:without\s+(?:human\s+)?clothes|no\s+(?:human\s+)?clothes|non-?human|natural\s+\w+\s+anatomy|standing\s+(?:naturally\s+)?on\s+four\s+paws|quadruped(?:al)?)\b/iu.test(cleaned);
  if (explicitHuman) return false;
  return /\b(?:natural\s+\w+\s+anatomy|standing\s+(?:naturally\s+)?on\s+four\s+paws|on\s+all\s+fours|quadruped(?:al)?|bipedal\s+(?:creature|dinosaur|reptile|beast|monster)|canine|feline|felid|equine|bovine|ursine|ceratopsian|proboscidean|theropod|sauropod|crustacean|dinosaur|t-?rex|tyrannosaurus|triceratops|spinosaurus|velociraptor|raptor|ankylosaurus|stegosaurus|brachiosaurus|allosaurus|pterosaur|mammoth|mastodon|smilodon|megalodon|mosasaurus|plesiosaur|kaiju|monster|beast|dragon|creature|tiger|lion|leopard|panther|jaguar|cheetah|sabertooth|gorilla|orangutan|gigantopithecus|ape|chimp|mandrill|baboon|monkey|bear|grizzly|polar\s+bear|panda|wolf|hound|dog|puppy|bulldog|rottweiler|retriever|husky|malamute|shepherd|mastiff|doberman|terrier|beagle|poodle|corgi|shiba|akita|chihuahua|pug|dachshund|dalmatian|collie|spaniel|shar[- ]?pei|greyhound|mutt|ridgeback|cat|kitten|tabby|calico|siamese|fox|squirrel|rabbit|hare|raccoon|badger|otter|beaver|boar|warthog|pig|hog|bull|buffalo|bison|rhino|elephant|hippo|horse|stallion|pony|donkey|deer|stag|moose|elk|camel|goat|sheep|ram|kangaroo|koala|sloth|pangolin|crocodile|alligator|lizard|turtle|tortoise|frog|toad|serpent|snake|shark|whale|orca|dolphin|seal|walrus|octopus|crab|lobster|scorpion|spider|eagle|hawk|falcon|owl|crow|raven|parrot|penguin|swan|rooster|chicken|hen|duck|goose|khủng\s+long|voi\s+ma\s+mút|quái\s+thú|cự\s+thú|mãnh\s+thú|hổ|sư\s+tử|báo|khỉ\s+đột|đười\s+ươi|gấu|sói|chó|cún|mèo|sóc|thỏ|ngựa|trâu|bò|voi|cá\s+sấu|cá\s+mập|cua|tôm\s+hùm|bọ\s+cạp|đại\s+bàng)\b/iu.test(cleaned);
}

function characterViewBlock(aspectRatio: string, isCreature = false) {
  const [width, height] = aspectRatio.split(":").map(Number);
  const layout = width > height
    ? "arranged horizontally in one row"
    : width < height
      ? "stacked vertically in one column"
      : "arranged in a clear three-panel 2×2 composition: front view in the upper-left cell, back view in the upper-right cell, and one wide portrait spanning both cells of the bottom row";
  if (isCreature) {
    return `CHARACTER REFERENCE SHEET — REQUIRED THREE CAMERA VIEWS.
Create one clean reference sheet on a plain white or neutral background, ${layout}. The sheet contains exactly three panels and exactly one creature/animal subject repeated across those panels:
1. FRONT VIEW: full body, facing the camera, complete anatomy visible from head to paws/claws/tail.
2. BACK/THREE-QUARTER REAR VIEW: full body showing dorsal markings, spine/crest, limbs and tail clearly.
3. PORTRAIT: one front-facing close-up of the head, snout/jaw, eyes, horns/ears and neck markings, occupying the wide bottom panel.
Keep the exact same species anatomy, head structure, fur/scale/hide texture, color pattern, scars/markings, body proportions and any explicitly specified collar or gear in every view. Do NOT anthropomorphize into a human or add human clothing, shirts, pants or footwear unless explicitly stated in the character description. Use grounded natural stances, consistent scale and even studio lighting. Keep the three panels distinct and fully inside the frame. Do not add a fourth view, extra subject, scene backdrop, text, labels, logos or watermark.
${referenceFrameInstruction(aspectRatio)}`;
  }
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
For a square sheet, panel order is upper-left NORTH, upper-right EAST, lower-left SOUTH, lower-right WEST. Use a shared floor-plan coordinate system: preserve each door, window and landmark on its specified wall, with physically consistent occlusion from opposite viewpoints. If cardinal positions are not supplied, establish one coherent arrangement for this reference only, then keep it identical across all views. Keep architecture, spatial layout, paths, materials, fixed landmarks, recurring set props, time of day, weather, lighting and palette consistent in every panel. These are four camera directions in one coherent place, not four alternate designs. Do not omit, duplicate or reorder a direction. No people, overlay text, panel labels, logos or watermark. Physical labels or signage are allowed only when explicitly required by the base environment; otherwise keep surfaces unlettered.
${referenceFrameInstruction(aspectRatio)}`;
}

function cleanBasePrompt(prompt: string, kind: "character" | "location", name: string) {
  const promptWithoutManagedBlock = kind === "character"
    ? prompt.replace(/\n\s*CHARACTER REFERENCE SHEET — REQUIRED THREE CAMERA VIEWS[\s\S]*$/i, "")
    : prompt.replace(/\n\s*LOCATION REFERENCE SHEET — REQUIRED FOUR CAMERA DIRECTIONS[\s\S]*$/i, "");
  return promptWithoutManagedBlock
    .trim()
    .replace(/(?:^|[\n.])[^.\n]*(?:\bno\b|\bavoid\b|do not|don't)[^.\n]*(?:contact sheet|reference sheet|multi[- ]?view|collage|grid|panels?)[^.\n]*(?:[.]|$)/gi, "\n")
    .replace(/\s*\n\s*\n\s*/g, "\n\n")
    .trim() || `${kind === "character" ? "Character" : "Location"} reference for ${name}. Preserve a coherent, consistent visual identity.`;
}

export function characterReferencePrompt(name: string, prompt: string, aspectRatio = PROFILE_REFERENCE_ASPECT_RATIO) {
  const base = cleanBasePrompt(prompt, "character", name);
  const block = characterViewBlock(aspectRatio, isNaturalCreatureCharacterPrompt(base));
  return checkedReferencePrompt(base, block);
}

export function locationReferencePrompt(name: string, prompt: string, aspectRatio = PROFILE_REFERENCE_ASPECT_RATIO) {
  const base = cleanBasePrompt(prompt, "location", name);
  const block = locationViewBlock(aspectRatio);
  return checkedReferencePrompt(base, block);
}

function checkedReferencePrompt(base: string, block: string) {
  const prompt = `${base}\n\n${block}`.trim();
  if (prompt.length > 9_999) throw new Error("REFERENCE_PROMPT_TOO_LONG: rút gọn hướng dẫn lặp; không cắt đặc điểm nhân vật hoặc sơ đồ bối cảnh.");
  return prompt;
}
