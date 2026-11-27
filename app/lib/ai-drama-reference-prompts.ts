export const PROFILE_REFERENCE_ASPECT_RATIO = "1:1";

export type CharacterReferenceKind = "human" | "natural_creature" | "dressed_creature" | "construct";

function referenceFrameInstruction(aspectRatio: string) {
  return `OUTPUT FRAME: Render the complete reference image in exactly ${aspectRatio}. This required reference frame overrides any different aspect ratio or orientation mentioned earlier. Fit every required view inside the frame without cropping.`;
}

function stripManagedCharacterBlock(prompt: string) {
  return prompt
    .replace(/\n\s*CHARACTER REFERENCE SHEET — REQUIRED THREE CAMERA VIEWS[\s\S]*$/i, "")
    .trim();
}

export function classifyCharacterReferenceKind(prompt: string): CharacterReferenceKind {
  const cleaned = stripManagedCharacterBlock(prompt);
  if (!cleaned) return "human";

  const isConstruct = /\b(?:robot|robotic\s+(?:unit|chassis|hound|drone|guardian|sentinel)|mecha|mech\s+(?:suit|unit|warrior|frame)|automaton|clockwork\s+(?:automaton|construct|guardian)|battle\s+droid|droid|autonomous\s+drone|hover\s+drone|golem|stone\s+golem|iron\s+golem|crystal\s+golem|elemental\s+(?:construct|entity|guardian|golem)|mechanical\s+(?:construct|sentinel|unit|guardian)|synthetic\s+android\s+chassis|người\s+máy|cỗ\s+máy\s+tự\s+hành|khôi\s+lỗi)\b/iu.test(cleaned)
    && !/\b(?:human\s+(?:pilot|driver|boy|girl|woman|man)|person\s+wearing)\b/iu.test(cleaned);
  if (isConstruct) return "construct";

  const explicitHuman = /\b(?:human|person|woman|man|girl|boy|lady|gentleman|teenager|elderly|grandmother|grandfather|mother|father|sister|brother|wife|husband|ceo|chef|courier|detective|officer|doctor|nurse|teacher|student|villager|emperor|empress|prince|princess|scholar|monk|warrior|knight|samurai|swordsman|swordswoman|cultivator|mage|sorcerer|witch|astronaut|người|phụ nữ|đàn ông|cô gái|chàng trai|bà cụ|ông cụ|thiếu nữ|thiếu niên)\b/iu.test(cleaned)
    && !/\b(?:without\s+(?:any\s+)?(?:human\s+)?(?:clothes|clothing)|no\s+(?:human\s+)?(?:clothes|clothing)|non-?human|natural\s+\w+\s+anatomy|standing\s+(?:naturally\s+)?on\s+four\s+paws|quadruped(?:al)?|anthropomorphic\s+(?:animal|dog|cat|fox|wolf|rabbit|bear|bird|creature|squirrel|mouse|frog|pig|tiger|lion|monkey|panda))\b/iu.test(cleaned);
  if (explicitHuman) return "human";

  const isCreatureSpecies = /\b(?:anthropomorphic|natural\s+\w+\s+anatomy|standing\s+(?:naturally\s+)?on\s+four\s+paws|on\s+all\s+fours|quadruped(?:al)?|bipedal\s+(?:creature|dinosaur|reptile|beast|monster|animal|dog|cat|fox|wolf|rabbit|bear|squirrel)|canine|feline|felid|equine|bovine|ursine|ceratopsian|proboscidean|theropod|sauropod|crustacean|dinosaur|t-?rex|tyrannosaurus|triceratops|spinosaurus|velociraptor|raptor|ankylosaurus|stegosaurus|brachiosaurus|allosaurus|pterosaur|mammoth|mastodon|smilodon|megalodon|mosasaurus|plesiosaur|kaiju|monster|beast|dragon|wyvern|griffin|phoenix|unicorn|qilin|kitsune|fenrir|hydra|kraken|chimera|werewolf|creature|tiger|lion|leopard|panther|jaguar|cheetah|sabertooth|gorilla|orangutan|gigantopithecus|ape|chimp|mandrill|baboon|monkey|bear|grizzly|polar\s+bear|panda|wolf|hound|dog|puppy|bulldog|bull\s+terrier|rottweiler|retriever|samoyed|husky|malamute|shepherd|mastiff|doberman|terrier|beagle|poodle|corgi|shiba|akita|chihuahua|pug|dachshund|dalmatian|collie|spaniel|shar[- ]?pei|greyhound|mutt|ridgeback|cat|kitten|tabby|calico|siamese|fox|squirrel|mouse|rat|hamster|rabbit|hare|raccoon|badger|otter|beaver|hedgehog|boar|warthog|pig|hog|bull|buffalo|bison|rhino|elephant|hippo|horse|stallion|pony|donkey|deer|stag|moose|elk|camel|goat|sheep|ram|kangaroo|koala|sloth|pangolin|crocodile|alligator|lizard|gecko|chameleon|turtle|tortoise|frog|toad|serpent|snake|cobra|python|shark|whale|orca|dolphin|seal|walrus|octopus|crab|lobster|scorpion|spider|mantis|beetle|eagle|hawk|falcon|owl|crow|raven|parrot|penguin|swan|farm[- ]?bird|bird|rooster|chicken|hen|duck|goose|khủng\s+long|voi\s+ma\s+mút|quái\s+thú|cự\s+thú|mãnh\s+thú|rồng|phượng\s+hoàng|kỳ\s+lân|hồ\s+ly|hổ|sư\s+tử|báo|khỉ\s+đột|đười\s+ươi|gấu|sói|chó|cún|mèo|sóc|thỏ|chuột|ngựa|trâu|bò|voi|cá\s+sấu|cá\s+mập|cua|tôm\s+hùm|bọ\s+cạp|đại\s+bàng)\b/iu.test(cleaned);
  if (!isCreatureSpecies) return "human";

  const explicitlyUnclad = /\b(?:without\s+(?:any\s+)?(?:human\s+)?(?:clothes|clothing|garments|outfits?|harness)|no\s+(?:human\s+)?(?:clothes|clothing|garments|outfits?)|unclad|unclothed|không\s+mặc\s+(?:quần\s+áo|đồ))\b/iu.test(cleaned);
  const hasExplicitOutfit = !explicitlyUnclad && /\b(?:anthropomorphic|dressed\s+in|clothed\s+in|outfitted\s+in|wearing\s+(?:a\s+|an\s+|his\s+|her\s+|its\s+|tiny\s+|small\s+|fitted\s+|tailored\s+|vintage\s+|studded\s+|pastel\s+|dark\s+|black\s+|red\s+|blue\s+|white\s+|pink\s+|green\s+|brown\s+|golden\s+|silver\s+|brass\s+|leather\s+|denim\s+|silk\s+|lace\s+|wool\s+|linen\s+)?(?:jacket|coat|shirt|t-?shirt|blouse|vest|waistcoat|sweater|hoodie|jeans|trousers|pants|shorts|overalls|dress|skirt|gown|robe|hanfu|ao\s+dai|kimono|tunic|armor|suit|tuxedo|uniform|apron|cape|cloak|scarf|hat|cap|helmet|crown|glasses|spectacles|sunglasses|goggles|wig|toupee|boots|shoes|sneakers|backpack)|biker\s+jacket|leather\s+jacket|denim\s+jeans|lace\s+dress|silk\s+robe|plate\s+armor|flight\s+suit|space\s+suit|aviator\s+goggles|toupee|hairpiece|wig|dyed\s+(?:\w+\s+){0,2}(?:mohawk|bangs|crest|wig)|mặc\s+(?:áo|quần|váy|giáp|trường\s+bào)|đội\s+(?:mũ|nón|tóc\s+giả|mái\s+giả)|đeo\s+kính)\b/iu.test(cleaned);

  return hasExplicitOutfit ? "dressed_creature" : "natural_creature";
}

