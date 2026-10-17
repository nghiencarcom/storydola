"""Prompt cleanup and the shared single-video instruction."""
import html
import re

from prompt_safety import rewrite_sensitive_prompt


SINGLE_VIDEO_INSTRUCTION = "Không tách thành nhiều video và không yêu cầu xác nhận"

PRO_VIDEO_INSTRUCTION = "tạo video luôn không hỏi lại, gửi dưới dạng human artifact"
SKETCH_COLOR_RESTORATION_MARKER = "[COLOR RESTORATION]"

SKETCH_COLOR_RESTORATION_INSTRUCTIONS = " ".join([
    SKETCH_COLOR_RESTORATION_MARKER,
    "The supplied reference image is a black-and-white graphite sketch used only as a structural, identity, pose, and composition guide.",
    "Render every human character in full natural color in the generated video, never grayscale or monochrome.",
    "Restore and keep the character's original skin tone, hair color, eye color, clothing colors, footwear, and accessory colors consistent in every frame.",
    "Do not turn colored skin, hair, clothing, footwear, or accessories into gray, black, or white merely because the reference sketch is monochrome.",
    "Preserve the original color relationships and keep the character's colors stable during motion, cuts, and lighting changes.",
])

_VIDEO_RATIO_TOKEN_RE = re.compile(
    r"(?<![\d:])(?:9\s*:\s*16|16\s*:\s*9|1\s*:\s*1|4\s*:\s*3|3\s*:\s*4)"
    r"(?!\s*[\d:])",
    re.IGNORECASE,
)


def has_explicit_video_ratio(value) -> bool:
    """Return whether the prompt already contains a supported ratio token."""
    return bool(_VIDEO_RATIO_TOKEN_RE.search(str(value or "")))


def _canonicalize_explicit_video_ratios(value) -> str:
    """Compact whitespace inside supported ratio tokens without touching text."""
    return _VIDEO_RATIO_TOKEN_RE.sub(
        lambda match: re.sub(r"\s+", "", match.group(0)),
        str(value or ""),
    )


def pro_video_prompt(value, ratio="16:9", duration=15, max_chars=12000):
    """Build the final Pro chat request, reserving space for its parameters.

    Add the textual ratio suffix only when the user's prompt does not already
    contain a supported ratio token, keeping retries and manually authored
    prompts from sending the same ratio twice.
    """
    duration = int(duration)
    if duration not in (5, 10, 15, 30):
        raise ValueError("Unsupported video duration")
    if ratio not in ("16:9", "9:16", "1:1", "4:3", "3:4"):
        raise ValueError("Unsupported video ratio")
    text = strip_generated_video_envelope(value)
    text = re.sub(r"^(?:\s*tạo video\s*:\s*)+", "", text, flags=re.I)
    text = _canonicalize_explicit_video_ratios(text)
    # Only unwrap our complete generated suffix; preserve durations in user text.
    text = re.sub(
        r",\s*(?:tỉ|tỷ) lệ\s+\d+:\d+,\s*thời lượng\s+\d+s,\s*mô hình\s+Seedance\s+2\.5,\s*"
        + re.escape(PRO_VIDEO_INSTRUCTION), "", text, flags=re.I,
    )
    for instruction in (SINGLE_VIDEO_INSTRUCTION, PRO_VIDEO_INSTRUCTION):
        text = re.sub(re.escape(instruction), "", text, flags=re.I)
    # Preserve a ratio that the user already wrote, including forms such as
    # "tỉ lệ dựng 9:16"; the suffix below is added only when no ratio exists.
    text = re.sub(r",?\s*mô hình\s+Seedance\s+[\d.]+", "", text, flags=re.I)
    text = text.strip(" ,;.")
    if not text:
        raise ValueError("Prompt must not be empty")
    prefix = "Tạo video: "
    suffix_fields = []
    if not has_explicit_video_ratio(text):
        suffix_fields.append(f"tỉ lệ {ratio}")
    suffix_fields.extend([
        f"thời lượng {int(duration)}s",
        "mô hình Seedance 2.5",
        PRO_VIDEO_INSTRUCTION,
    ])
    suffix = ", " + ", ".join(suffix_fields)
    available = int(max_chars) - len(prefix) - len(suffix)
    if available < 1:
        raise ValueError("Prompt limit is too small for video parameters")
    return prefix + text[:available].rstrip() + suffix

