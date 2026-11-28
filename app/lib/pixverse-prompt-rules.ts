// Auto-synchronized from /Users/mdd/Desktop/maivideo/backend/app/services/pixverse_prompt.py.
// Deterministic semantic safety normalization shared across StoryAI image/video prompts.

export const DEFAULT_CONTEXTUAL_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "blood pressure",
    "vital signs"
  ],
  [
    "blood sugar",
    "glucose level"
  ],
  [
    "blood test",
    "routine lab test"
  ],
  [
    "blood sample",
    "medical sample"
  ],
  [
    "blood vessel",
    "circulatory vessel"
  ],
  [
    "blood cell count",
    "cell count"
  ],
  [
    "blood relative",
    "family member"
  ],
  [
    "blood ties",
    "family ties"
  ],
  [
    "blood bank",
    "medical donation center"
  ],
  [
    "blood donor",
    "medical donor"
  ],
  [
    "blood orange",
    "red-fleshed orange"
  ],
  [
    "blood red",
    "deep crimson"
  ],
  [
    "nude color palette",
    "neutral color palette"
  ],
  [
    "nude makeup",
    "natural makeup"
  ],
  [
    "nude lipstick shade",
    "neutral lipstick shade"
  ],
  [
    "nude block-heel pumps",
    "beige block-heel pumps"
  ],
  [
    "nude pumps",
    "beige pumps"
  ],
  [
    "nude heels",
    "beige heels"
  ],
  [
    "pussy-bow",
    "ribbon-bow"
  ],
  [
    "pussy bow",
    "ribbon-bow"
  ],
  [
    "pussycat",
    "kitten"
  ],
  [
    "naked eye",
    "unaided eye"
  ],
  [
    "naked eye view",
    "unaided eye view"
  ],
  [
    "naked eye observation",
    "unaided-eye observation"
  ],
  [
    "naked-eye view",
    "unaided-eye view"
  ],
  [
    "age of the universe",
    "cosmic timescale"
  ],
  [
    "age of the earth",
    "geologic timescale"
  ],
  [
    "age of a tree",
    "tree growth rings"
  ],
  [
    "age rating",
    "content rating"
  ],
  [
    "age-appropriate",
    "context-appropriate"
  ],
  [
    "age–appropriate",
    "context-appropriate"
  ],
  [
    "character styling-appropriate",
    "context-appropriate"
  ],
  [
    "consistent adult age",
    "consistent adult maturity"
  ],
  [
    "age-lock",
    "visual-lock"
  ],
  [
    "de-age",
    "restyle"
  ],
  [
    "golden age",
    "classic era"
  ],
  [
    "bronze age",
    "ancient bronze era"
  ],
  [
    "stone age",
    "prehistoric era"
  ],
  [
    "ice age",
    "glacial era"
  ],
  [
    "middle-age",
    "midlife"
  ],
  [
    "middle age",
    "midlife"
  ],
  [
    "old age",
    "later life"
  ],
  [
    "coming-of-age",
    "personal growth"
  ],
  [
    "coming of age",
    "personal growth"
  ],
  [
    "age appearance",
    "maturity appearance"
  ],
  [
    "age groups",
    "generation groups"
  ],
  [
    "age group",
    "generation group"
  ],
  [
    "age gap",
    "generation gap"
  ],
  [
    "age range",
    "maturity range"
  ],
  [
    "same age",
    "similar generation"
  ],
  [
    "re-age",
    "restyle"
  ],
  [
    "re-character styling",
    "restyle"
  ],
  [
    "youthen",
    "restyle"
  ],
  [
    "of its own age",
    "of its own design"
  ],
  [
    "of that age",
    "of that design"
  ],
  [
    "as their age gives",
    "as their design gives"
  ],
  [
    "beautify, age,",
    "beautify, alter,"
  ],
  [
    "re-interpret, age,",
    "re-interpret, alter,"
  ],
  [
    "dead silence",
    "complete silence"
  ],
  [
    "dead end",
    "cul-de-sac"
  ],
  [
    "identity crisis",
    "personal journey"
  ],
  [
    "origin story",
    "character backstory"
  ],
  [
    "sexual reproduction",
    "biological reproduction"
  ],
  [
    "sexual dimorphism",
    "biological dimorphism"
  ],
  [
    "sex education",
    "reproductive health education"
  ],
  [
    "sexual health education",
    "reproductive health education"
  ],
  [
    "sexual health clinic",
    "reproductive health clinic"
  ],
  [
    "sexual health information",
    "reproductive health information"
  ],
  [
    "sex differences",
    "biological differences"
  ],
  [
    "suicide prevention poster",
    "mental health support poster"
  ],
  [
    "suicide awareness poster",
    "mental health awareness poster"
  ],
  [
    "suicide prevention campaign",
    "mental health awareness campaign"
  ],
  [
    "suicide hotline",
    "mental health crisis hotline"
  ],
  [
    "shooting star",
    "meteor streak"
  ],
  [
    "shoot a scene",
    "film a scene"
  ],
  [
    "shooting a scene",
    "filming a scene"
  ],
  [
    "shoot a movie",
    "film a movie"
  ],
  [
    "shooting a movie",
    "filming a movie"
  ],
  [
    "shoot a portrait",
    "photograph a portrait"
  ],
  [
    "shooting a portrait",
    "photographing a portrait"
  ],
  [
    "shoot a film",
    "film a movie"
  ],
  [
    "shooting a film",
    "filming a movie"
  ],
  [
    "shoot photos",
    "take photos"
  ],
  [
    "photo shoot",
    "photo session"
  ],
  [
    "shoot a message",
    "send a message"
  ],
  [
    "shoot me a message",
    "send me a message"
  ],
  [
    "smoking gun",
    "decisive evidence"
  ],
  [
    "smoking gun evidence",
    "decisive evidence"
  ],
  [
    "starting gun",
    "race-start signal"
  ],
  [
    "starting gun signal",
    "race-start signal"
  ],
  [
    "starter gun",
    "race-start signal"
  ],
  [
    "starter gun signal",
    "race-start signal"
  ],
  [
    "glue gun",
    "adhesive applicator"
  ],
  [
    "heat gun",
    "hot-air tool"
  ],
  [
    "massage gun",
    "percussion massager"
  ],
  [
    "spray gun",
    "paint sprayer"
  ],
  [
    "water gun",
    "water squirter"
  ],
  [
    "starting pistol",
    "race-start signal"
  ],
  [
    "starter pistol",
    "race-start signal"
  ],
  [
    "pistol shrimp",
    "snapping shrimp"
  ],
  [
    "sword fern",
    "fern plant"
  ],
  [
    "sword lily",
    "gladiolus flower"
  ],
  [
    "corpse flower",
    "titan arum flower"
  ],
  [
    "secret weapon",
    "standout strength"
  ],
  [
    "butter knife",
    "table spreader"
  ],
  [
    "chef's knife",
    "cooking tool"
  ],
  [
    "kitchen knife",
    "cooking utensil"
  ],
  [
    "bath bomb",
    "bath fizzer"
  ],
  [
    "bullet point",
    "list marker"
  ],
  [
    "bullet journal",
    "daily journal"
  ],
  [
    "kill time",
    "pass the time"
  ],
  [
    "kill switch",
    "emergency shutoff"
  ],
  [
    "kill the lights",
    "turn off the lights"
  ],
  [
    "kill the engine",
    "turn off the engine"
  ],
  [
    "kill the process",
    "stop the process"
  ],
  [
    "kill the mood",
    "change the mood"
  ],
  [
    "kill the vibe",
    "change the mood"
  ],
  [
    "killing it on stage",
    "performing brilliantly on stage"
  ],
  [
    "killer whale",
    "orca"
  ],
  [
    "murder mystery",
    "detective mystery"
  ],
  [
    "murder mystery novel",
    "detective mystery novel"
  ],
  [
    "murder mystery game",
    "detective mystery game"
  ],
  [
    "murder mystery party",
    "detective mystery party"
  ],
  [
    "drug store",
    "pharmacy"
  ],
  [
    "drug discovery",
    "medicine research"
  ],
  [
    "drug trial",
    "clinical trial"
  ],
  [
    "drug interaction",
    "medicine interaction"
  ],
  [
    "drug side effects",
    "medicine side effects"
  ],
  [
    "drug education",
    "health education"
  ],
  [
    "drug testing",
    "health screening"
  ],
  [
    "drug awareness poster",
    "health awareness poster"
  ],
  [
    "drug prevention campaign",
    "health prevention campaign"
  ],
  [
    "drug rehabilitation center",
    "recovery center"
  ],
  [
    "drug treatment program",
    "medical treatment program"
  ],
  [
    "drug policy debate",
    "public health policy debate"
  ],
  [
    "drug development research",
    "medicine development research"
  ],
  [
    "bullet train",
    "high-speed train"
  ],
  [
    "bullet point list",
    "list of key points"
  ],
  [
    "bullet point summary",
    "key-point summary"
  ],
  [
    "knife skills",
    "cooking skills"
  ],
  [
    "knife edge balance",
    "precise balance"
  ],
  [
    "knife-edge balance",
    "precise balance"
  ],
  [
    "stab in the back",
    "betray"
  ],
  [
    "stabbed in the back",
    "betrayed"
  ],
  [
    "fight a cold",
    "recover from a cold"
  ],
  [
    "fighting a cold",
    "recovering from a cold"
  ],
  [
    "fight the flu",
    "recover from the flu"
  ],
  [
    "fighting a disease",
    "recovering from an illness"
  ],
  [
    "fight against time",
    "race against time"
  ],
  [
    "fighting against time",
    "racing against time"
  ],
  [
    "fight or flight response",
    "stress response"
  ],
  [
    "fight a software bug",
    "fix a software bug"
  ],
  [
    "fight traffic",
    "navigate traffic"
  ],
  [
    "fighting traffic",
    "navigating traffic"
  ],
  [
    "fight a fire",
    "put out a fire"
  ],
  [
    "fight choreography",
    "staged action choreography"
  ],
  [
    "fight scene choreography",
    "staged action choreography"
  ],
  [
    "bomb cyclone",
    "severe winter storm"
  ],
  [
    "explosive growth",
    "rapid growth"
  ],
  [
    "explosive colors",
    "vivid colors"
  ],
  [
    "explosive mix of colors",
    "vivid color palette"
  ],
  [
    "explosive personality",
    "energetic personality"
  ],
  [
    "explosive success",
    "rapid success"
  ],
  [
    "gun safety class",
    "responsible handling class"
  ],
  [
    "gun safety lesson",
    "responsible handling lesson"
  ],
  [
    "gun control debate",
    "public policy debate"
  ],
  [
    "people in the crowd",
    "crowd of attendees"
  ],
  [
    "people in a photo",
    "subjects in a photo"
  ],
  [
    "child's pose",
    "resting yoga pose"
  ],
  [
    "inner child",
    "playful spirit"
  ],
  [
    "kid leather",
    "soft leather"
  ],
  [
    "kid glove",
    "gentle handling"
  ],
  [
    "kid-friendly",
    "family-friendly"
  ],
  [
    "for kids",
    "for all ages"
  ],
  [
    "for children",
    "for all audiences"
  ],
  [
    "children's book",
    "illustrated storybook"
  ],
  [
    "children's story",
    "illustrated storybook"
  ],
  [
    "minor detail",
    "subtle detail"
  ],
  [
    "minor details",
    "subtle details"
  ],
  [
    "minor adjustment",
    "subtle adjustment"
  ],
  [
    "minor character",
    "supporting character"
  ],
  [
    "minor characters",
    "supporting characters"
  ],
  [
    "minor key",
    "melancholic key"
  ],
  [
    "minor scale",
    "melancholic scale"
  ],
  [
    "minor scratch",
    "light scratch"
  ],
  [
    "legal briefs",
    "legal documents"
  ],
  [
    "creative briefs",
    "creative summaries"
  ],
  [
    "design briefs",
    "design summaries"
  ],
  [
    "project briefs",
    "project summaries"
  ],
  [
    "policy briefs",
    "policy summaries"
  ],
  [
    "client briefs",
    "client summaries"
  ],
  [
    "news briefs",
    "news summaries"
  ],
  [
    "chicken breast",
    "chicken fillet"
  ],
  [
    "turkey breast",
    "turkey fillet"
  ],
  [
    "duck breast",
    "duck fillet"
  ],
  [
    "chicken thighs",
    "chicken drumsticks"
  ],
  [
    "chicken thigh",
    "chicken drumstick"
  ],
  [
    "turkey thighs",
    "turkey drumsticks"
  ],
  [
    "turkey thigh",
    "turkey drumstick"
  ],
  [
    "duck thighs",
    "duck drumsticks"
  ],
  [
    "duck thigh",
    "duck drumstick"
  ],
  [
    "breast cancer",
    "health awareness"
  ],
  [
    "cigarette butt",
    "discarded filter"
  ],
  [
    "rifle butt",
    "prop stock"
  ],
  [
    "non-sheer",
    "opaque"
  ],
  [
    "blade of grass",
    "stalk of grass"
  ],
  [
    "blades of grass",
    "stalks of grass"
  ],
  [
    "grass-blades",
    "grass-stalks"
  ],
  [
    "grass-blade",
    "grass-stalk"
  ],
  [
    "razor-blade",
    "thin metallic"
  ],
  [
    "shoulder blade",
    "upper back"
  ],
  [
    "shoulder blades",
    "upper back"
  ],
  [
    "fan blade",
    "fan vane"
  ],
  [
    "fan blades",
    "fan vanes"
  ],
  [
    "roller blades",
    "inline skates"
  ],
  [
    "hot-swap",
    "modular"
  ],
  [
    "swap-meet",
    "flea-market"
  ],
  [
    "swap meet",
    "flea market"
  ],
  [
    "đo huyết áp",
    "đo chỉ số sinh tồn"
  ],
  [
    "xét nghiệm máu",
    "xét nghiệm y tế"
  ],
  [
    "xét nghiệm mẫu máu",
    "phân tích mẫu y tế"
  ],
  [
    "giết thời gian",
    "lấp đầy thời gian"
  ],
  [
    "phòng chống tự sát",
    "hỗ trợ sức khỏe tinh thần"
  ],
  [
    "giáo dục tình dục",
    "giáo dục sức khỏe sinh sản"
  ],
  [
    "súng bắn keo",
    "dụng cụ bơm keo"
  ],
  [
    "súng phun sơn",
    "máy phun sơn"
  ],
  [
    "dao nhà bếp",
    "dụng cụ nhà bếp"
  ],
  [
    "kỹ năng dùng dao",
    "kỹ năng sơ chế"
  ],
  [
    "đạn đầu dòng",
    "ký hiệu đầu dòng"
  ]
];

