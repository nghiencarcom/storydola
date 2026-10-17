import unittest
from prompt_format import (
    SKETCH_COLOR_RESTORATION_MARKER,
    SINGLE_VIDEO_INSTRUCTION,
    ensure_sketch_color_restoration,
    plain_text_prompt,
    remove_video_duration_mentions,
    remove_unsupported_30s_mentions,
    video_prompt,
)


class PromptFormatTests(unittest.TestCase):
    def test_sketch_color_restoration_block_is_added_once(self):
        prompt = ensure_sketch_color_restoration("A character walks through a park.")
        repeated = ensure_sketch_color_restoration(prompt)
        self.assertEqual(repeated.count(SKETCH_COLOR_RESTORATION_MARKER), 1)
        self.assertIn("black-and-white graphite sketch", repeated)
        self.assertIn("full natural color", repeated)

    def test_sketch_color_restoration_respects_prompt_limit(self):
        prompt = ensure_sketch_color_restoration("A" * 500, max_chars=700)
        self.assertLessEqual(len(prompt), 700)
        self.assertEqual(prompt.count(SKETCH_COLOR_RESTORATION_MARKER), 1)

    def test_document_preserves_words_and_sections(self):
        raw = '&#x20;\n# THE ECLIPSE TEMPLE ## STORY A storm. --- # CHARACTER 1 — VEXAR\nABILITIES: \\* energy dash \\* stone barriers'
        self.assertEqual(plain_text_prompt(raw), 'THE ECLIPSE TEMPLE STORY A storm. CHARACTER 1 VEXAR ABILITIES: energy dash stone barriers')

    def test_semantic_punctuation_and_unicode_are_preserved(self):
        raw = 'Huế, 9:16; #travel; C#; 2 * 3; -5; violet-white; “VEXAR” — KAIRO.'
        self.assertEqual(plain_text_prompt(raw), 'Huế, 9:16; #travel; C#; 2 * 3; -5; violet-white; “VEXAR” KAIRO.')

    def test_em_dash_is_removed_without_joining_words(self):
        self.assertEqual(plain_text_prompt('VEXAR—KAIRO — STORM'), 'VEXAR KAIRO STORM')

    def test_long_prompt_is_not_truncated_by_formatting(self):
        self.assertEqual(plain_text_prompt('Huế &amp; KAIRO. ' * 400), ('Huế & KAIRO. ' * 400).strip())

    def test_video_prompt_does_not_add_retired_single_video_instruction(self):
        result = video_prompt('Tạo video du lịch Huế', max_chars=12000)
        self.assertEqual(result, 'Tạo video du lịch Huế')
        self.assertNotIn(SINGLE_VIDEO_INSTRUCTION, result)

    def test_video_prompt_does_not_duplicate_instruction(self):
        prompt = f'Tạo video du lịch Huế. {SINGLE_VIDEO_INSTRUCTION}'
        self.assertEqual(video_prompt(prompt, max_chars=12000), 'Tạo video du lịch Huế.')

    def test_video_prompt_reserves_space_when_truncated(self):
        result = video_prompt('A' * 100, max_chars=80)
        self.assertEqual(len(result), 80)
        self.assertNotIn(SINGLE_VIDEO_INSTRUCTION, result)

    def test_video_prompt_keeps_empty_prompt_empty(self):
        self.assertEqual(video_prompt('   ', max_chars=12000), '')

    def test_removes_supported_video_duration_spellings(self):
        raw = (
            'Create a 30s cinematic video, then make a 30 second wide shot; '
            'use a 30-second ending and duration: 30 seconds. Keep 15 seconds '
            'and number 130 unchanged.'
        )
        result = remove_video_duration_mentions(raw)
        self.assertNotRegex(result, r'(?i)(?<!\w)(?:5|10|15|30)(?:\s*[-‐‑‒–—]\s*|\s+)?(?:s|secs?|seconds?|giây|秒(?:間)?)(?!\w)')
        self.assertNotIn('15 seconds', result)
        self.assertNotIn('10 giây', result)
        self.assertIn('130', result)
        self.assertNotIn('duration:', result)
        self.assertNotIn('; smooth', result)

    def test_removes_duration_before_sentence_punctuation(self):
        self.assertEqual(
            remove_video_duration_mentions('FINAL RULES Exactly 15 seconds. Horizontal 4:3.'),
            'FINAL RULES Exactly Horizontal 4:3.',
        )

    def test_video_prompt_preserves_duration_before_gateway_instruction(self):
        result = video_prompt(
            'Create a 30-second cinematic fantasy video lasting 30 seconds.',
            max_chars=12000,
        )
        self.assertIn('Create a 30-second cinematic fantasy video lasting 30 seconds.', result)
        self.assertNotIn(SINGLE_VIDEO_INSTRUCTION, result)

    def test_duration_cleanup_removes_15_seconds_and_vietnamese_giay(self):
        self.assertEqual(
            remove_video_duration_mentions('Generate 15 seconds of smooth motion for 10 giây.'),
            'Generate of smooth motion',
        )

    def test_legacy_alias_uses_same_cleanup(self):
        self.assertEqual(
            remove_unsupported_30s_mentions('Một cảnh liên tục 15 giây.'),
            'Một cảnh liên tục',
        )

    def test_removes_10_second_spellings(self):
        result = remove_video_duration_mentions(
            '10s, 10 s, 10 giây, 10 seconds, 10-second, 10-seconds.'
        )
        self.assertEqual(result, '')

    def test_removes_punctuation_attached_to_duration(self):
        for punctuation in ('.', ',', ';', ':', '!', '?'):
            with self.subTest(punctuation=punctuation):
                self.assertEqual(
                    remove_video_duration_mentions(f'Một cảnh 10s{punctuation}'),
                    'Một cảnh',
                )