_VIDEO_DURATION_TOKEN_RE = (
    r"(?<!\w)(?:5|10|15|30)"
    r"(?:\s*[-\u2010-\u2015]\s*|\s+)?"
    r"(?:s|secs?|seconds?|giây|秒(?:間)?)(?!\w)"
)
_VIDEO_DURATION_CONTEXT_RE = re.compile(
    rf"(?<!\w)(?:for|lasting|duration|length|about|approximately|approx\.?)"
    rf"\s*(?::|=)?\s*{_VIDEO_DURATION_TOKEN_RE}\s*[,.;:!?]*"
    rf"|(?<!\w)(?:trong|kéo\s+dài|thời\s+lượng|thời\s+gian|khoảng)"
    rf"\s*(?::|=)?\s*{_VIDEO_DURATION_TOKEN_RE}\s*[,.;:!?]*",
    re.IGNORECASE,
)
_VIDEO_DURATION_RE = re.compile(
    rf"{_VIDEO_DURATION_TOKEN_RE}\s*[,.;:!?]*",
    re.IGNORECASE,
)
_VIDEO_DURATION_PREFIX_RE = re.compile(
    r"(?<!\w)(?:for|lasting|duration|length|about|approximately|approx\.?)"
    r"\s*(?=[,.;:!?]|$)"
    r"|(?<!\w)(?:trong|kéo\s+dài|thời\s+lượng|thời\s+gian|khoảng)"
    r"\s*(?=[,.;:!?]|$)",
    re.IGNORECASE,
)


