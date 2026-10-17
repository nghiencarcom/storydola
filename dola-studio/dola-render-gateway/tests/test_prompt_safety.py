import unittest

from prompt_safety import rewrite_sensitive_prompt, safe_rewrite_summary
from prompt_format import video_prompt


class PromptSafetyTests(unittest.TestCase):
    def test_copyright_reference_becomes_original_character(self):
        result = rewrite_sensitive_prompt("Madara and Hashirama battle in a Naruto universe")
        self.assertIn("original shadow warrior", result.text)
        self.assertIn("original forest guardian", result.text)
        self.assertIn("original fantasy universe", result.text)
        self.assertNotIn("Madara", result.text)
        self.assertIn("copyright_reference", result.categories)

    def test_graphic_violence_is_reframed_without_obfuscation(self):
        result = rewrite_sensitive_prompt("Kill the enemy, blood splatter, gun attack")
        self.assertIn("non-graphic", result.text)
        self.assertNotRegex(result.text, r"(?i)\bkill\b|blood\s+splatter|\bgun\b")
        self.assertIn("graphic_violence", result.categories)

    def test_graphic_violence_rewrite_is_idempotent(self):
        first = rewrite_sensitive_prompt("A fight with blood splatter")
        second = rewrite_sensitive_prompt(first.text)
        guardrail = "Use non-graphic action with no blood, injury, or suffering."

        self.assertEqual(second.text, first.text)
        self.assertEqual(second.text.count(guardrail), 1)
        self.assertNotIn(
            "Use non-graphic action with no red cinematic lighting, injury, or suffering.",
            second.text,
        )
        self.assertEqual(second.categories, ())
        self.assertEqual(second.replacements, 0)

    def test_camera_shot_is_preserved_but_shooting_is_reframed(self):
        result = rewrite_sensitive_prompt(
            "Use a wide shot, a close-up shot, and a tracking shot before the guard starts shooting."
        )
        self.assertIn("wide shot", result.text.lower())
        self.assertIn("close-up shot", result.text.lower())
        self.assertIn("tracking shot", result.text.lower())
        self.assertNotIn("shooting", result.text.lower())
        self.assertIn("graphic_violence", result.categories)

    def test_unambiguous_violent_shot_is_reframed(self):
        result = rewrite_sensitive_prompt("The attacker shot at the guard with a gun.")
        self.assertNotRegex(result.text, r"(?i)shot\s+at|\bgun\b")
        self.assertIn("graphic_violence", result.categories)

    def test_all_generated_safety_rewrites_are_idempotent(self):
        for raw in (
            "Madara kills an enemy with blood splatter",
            "nude model in an erotic scene",
            "deepfake celebrity with hate speech",
        ):
            with self.subTest(raw=raw):
                first = rewrite_sensitive_prompt(raw)
                self.assertEqual(rewrite_sensitive_prompt(first.text).text, first.text)

    def test_nudity_is_reframed_as_fully_clothed(self):
        result = rewrite_sensitive_prompt("nude topless model in an erotic scene")
        self.assertNotRegex(result.text, r"(?i)\bnude\b|\btopless\b|\berotic\b")
        self.assertIn("fully clothed", result.text)
        self.assertIn("non-sexual", result.text)
        self.assertIn("nudity_or_sexual_content", result.categories)

    def test_platform_sensitive_terms_are_reframed(self):
        result = rewrite_sensitive_prompt("deepfake celebrity with hate speech")
        self.assertIn("original fictional character", result.text)
        self.assertIn("respectful dialogue", result.text)
        self.assertEqual(result.categories, ("platform_sensitive_content",))

    def test_safe_prompt_is_unchanged(self):
        prompt = "A calm sunrise over Hue with smooth camera movement."
        result = rewrite_sensitive_prompt(prompt)
        self.assertEqual(result.text, prompt)
        self.assertFalse(result.changed)

    def test_policy_refusal_gets_a_real_cooking_scene_reframe(self):
        prompt = (
            "Walter holds a kitchen knife and chops vegetables during "
            "a tense confrontation in the kitchen."
        )
        self.assertEqual(rewrite_sensitive_prompt(prompt).text, prompt)

        result = rewrite_sensitive_prompt(prompt, provider_refused=True)
        self.assertIn("stirs a pot with a wooden spoon", result.text)
        self.assertIn("prepares vegetables", result.text)
        self.assertIn("calm, serious conversation", result.text)
        self.assertIn("everyday cooking scene", result.text)
        self.assertNotRegex(
            result.text,
            r"(?i)\bknife\b|\bchopping\b|\bchops\b|\btense\b|\bconfrontation\b",
        )
        self.assertIn("provider_policy_safe_reframe", result.categories)
        self.assertEqual(
            rewrite_sensitive_prompt(result.text, provider_refused=True).text,
            result.text,
        )

    def test_summary_contains_no_prompt_text(self):
        summary = safe_rewrite_summary("Madara in a dramatic contest")
        self.assertNotIn("Madara", str(summary))
        self.assertTrue(summary["changed"])

    def test_gateway_video_prompt_uses_the_safe_rewrite(self):
        result = video_prompt("Nude Madara kills an enemy with blood splatter", max_chars=12000)
        self.assertNotRegex(result, r"(?i)\bnude\b|\bmadara\b|\bkill\w*\b|blood\s+splatter")
        self.assertNotIn("Không tách thành nhiều video", result)
        self.assertIn("non-graphic", result)

    def test_restraint_asphyxia_and_extreme_survival_are_reframed(self):
        prompt = (
            "A soldier is trapped underwater. Both wrists are zip-tied tightly "
            "behind his back; his hands must never appear in front of his body, "
            "never become loose, and never be unbound. Show survival tension and "
            "breathless pacing. He is submerged and nearly motionless, hands bound "
            "behind his back, holding his breath."
        )
        result = rewrite_sensitive_prompt(prompt)
        self.assertIn("dangerous_restraint_or_asphyxia", result.categories)
        self.assertNotRegex(
            result.text,
            r"(?i)zip[- ]?tied|bound behind|holding his breath|"
            r"survival tension|breathless pacing|trapped underwater|"
            r"submerged and nearly motionless|never be unbound",
        )
        self.assertIn("free to move", result.text)
        self.assertIn("breathe normally", result.text)

    def test_physical_safety_rewrite_is_idempotent(self):
        first = rewrite_sensitive_prompt(
            "A character is restrained underwater and cannot breathe."
        )
        second = rewrite_sensitive_prompt(first.text)
        self.assertEqual(second.text, first.text)
        self.assertEqual(second.categories, ())
        self.assertEqual(second.replacements, 0)

    def test_layered_legacy_scene_is_reframed_without_residual_risk_cues(self):
        prompt = (
            "A bald Black male soldier, athletic build, wearing a wet camouflage "
            "military uniform, in a murky underwater scene. SWAT operators search "
            "with rifles while he moves toward a reed-like breathing tube. The "
            "survival-escape tone is tense and stealthy suspense. Keep characters "
            "free to move and breathe normally in a safe, non-injurious adventure scene."
        )
        result = rewrite_sensitive_prompt(prompt)
        self.assertIn("dangerous_restraint_or_asphyxia", result.categories)
        self.assertNotRegex(
            result.text,
            r"(?i)\bsoldier\b|\bSWAT\b|\bmilitary\b|\b(?:rifle|rifles)\b|"
            r"\bbreathing[- ]tube\b|\bmurky\b|\bsurvival\b|\bstealthy\b|"
            r"\bsuspense(?:ful)?\b|\b(?:trapped|bound|tied)\b",
        )
        self.assertIn("family-friendly", result.text)
        self.assertEqual(rewrite_sensitive_prompt(result.text).text, result.text)

    def test_legacy_fire_command_is_reframed(self):
        result = rewrite_sensitive_prompt(
            "SWAT officer points and shouts: Open fire. The scene ends before gunfire."
        )
        self.assertNotRegex(result.text, r"(?i)\bSWAT\b|\bopen\s+fire\b|\bgunfire\b")
        self.assertIn("safety", result.text)
        self.assertIn("graphic_violence", result.categories)
