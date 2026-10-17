"""Deterministic, policy-compliant rewrites for video prompts.

This module deliberately performs semantic redaction/reframing. It does not
obfuscate words, insert look-alike characters, or try to defeat a provider's
moderation checks. The result is the prompt that is sent to Dola.
"""
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class PromptRewriteResult:
    text: str
    categories: tuple[str, ...]
    replacements: int

    @property
    def changed(self) -> bool:
        return self.replacements > 0


_RULES: tuple[tuple[str, tuple[tuple[re.Pattern[str], str], ...]], ...] = (
    (
        "copyright_reference",
        (
            # Specific character names are replaced before general franchise
            # names so a long prompt keeps a useful original-character role.
            (re.compile(r"\b(?:naruto\s+shippuden|dragon\s+ball(?:\s+z)?|one\s+piece|jujutsu\s+kaisen|demon\s+slayer|attack\s+on\s+titan|my\s+hero\s+academia)\b", re.I), "an original fantasy universe"),
            (re.compile(r"\b(?:naruto|pokemon|pok[eé]mon)\s+(?:universe|world|series)\b", re.I), "an original fantasy universe"),
            (re.compile(r"\b(?:madara(?:\s+uchiha)?|uchiha\s+madara)\b", re.I), "an original shadow warrior"),
            (re.compile(r"\b(?:hashirama(?:\s+senju)?|senju\s+hashirama)\b", re.I), "an original forest guardian"),
            (re.compile(r"\b(?:naruto|sasuke|sakura|kakashi|goku|vegeta|luffy|zoro|saitama|gojo|sukuna|pikachu)\b", re.I), "an original fantasy warrior"),
            (re.compile(r"\b(?:mickey\s+mouse|superman|batman|spider[- ]?man|iron\s+man|captain\s+america|darth\s+vader|harry\s+potter|hogwarts|star\s+wars|marvel|dc\s+comics|disney|avengers|transformers|jurassic\s+park)\b", re.I), "an original cinematic universe"),
            (re.compile(r"\b(?:copyrighted|copyright-protected)\s+(?:character|franchise|universe)\b", re.I), "original fictional character or universe"),
        ),
    ),
    (
        "nudity_or_sexual_content",
        (
            (re.compile(r"\b(?:full[- ]frontal\s+)?(?:nudity|nude|naked|topless|bare[- ]chested|bare[- ]breasted)\b|kh[oỏả]a\s+th[aâ]n|ng[uự]c\s+tr[oầầ]n|l[oộ] da\s+th[iị]t", re.I), "fully clothed character"),
            (re.compile(r"\b(?:genitals?|penis|vagina|nipples?|breasts?)\b|b[oộ]\s+ph[aậ]n\s+sinh\s+d[uụ]c", re.I), "fully clothed character"),
            (re.compile(r"\b(?:porn(?:ography|ographic)?|erotic|(?<!non-)sexual(?:ly)?|sex scene|fetish|nsfw|explicit content|orgasm)\b|khi[eê]u\s+d[aâ]m|t[iì]nh\s+d[uụ]c|g[oợ]i\s+d[uụ]c", re.I), "non-sexual, family-friendly scene"),
            (re.compile(r"\b(?:lingerie|underwear|intimate apparel)\b|n[oộ]i\s+y|[đd][ồo]\s+l[oó]t", re.I), "modest clothing"),
        ),
    ),
    (
        "graphic_violence",
        (
            (re.compile(r"\b(?:graphic\s+violence|extreme\s+violence|gore|dismemberment|dismembered|decapitation|decapitated|beheading|beheaded|severed\s+(?:head|limb))\b|m[aá]u\s+me|ch[eế]t\s+ch[oó]c|ph[aâ]n\s+th[iị]t", re.I), "non-graphic action"),
            (re.compile(r"\b(?:blood[- ]splatter(?:ed)?|blood[- ]soaked|blood|corpse|dead\s+body)\b|m[aá]u|x[aá]c\s+ch[eế]t", re.I), "red cinematic lighting"),
            (re.compile(r"\b(?:kill\w*|murder\w*|assassinate\w*|execute\w*|slaughter\w*)\b|gi[eế]t|s[aá]t\s+h[aạ]i", re.I), "outmaneuver"),
            (re.compile(r"\bopen\s+fire\b", re.I), "Stay calm and move to safety"),
            (re.compile(r"\b(?:gunfire|gun\s+fire)\b", re.I), "non-graphic action"),
            (re.compile(r"\b(?:shooting\s+command|fire\s+at|fire\s+on)\b", re.I), "a calm safety signal"),
            # ``shot`` is also standard cinematography vocabulary (wide shot,
            # close-up shot, tracking shot). Keep that neutral usage intact;
            # only rewrite an unambiguous violent use such as "shot at him"
            # or "shot with a gun". ``shoot``/``shooting`` remain covered as
            # direct violence terms.
            (re.compile(
                r"\bshot\s+(?:dead|at\s+(?:him|her|them|someone|a\s+(?:man|woman|person)|"
                r"the\s+(?:man|woman|person|enemy|target|guard))|"
                r"with\s+(?:a\s+)?(?:gun|rifle|pistol|firearm)|"
                r"from\s+(?:a\s+)?(?:gun|rifle|pistol|firearm))\b",
                re.I,
            ), "perform a stylized non-graphic move"),
            (re.compile(r"\b(?:stab|stabbing|stabbed|shoot|shooting|firearm|gun|rifle|pistol|torture|tortured)\b|b[aắ]n|đ[eâ]m|tra\s+t[aấ]n", re.I), "perform a stylized non-graphic move"),
            (re.compile(r"\b(?:fight|fighting|fought|battle|battling|combat|war|warfare|attack|attacking|attacked|weapon|weapons|bomb|bombing|detonation|explosion)\b|chi[eế]n\s+tranh|chi[eế]n\s+đ[aấ]u|t[aấ]n\s+c[oô]ng|v[uũ]\s+kh[ií]", re.I), "dramatic non-graphic contest"),
        ),
    ),
    (
        "dangerous_restraint_or_asphyxia",
        (
            # Reframe physical restraint as a character who can move freely;
            # do not disguise the original wording or try to defeat Dola's
            # moderation. Apply the specific wrist/hand phrases first so a
            # later generic rule cannot leave part of the unsafe description.
            (re.compile(
                r"\b(?:both\s+)?(?:wrists?|hands?)\s+(?:are|were|being)\s+"
                r"(?:zip[- ]?tied|tied|bound|handcuffed|cuffed|shackled|chained)"
                r"(?:\s+\w+){0,5}\s+(?:behind\s+(?:his|her|their)\s+back|"
                r"behind\s+the\s+back)", re.I,
            ), "both hands are free at the character's sides"),
            (re.compile(
                r"\b(?:zip[- ]?tied|tied|bound|handcuffed|cuffed|shackled|"
                r"chained|restrained)\b(?:\s+\w+){0,5}\s+"
                r"(?:behind\s+(?:his|her|their)\s+back|at\s+the\s+wrists?|"
                r"to\s+(?:a|the)\s+chair)", re.I,
            ), "free to move safely"),
            (re.compile(
                r"\b(?:hands?|wrists?|ankles?|legs?)\s+(?:are|were|being)\s+"
                r"(?:zip[- ]?tied|tied|bound|handcuffed|cuffed|shackled|chained)"
                r"(?:\s+\w+){0,4}", re.I,
            ), "free to move safely"),
            (re.compile(
                r"\b(?:hands?|wrists?)\s+(?:bound|tied|chained)\s+behind\s+"
                r"(?:his|her|their|the)\s+back\b", re.I,
            ), "hands free at the character's sides"),
            (re.compile(
                r"\b(?:his|her|their|the\s+character's)\s+hands?\s+must\s+"
                r"never\s+appear\s+in\s+front\s+of\s+(?:his|her|their|the)\s+body"
                r"\s*,?\s*never\s+become\s+loose\s*,?\s*and\s+never\s+be\s+"
                r"unbound\b", re.I,
            ), "the character moves freely with hands at the sides"),
            (re.compile(
                r"\b(?:never\s+be\s+unbound|never\s+become\s+loose|"
                r"never\s+appear\s+in\s+front\s+of\s+(?:his|her|their)\s+body)\b",
                re.I,
            ), "the character remains free to move"),
            (re.compile(
                r"\b(?:gagged|muzzled|tied up|bound up|restrained|handcuffed|"
                r"shackled|chained|zip[- ]?tied)\b", re.I,
            ), "free to move safely"),
            (re.compile(
                r"(?:bị\s+)?(?:trói(?:\s+chặt)?|buộc\s+chặt|còng(?:\s+tay)?|"
                r"xiềng|khóa\s+(?:tay|chân)|bịt\s+miệng|bịt\s+mặt)", re.I,
            ), "được tự do di chuyển an toàn"),
            (re.compile(
                r"\b(?:risk\s+of\s+)?(?:asphyxia(?:tion)?|suffocation|"
                r"choking|drowning|near\s+drowning|cannot\s+breathe|"
                r"can't\s+breathe|unable\s+to\s+breathe|"
                r"struggling\s+to\s+breathe)\b", re.I,
            ), "a safe, controlled atmosphere"),
            (re.compile(
                r"\bholding\s+(?:his|her|their)\s+breath\b|"
                r"\b(?:nín\s+thở|khó\s+thở|ngạt\s+thở|nguy\s+cơ\s+ngạt)\b",
                re.I,
            ), "breathing calmly"),
            (re.compile(r"\bbreathless\s+pacing\b", re.I), "rapid cinematic pacing"),
            (re.compile(
                r"\b(?:trapped|stranded|stuck)\s+underwater\b|"
                r"\b(?:mắc\s+kẹt|bị\s+chìm)\s+(?:dưới\s+nước|trong\s+nước)\b",
                re.I,
            ), "in a supervised underwater scene"),
            (re.compile(
                r"\bsubmerged\s+and\s+(?:nearly\s+)?motionless\b",
                re.I,
            ), "moving calmly underwater"),
            (re.compile(
                r"\b(?:extreme\s+survival|survival\s+危机|life[- ]threatening|"
                r"life[- ]or[- ]death|survival\s+danger)\b|"
                r"(?:sinh\s+tồn\s+cực\s+đoan|nguy\s+hiểm\s+đến\s+tính\s+mạng)",
                re.I,
            ), "cinematic exploration"),
            (re.compile(
                r"\b(?:survival\s+tension|survival\s+scenario)\b|"
                r"(?:căng\s+thẳng\s+sinh\s+tồn|tình\s+huống\s+sinh\s+tồn)",
                re.I,
            ), "adventure tension"),
            (re.compile(
                r"\b(?:submerged\s+and\s+)?(?:nearly\s+)?motionless\s+"
                r"(?:underwater|beneath\s+the\s+water)\b", re.I,
            ), "moving calmly underwater"),
            # A previous pass may have removed the restraint words while
            # leaving the surrounding military/search-and-escape framing.
            # Reframe that residual context as a calm, family-friendly nature
            # exploration. This is a semantic safety rewrite, not a spelling
            # trick intended to bypass provider moderation.
            (re.compile(
                r"\ba\s+bald\s+Black\s+male\s+soldier,\s*athletic\s+build,\s*"
                r"wearing\s+a\s+wet\s+camouflage\s+military\s+uniform\b", re.I,
            ), "an athletic adventure explorer wearing a weatherproof outdoor outfit"),
            (re.compile(
                r"\bmasked\s+SWAT\s+operator\b", re.I,
            ), "nature guide"),
            (re.compile(r"\bSWAT\s+operators?\b", re.I), "nature guides"),
            (re.compile(r"\bSWAT\s+team\b", re.I), "nature guides"),
            (re.compile(r"\bSWAT\s+(?:officer|member)\b", re.I), "nature guide"),
            (re.compile(r"\bSWAT\b", re.I), "nature guide"),
            (re.compile(r"\b(?:male\s+)?soldier\b", re.I), "adventure explorer"),
            (re.compile(
                r"\b(?:wet\s+)?camouflage\s+military\s+uniform\b|"
                r"\bmilitary\s+uniform\b", re.I,
            ), "weatherproof outdoor outfit"),
            (re.compile(r"\bmilitary\b", re.I), "outdoor adventure"),
            (re.compile(
                r"\bdistorted\s+silhouettes\s+of\s+nature\s+guides\s+loom\s+above\b",
                re.I,
            ), "gentle silhouettes of nature guides are visible above"),
            (re.compile(
                r"\brifles?\s+pointed\s+just\s+above\s+the\s+surface\b", re.I,
            ), "field equipment held safely at their sides"),
            (re.compile(r"\brifles?\b", re.I), "field equipment"),
            (re.compile(r"\b(?:masked\s+|unmasked\s+)?nature\s+guide\s+scanning\s+the\s+water\b", re.I), "nature guide observing the water"),
            (re.compile(r"\bmuddy\s+mangrove\s+swamp\b", re.I), "sunlit mangrove lagoon"),
            (re.compile(r"\bmurky\s+underwater\b", re.I), "sunlit underwater"),
            (re.compile(r"\bmuddy\s+light\s+shafts\b", re.I), "sunlit shafts of light"),
            (re.compile(r"\bmuddy\s+swamp\s+water\b|\bmuddy\s+water\b", re.I), "clear shallow water"),
            (re.compile(r"\bdark(?:er)?\s+(?:root\s+)?(?:tunnels?|nest\s+of\s+roots?)\b", re.I), "well-lit root grove"),
            (re.compile(r"\bretreating\s+into\s+shadow\b", re.I), "moving through soft daylight"),
            (re.compile(r"\bbody\s+low\s+in\s+the\s+water\b", re.I), "moving gracefully through shallow water"),
            (re.compile(r"\bstaying\s+low\s+and\s+silent\b", re.I), "moving calmly and quietly"),
            (re.compile(r"\blooking\s+upward\s+in\s+fear\b", re.I), "looking upward with calm curiosity"),
            (re.compile(r"\beyes\s+wide\s+and\s+strained\b", re.I), "calm focused eyes"),
            (re.compile(r"\bdesperate\s+eyes\b", re.I), "calm focused eyes"),
            (re.compile(r"\btense\s+jaw\b", re.I), "relaxed expression"),
            (re.compile(r"\bpainfully\s+bends\s+and\s+twists\s+his\s+torso\b", re.I), "gently moves his torso"),
            (re.compile(r"\bstruggling\s+to\s+maneuver\b", re.I), "calmly explores"),
            (re.compile(r"\bmoving\s+slowly\s+and\s+aggressively\b", re.I), "moving slowly and calmly"),
            (re.compile(r"\bsuspicious\s+and\s+alert\b", re.I), "observant and calm"),
            (re.compile(r"\burgently\s+but\s+quietly\b", re.I), "calmly and quietly"),
            (re.compile(r"\bdanger\s+above\s+remains\s+close\b", re.I), "sunlight remains visible above"),
            (re.compile(r"\b(?:survival[- ]escape|survival\s+escape)\s+tone\b", re.I), "family-friendly adventure tone"),
            (re.compile(r"\brealistic\s+cinematic\s+thriller\b", re.I), "cinematic family-friendly adventure"),
            (re.compile(r"\bstealthy\s+adventure\s+tension\b", re.I), "gentle adventure curiosity"),
            (re.compile(r"\btense\s+and\s+stealthy\s+suspense\b", re.I), "calm atmospheric exploration"),
            (re.compile(r"\btense,\s+breathless,\s+stealthy\s+suspense\b", re.I), "calm, atmospheric, exploratory adventure"),
            (re.compile(r"\b(?:concealment|imminent\s+discovery)\b", re.I), "peaceful observation"),
            (re.compile(r"\bsafe,\s+controlled\s+atmosphere\s+pressure\b", re.I), "safe, ambient atmosphere"),
            (re.compile(r"\batmosphere\s+pressure\b", re.I), "ambient atmosphere"),
            (re.compile(r"\bfinal\s+breathing[- ]tube\s+close-up\b", re.I), "final nature-detail close-up"),
            (re.compile(r"\bbreathing[- ]tube\b", re.I), "natural plant detail"),
            (re.compile(r"\bmurky\s+olive[- ]brown\s+underwater\s+color\b", re.I), "clear sunlit underwater color"),
            (re.compile(r"\bolive[- ]brown\b", re.I), "natural green-blue"),
            (re.compile(r"\bmurky\b", re.I), "clear"),
            (re.compile(r"\bwet\s+texture\s+on\s+skin\s+and\s+uniform\b", re.I), "natural texture on skin and outdoor outfit"),
            (re.compile(r"\bnatural\s+swamp\s+reflections\b", re.I), "natural lagoon reflections"),
            (re.compile(r"\btense\s+search\s+beats\b", re.I), "gentle observation beats"),
            (re.compile(r"\ban\s+intense\s+extreme\s+close-up\b", re.I), "a calm close-up"),
            (re.compile(r"\bintense\s+extreme\s+close-up\b", re.I), "calm close-up"),
            (re.compile(r"\b(?:rapid|fast)\s+cinematic\s+pacing\b", re.I), "gentle cinematic pacing"),
            (re.compile(r"\btense\s+and\s+adventure\b", re.I), "calm and atmospheric adventure"),
            (re.compile(r"\bsuspense\b", re.I), "atmosphere"),
            (re.compile(r"\bsuspenseful\b", re.I), "atmospheric"),
            (re.compile(r"\bfaint\s+bubbling\s+near\s+the\s+protagonist\b", re.I), "gentle water sounds nearby"),
            (re.compile(r"\bunderwater\s+muffled\s+ambience\b", re.I), "soft underwater ambience"),
            (re.compile(r"\bcinematic\s+atmosphere\s+sequence\b", re.I), "cinematic exploration sequence"),
            (re.compile(r"\bShow\s+him\s+calmly\s+explores\b", re.I), "Show him calmly exploring"),
            (re.compile(r"\balways\s+keeping\s+the\s+free\s+to\s+move\s+safely\b", re.I), "always keeping his movement free and safe"),
            (re.compile(r"\bclear\s+shallow\s+water\s+clouding\s+around\s+him\b", re.I), "clear water flowing gently around him"),
            (re.compile(r"\bthey\s+must\s+not\s+be\s+standing\s+dry\s+on\s+the\s+show\b", re.I), "they remain in the water"),
            (re.compile(r"\bback\s+himself\s+deeper\s+into\b", re.I), "move gently through"),
            (re.compile(r"\bsubmerged\s+root\s+maze\b", re.I), "sunlit root grove"),
            # Remove the remaining tube/breathing action rather than merely
            # changing its adjective; the character should remain able to
            # breathe normally throughout the scene.
            (re.compile(
                r"\bclamps\s+his\s+lips\s+around\s+the\s+hollow\s+reed\s+"
                r"and\s+begins\s+to\s+breathe\s+through\s+it\b", re.I,
            ), "observes the natural plant detail closely with a calm focused expression"),
            (re.compile(
                r"\bbringing\s+his\s+mouth\s+to\s+the\s+hollow\s+root\b", re.I,
            ), "looking toward the natural plant detail from a safe distance"),
            (re.compile(r"\b(?:hollow\s+root\s*/\s*reed-like\s+breathing\s+tube|reed-like\s+breathing\s+tube)\b", re.I), "natural reed-like plant detail"),
            (re.compile(r"\bbreathing\s+tube\b", re.I), "natural plant detail"),
            (re.compile(r"\bhollow\s+root\b", re.I), "natural root detail"),
            (re.compile(r"\bhollow\s+reed\b", re.I), "natural reed"),
            (re.compile(r"\b(?:begins\s+to\s+)?breathe\s+through\s+it\b", re.I), "continues breathing normally"),
            (re.compile(r"\bcheeks\s+tight\b", re.I), "relaxed expression"),
            (re.compile(r"\btiny\s+air\s+bubbles\s+rising\s+around\s+his\s+face\b", re.I), "sunlit particles drifting around his face"),
            # Clean residual adjectives from a layered rewrite while keeping
            # the action cinematic and non-injurious.
            (re.compile(r"\b(?:fear|strained|desperate|painfully|struggling|aggressively|urgently|breathless)\b", re.I), "calmly"),
            (re.compile(r"\b(?:survival|stealthy|suspense|thriller)\b", re.I), "adventure"),
            (re.compile(r"\b(?:danger|threat)\b", re.I), "peaceful surroundings"),
            (re.compile(r"\bperform\s+a\s+stylized\s+non-graphic\s+move(?:k)?\b", re.I), "show"),
            (re.compile(r"\bthey\s+must\s+not\s+be\s+standing\s+dry\s+on\s+the\s+show\b", re.I), "they remain in the water"),
            (re.compile(r"\bthey\s+must\s+not\s+be\s+standing\s+dry\s+on\s+the\s+perform\s+a\s+stylized\s+non-graphic\s+move(?:k)?\b", re.I), "they remain in the water"),
            (re.compile(r"\bhollow\s+root\s*/\s*reed-like\s+natural\s+plant\s+detail\b", re.I), "natural plant detail"),
            (re.compile(r"\bnatural\s+root\s+detail\s*/\s*reed-like\s+natural\s+plant\s+detail\b", re.I), "natural plant detail"),
            (re.compile(r"\btense\s+and\s+adventure\b", re.I), "calm and atmospheric adventure"),
            (re.compile(r"\b(?:a\s+)?an\s+(?:a\s+)?nature\s+guide\b", re.I), "a nature guide"),
            (re.compile(r"\ba\s+a\s+(well-lit\s+root\s+grove|sunlit\s+mangrove\s+lagoon)\b", re.I), r"a \1"),
        ),
    ),
    (
        "platform_sensitive_content",
        (
            (re.compile(r"\b(?:deep[- ]fake|deepfake|face[- ]swap|celebrity\s+likeness|real[- ]person\s+likeness)\b|gh[eé]p\s+mặt\s+ng[uườ]i\s+th[eậ]t", re.I), "original fictional character"),
            (re.compile(r"\b(?:hate\s+speech|racial\s+slur|slur)\b|l[oờ]i\s+n[oó]i\s+th[uù]\s+h[aậ]n", re.I), "respectful dialogue"),
            (re.compile(r"\b(?:terrorist|terrorism|extremist|extremism)\b|kh[uủ]ng\s+b[oố]", re.I), "fictional antagonist"),
            (re.compile(r"\b(?:self[- ]harm|suicid(?:e|al))\b|t[uự]\s+h[aạ]i|t[uự]\s+t[uử]", re.I), "emotional recovery"),
            (re.compile(r"\b(?:drug\s+use|cocaine|heroin|methamphetamine|fentanyl)\b|s[uử]\s+d[uụ]ng\s+ma\s+t[uú]y", re.I), "a neutral medical prop"),
        ),
    ),
)