export const DEFAULT_LITERAL_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "blood pressure",
    "vital signs"
  ],
  [
    "blood sugar",
    "glucose level"
  ],
  [
    "blood test",
    "routine lab test"
  ],
  [
    "blood sample",
    "medical sample"
  ],
  [
    "blood vessel",
    "circulatory vessel"
  ],
  [
    "blood cell count",
    "cell count"
  ],
  [
    "blood relative",
    "family member"
  ],
  [
    "blood ties",
    "family ties"
  ],
  [
    "blood bank",
    "medical donation center"
  ],
  [
    "blood donor",
    "medical donor"
  ],
  [
    "blood orange",
    "red-fleshed orange"
  ],
  [
    "blood red",
    "deep crimson"
  ],
  [
    "nude color palette",
    "neutral color palette"
  ],
  [
    "nude makeup",
    "natural makeup"
  ],
  [
    "nude lipstick shade",
    "neutral lipstick shade"
  ],
  [
    "nude block-heel pumps",
    "beige block-heel pumps"
  ],
  [
    "nude pumps",
    "beige pumps"
  ],
  [
    "nude heels",
    "beige heels"
  ],
  [
    "pussy-bow",
    "ribbon-bow"
  ],
  [
    "pussy bow",
    "ribbon-bow"
  ],
  [
    "pussycat",
    "kitten"
  ],
  [
    "naked eye",
    "unaided eye"
  ],
  [
    "naked eye view",
    "unaided eye view"
  ],
  [
    "naked eye observation",
    "unaided-eye observation"
  ],
  [
    "naked-eye view",
    "unaided-eye view"
  ],
  [
    "age of the universe",
    "cosmic timescale"
  ],
  [
    "age of the earth",
    "geologic timescale"
  ],
  [
    "age of a tree",
    "tree growth rings"
  ],
  [
    "age rating",
    "content rating"
  ],
  [
    "age-appropriate",
    "context-appropriate"
  ],
  [
    "age–appropriate",
    "context-appropriate"
  ],
  [
    "character styling-appropriate",
    "context-appropriate"
  ],
  [
    "consistent adult age",
    "consistent adult maturity"
  ],
  [
    "age-lock",
    "visual-lock"
  ],
  [
    "de-age",
    "restyle"
  ],
  [
    "golden age",
    "classic era"
  ],
  [
    "bronze age",
    "ancient bronze era"
  ],
  [
    "stone age",
    "prehistoric era"
  ],
  [
    "ice age",
    "glacial era"
  ],
  [
    "middle-age",
    "midlife"
  ],
  [
    "middle age",
    "midlife"
  ],
  [
    "old age",
    "later life"
  ],
  [
    "coming-of-age",
    "personal growth"
  ],
  [
    "coming of age",
    "personal growth"
  ],
  [
    "age appearance",
    "maturity appearance"
  ],
  [
    "age groups",
    "generation groups"
  ],
  [
    "age group",
    "generation group"
  ],
  [
    "age gap",
    "generation gap"
  ],
  [
    "age range",
    "maturity range"
  ],
  [
    "same age",
    "similar generation"
  ],
  [
    "re-age",
    "restyle"
  ],
  [
    "re-character styling",
    "restyle"
  ],
  [
    "youthen",
    "restyle"
  ],
  [
    "of its own age",
    "of its own design"
  ],
  [
    "of that age",
    "of that design"
  ],
  [
    "as their age gives",
    "as their design gives"
  ],
  [
    "beautify, age,",
    "beautify, alter,"
  ],
  [
    "re-interpret, age,",
    "re-interpret, alter,"
  ],
  [
    "dead silence",
    "complete silence"
  ],
  [
    "dead end",
    "cul-de-sac"
  ],
  [
    "identity crisis",
    "personal journey"
  ],
  [
    "origin story",
    "character backstory"
  ],
  [
    "sexual reproduction",
    "biological reproduction"
  ],
  [
    "sexual dimorphism",
    "biological dimorphism"
  ],
  [
    "sex education",
    "reproductive health education"
  ],
  [
    "sexual health education",
    "reproductive health education"
  ],
  [
    "sexual health clinic",
    "reproductive health clinic"
  ],
  [
    "sexual health information",
    "reproductive health information"
  ],
  [
    "sex differences",
    "biological differences"
  ],
  [
    "suicide prevention poster",
    "mental health support poster"
  ],
  [
    "suicide awareness poster",
    "mental health awareness poster"
  ],
  [
    "suicide prevention campaign",
    "mental health awareness campaign"
  ],
  [
    "suicide hotline",
    "mental health crisis hotline"
  ],
  [
    "shooting star",
    "meteor streak"
  ],
  [
    "shoot a scene",
    "film a scene"
  ],
  [
    "shooting a scene",
    "filming a scene"
  ],
  [
    "shoot a movie",
    "film a movie"
  ],
  [
    "shooting a movie",
    "filming a movie"
  ],
  [
    "shoot a portrait",
    "photograph a portrait"
  ],
  [
    "shooting a portrait",
    "photographing a portrait"
  ],
  [
    "shoot a film",
    "film a movie"
  ],
  [
    "shooting a film",
    "filming a movie"
  ],
  [
    "shoot photos",
    "take photos"
  ],
  [
    "photo shoot",
    "photo session"
  ],
  [
    "shoot a message",
    "send a message"
  ],
  [
    "shoot me a message",
    "send me a message"
  ],
  [
    "smoking gun",
    "decisive evidence"
  ],
  [
    "smoking gun evidence",
    "decisive evidence"
  ],
  [
    "starting gun",
    "race-start signal"
  ],
  [
    "starting gun signal",
    "race-start signal"
  ],
  [
    "starter gun",
    "race-start signal"
  ],
  [
    "starter gun signal",
    "race-start signal"
  ],
  [
    "glue gun",
    "adhesive applicator"
  ],
  [
    "heat gun",
    "hot-air tool"
  ],
  [
    "massage gun",
    "percussion massager"
  ],
  [
    "spray gun",
    "paint sprayer"
  ],
  [
    "water gun",
    "water squirter"
  ],
  [
    "starting pistol",
    "race-start signal"
  ],
  [
    "starter pistol",
    "race-start signal"
  ],
  [
    "pistol shrimp",
    "snapping shrimp"
  ],
  [
    "sword fern",
    "fern plant"
  ],
  [
    "sword lily",
    "gladiolus flower"
  ],
  [
    "corpse flower",
    "titan arum flower"
  ],
  [
    "secret weapon",
    "standout strength"
  ],
  [
    "butter knife",
    "table spreader"
  ],
  [
    "chef's knife",
    "cooking tool"
  ],
  [
    "kitchen knife",
    "cooking utensil"
  ],
  [
    "bath bomb",
    "bath fizzer"
  ],
  [
    "bullet point",
    "list marker"
  ],
  [
    "bullet journal",
    "daily journal"
  ],
  [
    "kill time",
    "pass the time"
  ],
  [
    "kill switch",
    "emergency shutoff"
  ],
  [
    "kill the lights",
    "turn off the lights"
  ],
  [
    "kill the engine",
    "turn off the engine"
  ],
  [
    "kill the process",
    "stop the process"
  ],
  [
    "kill the mood",
    "change the mood"
  ],
  [
    "kill the vibe",
    "change the mood"
  ],
  [
    "killing it on stage",
    "performing brilliantly on stage"
  ],
  [
    "killer whale",
    "orca"
  ],
  [
    "murder mystery",
    "detective mystery"
  ],
  [
    "murder mystery novel",
    "detective mystery novel"
  ],
  [
    "murder mystery game",
    "detective mystery game"
  ],
  [
    "murder mystery party",
    "detective mystery party"
  ],
  [
    "drug store",
    "pharmacy"
  ],
  [
    "drug discovery",
    "medicine research"
  ],
  [
    "drug trial",
    "clinical trial"
  ],
  [
    "drug interaction",
    "medicine interaction"
  ],
  [
    "drug side effects",
    "medicine side effects"
  ],
  [
    "drug education",
    "health education"
  ],
  [
    "drug testing",
    "health screening"
  ],
  [
    "drug awareness poster",
    "health awareness poster"
  ],
  [
    "drug prevention campaign",
    "health prevention campaign"
  ],
  [
    "drug rehabilitation center",
    "recovery center"
  ],
  [
    "drug treatment program",
    "medical treatment program"
  ],
  [
    "drug policy debate",
    "public health policy debate"
  ],
  [
    "drug development research",
    "medicine development research"
  ],
  [
    "bullet train",
    "high-speed train"
  ],
  [
    "bullet point list",
    "list of key points"
  ],
  [
    "bullet point summary",
    "key-point summary"
  ],
  [
    "knife skills",
    "cooking skills"
  ],
  [
    "knife edge balance",
    "precise balance"
  ],
  [
    "knife-edge balance",
    "precise balance"
  ],
  [
    "stab in the back",
    "betray"
  ],
  [
    "stabbed in the back",
    "betrayed"
  ],
  [
    "fight a cold",
    "recover from a cold"
  ],
  [
    "fighting a cold",
    "recovering from a cold"
  ],
  [
    "fight the flu",
    "recover from the flu"
  ],
  [
    "fighting a disease",
    "recovering from an illness"
  ],
  [
    "fight against time",
    "race against time"
  ],
  [
    "fighting against time",
    "racing against time"
  ],
  [
    "fight or flight response",
    "stress response"
  ],
  [
    "fight a software bug",
    "fix a software bug"
  ],
  [
    "fight traffic",
    "navigate traffic"
  ],
  [
    "fighting traffic",
    "navigating traffic"
  ],
  [
    "fight a fire",
    "put out a fire"
  ],
  [
    "fight choreography",
    "staged action choreography"
  ],
  [
    "fight scene choreography",
    "staged action choreography"
  ],
  [
    "bomb cyclone",
    "severe winter storm"
  ],
  [
    "explosive growth",
    "rapid growth"
  ],
  [
    "explosive colors",
    "vivid colors"
  ],
  [
    "explosive mix of colors",
    "vivid color palette"
  ],
  [
    "explosive personality",
    "energetic personality"
  ],
  [
    "explosive success",
    "rapid success"
  ],
  [
    "gun safety class",
    "responsible handling class"
  ],
  [
    "gun safety lesson",
    "responsible handling lesson"
  ],
  [
    "gun control debate",
    "public policy debate"
  ],
  [
    "people in the crowd",
    "crowd of attendees"
  ],
  [
    "people in a photo",
    "subjects in a photo"
  ],
  [
    "child's pose",
    "resting yoga pose"
  ],
  [
    "inner child",
    "playful spirit"
  ],
  [
    "kid leather",
    "soft leather"
  ],
  [
    "kid glove",
    "gentle handling"
  ],
  [
    "kid-friendly",
    "family-friendly"
  ],
  [
    "for kids",
    "for all ages"
  ],
  [
    "for children",
    "for all audiences"
  ],
  [
    "children's book",
    "illustrated storybook"
  ],
  [
    "children's story",
    "illustrated storybook"
  ],
  [
    "minor detail",
    "subtle detail"
  ],
  [
    "minor details",
    "subtle details"
  ],
  [
    "minor adjustment",
    "subtle adjustment"
  ],
  [
    "minor character",
    "supporting character"
  ],
  [
    "minor characters",
    "supporting characters"
  ],
  [
    "minor key",
    "melancholic key"
  ],
  [
    "minor scale",
    "melancholic scale"
  ],
  [
    "minor scratch",
    "light scratch"
  ],
  [
    "legal briefs",
    "legal documents"
  ],
  [
    "creative briefs",
    "creative summaries"
  ],
  [
    "design briefs",
    "design summaries"
  ],
  [
    "project briefs",
    "project summaries"
  ],
  [
    "policy briefs",
    "policy summaries"
  ],
  [
    "client briefs",
    "client summaries"
  ],
  [
    "news briefs",
    "news summaries"
  ],
  [
    "chicken breast",
    "chicken fillet"
  ],
  [
    "turkey breast",
    "turkey fillet"
  ],
  [
    "duck breast",
    "duck fillet"
  ],
  [
    "chicken thighs",
    "chicken drumsticks"
  ],
  [
    "chicken thigh",
    "chicken drumstick"
  ],
  [
    "turkey thighs",
    "turkey drumsticks"
  ],
  [
    "turkey thigh",
    "turkey drumstick"
  ],
  [
    "duck thighs",
    "duck drumsticks"
  ],
  [
    "duck thigh",
    "duck drumstick"
  ],
  [
    "breast cancer",
    "health awareness"
  ],
  [
    "cigarette butt",
    "discarded filter"
  ],
  [
    "rifle butt",
    "prop stock"
  ],
  [
    "non-sheer",
    "opaque"
  ],
  [
    "blade of grass",
    "stalk of grass"
  ],
  [
    "blades of grass",
    "stalks of grass"
  ],
  [
    "grass-blades",
    "grass-stalks"
  ],
  [
    "grass-blade",
    "grass-stalk"
  ],
  [
    "razor-blade",
    "thin metallic"
  ],
  [
    "shoulder blade",
    "upper back"
  ],
  [
    "shoulder blades",
    "upper back"
  ],
  [
    "fan blade",
    "fan vane"
  ],
  [
    "fan blades",
    "fan vanes"
  ],
  [
    "roller blades",
    "inline skates"
  ],
  [
    "hot-swap",
    "modular"
  ],
  [
    "swap-meet",
    "flea-market"
  ],
  [
    "swap meet",
    "flea market"
  ],
  [
    "đo huyết áp",
    "đo chỉ số sinh tồn"
  ],
  [
    "xét nghiệm máu",
    "xét nghiệm y tế"
  ],
  [
    "xét nghiệm mẫu máu",
    "phân tích mẫu y tế"
  ],
  [
    "giết thời gian",
    "lấp đầy thời gian"
  ],
  [
    "phòng chống tự sát",
    "hỗ trợ sức khỏe tinh thần"
  ],
  [
    "giáo dục tình dục",
    "giáo dục sức khỏe sinh sản"
  ],
  [
    "súng bắn keo",
    "dụng cụ bơm keo"
  ],
  [
    "súng phun sơn",
    "máy phun sơn"
  ],
  [
    "dao nhà bếp",
    "dụng cụ nhà bếp"
  ],
  [
    "kỹ năng dùng dao",
    "kỹ năng sơ chế"
  ],
  [
    "đạn đầu dòng",
    "ký hiệu đầu dòng"
  ],
  [
    "credit card number",
    "generic payment details"
  ],
  [
    "social security number",
    "generic identification number"
  ],
  [
    "driver's license",
    "generic identification document"
  ],
  [
    "driver license",
    "generic identification document"
  ],
  [
    "identity card",
    "generic identification document"
  ],
  [
    "id card",
    "generic identification document"
  ],
  [
    "explicit nudity",
    "fully clothed editorial portrait"
  ],
  [
    "graphic nudity",
    "fully clothed editorial portrait"
  ],
  [
    "explicit sexual content",
    "romantic editorial content"
  ],
  [
    "sexual content",
    "romantic editorial content"
  ],
  [
    "bare breasts",
    "covered upper body"
  ],
  [
    "exposed genitals",
    "fully clothed figure"
  ],
  [
    "sexual intercourse",
    "romantic embrace"
  ],
  [
    "sex scene",
    "romantic scene"
  ],
  [
    "sexually explicit",
    "romantic editorial"
  ],
  [
    "nothing sexualised",
    "fully clothed editorial styling"
  ],
  [
    "nothing sexualized",
    "fully clothed editorial styling"
  ],
  [
    "copy this person's exact face",
    "use a consistent fictional character face"
  ],
  [
    "person's exact face",
    "consistent fictional character face"
  ],
  [
    "copy their face",
    "use consistent fictional facial features"
  ],
  [
    "copy the face",
    "use consistent fictional facial features"
  ],
  [
    "exact likeness",
    "consistent fictional appearance"
  ],
  [
    "identity references only",
    "character references only"
  ],
  [
    "identity references",
    "character references"
  ],
  [
    "consistent character facial identities",
    "consistent facial character designs"
  ],
  [
    "consistent character facial identity",
    "consistent facial character design"
  ],
  [
    "characters' identities",
    "characters' visual designs"
  ],
  [
    "character's identity",
    "character's visual design"
  ],
  [
    "character identities",
    "character designs"
  ],
  [
    "character identity",
    "character design"
  ],
  [
    "identity-lock",
    "appearance-lock"
  ],
  [
    "identity lock",
    "appearance lock"
  ],
  [
    "identity drifting",
    "appearance drift"
  ],
  [
    "identity drift",
    "appearance drift"
  ],
  [
    "not a celebrity, not a public figure, not based on any real person",
    "an original fictional character concept"
  ],
  [
    "not a celebrity, not a public figure",
    "an original fictional character"
  ],
  [
    "not based on any real person",
    "an entirely original fictional concept"
  ],
  [
    "no real-person likeness",
    "only original fictional character design"
  ],
  [
    "no real-person fictional appearance",
    "only original fictional character design"
  ],
  [
    "real-person likeness",
    "original fictional character design"
  ],
  [
    "not a celebrity",
    "an original fictional character"
  ],
  [
    "based on any real person",
    "an original fictional character"
  ],
  [
    "real-person",
    "original fictional character"
  ],
  [
    "selected character nationality lock",
    "selected character visual profile"
  ],
  [
    "nationality is mandatory",
    "the visual profile is mandatory"
  ],
  [
    "bank-statement",
    "financial document"
  ],
  [
    "bank statement",
    "financial document"
  ],
  [
    "master bedrooms",
    "main bedrooms"
  ],
  [
    "master bedroom",
    "main bedroom"
  ],
  [
    "master bathrooms",
    "main bathrooms"
  ],
  [
    "master bathroom",
    "main bathroom"
  ],
  [
    "apparent age",
    "character styling"
  ],
  [
    "battle-worn",
    "weathered"
  ],
  [
    "battle-scarred",
    "weathered"
  ],
  [
    "broken dragged leg",
    "careful walking pose"
  ],
  [
    "broken leg",
    "careful walking pose"
  ],
  [
    "blood-soaked",
    "paint-stained"
  ],
  [
    "bloodstained",
    "paint-stained"
  ],
  [
    "freshly wounded",
    "visibly shaken"
  ],
  [
    "cutting remarks",
    "sharp remarks"
  ],
  [
    "cutting remark",
    "sharp remark"
  ],
  [
    "cloth-wrapped bare torso",
    "cloth-wrapped tunic"
  ],
  [
    "bare torso",
    "fitted tunic"
  ],
  [
    "bare chest",
    "fitted top"
  ],
  [
    "unclad animals",
    "natural-coat animals"
  ],
  [
    "no de-aging",
    "consistent adult character styling"
  ],
  [
    "de-aging",
    "character restyling"
  ],
  [
    "faces kneeling",
    "faces crouching"
  ],
  [
    "kneels smoothly",
    "crouches gently"
  ],
  [
    "medical shears opening her uniform",
    "medical kit beside her uniform"
  ],
  [
    "opening her uniform",
    "adjusting her uniform collar"
  ],
  [
    "opening his uniform",
    "adjusting his uniform collar"
  ],
  [
    "cut open at the front, revealing",
    "parted at the collar, showing"
  ],
  [
    "cut open at the front",
    "parted at the collar"
  ],
  [
    "across her upper chest",
    "near her collarbone"
  ],
  [
    "healed surgical scars",
    "faint healed marks"
  ],
  [
    "surgical scars",
    "faint healed marks"
  ],
  [
    "surgical scar",
    "faint healed mark"
  ],
  [
    "stainless-steel trauma shears",
    "compact medical tool"
  ],
  [
    "trauma shears",
    "medical tool"
  ],
  [
    "medical shears",
    "medical tool"
  ],
  [
    "dead grandmother",
    "late grandmother"
  ],
  [
    "dead grandfather",
    "late grandfather"
  ],
  [
    "dead mother",
    "late mother"
  ],
  [
    "dead father",
    "late father"
  ],
  [
    "dead husband",
    "late husband"
  ],
  [
    "dead wife",
    "late wife"
  ],
  [
    "dead son",
    "late son"
  ],
  [
    "dead daughter",
    "late daughter"
  ],
  [
    "graphic violence",
    "non-graphic dramatic action"
  ],
  [
    "graphic gore",
    "non-graphic dramatic action"
  ],
  [
    "thick black fluid dripping from mouths",
    "stylized dark visual effect around the mouths"
  ],
  [
    "blazing fireballs",
    "glowing energy effects"
  ],
  [
    "crimson explosion",
    "dramatic light burst"
  ],
  [
    "dead/decaying human",
    "weathered fictional figure"
  ],
  [
    "dead/decaying bodies",
    "weathered fictional figures"
  ],
  [
    "decaying bodies",
    "weathered fictional figures"
  ],
  [
    "decaying human",
    "weathered fictional figure"
  ],
  [
    "dead bodies",
    "fallen figures"
  ],
  [
    "dead human",
    "fallen fictional figure"
  ],
  [
    "rotting corpse",
    "weathered fictional figure"
  ],
  [
    "short dagger",
    "short fictional stage prop"
  ],
  [
    "dagger wound",
    "dramatic makeup detail"
  ],
  [
    "knife wound",
    "dramatic makeup detail"
  ],
  [
    "no wounds",
    "no graphic detail"
  ],
  [
    "no wound",
    "no graphic detail"
  ],
  [
    "dead body",
    "fallen figure"
  ],
  [
    "shooting a person",
    "filming a dramatic scene"
  ],
  [
    "shooting someone",
    "filming a dramatic scene"
  ],
  [
    "self-harm",
    "emotional distress with support"
  ],
  [
    "self harm",
    "emotional distress with support"
  ],
  [
    "mental breakdown",
    "emotional scene with support"
  ],
  [
    "drug use",
    "fictional medicine prop"
  ],
  [
    "drug abuse",
    "health education scene"
  ],
  [
    "khỏa thân hoàn toàn",
    "mặc trang phục kín đáo"
  ],
  [
    "khoả thân hoàn toàn",
    "mặc trang phục kín đáo"
  ],
  [
    "cảnh quan hệ tình dục",
    "cảnh ôm lãng mạn"
  ],
  [
    "cảnh tình dục",
    "cảnh lãng mạn"
  ],
  [
    "bạo lực đồ họa",
    "hành động kịch tính không máu me"
  ],
  [
    "đổ máu",
    "sơn màu đỏ"
  ],
  [
    "chém đầu",
    "động tác hành động không đồ họa"
  ],
  [
    "tự sát",
    "cảnh hỗ trợ sức khỏe tinh thần"
  ],
  [
    "tự hại",
    "cảnh nhân vật được hỗ trợ"
  ],
  [
    "lạm dụng ma túy",
    "cảnh giáo dục sức khỏe"
  ],
  [
    "fully nude",
    "fully clothed"
  ],
  [
    "fully naked",
    "fully clothed"
  ],
  [
    "non-consensual",
    "consensual"
  ],
  [
    "không mặc quần áo",
    "mặc trang phục kín đáo"
  ],
  [
    "không mặc gì",
    "mặc trang phục kín đáo"
  ],
  [
    "khỏa thân",
    "mặc trang phục kín đáo"
  ],
  [
    "khoả thân",
    "mặc trang phục kín đáo"
  ],
  [
    "máu me",
    "sơn màu đỏ"
  ],
  [
    "vết thương",
    "chi tiết trang điểm kịch tính"
  ],
  [
    "vết rách",
    "chi tiết trang điểm kịch tính"
  ],
  [
    "xác chết",
    "nhân vật ngã xuống"
  ],
  [
    "thây ma",
    "nhân vật hư cấu phong cách giả tưởng"
  ],
  [
    "xác sống",
    "nhân vật hư cấu phong cách giả tưởng"
  ],
  [
    "dao găm",
    "đạo cụ sân khấu"
  ],
  [
    "bắn súng",
    "biểu diễn hành động với đạo cụ sân khấu"
  ],
  [
    "khiêu dâm",
    "thời trang nghệ thuật"
  ],
  [
    "nội dung tình dục",
    "nội dung lãng mạn"
  ],
  [
    "chất cấm",
    "đạo cụ hư cấu"
  ],
  [
    "ma túy",
    "đạo cụ thuốc hư cấu"
  ],
  [
    "vũ khí",
    "đạo cụ hư cấu"
  ],
  [
    "không mặc đồ",
    "mặc trang phục kín đáo"
  ],
  [
    "giọng con gái (bé gái)",
    "giọng nữ hoạt hình tươi sáng"
  ],
  [
    "giọng của bé gái",
    "giọng nữ hoạt hình tươi sáng"
  ],
  [
    "giọng bé gái",
    "giọng nữ hoạt hình tươi sáng"
  ],
  [
    "giọng con gái",
    "giọng nữ"
  ],
  [
    "giọng của bé trai",
    "giọng nam hoạt hình tươi sáng"
  ],
  [
    "giọng bé trai",
    "giọng nam hoạt hình tươi sáng"
  ],
  [
    "giọng con trai",
    "giọng nam"
  ],
  [
    "dạy học cho trẻ lớp 1",
    "dạy học cơ bản dễ hiểu"
  ],
  [
    "dạy học cho trẻ em",
    "dạy học cơ bản dễ hiểu"
  ],
  [
    "dạy học cho trẻ nhỏ",
    "dạy học cơ bản dễ hiểu"
  ],
  [
    "dành cho trẻ lớp 1",
    "dành cho người mới bắt đầu"
  ],
  [
    "cho trẻ lớp 1",
    "cho người mới bắt đầu"
  ],
  [
    "cho trẻ mầm non",
    "cho người mới bắt đầu"
  ],
  [
    "cho trẻ mẫu giáo",
    "cho người mới bắt đầu"
  ],
  [
    "cho trẻ tiểu học",
    "cho người mới bắt đầu"
  ],
  [
    "cho trẻ em",
    "cho mọi lứa tuổi"
  ],
  [
    "cho trẻ nhỏ",
    "cho mọi lứa tuổi"
  ],
  [
    "trẻ vị thành niên",
    "nhân vật hư cấu"
  ],
  [
    "vị thành niên",
    "nhân vật hư cấu"
  ],
  [
    "trẻ sơ sinh",
    "nhân vật nhỏ nhắn"
  ],
  [
    "trẻ mầm non",
    "người học cơ bản"
  ],
  [
    "trẻ mẫu giáo",
    "người học cơ bản"
  ],
  [
    "trẻ tiểu học",
    "người học cơ bản"
  ],
  [
    "học sinh tiểu học",
    "người học cơ bản"
  ],
  [
    "trẻ lớp 1",
    "người học cơ bản"
  ],
  [
    "trẻ lớp 2",
    "người học cơ bản"
  ],
  [
    "trẻ lớp 3",
    "người học cơ bản"
  ],
  [
    "trẻ lớp 4",
    "người học cơ bản"
  ],
  [
    "trẻ lớp 5",
    "người học cơ bản"
  ],
  [
    "trẻ nhỏ",
    "các nhân vật"
  ],
  [
    "trẻ em",
    "các nhân vật"
  ],
  [
    "trẻ con",
    "các nhân vật"
  ],
  [
    "mấy đứa trẻ",
    "nhóm nhân vật"
  ],
  [
    "mấy đứa nhỏ",
    "nhóm nhân vật"
  ],
  [
    "mấy đứa con nít",
    "nhóm nhân vật"
  ],
  [
    "mấy đứa",
    "mấy bạn"
  ],
  [
    "tụi nhỏ",
    "nhóm bạn"
  ],
  [
    "sấp nhỏ",
    "nhóm bạn"
  ],
  [
    "bọn trẻ",
    "các nhân vật trẻ"
  ],
  [
    "lũ trẻ",
    "các nhân vật trẻ"
  ],
  [
    "đám trẻ",
    "các nhân vật trẻ"
  ],
  [
    "con nít",
    "nhân vật"
  ],
  [
    "thiếu nhi",
    "gia đình"
  ],
  [
    "nhi đồng",
    "gia đình"
  ],
  [
    "phòng bệnh nhi",
    "phòng bệnh viện"
  ],
  [
    "bệnh viện nhi",
    "bệnh viện đa khoa"
  ],
  [
    "khoa nhi",
    "khoa nội"
  ],
  [
    "bác sĩ nhi",
    "bác sĩ điều trị"
  ],
  [
    "bệnh nhi",
    "bệnh nhân"
  ],
  [
    "pediatric hospital room",
    "quiet hospital room"
  ],
  [
    "pediatric room",
    "hospital room"
  ],
  [
    "pediatric ward",
    "hospital ward"
  ],
  [
    "pediatrician",
    "attending physician"
  ],
  [
    "em bé",
    "nhân vật nhỏ nhắn"
  ],
  [
    "bé gái",
    "cô gái trẻ"
  ],
  [
    "bé trai",
    "chàng trai trẻ"
  ],
  [
    "người con gái",
    "cô gái trưởng thành"
  ],
  [
    "cô con gái",
    "cô gái trưởng thành"
  ],
  [
    "con gái lớn",
    "con trưởng thành"
  ],
  [
    "con gái của",
    "người con của"
  ],
  [
    "con trai của",
    "người con của"
  ],
  [
    "con gái",
    "nhân vật nữ"
  ],
  [
    "tỉ lệ cơ thể đáng yêu",
    "tỉ lệ tạo hình 3D đáng yêu"
  ],
  [
    "tỷ lệ cơ thể đáng yêu",
    "tỷ lệ tạo hình 3D đáng yêu"
  ],
  [
    "tỉ lệ cơ thể",
    "tỉ lệ tạo hình 3D"
  ],
  [
    "tỷ lệ cơ thể",
    "tỉ lệ tạo hình 3D"
  ],
  [
    "khẩu hình miệng",
    "khẩu hình"
  ],
  [
    "no children, teenagers, or minors anywhere",
    "only mature adults in frame"
  ],
  [
    "do not depict any children, teenagers, babies, or anyone under eighteen",
    "depict only mature adults"
  ],
  [
    "do not depict children, teenagers, babies, or anyone under eighteen",
    "depict only mature adults"
  ],
  [
    "do not depict any children, teenagers, or anyone under eighteen",
    "depict only mature adults"
  ],
  [
    "do not depict children or anyone under eighteen",
    "depict only mature adults"
  ],
  [
    "do not show any children, teenagers, babies, or anyone under eighteen",
    "show only mature adults"
  ],
  [
    "do not show children, teenagers, babies, or anyone under eighteen",
    "show only mature adults"
  ],
  [
    "do not show children or anyone under eighteen",
    "show only mature adults"
  ],
  [
    "do not include children, teenagers, babies, or anyone under eighteen",
    "include only mature adults"
  ],
  [
    "with no children, teenagers, babies, or anyone under eighteen",
    "with only mature adults"
  ],
  [
    "no children, teenagers, babies, or anyone under eighteen",
    "only mature adults"
  ],
  [
    "only mature adults or teenagers anywhere",
    "only mature adults anywhere"
  ],
  [
    "only mature adults or teens anywhere",
    "only mature adults anywhere"
  ],
  [
    "only mature adults or minors anywhere",
    "only mature adults anywhere"
  ],
  [
    "only mature adults or children anywhere",
    "only mature adults anywhere"
  ],
  [
    "only mature adults or young adults anywhere",
    "only mature adults anywhere"
  ],
  [
    "do not depict, mention, or imply any characters or young adults",
    "depict only mature adults"
  ],
  [
    "do not include red paint, non-graphic character detail, medical equipment, hospital imagery, fictional stage props, or physical dramatic action",
    "keep the scene calm and everyday"
  ],
  [
    "no children, teenagers, or minors",
    "only mature adults"
  ],
  [
    "no children or teenagers",
    "only mature adults"
  ],
  [
    "no children or minors",
    "only mature adults"
  ],
  [
    "anyone under eighteen",
    "only mature adults"
  ],
  [
    "anyone under 18",
    "only mature adults"
  ],
  [
    "anyone under the age of eighteen",
    "only mature adults"
  ],
  [
    "anyone under the age of 18",
    "only mature adults"
  ],
  [
    "any person under eighteen",
    "only mature adults"
  ],
  [
    "any person under 18",
    "only mature adults"
  ],
  [
    "person under the age of eighteen",
    "adult character"
  ],
  [
    "person under the age of 18",
    "adult character"
  ],
  [
    "person under eighteen",
    "adult character"
  ],
  [
    "person under 18",
    "adult character"
  ],
  [
    "people under eighteen",
    "adult characters"
  ],
  [
    "people under 18",
    "adult characters"
  ],
  [
    "students under eighteen",
    "adult students"
  ],
  [
    "students under 18",
    "adult students"
  ],
  [
    "anyone who could appear underage",
    "any young adult character"
  ],
  [
    "school-aged",
    "young-adult"
  ],
  [
    "school-age",
    "young-adult"
  ],
  [
    "school aged",
    "young-adult"
  ],
  [
    "school age",
    "young-adult"
  ],
  [
    "under-eighteen",
    "adult-only"
  ],
  [
    "under-18",
    "adult-only"
  ],
  [
    "youthful-looking person",
    "young adult character"
  ],
  [
    "young-looking person",
    "young adult character"
  ],
  [
    "juvenile-looking figures",
    "young adult figures"
  ],
  [
    "childlike figures",
    "young adult figures"
  ],
  [
    "youthful figures",
    "young adult figures"
  ],
  [
    "controlled humiliation",
    "quiet emotional tension"
  ],
  [
    "không có trẻ em, thiếu niên hay người dưới 18 tuổi",
    "chỉ gồm người trưởng thành"
  ],
  [
    "không có trẻ em hay người dưới 18 tuổi",
    "chỉ gồm người trưởng thành"
  ],
  [
    "không xuất hiện trẻ em hay người dưới 18 tuổi",
    "chỉ có người trưởng thành xuất hiện"
  ],
  [
    "không có trẻ em hoặc trẻ vị thành niên",
    "chỉ gồm người trưởng thành"
  ],
  [
    "không bao gồm trẻ em",
    "chỉ gồm người trưởng thành"
  ],
  [
    "không xuất hiện trẻ em",
    "chỉ có người trưởng thành"
  ],
  [
    "không vẽ trẻ em",
    "chỉ vẽ người trưởng thành"
  ],
  [
    "không có trẻ em",
    "chỉ có người trưởng thành"
  ],
  [
    "không có trẻ nhỏ",
    "chỉ có người trưởng thành"
  ],
  [
    "không có bé gái",
    "chỉ có người trưởng thành"
  ],
  [
    "không có bé trai",
    "chỉ có người trưởng thành"
  ],
  [
    "không có người dưới 18 tuổi",
    "chỉ có người trưởng thành"
  ],
  [
    "người dưới 18 tuổi",
    "người trưởng thành"
  ],
  [
    "trẻ dưới 18 tuổi",
    "người trưởng thành"
  ],
  [
    "dưới 18 tuổi",
    "độ tuổi trưởng thành"
  ],
  [
    "no children",
    "adults only"
  ],
  [
    "no teenagers",
    "adults only"
  ],
  [
    "no minors",
    "adults only"
  ],
  [
    "little girl's voice",
    "bright female animated voice"
  ],
  [
    "little boy's voice",
    "bright male animated voice"
  ],
  [
    "girl's voice",
    "bright female animated voice"
  ],
  [
    "boy's voice",
    "bright male animated voice"
  ],
  [
    "little girl",
    "young adult female character"
  ],
  [
    "little boy",
    "young adult male character"
  ],
  [
    "small girls",
    "young adult women"
  ],
  [
    "small girl",
    "young adult woman"
  ],
  [
    "small boys",
    "young adult men"
  ],
  [
    "small boy",
    "young adult man"
  ],
  [
    "small children",
    "young adult characters"
  ],
  [
    "small child",
    "young adult character"
  ],
  [
    "small kids",
    "young adult characters"
  ],
  [
    "small kid",
    "young adult character"
  ],
  [
    "young girl",
    "young adult woman"
  ],
  [
    "young boy",
    "young adult man"
  ],
  [
    "the boy",
    "the young adult character"
  ],
  [
    "the girl",
    "the young adult woman"
  ],
  [
    "schoolgirl",
    "college student"
  ],
  [
    "school girl",
    "college student"
  ],
  [
    "schoolboy",
    "college student"
  ],
  [
    "school boy",
    "college student"
  ],
  [
    "a minor",
    "a young adult"
  ],
  [
    "hoạt hình 3D Pixar/Disney",
    "hoạt hình 3D điện ảnh"
  ],
  [
    "hoạt hình 3D Disney/Pixar",
    "hoạt hình 3D điện ảnh"
  ],
  [
    "phong cách Pixar/Disney",
    "phong cách hoạt hình 3D điện ảnh"
  ],
  [
    "phong cách Disney/Pixar",
    "phong cách hoạt hình 3D điện ảnh"
  ],
  [
    "phong cách Pixar",
    "phong cách hoạt hình 3D điện ảnh"
  ],
  [
    "phong cách Disney",
    "phong cách hoạt hình 3D điện ảnh"
  ],
  [
    "phong cách DreamWorks",
    "phong cách hoạt hình 3D điện ảnh"
  ],
  [
    "phong cách Studio Ghibli",
    "phong cách anime vẽ tay"
  ],
  [
    "phong cách Ghibli",
    "phong cách anime vẽ tay"
  ],
  [
    "3D Pixar/Disney",
    "3D điện ảnh"
  ],
  [
    "3D Disney/Pixar",
    "3D điện ảnh"
  ],
  [
    "Pixar/Disney",
    "cinematic 3D animation"
  ],
  [
    "Disney/Pixar",
    "cinematic 3D animation"
  ],
  [
    "Pixar style",
    "cinematic 3D animation style"
  ],
  [
    "Disney style",
    "cinematic 3D animation style"
  ],
  [
    "DreamWorks style",
    "stylized 3D animation style"
  ],
  [
    "Studio Ghibli style",
    "hand-painted anime style"
  ],
  [
    "Studio Ghibli",
    "hand-painted anime"
  ],
  [
    "Ghibli style",
    "hand-painted anime style"
  ],
  [
    "DC Comics",
    "comic-book superhero"
  ],
  [
    "Mickey Mouse",
    "classic cartoon mouse"
  ],
  [
    "Spider-Man",
    "masked acrobatic hero"
  ],
  [
    "Iron Man",
    "armored sci-fi hero"
  ],
  [
    "Harry Potter",
    "young wizard"
  ],
  [
    "Hello Kitty",
    "cute cartoon cat"
  ],
  [
    "One Piece",
    "classic adventure anime"
  ],
  [
    "Dragon Ball",
    "classic action anime"
  ],
  [
    "protective underwear package",
    "plain pharmacy box"
  ],
  [
    "half-stripped of shirt",
    "wearing a casual unbuttoned jacket"
  ],
  [
    "half stripped of shirt",
    "wearing a casual unbuttoned jacket"
  ],
  [
    "half-stripped",
    "wearing a casual layered outfit"
  ],
  [
    "half stripped",
    "wearing a casual layered outfit"
  ],
  [
    "stripped of shirt",
    "wearing a casual shirt"
  ],
  [
    "take shirt off",
    "adjusting casual jacket"
  ],
  [
    "off shirt",
    "casual outfit"
  ],
  [
    "open shirt",
    "layered casual shirt"
  ],
  [
    "wet body",
    "rain-lit silhouette"
  ],
  [
    "kisses with his tongue",
    "smiles warmly"
  ],
  [
    "kiss with his tongue",
    "warm affectionate look"
  ],
  [
    "sticks out his tongue",
    "smiles playfully"
  ],
  [
    "sticking out his tongue",
    "smiling playfully"
  ],
  [
    "kiss tongue",
    "warm embrace"
  ],
  [
    "kiss his lips softly",
    "warm affectionate moment"
  ],
  [
    "kiss his lips",
    "warm affectionate moment"
  ],
  [
    "kiss her lips",
    "warm affectionate moment"
  ],
  [
    "kiss on the lips",
    "warm affectionate moment"
  ],
  [
    "french kiss",
    "warm embrace"
  ],
  [
    "lovely kissing",
    "warm embrace"
  ],
  [
    "passionate kissing",
    "warm embrace"
  ],
  [
    "deep kiss",
    "warm embrace"
  ],
  [
    "son on top of dad",
    "son standing beside dad"
  ],
  [
    "on top of dad",
    "standing beside dad"
  ],
  [
    "keep this exact face",
    "keep this consistent character face"
  ],
  [
    "keep the exact face",
    "keep the consistent character face"
  ],
  [
    "exactly her face",
    "consistent character face for her"
  ],
  [
    "exactly his face",
    "consistent character face for him"
  ],
  [
    "exact face",
    "consistent character face"
  ],
  [
    "exact facial",
    "consistent character facial"
  ],
  [
    "copy the person",
    "copy the subject styling"
  ],
  [
    "body proportions",
    "character proportions"
  ],
  [
    "facial scar",
    "subtle facial mark"
  ],
  [
    "scar across",
    "weathered mark across"
  ],
  [
    "product swap",
    "product replacement"
  ],
  [
    "face swap",
    "character styling edit"
  ],
  [
    "head swap",
    "character styling edit"
  ],
  [
    "clothes swap",
    "outfit change"
  ],
  [
    "outfit swap",
    "outfit change"
  ],
  [
    "3D deformation",
    "3D contoured shape"
  ],
  [
    "unnatural body deformation",
    "unnatural body warping"
  ],
  [
    "no body deformation",
    "no body warping"
  ],
  [
    "without body deformation",
    "without body warping"
  ],
  [
    "body deformation",
    "body warping"
  ],
  [
    "facial deformation",
    "facial warping"
  ],
  [
    "hand deformation",
    "hand warping"
  ],
  [
    "mesh deformation",
    "mesh warping"
  ],
  [
    "no deformation",
    "no warping"
  ],
  [
    "without deformation",
    "without warping"
  ],
  [
    "cup-hugging",
    "cup-cradling"
  ],
  [
    "mug-hugging",
    "mug-cradling"
  ],
  [
    "hugging the lower mug sides",
    "resting against the lower mug sides"
  ],
  [
    "hugged by",
    "cradled by"
  ],
  [
    "pressed flush against",
    "resting gently against"
  ],
  [
    "presses firmly down",
    "rests firmly"
  ],
  [
    "sideways-bulging",
    "sideways-prominent"
  ],
  [
    "bulging",
    "prominent"
  ],
  [
    "rooster",
    "farm-bird"
  ],
  [
    "wattles",
    "red chin tabs"
  ],
  [
    "no one is touching or striking anyone",
    "everyone stands calmly apart"
  ],
  [
    "touching or striking anyone",
    "standing near anyone"
  ],
  [
    "touching or striking",
    "approaching"
  ],
  [
    "no one is hurt",
    "everyone is safe and calm"
  ],
  [
    "do not include blood, injury, medical equipment, hospital imagery, weapons, or physical violence",
    "keep the scene calm and everyday"
  ],
  [
    "bound and gagged",
    "restrained in silence"
  ],
  [
    "taped and bound",
    "restrained in silence"
  ],
  [
    "gagged with black tape",
    "silenced with dark fabric"
  ],
  [
    "gagged with tape",
    "silenced with dark fabric"
  ],
  [
    "pins her wrists behind her back",
    "holds her hands behind her back"
  ],
  [
    "pins his wrists behind his back",
    "holds his hands behind his back"
  ],
  [
    "binds them with a white cloth",
    "wraps them with a white cloth"
  ],
  [
    "wrists bound behind her back",
    "hands held behind her"
  ],
  [
    "wrists bound behind her",
    "hands held behind her"
  ],
  [
    "wrists bound behind him",
    "hands held behind him"
  ],
  [
    "black tape over her mouth",
    "dark scarf covering her mouth"
  ],
  [
    "strip of dark tape across her mouth",
    "dark scarf across her mouth"
  ],
  [
    "tape across her mouth",
    "scarf across her mouth"
  ],
  [
    "taped mouth",
    "closed mouth"
  ],
  [
    "mouth taped",
    "mouth closed"
  ],
  [
    "shoved onto her rumpled bed",
    "falls back onto her rumpled bed"
  ],
  [
    "struggling against the binding",
    "reacting tensely in the dramatic scene"
  ],
  [
    "cake wreckage",
    "toppled cake pieces"
  ],
  [
    "mug-pressing",
    "mug-resting"
  ],
  [
    "mug bottom",
    "mug base"
  ],
  [
    "baby-pink",
    "soft pastel pink"
  ],
  [
    "baby pink",
    "soft pastel pink"
  ],
  [
    "baby-blue",
    "soft pastel blue"
  ],
  [
    "baby blue",
    "soft pastel blue"
  ],
  [
    "completely free of pants or skirt",
    "wearing a casual oversized shirt and tailored shorts"
  ],
  [
    "free of pants or skirt",
    "wearing tailored casual shorts"
  ],
  [
    "without pants",
    "wearing tailored casual shorts"
  ],
  [
    "no pants",
    "wearing tailored casual shorts"
  ],
  [
    "no underwear",
    "fully dressed in casual attire"
  ],
  [
    "subtle translucency",
    "soft breathable cotton texture"
  ],
  [
    "see-through",
    "textured woven"
  ],
  [
    "see through",
    "textured woven"
  ],
  [
    "sheer fabric",
    "lightweight opaque fabric"
  ],
  [
    "sheer dress",
    "lightweight opaque dress"
  ],
  [
    "sheer shirt",
    "lightweight opaque shirt"
  ],
  [
    "sheer blouse",
    "lightweight opaque blouse"
  ],
  [
    "sheer top",
    "lightweight opaque top"
  ],
  [
    "sheer skirt",
    "lightweight opaque skirt"
  ],
  [
    "sheer lace",
    "textured lace"
  ],
  [
    "unbuttoned collar",
    "relaxed open-collar neckline"
  ],
  [
    "the open chore-jacket collar and the henley neckline are visible",
    "the layered denim jacket collar and the buttoned henley shirt are clearly shown"
  ],
  [
    "open chore-jacket collar",
    "layered denim jacket collar"
  ],
  [
    "chore-jacket collar",
    "denim jacket collar"
  ],
  [
    "chore-jacket",
    "work jacket"
  ],
  [
    "henley neckline",
    "buttoned henley shirt"
  ],
  [
    "with no nudity",
    "fully clothed"
  ],
  [
    "no nudity",
    "fully clothed"
  ],
  [
    "no blood or gore",
    "clean non-graphic styling"
  ],
  [
    "no gore or blood",
    "clean non-graphic styling"
  ],
  [
    "without blood",
    "clean non-graphic styling"
  ],
  [
    "no blood",
    "clean non-graphic styling"
  ],
  [
    "no gore",
    "clean non-graphic styling"
  ],
  [
    "no violence",
    "calm non-graphic tone"
  ],
  [
    "without violence",
    "calm non-graphic tone"
  ],
  [
    "without weapons",
    "unarmed empty hands"
  ],
  [
    "no weapons",
    "unarmed empty hands"
  ],
  [
    "no guns",
    "unarmed empty hands"
  ],
  [
    "no gun",
    "unarmed empty hands"
  ],
  [
    "no knives",
    "unarmed empty hands"
  ],
  [
    "no knife",
    "unarmed empty hands"
  ],
  [
    "no shirtless men",
    "all men wearing modest tops"
  ],
  [
    "no shirtless people",
    "everyone wearing modest tops"
  ],
  [
    "no shirtless",
    "wearing modest tops"
  ],
  [
    "without a bra",
    "wearing a modest layered top"
  ],
  [
    "without bra",
    "wearing a modest layered top"
  ],
  [
    "no bra",
    "wearing a modest layered top"
  ],
  [
    "no bikinis",
    "modest everyday attire"
  ],
  [
    "no bikini",
    "modest everyday attire"
  ],
  [
    "no lingerie",
    "modest everyday attire"
  ],
  [
    "after stripping",
    "after changing outfits"
  ],
  [
    "stripping off",
    "changing out of"
  ],
  [
    "strip off",
    "change out of"
  ],
  [
    "lets the black nightie fall",
    "changes into loungewear"
  ],
  [
    "slip nightie, no robe",
    "modest satin lounge dress, fully covered"
  ],
  [
    "nightie, no robe",
    "modest satin lounge dress, fully covered"
  ],
  [
    "slip nightie",
    "satin lounge dress"
  ],
  [
    "nighties",
    "lounge dresses"
  ],
  [
    "nightie",
    "lounge dress"
  ],
  [
    "no robe",
    "modest lounge style"
  ],
  [
    "without a robe",
    "modest lounge style"
  ],
  [
    "after her shower",
    "in the evening"
  ],
  [
    "after his shower",
    "in the evening"
  ],
  [
    "after a shower",
    "in the evening"
  ],
  [
    "after the shower",
    "in the evening"
  ],
  [
    "near-kiss",
    "close tender moment"
  ],
  [
    "near kiss",
    "close tender moment"
  ],
  [
    "after the wedding gown falls away",
    "worn after changing out of the wedding gown"
  ],
  [
    "after the gown is unlaced and dropped",
    "after she has changed out of the wedding gown"
  ],
  [
    "gown is unlaced and dropped",
    "she has changed out of the gown"
  ],
  [
    "wedding gown falls away",
    "changed out of the wedding gown"
  ],
  [
    "carried to and lying on the grey leather sofa",
    "resting on the grey leather sofa"
  ],
  [
    "wearing the wedding gown the maid dressed her in",
    "wearing the wedding gown prepared for her"
  ],
  [
    "the maid dressed her in",
    "prepared for her"
  ],
  [
    "slip underdress",
    "slip dress"
  ],
  [
    "underdress",
    "slip dress"
  ],
  [
    "one strap slightly slipped",
    "slim straps neatly in place"
  ],
  [
    "strap slightly slipped",
    "strap neatly in place"
  ],
  [
    "bare shoulders and arms",
    "classic tailored neckline and sleeves"
  ],
  [
    "bare shoulders",
    "classic tailored shoulders"
  ],
  [
    "draped off-the-shoulder satin band",
    "draped satin band"
  ],
  [
    "draped off-shoulder band",
    "draped satin band"
  ],
  [
    "off-the-shoulder",
    "draped-shoulder"
  ],
  [
    "off-shoulder",
    "draped-shoulder"
  ],
  [
    "the hem falling mid-thigh",
    "modest knee-length hemline"
  ],
  [
    "mid-thigh",
    "knee-length"
  ],
  [
    "lips slightly parted",
    "a gentle closed-lip half-smile"
  ],
  [
    "barely visible small pregnancy bump",
    "subtle early-pregnancy silhouette at the waist"
  ],
  [
    "beautifully proportioned thighs",
    "relaxed standing posture"
  ],
  [
    "bare thighs",
    "relaxed standing posture"
  ],
  [
    "bare legs",
    "casual standing posture"
  ],
  [
    "low-rise",
    "relaxed-fit"
  ],
  [
    "sports bra",
    "fitted athletic top"
  ],
  [
    "g-string",
    "casual loungewear"
  ],
  [
    "quần lót",
    "quần short thường ngày"
  ],
  [
    "quần chíp",
    "quần short thường ngày"
  ],
  [
    "áo ngực",
    "áo thun ôm gọn"
  ],
  [
    "áo lót",
    "áo thun kín đáo"
  ],
  [
    "nội y ren",
    "trang phục thời trang thanh lịch"
  ],
  [
    "xuyên thấu",
    "chất liệu vải dày dặn"
  ],
  [
    "mỏng tang",
    "chất liệu vải mềm mại"
  ],
  [
    "không mặc quần",
    "mặc trang phục kín đáo"
  ],
  [
    "không mặc váy",
    "mặc quần trang phục kín đáo"
  ],
  [
    "hở hang",
    "trang phục thanh lịch"
  ],
  [
    "khe ngực",
    "cổ áo kín đáo"
  ],
  [
    "đùi trần",
    "dáng đứng tự nhiên"
  ],
  [
    "cô bé",
    "cô gái trẻ"
  ],
  [
    "cậu bé",
    "chàng trai trẻ"
  ],
  [
    "thằng bé",
    "chàng trai trẻ"
  ],
  [
    "con bé",
    "cô gái trẻ"
  ],
  [
    "nữ sinh",
    "sinh viên nữ"
  ],
  [
    "nam sinh",
    "sinh viên nam"
  ],
  [
    "học sinh cấp 1",
    "người học cơ bản"
  ],
  [
    "học sinh cấp 2",
    "người học phổ thông"
  ],
  [
    "học sinh cấp 3",
    "sinh viên trẻ"
  ],
  [
    "miệng đầy nước bọt",
    "biểu cảm kịch tính"
  ],
  [
    "nước bọt",
    "hiệu ứng ánh sáng"
  ],
  [
    "cởi chuồng",
    "mặc trang phục kín đáo"
  ],
  [
    "cởi truồng",
    "mặc trang phục kín đáo"
  ],
  [
    "ở truồng",
    "mặc trang phục kín đáo"
  ],
  [
    "trần như nhộng",
    "mặc trang phục kín đáo"
  ],
  [
    "bóp dú",
    "tạo dáng thời trang"
  ],
  [
    "bóp vú",
    "tạo dáng thời trang"
  ],
  [
    "bóp ngực",
    "tạo dáng thời trang"
  ],
  [
    "sờ ngực",
    "tạo dáng thời trang"
  ],
  [
    "sờ mông",
    "tạo dáng thời trang"
  ],
  [
    "vỗ mông",
    "tạo dáng thời trang"
  ],
  [
    "khoe ngực",
    "trang phục thanh lịch"
  ],
  [
    "khoe mông",
    "trang phục thanh lịch"
  ],
  [
    "lộ ngực",
    "trang phục kín đáo"
  ],
  [
    "lộ mông",
    "trang phục kín đáo"
  ],
  [
    "lộ hàng",
    "trang phục kín đáo"
  ],
  [
    "khoe thân",
    "trang phục thanh lịch"
  ],
  [
    "ngực trần",
    "trang phục kín đáo"
  ],
  [
    "gợi dục",
    "phong cách nghệ thuật thanh lịch"
  ],
  [
    "dâm dục",
    "phong cách nghệ thuật thanh lịch"
  ],
  [
    "kích dục",
    "phong cách nghệ thuật thanh lịch"
  ],
  [
    "khiêu gợi",
    "phong cách nghệ thuật thanh lịch"
  ],
  [
    "dâm đãng",
    "phong cách nghệ thuật thanh lịch"
  ],
  [
    "cởi áo",
    "chỉnh trang phục"
  ],
  [
    "cởi trần",
    "mặc áo thun gọn gàng"
  ],
  [
    "đồ lót",
    "trang phục thường ngày"
  ],
  [
    "nội y",
    "trang phục thời trang"
  ],
  [
    "hôn lưỡi",
    "khoảnh khắc tình cảm ấm áp"
  ],
  [
    "hôn sâu",
    "khoảnh khắc tình cảm ấm áp"
  ]
];