export function isNaturalCreatureCharacterPrompt(prompt: string) {
  return classifyCharacterReferenceKind(prompt) === "natural_creature";
}

function characterViewBlock(aspectRatio: string, kind: CharacterReferenceKind = "human") {
  const [width, height] = aspectRatio.split(":").map(Number);
  const layout = width > height
    ? "arranged horizontally in one row"
    : width < height
      ? "stacked vertically in one column"
      : "arranged in a clear three-panel 2×2 composition: front view in the upper-left cell, back view in the upper-right cell, and one wide portrait spanning both cells of the bottom row";
  if (kind === "natural_creature") {
    return `CHARACTER REFERENCE SHEET — REQUIRED THREE CAMERA VIEWS.
Create one clean reference sheet on a plain white or neutral background, ${layout}. The sheet contains exactly three panels and exactly one creature/animal subject repeated across those panels:
1. FRONT VIEW: full body, facing the camera, complete anatomy visible from head to paws/claws/tail.
2. BACK/THREE-QUARTER REAR VIEW: full body showing dorsal markings, spine/crest, limbs and tail clearly.
3. PORTRAIT: one front-facing close-up of the head, snout/jaw, eyes, horns/ears and neck markings, occupying the wide bottom panel.
Keep the exact same species anatomy, head structure, fur/scale/hide texture, color pattern, scars/markings, body proportions and any explicitly specified collar or gear in every view. Do NOT anthropomorphize into a human or add human clothing, shirts, pants or footwear unless explicitly stated in the character description. Use grounded natural stances, consistent scale and even studio lighting. Keep the three panels distinct and fully inside the frame. Do not add a fourth view, extra subject, scene backdrop, text, labels, logos or watermark.
${referenceFrameInstruction(aspectRatio)}`;
  }
  if (kind === "dressed_creature") {
    return `CHARACTER REFERENCE SHEET — REQUIRED THREE CAMERA VIEWS.
Create one clean reference sheet on a plain white or neutral background, ${layout}. The sheet contains exactly three panels and exactly one dressed/stylized animal or creature character repeated across those panels:
1. FRONT VIEW: full body, facing the camera, complete species anatomy, posture and signature outfit/accessories visible from head to paws/feet/tail.
2. BACK/THREE-QUARTER REAR VIEW: full body showing the back of the outfit, dorsal fur/markings, ears/crest/hairpiece and tail clearly.
3. PORTRAIT: one front-facing close-up of the animal/creature head, muzzle/snout, eyes, ears/hairpiece and collar/neckwear, occupying the wide bottom panel.
Keep the exact same species facial structure, fur/scale pattern, body stance (quadrupedal or bipedal as described) and exact signature clothing, accessories or hairstyle in every view. Do NOT replace the animal/creature head with a human face or alter its outfit between panels. Use consistent scale and even studio lighting. Keep the three panels distinct and fully inside the frame. Do not add a fourth view, extra subject, scene backdrop, text, labels, logos or watermark.
${referenceFrameInstruction(aspectRatio)}`;
  }
  if (kind === "construct") {
    return `CHARACTER REFERENCE SHEET — REQUIRED THREE CAMERA VIEWS.
Create one clean reference sheet on a plain white or neutral background, ${layout}. The sheet contains exactly three panels and exactly one mechanical or elemental construct character repeated across those panels:
1. FRONT VIEW: full body, facing the camera, complete chassis/body structure visible from head/sensor unit to base/feet.
2. BACK VIEW: full body, facing away from the camera, dorsal plating, joints, power core/thrusters and silhouette clearly visible.
3. PORTRAIT: one front-facing close-up of the head/visor/core unit and upper shoulders, occupying the wide bottom panel.
Keep the exact same chassis geometry, armor/stone/energy surface materials, joint articulation, optical sensors/runes, weathered markings and proportions in every view. Do NOT replace mechanical or elemental parts with human skin, hair or unrequested fabric clothing. Use balanced neutral stances, consistent scale and even studio lighting. Keep the three panels distinct and fully inside the frame. Do not add a fourth view, extra subject, scene backdrop, text, labels, logos or watermark.
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
  const block = characterViewBlock(aspectRatio, classifyCharacterReferenceKind(base));
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