_POLICY_REFUSAL_REWRITES: tuple[tuple[re.Pattern[str], str], ...] = (
    # After an explicit provider refusal, convert weapon-like kitchen actions
    # into ordinary food preparation or stirring. This changes the scene
    # instead of disguising the refused wording.
    (
        re.compile(
            r"\b(?:chopping|cutting|slicing)\s+"
            r"([\w'-]+(?:\s+[\w'-]+){0,3})\s+(?:with|using)\s+"
            r"(?:a\s+)?(?:kitchen\s+)?(?:knife|blade)\b",
            re.I,
        ),
        r"preparing \1 at the counter",
    ),
    (
        re.compile(
            r"\b(?:chops?|cuts?|slices?)\s+"
            r"([\w'-]+(?:\s+[\w'-]+){0,3})\s+(?:with|using)\s+"
            r"(?:a\s+)?(?:kitchen\s+)?(?:knife|blade)\b",
            re.I,
        ),
        r"prepares \1 at the counter",
    ),
    (re.compile(r"\bknives\b", re.I), "cooking utensils"),
    (re.compile(r"\b(?:kitchen\s+)?(?:knife|blade|dagger)\b", re.I), "wooden spoon"),
    (
        re.compile(
            r"\b(is|was)\s+(?:holding|gripping|wielding)\s+"
            r"(?:a\s+)?wooden spoon\b",
            re.I,
        ),
        r"\1 stirring a pot with a wooden spoon",
    ),
    (
        re.compile(
            r"\b(?:holding|gripping|wielding)\s+(?:a\s+)?wooden spoon\b",
            re.I,
        ),
        "stirring a pot with a wooden spoon",
    ),
    (
        re.compile(r"\b(?:holds?|grips?|wields?)\s+(?:a\s+)?wooden spoon\b", re.I),
        "stirs a pot with a wooden spoon",
    ),
    (
        re.compile(
            r"\b(?:chopping|cutting|slicing)\s+"
            r"([\w'-]+(?:\s+[\w'-]+){0,3})\b",
            re.I,
        ),
        r"preparing \1",
    ),
    (
        re.compile(
            r"\b(?:chops?|cuts?|slices?)\s+"
            r"([\w'-]+(?:\s+[\w'-]+){0,3})\b",
            re.I,
        ),
        r"prepares \1",
    ),
    (
        re.compile(r"\b(?:tense|heated|hostile|aggressive)\s+confrontation\b", re.I),
        "calm, serious conversation",
    ),
    (
        re.compile(r"\b(?:confrontation|standoff|face[- ]off)\b", re.I),
        "calm conversation",
    ),
    (
        re.compile(r"\b(?:tense|heated|hostile|aggressive)\b", re.I),
        "calm",
    ),
    (
        re.compile(r"\b(is|was)\s+confronting\b", re.I),
        r"\1 speaking calmly with",
    ),
    (re.compile(r"\bconfronts\b", re.I), "speaks calmly with"),
    (re.compile(r"\bconfronted\b", re.I), "spoke calmly with"),
    (re.compile(r"\bconfronting\b", re.I), "speaking calmly with"),
    (re.compile(r"\bconfront\b", re.I), "speak calmly with"),
)