export const DEFAULT_WORD_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "pornographic",
    "fashion editorial"
  ],
  [
    "porn",
    "fashion editorial"
  ],
  [
    "pornography",
    "fashion editorial"
  ],
  [
    "explicit",
    "editorial"
  ],
  [
    "erotic",
    "romantic editorial"
  ],
  [
    "sexualized",
    "elegant editorial"
  ],
  [
    "sexualised",
    "elegant editorial"
  ],
  [
    "sexualisation",
    "elegant editorial"
  ],
  [
    "sexualization",
    "elegant editorial"
  ],
  [
    "sexually",
    "romantic editorial"
  ],
  [
    "sexual",
    "romantic"
  ],
  [
    "deepfake",
    "fictional character edit"
  ],
  [
    "biometric",
    "fictional character design"
  ],
  [
    "celebrities",
    "fictional stars"
  ],
  [
    "celebrity",
    "fictional star"
  ],
  [
    "likeness",
    "fictional appearance"
  ],
  [
    "identities",
    "character designs"
  ],
  [
    "identity",
    "character design"
  ],
  [
    "nationality",
    "visual profile"
  ],
  [
    "ethnicity",
    "visual design"
  ],
  [
    "origin",
    "visual design"
  ],
  [
    "person's",
    "character's"
  ],
  [
    "people",
    "characters"
  ],
  [
    "age",
    "character styling"
  ],
  [
    "seductive",
    "elegant"
  ],
  [
    "fetish",
    "fashion editorial"
  ],
  [
    "stripper",
    "dancer"
  ],
  [
    "nude",
    "fully clothed"
  ],
  [
    "nudes",
    "fully clothed portraits"
  ],
  [
    "nudity",
    "fully clothed editorial"
  ],
  [
    "naked",
    "fully clothed"
  ],
  [
    "topless",
    "fully clothed"
  ],
  [
    "unclad",
    "fully clothed"
  ],
  [
    "kneeling",
    "crouching"
  ],
  [
    "kneels",
    "crouches"
  ],
  [
    "kneel",
    "crouch"
  ],
  [
    "nsfw",
    "safe-for-work"
  ],
  [
    "lingerie",
    "fashion outfit"
  ],
  [
    "gory",
    "non-graphic dramatic"
  ],
  [
    "gore",
    "dramatic red paint"
  ],
  [
    "bloodshed",
    "non-graphic dramatic action"
  ],
  [
    "blood",
    "red paint"
  ],
  [
    "bloodied",
    "paint-stained"
  ],
  [
    "bloody",
    "crimson-stained"
  ],
  [
    "bleeding",
    "dramatic red paint detail"
  ],
  [
    "lacerations",
    "dramatic makeup details"
  ],
  [
    "laceration",
    "dramatic makeup detail"
  ],
  [
    "wounds",
    "non-graphic character details"
  ],
  [
    "wound",
    "non-graphic character detail"
  ],
  [
    "wounded",
    "weathered"
  ],
  [
    "injuries",
    "non-graphic character details"
  ],
  [
    "injury",
    "non-graphic character detail"
  ],
  [
    "mutilated",
    "weathered fictional"
  ],
  [
    "mutilation",
    "non-graphic character detail"
  ],
  [
    "dismembered",
    "non-graphic dramatic"
  ],
  [
    "gouged",
    "scuffed"
  ],
  [
    "gouges",
    "scuff marks"
  ],
  [
    "gouge",
    "scuff mark"
  ],
  [
    "wreckage",
    "scattered pieces"
  ],
  [
    "hurt",
    "upset"
  ],
  [
    "gagged",
    "silenced"
  ],
  [
    "carnage",
    "dramatic aftermath"
  ],
  [
    "massacre",
    "dramatic confrontation"
  ],
  [
    "corpse",
    "fallen figure"
  ],
  [
    "cadaver",
    "fallen fictional figure"
  ],
  [
    "decaying",
    "weathered fictional"
  ],
  [
    "decomposed",
    "weathered fictional"
  ],
  [
    "decomposition",
    "weathered fictional detail"
  ],
  [
    "rotting",
    "weathered fictional"
  ],
  [
    "zombies",
    "fantasy characters"
  ],
  [
    "zombie",
    "fantasy character"
  ],
  [
    "undead",
    "fantasy characters"
  ],
  [
    "murder",
    "dramatic confrontation"
  ],
  [
    "murdered",
    "fallen in a dramatic scene"
  ],
  [
    "killing",
    "dramatic confrontation"
  ],
  [
    "killed",
    "defeated"
  ],
  [
    "kill",
    "defeat"
  ],
  [
    "violence",
    "dramatic action"
  ],
  [
    "violent",
    "intense"
  ],
  [
    "brutal",
    "grueling"
  ],
  [
    "cruelty",
    "harshness"
  ],
  [
    "decapitation",
    "non-graphic dramatic action"
  ],
  [
    "dismemberment",
    "non-graphic dramatic action"
  ],
  [
    "torture",
    "dramatic confrontation"
  ],
  [
    "assault",
    "dramatic confrontation"
  ],
  [
    "stabbing",
    "dynamic choreography"
  ],
  [
    "stab",
    "dynamic choreography"
  ],
  [
    "suicide",
    "mental health support scene"
  ],
  [
    "self-harm",
    "emotional distress with support"
  ],
  [
    "selfharm",
    "emotional distress with support"
  ],
  [
    "self-injury",
    "emotional distress with support"
  ],
  [
    "self injury",
    "emotional distress with support"
  ],
  [
    "suicidal thoughts",
    "mental health support scene"
  ],
  [
    "suicide attempt",
    "mental health support scene"
  ],
  [
    "suicidal",
    "mental health support"
  ],
  [
    "overdose",
    "health support scene"
  ],
  [
    "firearm",
    "fictional stage prop"
  ],
  [
    "firearms",
    "fictional stage props"
  ],
  [
    "rifle",
    "fictional stage prop"
  ],
  [
    "rifles",
    "fictional stage props"
  ],
  [
    "pistol",
    "fictional stage prop"
  ],
  [
    "pistols",
    "fictional stage props"
  ],
  [
    "weapon",
    "fictional stage prop"
  ],
  [
    "weapons",
    "fictional stage props"
  ],
  [
    "sword",
    "fantasy stage prop"
  ],
  [
    "swords",
    "fantasy stage props"
  ],
  [
    "swordsmen",
    "martial artists"
  ],
  [
    "swordsman",
    "martial artist"
  ],
  [
    "blades",
    "stage props"
  ],
  [
    "blade",
    "stage prop"
  ],
  [
    "cleavers",
    "heavy stage props"
  ],
  [
    "cleaver",
    "heavy stage prop"
  ],
  [
    "butcher",
    "heavy warrior"
  ],
  [
    "knife",
    "stage prop"
  ],
  [
    "knives",
    "stage props"
  ],
  [
    "daggers",
    "fictional stage props"
  ],
  [
    "dagger",
    "fictional stage prop"
  ],
  [
    "machetes",
    "fictional stage props"
  ],
  [
    "machete",
    "fictional stage prop"
  ],
  [
    "crossbows",
    "fictional stage props"
  ],
  [
    "crossbow",
    "fictional stage prop"
  ],
  [
    "spears",
    "fantasy stage props"
  ],
  [
    "spear",
    "fantasy stage prop"
  ],
  [
    "axes",
    "fictional stage props"
  ],
  [
    "axe",
    "fictional stage prop"
  ],
  [
    "katana",
    "fantasy stage prop"
  ],
  [
    "missiles",
    "special-effects props"
  ],
  [
    "missile",
    "special-effects prop"
  ],
  [
    "cannons",
    "special-effects props"
  ],
  [
    "cannon",
    "special-effects prop"
  ],
  [
    "gun",
    "fictional stage prop"
  ],
  [
    "guns",
    "fictional stage props"
  ],
  [
    "bomb",
    "special-effects prop"
  ],
  [
    "bombs",
    "special-effects props"
  ],
  [
    "explosive",
    "special-effects prop"
  ],
  [
    "explosives",
    "special-effects props"
  ],
  [
    "explosions",
    "dramatic light bursts"
  ],
  [
    "explosion",
    "dramatic light burst"
  ],
  [
    "fireballs",
    "glowing energy effects"
  ],
  [
    "fireball",
    "glowing energy effect"
  ],
  [
    "blasting",
    "dramatic motion"
  ],
  [
    "blazing",
    "brightly lit"
  ],
  [
    "grenade",
    "fictional stage prop"
  ],
  [
    "grenades",
    "fictional stage props"
  ],
  [
    "ammunition",
    "stage prop accessories"
  ],
  [
    "bullet",
    "non-graphic action effect"
  ],
  [
    "bullets",
    "non-graphic action effects"
  ],
  [
    "cocaine",
    "fictional powder prop"
  ],
  [
    "heroin",
    "fictional medicine prop"
  ],
  [
    "methamphetamine",
    "fictional medicine prop"
  ],
  [
    "fentanyl",
    "fictional medicine prop"
  ],
  [
    "marijuana",
    "fictional herbal product"
  ],
  [
    "cannabis",
    "fictional herbal product"
  ],
  [
    "crack cocaine",
    "fictional powder prop"
  ],
  [
    "ecstasy",
    "fictional medicine prop"
  ],
  [
    "mdma",
    "fictional medicine prop"
  ],
  [
    "lsd",
    "fictional medicine prop"
  ],
  [
    "opium",
    "fictional medicine prop"
  ],
  [
    "morphine",
    "fictional medicine prop"
  ],
  [
    "drugs",
    "fictional medicine props"
  ],
  [
    "drug",
    "fictional medicine prop"
  ],
  [
    "bạo lực",
    "hành động kịch tính"
  ],
  [
    "máu",
    "sơn màu đỏ"
  ],
  [
    "khỏa thân",
    "mặc trang phục kín đáo"
  ],
  [
    "khoả thân",
    "mặc trang phục kín đáo"
  ],
  [
    "trần truồng",
    "mặc trang phục kín đáo"
  ],
  [
    "tình dục",
    "lãng mạn"
  ],
  [
    "tình dục hóa",
    "phong cách biên tập thanh lịch"
  ],
  [
    "khiêu dâm",
    "thời trang nghệ thuật"
  ],
  [
    "tự sát",
    "hỗ trợ sức khỏe tinh thần"
  ],
  [
    "tự hại",
    "nhân vật được hỗ trợ"
  ],
  [
    "ma túy",
    "đạo cụ thuốc hư cấu"
  ],
  [
    "súng",
    "đạo cụ sân khấu"
  ],
  [
    "dao găm",
    "đạo cụ sân khấu"
  ],
  [
    "vết thương",
    "chi tiết trang điểm kịch tính"
  ],
  [
    "vết rách",
    "chi tiết trang điểm kịch tính"
  ],
  [
    "xác chết",
    "nhân vật ngã xuống"
  ],
  [
    "thây ma",
    "nhân vật hư cấu phong cách giả tưởng"
  ],
  [
    "xác sống",
    "nhân vật hư cấu phong cách giả tưởng"
  ],
  [
    "fighting",
    "dynamic choreography"
  ],
  [
    "fight",
    "dynamic choreography"
  ],
  [
    "giết",
    "đối đầu"
  ],
  [
    "pixar",
    "cinematic 3D animation"
  ],
  [
    "disney",
    "classic animated film"
  ],
  [
    "dreamworks",
    "stylized 3D animation"
  ],
  [
    "ghibli",
    "hand-painted anime"
  ],
  [
    "marvel",
    "comic-book superhero"
  ],
  [
    "spiderman",
    "masked acrobatic hero"
  ],
  [
    "batman",
    "caped detective hero"
  ],
  [
    "superman",
    "caped flying hero"
  ],
  [
    "pokemon",
    "fantasy creature"
  ],
  [
    "pokémon",
    "fantasy creature"
  ],
  [
    "pikachu",
    "electric yellow creature"
  ],
  [
    "barbie",
    "fashion doll"
  ],
  [
    "naruto",
    "anime character"
  ],
  [
    "doraemon",
    "robotic cartoon cat"
  ],
  [
    "children",
    "characters"
  ],
  [
    "child",
    "character"
  ],
  [
    "kids",
    "characters"
  ],
  [
    "kid",
    "character"
  ],
  [
    "toddlers",
    "small characters"
  ],
  [
    "toddler",
    "small character"
  ],
  [
    "infants",
    "small characters"
  ],
  [
    "infant",
    "small character"
  ],
  [
    "babies",
    "small characters"
  ],
  [
    "newborns",
    "small characters"
  ],
  [
    "newborn",
    "small character"
  ],
  [
    "adolescents",
    "young adults"
  ],
  [
    "adolescent",
    "young adult"
  ],
  [
    "juveniles",
    "young adults"
  ],
  [
    "juvenile",
    "youthful"
  ],
  [
    "childlike",
    "playful"
  ],
  [
    "pediatrics",
    "medical care"
  ],
  [
    "pediatric",
    "medical"
  ],
  [
    "paediatric",
    "medical"
  ],
  [
    "teenagers",
    "young adults"
  ],
  [
    "teenager",
    "young adult"
  ],
  [
    "teenage",
    "young adult"
  ],
  [
    "teens",
    "young adults"
  ],
  [
    "teen",
    "young adult"
  ],
  [
    "minors",
    "young adults"
  ],
  [
    "underage",
    "young adult"
  ],
  [
    "preteen",
    "young character"
  ],
  [
    "schoolkids",
    "students"
  ],
  [
    "schoolkid",
    "student"
  ],
  [
    "underwear",
    "casual loungewear"
  ],
  [
    "panties",
    "casual lounge shorts"
  ],
  [
    "panty",
    "casual lounge shorts"
  ],
  [
    "thong",
    "casual loungewear"
  ],
  [
    "bralette",
    "fitted athletic top"
  ],
  [
    "bras",
    "fitted tops"
  ],
  [
    "bra",
    "fitted top"
  ],
  [
    "bikinis",
    "two-piece summer beachwear"
  ],
  [
    "bikini",
    "two-piece summer beachwear"
  ],
  [
    "cleavage",
    "modest neckline"
  ],
  [
    "nipples",
    "covered fabric detail"
  ],
  [
    "nipple",
    "covered fabric detail"
  ],
  [
    "areola",
    "covered fabric detail"
  ],
  [
    "breasts",
    "upper torso"
  ],
  [
    "buttocks",
    "lower silhouette"
  ],
  [
    "buttock",
    "lower silhouette"
  ],
  [
    "genitals",
    "covered figure"
  ],
  [
    "genitalia",
    "covered figure"
  ],
  [
    "pantless",
    "wearing casual shorts"
  ],
  [
    "bottomless",
    "fully clothed"
  ],
  [
    "intimate",
    "warm personal"
  ],
  [
    "thighs",
    "lower silhouette"
  ],
  [
    "briefs",
    "casual shorts"
  ],
  [
    "shirtless",
    "wearing a fitted casual top"
  ],
  [
    "scarred",
    "weathered"
  ],
  [
    "scars",
    "weathered marks"
  ],
  [
    "scar",
    "weathered mark"
  ],
  [
    "deformation",
    "contoured shape"
  ],
  [
    "deformity",
    "irregular shape"
  ],
  [
    "deformed",
    "irregularly shaped"
  ],
  [
    "swap",
    "replacement"
  ],
  [
    "dú",
    "trang phục kín đáo"
  ],
  [
    "vú",
    "trang phục kín đáo"
  ]
];