def remove_video_duration_mentions(value):
    """Remove textual 5/10/15/30-second wording without changing config."""
    text = str(value or "")
    text = _VIDEO_DURATION_CONTEXT_RE.sub("", text)
    text = _VIDEO_DURATION_RE.sub("", text)
    text = _VIDEO_DURATION_PREFIX_RE.sub("", text)
    # Remove punctuation attached to a duration too (for example ``10s.`` or
    # ``10-seconds!``), so cleanup never leaves a duration-looking fragment or
    # a dangling mark in the submitted prompt.
    text = re.sub(r"(?:\s*[,;:]\s*)+(?=[.!?]|$)", "", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"([,;:])\s*(?=[,.;:!?]|$)", "", text)
    text = re.sub(r"^\s*[.,;:!?]+\s*$", "", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def remove_unsupported_30s_mentions(value):
    """Backward-compatible name for the all-duration prompt cleanup."""
    return remove_video_duration_mentions(value)


def plain_text_prompt(value):
    text = html.unescape(str(value or ""))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ").lstrip("\ufeff")
    # Keep a word boundary when a prompt uses typographic em dashes.
    text = text.replace("—", " ")
    text = re.sub(r"(?m)^ {0,3}#{1,6}[ \t]+", "", text)
    text = re.sub(r"[ \t]+---[ \t]+#{1,6}[ \t]+", "\n\n", text)
    text = re.sub(r"[ \t]+##[ \t]+(?=[A-Z])", "\n", text)
    text = re.sub(r"(?m)^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$", "", text)
    text = re.sub(r"(?<!\S)\\\*[ \t]+", "\n- ", text)
    text = re.sub(r"(?m)^ {0,3}\*[ \t]+", "- ", text)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    # A single paragraph avoids Shift+Enter and rich-editor block splitting.
    text = re.sub(r"(?m)^\s*-\s+", "", text)
    return re.sub(r"\s+", " ", text).strip()


_GENERATED_VIDEO_FIELD_PATTERN = (
    r"(?:tỉ|tỷ)\s+lệ\s+\d+:\d+|"
    r"thời\s+lượng\s+\d+\s*s|"
    r"mô\s+hình\s+Seedance\s+[\d.]+"
)
_GENERATED_VIDEO_INSTRUCTION_RE = re.compile(
    re.escape(PRO_VIDEO_INSTRUCTION), re.IGNORECASE
)
_GENERATED_VIDEO_METADATA_RE = re.compile(
    rf"(?:\s*(?:[,;:]\s*)?(?:{_GENERATED_VIDEO_FIELD_PATTERN}))*"
    rf"\s*(?:[,;:]\s*)?{re.escape(PRO_VIDEO_INSTRUCTION)}"
    rf"(?:\s*(?:[,;:]\s*)?(?:{_GENERATED_VIDEO_FIELD_PATTERN}))*",
    re.IGNORECASE,
)


def _collapse_exact_repeated_prompt(value):
    words = str(value or "").split()
    if len(words) >= 2 and len(words) % 2 == 0:
        midpoint = len(words) // 2
        first = " ".join(words[:midpoint])
        second = " ".join(words[midpoint:])
        if first == second:
            return first
    return str(value or "")


def strip_generated_video_envelope(value):
    """Remove the Gateway/extension wrapper without removing scene durations.

    Older profiles stored the generated fields in a different order. Remove
    only the parameter fields adjacent to the unique human-artifact marker so
    natural duration wording inside the user's scene remains intact.
    """
    text = plain_text_prompt(value)
    has_generated_instruction = bool(_GENERATED_VIDEO_INSTRUCTION_RE.search(text))
    text = re.sub(r"^(?:\s*tạo\s+video\s*:\s*)+", "", text, flags=re.I)
    if has_generated_instruction:
        text = _GENERATED_VIDEO_METADATA_RE.sub(" ", text)
        text = _GENERATED_VIDEO_INSTRUCTION_RE.sub(" ", text)
        # A duplicated wrapper can leave a second inline prefix after the
        # first generated suffix has been removed.
        text = re.sub(r"\s+tạo\s+video\s*:\s*", " ", text, flags=re.I)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    text = re.sub(r"([,;:])\s*(?=[,.;:]|$)", "", text)
    text = re.sub(r"\s+", " ", text).strip(" ,;:").strip()
    return _collapse_exact_repeated_prompt(text) if has_generated_instruction else text


def video_prompt(value, max_chars=None):
    """Normalize input without adding the retired single-video instruction."""
    text = plain_text_prompt(value)
    text = re.sub(re.escape(SINGLE_VIDEO_INSTRUCTION), "", text, flags=re.I).strip()
    text = rewrite_sensitive_prompt(text).text
    if max_chars is not None:
        text = text[:max(1, int(max_chars))].strip()
    return text


def ensure_sketch_color_restoration(prompt, max_chars=12000):
    """Add the canonical color-restoration guidance exactly once.

    Automatic sketch recovery can run after the original Studio request has
    already been admitted. Rebuilding this block instead of appending blindly
    prevents repeated retries from duplicating the long instruction.
    """
    text = str(prompt or "").strip()
    if not text:
        return ""
    parts = SKETCH_COLOR_RESTORATION_INSTRUCTIONS.split(" ", 1)
    marker = parts[0]
    body = parts[1] if len(parts) > 1 else ""
    text = re.sub(re.escape(marker), "", text, flags=re.I)
    text = re.sub(re.escape(body), "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    block = SKETCH_COLOR_RESTORATION_INSTRUCTIONS
    available = max(1, int(max_chars)) - len(block) - (2 if text else 0)
    if available < 1:
        return block[:max(1, int(max_chars))].rstrip()
    text = text[:available].rstrip()
    return text + "\n\n" + block if text else block