_CATEGORY_GUARDRAILS = {
    "copyright_reference": "Use original fictional characters and settings only.",
    "nudity_or_sexual_content": "Keep all characters fully clothed and the scene non-sexual.",
    "graphic_violence": "Use non-graphic action with no blood, injury, or suffering.",
    "dangerous_restraint_or_asphyxia": (
        "Keep characters free to move and breathe normally in a safe, non-injurious "
        "adventure scene."
    ),
    "platform_sensitive_content": "Keep the presentation respectful, fictional, and family-friendly.",
}


def _flexible_literal_pattern(*values: str) -> re.Pattern[str]:
    """Match generated guardrails while tolerating editor whitespace."""
    alternatives = []
    for value in values:
        escaped = re.escape(value).replace(r"\ ", r"\s+")
        alternatives.append(escaped)
    return re.compile(r"(?:" + "|".join(alternatives) + r")", re.I)


# A previous safety pass could rewrite ``blood`` inside the graphic-violence
# guardrail itself, producing this malformed variant. Treat both forms as the
# same generated guardrail so retries and layered gateway/UI normalization are
# stable and never accumulate another copy.
_GUARDRAIL_PATTERNS = {
    "copyright_reference": _flexible_literal_pattern(
        _CATEGORY_GUARDRAILS["copyright_reference"],
    ),
    "nudity_or_sexual_content": _flexible_literal_pattern(
        _CATEGORY_GUARDRAILS["nudity_or_sexual_content"],
    ),
    "graphic_violence": _flexible_literal_pattern(
        _CATEGORY_GUARDRAILS["graphic_violence"],
        "Use non-graphic action with no red cinematic lighting, injury, or suffering.",
    ),
    "dangerous_restraint_or_asphyxia": _flexible_literal_pattern(
        _CATEGORY_GUARDRAILS["dangerous_restraint_or_asphyxia"],
    ),
    "platform_sensitive_content": _flexible_literal_pattern(
        _CATEGORY_GUARDRAILS["platform_sensitive_content"],
    ),
}