export const DEFAULT_NO_BOUNDARY_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    "กระบี่ไม้",
    "อุปกรณ์ประกอบฉากไม้"
  ],
  [
    "กระบี่",
    "อุปกรณ์ประกอบฉาก"
  ],
  [
    "ดาบไม้",
    "อุปกรณ์ประกอบฉากไม้"
  ],
  [
    "ถือดาบ",
    "ถืออุปกรณ์ประกอบฉาก"
  ],
  [
    "ชักดาบ",
    "หยิบอุปกรณ์ประกอบฉาก"
  ],
  [
    "คมดาบ",
    "อุปกรณ์ประกอบฉาก"
  ],
  [
    "มีดสั้น",
    "อุปกรณ์ประกอบฉาก"
  ],
  [
    "มีดพก",
    "อุปกรณ์ประกอบฉาก"
  ],
  [
    "ถือมีด",
    "ถืออุปกรณ์ประกอบฉาก"
  ],
  [
    "คมมีด",
    "อุปกรณ์ประกอบฉาก"
  ],
  [
    "ปืนพก",
    "อุปกรณ์ประกอบฉาก"
  ],
  [
    "ปืนใหญ่",
    "อุปกรณ์ประกอบฉาก"
  ],
  [
    "ยิงปืน",
    "ท่าทางแอ็กชัน"
  ],
  [
    "ปืน",
    "อุปกรณ์ประกอบฉาก"
  ],
  [
    "อาวุธ",
    "อุปกรณ์ประกอบฉาก"
  ],
  [
    "ระเบิด",
    "เอฟเฟกต์แสง"
  ],
  [
    "รอยแผลเป็น",
    "รอยตำหนิจางๆ"
  ],
  [
    "แผลเป็น",
    "รอยตำหนิจางๆ"
  ],
  [
    "บาดแผล",
    "รายละเอียดการแต่งหน้า"
  ],
  [
    "รอยแผล",
    "รายละเอียดการแต่งหน้า"
  ],
  [
    "เลือด",
    "สีแดง"
  ],
  [
    "ซากศพ",
    "ตัวละครที่ล้มลง"
  ],
  [
    "ฆาตกรรม",
    "การเผชิญหน้า"
  ],
  [
    "ฆ่าตัวตาย",
    "ฉากดูแลสุขภาพจิต"
  ],
  [
    "ฆ่า",
    "เผชิญหน้า"
  ],
  [
    "เปลือยกาย",
    "สวมเสื้อผ้ามิดชิด"
  ],
  [
    "เปลือย",
    "สวมเสื้อผ้ามิดชิด"
  ],
  [
    "โป๊เปลือย",
    "สวมเสื้อผ้ามิดชิด"
  ],
  [
    "อนาจาร",
    "แนวแฟชั่น"
  ],
  [
    "ลามก",
    "แนวแฟชั่น"
  ],
  [
    "เด็กหญิง",
    "หญิงสาว"
  ],
  [
    "เด็กชาย",
    "ชายหนุ่ม"
  ],
  [
    "เด็กเล็ก",
    "ตัวละคร"
  ],
  [
    "ผู้เยาว์",
    "ตัวละครสมมติ"
  ]
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compileBoundaryRules(entries: ReadonlyArray<readonly [string, string]>) {
  const merged = new Map<string, readonly [string, string]>();
  for (const [source, target] of entries) {
    merged.set(source.toLowerCase(), [source, target]);
  }
  const ordered = [...merged.values()].sort((left, right) => right[0].length - left[0].length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${ordered.map(([source]) => escapeRegExp(source)).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  const map = new Map<string, [string, string]>();
  for (const [source, target] of ordered) {
    map.set(source.toLowerCase(), [target, source]);
  }
  return { pattern, map };
}

function compileNoBoundaryRules(entries: ReadonlyArray<readonly [string, string]>) {
  const merged = new Map<string, readonly [string, string]>();
  for (const [source, target] of entries) {
    merged.set(source.toLowerCase(), [source, target]);
  }
  const ordered = [...merged.values()].sort((left, right) => right[0].length - left[0].length);
  const pattern = ordered.length
    ? new RegExp(
        `(?:${ordered.map(([source]) => escapeRegExp(source)).join("|")})(?!\\u0E31|[\\u0E34-\\u0E3A]|[\\u0E47-\\u0E4E])`,
        "giu",
      )
    : null;
  const map = new Map<string, [string, string]>();
  for (const [source, target] of ordered) {
    map.set(source.toLowerCase(), [target, source]);
  }
  return { pattern, map };
}

const LITERAL_RULES = compileBoundaryRules([...DEFAULT_LITERAL_REPLACEMENTS, ...DEFAULT_WORD_REPLACEMENTS]);
const NO_BOUNDARY_RULES = compileNoBoundaryRules(DEFAULT_NO_BOUNDARY_REPLACEMENTS);

const URL_PATTERN = /(?:https?|ftp):\/\/[^\s<>'"]+|www\.[^\s<>'"]+/giu;
const MINOR_AGE_EN_PATTERN = /(?<![\p{L}\p{N}_])(?:[1-9]|1[0-7])[-\s]+year[-\s]+old\s+(girl|boy|child|kid|teen(?:ager)?|daughter|son|sister|brother|patient|character|student|baby|toddler|infant)(?![\p{L}\p{N}_])/giu;
const MINOR_AGE_PROPER_NAME_EN_PATTERN = /(?<![\p{L}\p{N}_])(?:[1-9]|1[0-7])[-\s]+[Yy]ear[-\s]+[Oo]ld\s+(?!(?:Scotch|Bourbon|Whisk(?:e)?y|Wine|Rum|Brandy|Cognac|Cheddar|Oak|Bonsai)(?![\p{L}\p{N}_]))([A-ZÀ-Ỹ][a-zà-ỹ]+)/gu;
const MINOR_YO_EN_PATTERN = /(?<![\p{L}\p{N}_])(?:[1-9]|1[0-7])\s*y\/?o(?![\p{L}\p{N}_])/giu;
const NAME_MINOR_AGE_EN_PATTERN = /(?<![\p{L}\p{N}_])(?!(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?![\p{L}\p{N}_]))([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}),\s*(?:[1-9]|1[0-7]),(?!\s*\d{4})/gu;
const MINOR_AGE_VI_PATTERN = /(?<![\p{L}\p{N}_])(?:cô bé|cậu bé|thằng bé|con bé|em bé|bé gái|bé trai|bé|em|trẻ)\s+(?:[1-9]|1[0-7])\s+tuổi(?![\p{L}\p{N}_])/giu;

const MINOR_LIST_ITEM_PATTERN = /^(?:(?:any|a|an|all)\s+)?(?:such\s+)?(?:(?:school[-\s]?aged?|childlike|juvenile[-\s]?looking|youthful[-\s]?looking|young[-\s]?looking|younger[-\s]?looking)\s+(?:characters?|figures?|people|persons?|students?|guests?)|(?:underage|minor)\s+(?:characters?|figures?|people|persons?|students?|guests?)|(?:children|child|kids?|babies|baby|toddlers?|infants?|newborns?|teens?|teenagers?|minors?|preteens?|adolescents?|juveniles?|schoolgirls?|schoolboys?|schoolkids?|girls?|boys?)|youthful\s+figures?|(?:anyone|anybody|someone|person|people|students?|guests?|characters?|figures?)\s+(?:who\s+(?:looks?|is|are|could\s+appear|might\s+look)\s+)?(?:under\s+(?:the\s+age\s+of\s+)?(?:18|eighteen|21|twenty-one|age)|under[-\s]?18|under[-\s]?eighteen|underage)|any\s+reference\s+to\s+(?:them|children|kids|babies|teenagers?|minors?)|under\s+(?:the\s+age\s+of\s+)?(?:18|eighteen))(?:\s+(?:visually|anywhere))?$/iu;
const NEG_CLAUSE_TRAILING_SCOPE_RE = /(?:,?\s*(?:including\s+reflections\s+or\s+background\s+silhouettes|anywhere(?:\s+in\s+(?:the\s+)?(?:frame|image|scene|room|shot|picture|background))?|or\s+any\s+such\s+person(?:\s+visually)?))$/iu;
const NEG_MINOR_CLAUSE_PATTERN = /(?<![\p{L}\p{N}_])((?:do\s+not|don't|never)\s+(?:depict|show|include|mention|imply|add|feature|render)(?:\s+or\s+(?:depict|show|include|mention|imply|add|feature|render))?|avoid)([^.!;\n]+?)(?=(?:,\s*(?:and|or)\s+(?:do\s+not|don't|never|avoid|keep|make|show|all|every|everyone|there)(?![\p{L}\p{N}_]))|[.!;\n]|$)/giu;
const STANDALONE_MINOR_NEG_PATTERN = /(?<![\p{L}\p{N}_])(?:(?:nobody|no\s+one)\s+(?:is\s+)?under\s+(?:the\s+age\s+of\s+)?(?:18|eighteen|21|twenty-one)(?:\s+(?:is\s+present(?:\s+or\s+implied)?|appears?(?:\s+anywhere)?))?|(?:there\s+are\s+|with\s+)?no\s+(?:person|people|one|students?|guests?)?\s*under\s+(?:the\s+age\s+of\s+)?(?:18|eighteen|21|twenty-one)(?:\s+(?:is\s+present(?:\s+or\s+implied)?|appears?(?:\s+anywhere)?))?|(?:there\s+are\s+|with\s+)?no\s+(?:children|kids|babies|toddlers|infants|teenagers?|minors|minor(?=\s*(?:,|;|anywhere|is|are|or|and|$)))(?:\s*,\s*(?:(?:or|and)\s+)?(?:children|kids|babies|toddlers|infants|teenagers?|minors?|anyone\s+under\s+(?:18|eighteen)|any\s+person\s+under\s+(?:18|eighteen)))*(?:\s+(?:anywhere(?:\s+in\s+(?:the\s+)?(?:frame|image|scene))?|is\s+present(?:\s+or\s+implied)?|appears?(?:\s+anywhere)?))?)(?![\p{L}\p{N}_])/giu;

function rewriteNegativeMinorClauses(value: string, replacements: string[]): string {
  let prompt = value.replace(NEG_MINOR_CLAUSE_PATTERN, (full, rawLead: string, rawBody: string) => {
    const lead = rawLead || "";
    const body = rawBody || "";
    let bodyClean = body.trim();
    let trailingScope = "";
    const scopeMatch = NEG_CLAUSE_TRAILING_SCOPE_RE.exec(bodyClean);
    if (scopeMatch) {
      trailingScope = scopeMatch[0].replace(/^,\s*/u, "").trim();
      bodyClean = bodyClean.slice(0, scopeMatch.index).trim();
    }

    const rawParts = bodyClean.split(",").map((part) => part.trim()).filter(Boolean);
    const tokens: string[] = [];
    if (rawParts.length === 1) {
      tokens.push(...rawParts[0].split(/\s+(?:or|and)\s+/iu).map((tok) => tok.trim()).filter(Boolean));
    } else {
      rawParts.forEach((part, idx) => {
        const cleaned = part.replace(/^(?:or|and)\s+/iu, "").trim();
        if (idx === rawParts.length - 1 && /\s+(?:or|and)\s+/iu.test(cleaned)) {
          const sub = cleaned.split(/\s+(?:or|and)\s+/iu).map((tok) => tok.trim()).filter(Boolean);
          if (sub.length && sub.every((tok) => MINOR_LIST_ITEM_PATTERN.test(tok))) {
            tokens.push(...sub);
            return;
          }
        }
        if (cleaned) tokens.push(cleaned);
      });
    }

    if (!tokens.length) return full;

    const kept: string[] = [];
    let removed = 0;
    for (const tok of tokens) {
      const tokStripped = tok.replace(NEG_CLAUSE_TRAILING_SCOPE_RE, "").trim();
      if (MINOR_LIST_ITEM_PATTERN.test(tokStripped)) {
        removed += 1;
      } else {
        kept.push(tok);
      }
    }

    if (removed === 0) return full;
    if (!replacements.includes("negative minor clause")) replacements.push("negative minor clause");

    if (!kept.length) {
      const leadLow = lead.toLowerCase();
      let phrase = "only mature adults";
      if (leadLow.includes("depict")) phrase = "depict only mature adults";
      else if (leadLow.includes("show")) phrase = "show only mature adults";
      if (trailingScope && !/^(?:including|or any such)/iu.test(trailingScope)) {
        phrase = `${phrase} ${trailingScope}`;
      }
      if (lead.slice(0, 1) === lead.slice(0, 1).toUpperCase() && lead.slice(0, 1) !== lead.slice(0, 1).toLowerCase()) {
        phrase = phrase.slice(0, 1).toUpperCase() + phrase.slice(1);
      }
      return phrase;
    }

    const connector = /,\s*and\b/iu.test(body) ? "and" : "or";
    let rebuilt = kept.length === 1
      ? kept[0]
      : kept.length === 2
        ? `${kept[0]} ${connector} ${kept[1]}`
        : `${kept.slice(0, -1).join(", ")}, ${connector} ${kept[kept.length - 1]}`;
    if (trailingScope && !/^(?:including|or any such)/iu.test(trailingScope)) {
      rebuilt = `${rebuilt} ${trailingScope}`;
    }
    return `${lead} ${rebuilt}`;
  });

  prompt = prompt.replace(STANDALONE_MINOR_NEG_PATTERN, (raw) => {
    const low = raw.toLowerCase();
    let replacement = "only mature adults";
    if (low.startsWith("with ")) replacement = "with only mature adults in frame";
    else if (low.startsWith("there are ")) replacement = "only mature adults are present";
    else if (low.includes("is present") || low.includes("appears") || low.startsWith("nobody") || low.startsWith("no one")) {
      replacement = "only mature adults are present";
    } else if (low.includes("anywhere")) {
      replacement = "only mature adults in frame";
    }
    if (raw.slice(0, 1) === raw.slice(0, 1).toUpperCase() && raw.slice(0, 1) !== raw.slice(0, 1).toLowerCase()) {
      replacement = replacement.slice(0, 1).toUpperCase() + replacement.slice(1);
    }
    if (!replacements.includes("negative minor clause")) replacements.push("negative minor clause");
    return replacement;
  });

  return prompt;
}

function applyRuleSet(
  prompt: string,
  pattern: RegExp | null,
  map: Map<string, [string, string]>,
  replacements: string[],
): string {
  if (!pattern || !map.size) return prompt;
  return prompt.replace(pattern, (matched) => {
    const entry = map.get(matched.toLowerCase());
    if (!entry) return matched;
    const [target, source] = entry;
    if (!replacements.includes(source)) replacements.push(source);
    return target;
  });
}

/** Deterministic PixVerse-aligned normalization for visual prompts. */
export function normalizePixversePrompt(
  value: string,
  maxLength = 100_000,
): { prompt: string; replacements: string[] } {
  let prompt = String(value || "").trim();
  if (!prompt) return { prompt: "", replacements: [] };

  const replacements: string[] = [];

  const updatedUrl = prompt.replace(URL_PATTERN, "generic reference link");
  if (updatedUrl !== prompt) {
    prompt = updatedUrl;
    replacements.push("URL");
  }

  const updatedEn = prompt.replace(MINOR_AGE_EN_PATTERN, (_m, rawNoun: string) => {
    const noun = rawNoun.toLowerCase();
    if (noun === "girl") return "young adult woman";
    if (noun === "boy") return "young adult man";
    if (["daughter", "son", "sister", "brother", "patient", "character", "student"].includes(noun)) {
      return `young adult ${noun}`;
    }
    return "young adult character";
  });
  if (updatedEn !== prompt) {
    prompt = updatedEn;
    replacements.push("minor age");
  }

  const updatedProper = prompt.replace(MINOR_AGE_PROPER_NAME_EN_PATTERN, "young adult $1");
  if (updatedProper !== prompt) {
    prompt = updatedProper;
    if (!replacements.includes("minor age")) replacements.push("minor age");
  }

  const updatedYo = prompt.replace(MINOR_YO_EN_PATTERN, "young adult");
  if (updatedYo !== prompt) {
    prompt = updatedYo;
    if (!replacements.includes("minor age")) replacements.push("minor age");
  }

  const updatedNameAge = prompt.replace(NAME_MINOR_AGE_EN_PATTERN, "$1, a young adult character,");
  if (updatedNameAge !== prompt) {
    prompt = updatedNameAge;
    if (!replacements.includes("minor age")) replacements.push("minor age");
  }

  const updatedVi = prompt.replace(MINOR_AGE_VI_PATTERN, (matched) => {
    const text = matched.toLowerCase();
    if (["gái", "cô bé", "con bé"].some((marker) => text.includes(marker))) return "cô gái trẻ";
    if (["trai", "cậu bé", "thằng bé"].some((marker) => text.includes(marker))) return "chàng trai trẻ";
    return "nhân vật trẻ trung";
  });
  if (updatedVi !== prompt) {
    prompt = updatedVi;
    if (!replacements.includes("minor age")) replacements.push("minor age");
  }

  prompt = rewriteNegativeMinorClauses(prompt, replacements);
  prompt = applyRuleSet(prompt, LITERAL_RULES.pattern, LITERAL_RULES.map, replacements);
  prompt = applyRuleSet(prompt, NO_BOUNDARY_RULES.pattern, NO_BOUNDARY_RULES.map, replacements);

  prompt = prompt.replace(/[ \t]{2,}/gu, " ").trim();
  return {
    prompt: prompt.slice(0, Math.max(1, Math.floor(maxLength))),
    replacements,
  };
}