def rewrite_sensitive_prompt(
    value, *, provider_refused: bool = False
) -> PromptRewriteResult:
    """Rewrite known high-risk references into a compliant video description.

    provider_refused enables a second, conservative scene reframe only after
    Dola explicitly refuses the first attempt. It removes weapon-like kitchen
    handling and confrontational staging instead of resending unchanged.
    """
    text = str(value or "")
    categories: list[str] = []
    replacements = 0

    # Guardrails are appended by this function and can pass through the
    # function again at another boundary (for example, API admission followed
    # by browser submission). Hide them while applying content rules so a rule
    # cannot rewrite its own output. Replacing all copies with one marker per
    # category also makes the result deduplicate existing repeated guardrails.
    protected_categories: list[str] = []
    guardrail_markers: dict[str, str] = {}
    for category, pattern in _GUARDRAIL_PATTERNS.items():
        marker = f"__DOLA_GUARDRAIL_{category.upper()}__"
        text, count = pattern.subn(marker, text)
        if count:
            protected_categories.append(category)
            guardrail_markers[category] = marker

    for category, rules in _RULES:
        category_count = 0
        for pattern, replacement in rules:
            text, count = pattern.subn(replacement, text)
            category_count += count
        if category_count:
            categories.append(category)
            replacements += category_count

    policy_refusal_replacements = 0
    if provider_refused:
        for pattern, replacement in _POLICY_REFUSAL_REWRITES:
            text, count = pattern.subn(replacement, text)
            policy_refusal_replacements += count
        if policy_refusal_replacements:
            replacements += policy_refusal_replacements
            guardrail = (
                "Maintain a calm, everyday cooking scene with non-threatening actions."
            )
            if guardrail not in text:
                text = f"{text.strip()} {guardrail}".strip()

    # Restore one canonical copy of every guardrail that was already present.
    # This also repairs the malformed red-cinematic-lighting variant above.
    for category, marker in guardrail_markers.items():
        text = text.replace(marker, _CATEGORY_GUARDRAILS[category], 1)
        text = text.replace(marker, "")

    if guardrail_markers:
        text = text.strip()

    new_guardrail_categories = [
        category for category in categories if category not in protected_categories
    ]
    if new_guardrail_categories:
        guardrails = " ".join(
            _CATEGORY_GUARDRAILS[category] for category in new_guardrail_categories
        )
        text = f"{text.strip()} {guardrails}".strip()
    if policy_refusal_replacements:
        categories.append("provider_policy_safe_reframe")
    return PromptRewriteResult(text=text, categories=tuple(categories), replacements=replacements)


def safe_rewrite_summary(value) -> dict:
    """Return non-sensitive diagnostics for logs and UI status messages."""
    result = rewrite_sensitive_prompt(value)
    return {
        "changed": result.changed,
        "categories": list(result.categories),
        "replacements": result.replacements,
        "input_chars": len(str(value or "")),
        "output_chars": len(result.text),
    }
