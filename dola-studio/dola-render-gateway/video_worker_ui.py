"""Video generation worker v2: UI automation with OpenCV slider puzzle solver."""
import asyncio
import base64
import hashlib
import inspect
import json
import mimetypes
import random
import re
import sys
import time
from datetime import datetime, time as dt_time, timedelta, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4
from zoneinfo import ZoneInfo

import aiohttp
from patchright.async_api import async_playwright

from gap import find_gap_x

import config
from prompt_format import video_prompt, pro_video_prompt
from prompt_safety import rewrite_sensitive_prompt, safe_rewrite_summary
from browser import (
    _page_has_google_login_button,
    _page_has_login_button,
    _page_has_logged_out_marker,
    cookie_value,
    has_dola_session,
    launch_account_context,
)
from dola_client import (
    CREDIT_COST_EXCEEDED_PATTERN,
    CREDIT_FAIL_PATTERN,
    ROLLING_VIDEO_LIMIT_PATTERN,
)
from video_worker import (
    POLL_JS,
    PostSubmitRateLimitError,
    RateLimitError,
    RiskControlError,
    VideoValidationError,
    _download_video_source,
    extract_unwatermarked_url,
    is_rate_limit_response,
    provider_response_texts,
    validate_video_output,
)

# Require an explicit quota-reached statement. Generic mentions such as
# "daily limit" and "0 credits left today" also occur in prompts and normal
# accepted-generation replies; neither means Dola rejected this conversation.
SEVEN_DAY_FREE_LIMIT_PATTERN = re.compile(
    r"\b(?:you['’]ve|you\s+have)\s+reached\s+the\s+7\s*[-–—]\s*day\s+free\s+limit\b",
    re.IGNORECASE,
)
FAST_MODE_FALLBACK_MESSAGE = (
    "Dola đã hết lượt tạo video Pro trong 7 ngày; đang chuyển sang Fast để gửi lại prompt."
)
# Dola may mount Settings controls well after the chat shell appears, especially
# on newly added profiles. Give the modal controls time to hydrate before
# rotating the profile or attempting to type into the composer.
SETTINGS_BUTTON_WAIT_MS = 30000
SETTINGS_MODAL_BUTTON_WAIT_MS = 30000
SETTINGS_MODAL_CLOSE_WAIT_MS = 15000
DAILY_LIMIT_PATTERN = re.compile(
    rf"(?:{ROLLING_VIDEO_LIMIT_PATTERN.pattern})|"
    r"(?:\b(?:daily|per[- ]day)\s+(?:video\s+)?(?:generation\s+)?(?:limit|quota)\b"
    r"[\s\S]{0,100}\b(?:(?:has|have)\s+been\s+)?(?:reached|exceeded|exhausted|hit)\b)|"
    r"(?:\b(?:reached|exceeded|exhausted|hit)\b[\s\S]{0,100}"
    r"\b(?:daily|per[- ]day)\s+(?:video\s+)?(?:generation\s+)?(?:limit|quota)\b)|"
    r"動画生成の\s*1日あたりの上限[\s\S]{0,40}(?:到達|達し|超え)|"
    r"(?:每日|每天)(?:视频|影片)?生成.{0,50}(?:上限|限额|额度).{0,30}(?:已达|达到|超出|用完)|"
    r"(?:上限|限额|额度).{0,40}(?:每日|每天)(?:视频|影片)?生成.{0,30}(?:已达|达到|超出|用完)|"
    r"(?:đã\s+đạt|đã\s+vượt|đã\s+hết).{0,80}(?:giới\s+hạn|hạn\s+mức).{0,50}(?:video|tạo\s+video|ngày|hôm\s+nay)|"
    r"(?:giới\s+hạn|hạn\s+mức).{0,80}(?:video|tạo\s+video).{0,50}(?:đã\s+đạt|đã\s+vượt|hết)",
    re.IGNORECASE,
)
VIDEO_LIMIT_MESSAGE = "Tài khoản Dola đã đạt giới hạn tạo video theo chu kỳ (ngày/7 ngày)"


def _is_seven_day_free_limit(value) -> bool:
    """Recognize Dola's explicit 7-day Pro limit that offers Fast mode."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(
        SEVEN_DAY_FREE_LIMIT_PATTERN.search(raw)
        or FAST_MODE_FALLBACK_MESSAGE in raw
    )

# If the in-page chain request is temporarily unavailable, use the completed
# assistant SSE capture and the active chat DOM as independent response paths.
# The DOM fallback is needed for Dola's doc_editor UI, which has no stable role
# attributes; the caller removes the submitted prompt before classification.
VISIBLE_PROVIDER_TEXT_JS = r"""
({conversationId = "", asMessages = false} = {}) => {
  // Poll recovery always navigates to the task's chat. During first submission
  // Dola may keep the generic /chat URL, so only reject a different explicit
  // conversation route.
  const activeConversation = String(location.pathname || "").match(/\/chat\/([^/]+)/)?.[1] || "";
  if (conversationId && activeConversation && activeConversation !== conversationId) return "";
  const capture = window.__dolaRenderConversationCapture || {};
  const captureIsFinal = capture.streamComplete === true ||
    (Array.isArray(capture.errors) && capture.errors.some(item =>
      String(item).startsWith('provider_busy_response:')));
  const capturedText = captureIsFinal ? String(capture.assistantText || "").trim() : "";
  const combine = values => [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
    .join("\n").slice(-50000);
  const selectors = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[data-author="assistant"]',
  ];
  const results = [];
  const seen = new Set();
  let foundAssistantNode = false;
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      foundAssistantNode = true;
      const status = String(element.getAttribute("data-status") ||
        element.getAttribute("data-state") || "").toLowerCase().replace(/-/g, "_");
      const text = String(element.innerText || element.textContent || "").trim();
      if (["thinking", "streaming", "generating", "pending", "processing",
           "running", "in_progress", "in progress", "unfinished"].includes(status)) continue;
      if (text && !seen.has(text)) {
        seen.add(text);
        results.push(text);
      }
    }
  }
  if (foundAssistantNode) {
    const messages = [...new Set([capturedText, ...results.slice(-20)]
      .map(value => String(value || "").trim()).filter(Boolean))].slice(-20);
    return asMessages ? messages : combine(messages).slice(-20000);
  }

  // Dola's current doc_editor chat UI does not expose the assistant-role
  // attributes above. Keep a same-conversation fallback so a visible provider
  // refusal/overload is not mistaken for an indefinitely running render.
  const root = document.querySelector("main") || document.body;
  const fallback = combine([capturedText, root?.innerText || root?.textContent || ""]);
  return asMessages ? (fallback ? [fallback] : []) : fallback;
}
"""

# Some Dola builds render the finished clip in the chat player but return no
# video creation block from /im/chain/single. Recover a direct HTTP(S) source
# from the matching assistant chat node as a last resort.
VISIBLE_PROVIDER_VIDEO_URLS_JS = r"""
({conversationId = ""} = {}) => {
  const activeConversation = String(location.pathname || "").match(/\/chat\/([^/]+)/)?.[1] || "";
  if (conversationId && activeConversation && activeConversation !== conversationId) return [];
  const assistantSelector = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[data-author="assistant"]',
  ].join(",");
  const userSelector = [
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '[data-author="user"]',
  ].join(",");
  const assistantNodes = [...document.querySelectorAll(assistantSelector)];
  const root = document.querySelector("main") || document.body;
  const candidates = [];
  const add = value => {
    const url = String(value || "").trim();
    if (/^https?:\/\//i.test(url) && !candidates.includes(url)) candidates.push(url);
  };
  const videos = assistantNodes.length
    ? assistantNodes.flatMap(node => [...node.querySelectorAll("video")])
    : [...(root?.querySelectorAll("video") || [])];
  for (const video of videos) {
    if (video.closest(userSelector)) continue;
    add(video.currentSrc);
    add(video.getAttribute("src"));
    for (const source of video.querySelectorAll("source[src]")) add(source.getAttribute("src"));
  }
  for (const link of root?.querySelectorAll('a[href]') || []) {
    if (link.closest(userSelector)) continue;
    if (/\.mp4(?:[?#]|$)/i.test(link.href)) add(link.href);
  }
  return candidates.slice(0, 4);
}
""";

# On recovery, distinguish a confirmation that was actually submitted from a
# draft that was persisted just before an interrupted/blocked Enter press.
DURATION_CONFIRMATION_VISIBLE_JS = r"""
message => {
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const expected = normalize(message);
  if (!expected) return false;
  const userNodes = [...document.querySelectorAll(
    '[data-message-author-role="user"], [data-role="user"], [data-author="user"]'
  )];
  if (userNodes.length) {
    return userNodes.some(node => normalize(node.innerText || node.textContent).includes(expected));
  }
  const root = document.querySelector("main") || document.body;
  const editorTexts = [...document.querySelectorAll(
    'textarea, input, [contenteditable="true"]'
  )].map(node => normalize(node.value || node.innerText || node.textContent));
  if (editorTexts.some(value => value.includes(expected))) return false;
  return normalize(root?.innerText || root?.textContent).includes(expected);
}
""";


def _visible_text_without_prompt(value, prompt_text: str | None = None) -> str:
    """Remove the submitted prompt before classifying a visible Dola reply.

    The body-text fallback is needed for Dola's doc_editor UI, whose assistant
    messages currently lack the role attributes used by the preferred path.
    Excluding the exact task prompt prevents its wording from triggering a
    provider error classification.
    """
    if isinstance(value, bytes):
        raw = value.decode("utf-8", "replace")
    elif isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    text = re.sub(r"\s+", " ", raw).strip()
    prompt = re.sub(r"\s+", " ", str(prompt_text or "")).strip()
    if prompt:
        text = text.replace(prompt, " ").strip()
    return text

# Dola can return a normal 200 response and put a duration capability mismatch,
# transient error, or policy/content rejection in the conversation text.
# Without this terminal check, the worker waits for the full poll timeout even
# though the provider will never return a video.
DURATION_CAPABILITY_PATTERN = re.compile(
    r"(?:video\s+generation\s+)?currently\s+supports?\s+durations?\s+from\s*"
    r"4\s*(?:to|[-–—])\s*15\s*(?:seconds?|s)\b|"
    r"(?:supports?|hỗ\s+trợ|giới\s+hạn).{0,120}"
    r"(?:durations?|thời\s+lượng).{0,120}"
    r"4\s*(?:to|đến|[-–—])\s*15\s*(?:seconds?|giây|s)?\b|"
    r"(?:durations?|thời\s+lượng).{0,80}"
    r"(?:from|between|từ|trong\s+khoảng|ở|là)?\s*"
    r"4\s*(?:to|đến|[-–—])\s*15\s*(?:seconds?|giây|s)?\b",
    re.IGNORECASE,
)
DURATION_NEAREST_PATTERN = re.compile(
    r"(?:nearest|closest)(?:\s+supported)?\s+duration\s+"
    r"(?:of|is)?\s*(\d{1,2})\s*(?:seconds?|s)\b|"
    r"thời\s+lượng(?:\s+(?:gần\s+nhất|được\s+hỗ\s+trợ\s+gần\s+nhất))?"
    r"\s*(?:là|ở|:)?\s*(\d{1,2})\s*(?:giây|s)\b",
    re.IGNORECASE,
)
DURATION_CAPABILITY_MESSAGE = (
    "Dola phản hồi chat hiện tại chỉ hỗ trợ thời lượng 4–15 giây và đang chờ xác nhận thời lượng."
)
CREDIT_COST_EXCEEDED_PREFIX = "Dola không đủ credit cho bộ tham số"

SEEDANCE_WORKER_IMAGE_REQUEST_EVENT = "studio-relay:worker-image-attach-request:v1"
SEEDANCE_WORKER_IMAGE_RESPONSE_EVENT = "studio-relay:worker-image-attach-response:v1"
SEEDANCE_WORKER_PROMPT_REQUEST_EVENT = "studio-relay:worker-prompt-fill-request:v1"
SEEDANCE_WORKER_PROMPT_RESPONSE_EVENT = "studio-relay:worker-prompt-fill-response:v1"
SEEDANCE_MAIN_IMAGE_REQUEST_EVENT = "studio-relay:image-attach-request:v2"
SEEDANCE_MAIN_IMAGE_RESPONSE_EVENT = "studio-relay:image-attach-response:v2"
SEEDANCE_IMAGE_BRIDGE_TIMEOUT_MS = 7000
SEEDANCE_IMAGE_UPLOAD_CONFIRM_TIMEOUT_SECONDS = 120
SEEDANCE_IMAGE_NO_SIGNAL_TIMEOUT_SECONDS = 20
SEEDANCE_PROMPT_BRIDGE_TIMEOUT_MS = 12000
SEEDANCE_PROMPT_BRIDGE_REPEAT_MS = 350
SEEDANCE_PROMPT_BRIDGE_ATTEMPTS = 2
SEEDANCE_IMAGE_BRIDGE_TIMEOUT_ERROR = "__seedance_image_bridge_timeout__"
SEEDANCE_PROMPT_BRIDGE_TIMEOUT_ERROR = "__seedance_prompt_bridge_timeout__"
SEEDANCE_MAX_IMAGE_BYTES = 25 * 1024 * 1024
SEEDANCE_IMAGE_MIME_TYPES = {
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}


def _extension_requires_legacy_handshake() -> bool:
    """Return whether the configured extension exposes the old Dola30 runtime.

    The GitHub ``dola30`` extension uses ``service-worker.js`` plus a debugger
    handshake. SeedancePro intentionally runs without ``chrome.debugger`` and
    uses ``background.js``/DOM controls instead, so waiting for the legacy
    handshake would reject an otherwise correctly loaded extension.
    """
    extension_dir = Path(config.EXTENSION_DIR)
    if not extension_dir.is_absolute():
        extension_dir = Path(__file__).resolve().parent / extension_dir
    return (extension_dir / "service-worker.js").is_file()


def _credit_cost_error_message(value) -> str:
    """Explain Dola's pre-render credit gate without exposing the full prompt."""
    raw = str(value or "")
    match = CREDIT_COST_EXCEEDED_PATTERN.search(raw)
    if match:
        return (
            f"{CREDIT_COST_EXCEEDED_PREFIX}: cần {match.group('required')} credit "
            f"nhưng tài khoản chỉ còn {match.group('available')} credit hôm nay; "
            "đã dừng trước khi chờ render."
        )
    return f"{CREDIT_COST_EXCEEDED_PREFIX}; đã dừng trước khi chờ render."


def _is_credit_cost_exceeded_error(value) -> bool:
    """Recognize Dola's explicit cost-vs-balance rejection."""
    raw = str(value or "")
    return bool(
        CREDIT_COST_EXCEEDED_PATTERN.search(raw)
        or raw.startswith(CREDIT_COST_EXCEEDED_PREFIX)
    )


SOMETHING_WENT_WRONG_PATTERN = re.compile(
    r"something\s+went\s+wrong\s*[.!…-]*\s*please\s+try\s+again",
    re.IGNORECASE,
)
SOMETHING_WENT_WRONG_MESSAGE = (
    "Dola phản hồi lỗi tạm thời ‘Something went wrong’; chưa tạo video."
)
PROVIDER_EMPTY_TASK_ID_PATTERN = re.compile(
    r"\btask[\s_-]*id\s*(?:(?:is|was)\s*)?(?:=|:)?\s*(?:empty|blank|missing|trống|rỗng)\b",
    re.IGNORECASE,
)
PROVIDER_SAFE_CONTENT_CONFIRMATION_PATTERN = re.compile(
    r"không\s+phải\s+do\s+(?:yêu\s+cầu|prompt)\s+của\s+bạn"
    r"|(?:nội\s+dung|yêu\s+cầu)(?:\s+bạn\s+yêu\s+cầu)?[\s\S]{0,180}"
    r"\b(?:phù\s+hợp|an\s+toàn)\b"
    r"|\b(?:your\s+)?(?:request|prompt|content)\b[\s\S]{0,160}"
    r"\b(?:safe|appropriate)\b",
    re.IGNORECASE,
)
PROVIDER_RETRY_STEP_PATTERN = re.compile(
    r"(?:tôi\s+(?:sẽ\s+)?thử|đang\s+thử|thử\s+(?:lại|lần\s+cuối)|"
    r"i\s+(?:will\s+)?try|trying)\b[\s\S]{0,180}"
    r"(?:image\s*[-–]?\s*to\s*[-–]?\s*video|"
    r"text\s*[-–]?\s*to\s*[-–]?\s*video|seedance|prompt|profile|account|chat|mô\s+hình)",
    re.IGNORECASE,
)
PROVIDER_FINAL_RESULT_PATTERN = re.compile(
    r"rất\s+tiếc|sorry|unfortunately|đã\s+thử\s+(?:nhiều\s+cách|hết\s+các\s+nhánh)|"
    r"tried\s+(?:all\s+branches|every\s+(?:route|path))|"
    r"task[\s_-]*id\s*(?:(?:is|was)\s*)?(?:=|:)?\s*(?:empty|blank|missing|trống|rỗng)|"
    r"không\s+phải\s+do\s+(?:yêu\s+cầu|prompt)\s+của\s+bạn|"
    r"(?:technical|system)\s+(?:issue|error|failure)|lỗi\s+kỹ\s+thuật\s+nghiêm\s+trọng|"
    r"(?:yêu\s+cầu|request)[\s\S]{0,100}tạm\s+thời\s+bị\s+từ\s+chối|"
    r"để\s+có\s+(?:được\s+)?video[\s\S]{0,300}"
    r"bạn\s+chọn\s+(?:hướng|phương\s+án)\s+nào|"
    r"to\s+get\s+(?:the\s+)?video[\s\S]{0,300}"
    r"which\s+(?:direction|option|approach)\s+"
    r"(?:would\s+you\s+(?:like|choose)|do\s+you\s+choose)|"
    r"request[\s\S]{0,100}temporarily\s+(?:rejected|declined)[\s\S]{0,100}"
    r"(?:cannot\s+be\s+retried|cannot\s+retry)|"
    r"(?:i|we)[\s\S]{0,100}(?:cannot|can't|can’t|unable\s+to)"
    r"[\s\S]{0,100}(?:final\s+)?video[\s\S]{0,100}"
    r"(?:for|according\s+to)\s+(?:this|the|your)\s+(?:request|prompt)|"
    r"hệ\s+thống[\s\S]{0,100}chặn[\s\S]{0,80}tạo\s+nội\s+dung|"
    r"(?:the\s+)?system[\s\S]{0,100}(?:blocked|has\s+blocked|prohibited)"
    r"[\s\S]{0,80}(?:the\s+)?content\s+generation|"
    r"(?:does\s+not\s+allow|doesn't\s+allow|disallows|will\s+not\s+allow|"
    r"does\s+not\s+permit|prohibits|forbids)[\s\S]{0,30}"
    r"(?:a\s+|another\s+|any\s+)?retr(?:y|ies|ying)|"
    r"không\s+(?:thể|được\s+phép|cho\s+phép)\s+thử\s+lại",
    re.IGNORECASE,
)

# Some profiles/locales return a plain assistant response instead of an SSE
# error object. It means the accepted conversation has no usable output; the
# Gateway may safely discard it and start one fresh conversation.
CANNOT_ANSWER_QUESTION_PATTERN = re.compile(
    r"\bi\s+can(?:not|'t|’t)\s+answer\s+(?:your|the)\s+question\b"
    r"|\bi am temporarily unable to generate the (?:video\s+)?content you requested\b"
    r"|\bthe image-to-video generation system has declined this particular request\b"
    r"|\bthe requested video generation cannot be performed temporarily\b"
    r"|\bconfirmation(?:\s+round)?\s+is\s+required\b[\s\S]{0,240}\b(?:before\s+proceeding|video\s+generation|creative[-\s]?video)\b"
    r"|(?:tôi|chúng tôi)\s+tạm\s+thời\s+không\s+thể\s+tạo\s+"
    r"(?:nội\s+dung\s+(?:bạn\s+(?:vừa\s+)?)?yêu\s+cầu|"
    r"được\s+(?:nội\s+dung\s+)?video\s+(?:bạn\s+)?yêu\s+cầu)\b"
    r"|(?:tôi|chúng tôi)\s+hiện(?:\s+tại)?\s+không\s+thể\s+tạo\s+"
    r"(?:nội\s+dung\s+(?:video\s+)?(?:bạn\s+)?yêu\s+cầu|"
    r"(?:được\s+)?(?:nội\s+dung\s+)?video\s+(?:bạn\s+)?yêu\s+cầu)\b"
    r"|(?:tôi|chúng tôi)\s+(?:hiện(?:\s+tại)?\s+)?(?:tạm\s+thời\s+)?"
    r"(?:không\s+thể|chưa\s+thể)\s+(?:tạo|xuất)\s+(?:được\s+)?"
    r"(?:video(?:\s+cuối)?|clip)"
    r"(?:\s+(?:theo|cho)\s+(?:đúng\s+)?(?:yêu\s+cầu|request)(?:\s+này)?)?"
    r"|(?:yêu\s+cầu|request)[\s\S]{0,100}"
    r"(?:tạm\s+thời\s+bị\s+từ\s+chối|temporarily\s+rejected)"
    r"[\s\S]{0,100}(?:không\s+thể\s+thử\s+lại|cannot\s+be\s+retried|cannot\s+retry)"
    r"|(?:sorry[\s,!…]*)?(?:i|we)\s+(?:(?:currently|temporarily|at\s+the\s+moment)\s+)?"
    r"(?:cannot|can't|can’t)(?:\s+(?:currently|temporarily|at\s+the\s+moment))?\s+"
    r"(?:create|generate|produce|export|output|render)\s+(?:the\s+)?"
    r"(?:final\s+)?video\b[\s\S]{0,180}"
    r"\b(?:for|according\s+to)\s+(?:this|the|your)\s+(?:request|prompt)\b"
    r"|(?:sorry[\s,!…]*)?(?:i|we)\s+(?:am|are)\s+"
    r"(?:(?:currently|temporarily|at\s+the\s+moment)\s+)?unable\s+to\s+"
    r"(?:create|generate|produce|export|output|render)\s+(?:the\s+)?"
    r"(?:final\s+)?video\b[\s\S]{0,180}"
    r"\b(?:for|according\s+to)\s+(?:this|the|your)\s+(?:request|prompt)\b"
    r"|(?:hiện(?:\s+tại)?\s+)?(?:tôi|chúng tôi)\s+(?:chưa|không)\s+"
    r"(?:thể\s+)?tạo\s+(?:được\s+)?(?:video|clip)\b",
    re.IGNORECASE,
)
# These plain no-video responses are recoverable on another profile. Keep this
# narrower than CONTENT_POLICY_REJECTION_PATTERN: an explicit content block
# must be classified first and must never be bypassed by profile rotation.
PROFILE_ROTATION_NO_VIDEO_PATTERN = re.compile(
    r"(?:rất\s+tiếc\s*[,!…]?\s*)?(?:tôi|chúng\s+tôi)\s+"
    r"(?:(?:hiện(?:\s+tại)?|tạm\s+thời)\s+)?"
    r"(?:không\s+thể|chưa\s+thể)\s+tạo\s+(?:được\s+)?"
    r"video\s+(?:bạn\s+)?yêu\s+cầu\b"
    r"|(?:rất\s+tiếc\s*[,!…]?\s*)?(?:tôi|chúng\s+tôi)\s+"
    r"(?:(?:hiện(?:\s+tại)?|tạm\s+thời)\s+)?"
    r"(?:không\s+thể|chưa\s+thể)\s+(?:tạo|xuất)\s+(?:được\s+)?"
    r"video(?:\s+cuối)?\s+(?:theo|cho)\s+(?:đúng\s+)?"
    r"(?:yêu\s+cầu|request)(?:\s+này)?"
    r"|(?:sorry\s*[,!…]?\s*)?(?:i|we)\s+"
    r"(?:(?:am|are)\s+)?(?:(?:currently|temporarily|at\s+the\s+moment)\s+)?"
    r"(?:cannot|can't|can’t|unable\s+to|not\s+able\s+to)\s+"
    r"(?:generate|create|produce|make)\s+(?:the\s+)?"
    r"(?:requested\s+)?(?:video|content)\s+(?:you\s+)?requested\b"
    r"|(?:i|we)\s+am\s+temporarily\s+unable\s+to\s+generate\s+"
    r"(?:the\s+)?(?:video\s+)?content\s+you\s+requested\b"
    r"|(?:rất\s+tiếc\s*[,!…]?\s*)?"
    r"(?:i(?:\s+am|'m|’m)|we(?:\s+are|'re|’re)|i|we)\s+"
    r"(?:(?:currently|temporarily|at\s+the\s+moment)\s+)?"
    r"(?:cannot|can't|can’t|not\s+able\s+to|unable\s+to)\s+"
    r"(?:(?:currently|temporarily|at\s+the\s+moment)\s+)?"
    r"(?:create|generate|produce|export|output|render)\s+(?:the\s+)?"
    r"(?:final\s+)?video\s+(?:for|according\s+to)\s+"
    r"(?:this|the|your)\s+(?:request|prompt)"
    r"|để\s+có\s+(?:được\s+)?video[\s\S]{0,280}"
    r"chọn\s+một\s+trong\s+(?:các\s+)?(?:hướng|phương\s+án)"
    r"[\s\S]{0,220}bạn\s+chọn\s+(?:hướng|phương\s+án)\s+nào"
    r"|to\s+get\s+(?:the\s+)?video[\s\S]{0,280}"
    r"choose\s+one\s+of\s+(?:the\s+)?(?:following|these)\s+"
    r"(?:directions|options|approaches)[\s\S]{0,220}"
    r"which\s+(?:direction|option|approach)\s+"
    r"(?:would\s+you\s+(?:like|choose)|do\s+you\s+choose)"
    r"|(?:yêu\s+cầu|request)[\s\S]{0,100}"
    r"(?:tạm\s+thời\s+bị\s+từ\s+chối|temporarily\s+(?:rejected|declined))"
    r"[\s\S]{0,100}"
    r"(?:không\s+thể\s+thử\s+lại|cannot\s+be\s+retried|cannot\s+retry)\b",
    re.IGNORECASE,
)
PROFILE_ROTATION_PROMPT_ADJUSTMENT_PATTERN = re.compile(
    r"để\s+(?:tôi|chúng\s+tôi)\s+tạo\s+(?:được\s+)?video[\s\S]{0,260}"
    r"(?:bạn\s+có\s+thể\s+)?chọn\s+một\s+trong\s+(?:các\s+)?(?:hướng|phương\s+án)"
    r"[\s\S]{0,220}bạn\s+muốn\s+tôi\s+thử\s+lại\s+theo\s+(?:hướng|phương\s+án)\s+nào",
    re.IGNORECASE,
)
NO_VIDEO_CREATION_RESPONSE_PATTERN = re.compile(
    r"\b(?:(?:i|we|dola|the\s+system)\s+)?"
    r"(?:can(?:not|'t|’t)|could\s+not|couldn't|unable\s+to|not\s+able\s+to)\s+"
    r"(?:create|generate|make|produce)\s+"
    r"(?:(?:a|the|this|your|requested)\s+)?videos?\b"
    r"|\b(?:the\s+)?videos?\s+"
    r"(?:(?:can|could)\s+not|can't|cannot|couldn't)\s+be\s+"
    r"(?:created|generated|made|produced)\b"
    r"|(?:không\s+thể\s+(?:tạo\s+)?(?:video|clip)|"
    r"không\s+tạo\s+được\s+(?:video|clip))\b",
    re.IGNORECASE,
)
NO_VIDEO_QUOTA_CONTEXT_PATTERN = re.compile(
    r"\b(?:insufficient|not\s+enough|out\s+of|short\s+of)\s+"
    r"(?:(?:video)\s+)?credits?\b|"
    r"\binsufficient\s+(?:video\s+)?quota\b|"
    r"\bcredits?\s+(?:are\s+)?(?:insufficient|exhausted|depleted)\b|"
    r"\b(?:no|zero)\s+(?:(?:video)\s+)?credits?\s+(?:left|remaining)\b|"
    r"\bcredits?\s+(?:left|remaining)\b|"
    r"\b(?:daily|weekly)\s+(?:video\s+)?(?:limit|quota)\b|"
    r"\bquota\s+(?:is\s+)?(?:exceeded|exhausted|reached)\b|"
    r"\bbalance\s+(?:is\s+)?(?:too\s+low|insufficient)\b",
    re.IGNORECASE,
)
VIDEO_GENERATION_CONFIRMATION_PATTERN = re.compile(
    r"bạn\s+có\s+xác\s+nhận\b[\s\S]{0,240}"
    r"\bbắt\s+đầu\s+tạo\s+video\b[\s\S]{0,160}\bkhông"
    r"|xác\s+nhận\s+để\s+dola\s+tự\s+tạo\s+video\b",
    re.IGNORECASE,
)
CANNOT_ANSWER_QUESTION_MESSAGE = (
    "Dola chưa tạo được video cho yêu cầu này; đang tạo lại bằng chat mới."
)
PROFILE_ROTATION_NO_VIDEO_MESSAGE = (
    "Dola từ chối tạo video chung chung; đang chuyển sang profile khác để tạo lại."
)

# Policy refusals can arrive as an ordinary assistant message instead of an
# SSE error. They must not be left in the accepted-conversation polling path:
# there will be no video to download. A safe rewrite is attempted in one fresh
# chat when the original prompt contains one of the supported risky patterns.
CONTENT_POLICY_REJECTION_PATTERN = re.compile(
    r"(?:không phù hợp|không được phép)\s+(?:với\s+)?(?:tiêu chuẩn|chính sách)\s+nội dung"
    r"|(?:tiêu chuẩn|chính sách)\s+nội dung\s+(?:cho phép|được phép)"
    r"|(?:nội dung|yêu cầu)[\s\S]{0,100}\bbị\s+hệ thống\s+chặn(?:\s+tạm thời)?"
    r"|hệ thống\s+(?:an toàn\s+)?nội dung\s+(?:đã\s+)?tạm thời\s+chặn"
    r"[\s\S]{0,120}(?:việc\s+)?(?:tạo video|yêu cầu|nội dung|cảnh)"
    r"|\bvideo\s+generation\s+request\s+was\s+blocked\s+by\s+the\s+content\s+safety\s+filter\b"
    r"|hệ\s+thống\s+đã\s+chặn\s+(?:yêu\s+cầu|nội\s+dung)(?:\s+này)?"
    r"|hệ\s+thống[\s\S]{0,100}chặn[\s\S]{0,80}tạo\s+nội\s+dung"
    r"|(?:the\s+)?system[\s\S]{0,100}(?:blocked|has\s+blocked|prohibited)"
    r"[\s\S]{0,80}(?:the\s+)?content\s+generation"
    r"[\s\S]{0,100}(?:does\s+not\s+allow|doesn't\s+allow|disallows|"
    r"will\s+not\s+allow|does\s+not\s+permit|prohibits|forbids)[\s\S]{0,30}"
    r"(?:a\s+|another\s+|any\s+)?retr(?:y|ies|ying)"
    r"|không\s+cho\s+phép\s+thử\s+lại"
    r"|không\s+được\s+phép\s+thử\s+lại(?:\s+với\s+cùng\s+yêu\s+cầu)?"
    r"|yêu\s+cầu\s+tạo\s+video\b[\s\S]{0,120}"
    r"\b(?:bị\s+)?hệ\s+thống\s+chặn\s+tạo\s+nội\s+dung"
    r"|(?:đã\s+)?bị\s+chặn\b[\s\S]{0,100}\b(?:chính\s+sách|bộ\s+lọc|lọc\s+an\s+toàn|an\s+toàn\s+nội\s+dung)\b"
    r"|(?:đã\s+)?bị\s+chặn\s+(?:bởi\s+)?(?:chính\s+sách\s+(?:an\s+toàn\s+)?nội\s+dung|(?:bộ\s+lọc\s+)?(?:an\s+toàn\s+)?nội\s+dung)"
    r"|(?:tôi|chúng tôi)\s+tạm\s+thời\s+không\s+thể\s+tạo\s+"
    r"(?:nội\s+dung\s+)?video\s+(?:bạn\s+)?yêu\s+cầu"
    r"|\b(?:content|safety)\s+(?:standards?|policy)\b[\s\S]{0,160}"
    r"\b(?:not appropriate|not allowed|violation|declined)\b"
    r"|\bsystem\s+(?:prohibits|does not permit|doesn't permit|forbids)\s+"
    r"content\s+generation\b"
    r"|\b(?:content generation|requested video creation)\b[\s\S]{0,120}"
    r"\b(?:is\s+)?(?:prohibited|not permitted|cannot be fulfilled|"
    r"unable to be fulfilled)\b"
    r"|\bthe\s+system\s+has\s+prohibited\s+(?:the\s+)?video\s+generation\b"
    r"|\b(?:request|video|content)\b[\s\S]{0,200}\bblocked\b[\s\S]{0,100}\b(?:safety|content)\s+(?:filter|policy)\b"
    r"|\b(?:safety|content)\s+(?:filter|policy)\b[\s\S]{0,200}\b(?:blocked|rejected|prohibited|not\s+allowed)\b"
    r"|\b(?:cannot|can't|will\s+not|won't|does\s+not)\s+(?:be\s+)?retry\b[\s\S]{0,100}\b(?:same|identical)\s+(?:request|prompt)\b"
    r"|\b(?:request|content)\b[\s\S]{0,200}\b"
    r"(?:cannot be fulfilled|is prohibited|is not permitted)\b",
    re.IGNORECASE,
)
CONTENT_POLICY_NO_RETRY_PATTERN = re.compile(
    r"(?:không thể|không được phép|không cho phép)\s+thử lại"
    r"[\s\S]{0,80}\b(?:yêu cầu|prompt)(?:\s+(?:này|đó))?(?:\s+nữa)?"
    r"|hệ\s+thống[\s\S]{0,100}chặn[\s\S]{0,80}tạo\s+nội\s+dung"
    r"[\s\S]{0,100}không\s+cho\s+phép\s+thử\s+lại"
    r"|(?:the\s+)?system[\s\S]{0,100}(?:blocked|has\s+blocked|prohibited)"
    r"[\s\S]{0,80}(?:the\s+)?content\s+generation"
    r"[\s\S]{0,100}(?:does\s+not\s+allow|doesn't\s+allow|disallows|"
    r"will\s+not\s+allow|does\s+not\s+permit|prohibits|forbids)[\s\S]{0,30}"
    r"(?:a\s+|another\s+|any\s+)?retr(?:y|ies|ying)"
    r"|\b(?:cannot|can't|will not|won't)\s+retry"
    r"[\s\S]{0,80}\b(?:same\s+)?(?:request|prompt)\b",
    re.IGNORECASE,
)
CONTENT_POLICY_SCENE_BLOCK_PATTERN = re.compile(
    r"cả\s+hai\s+kênh[\s\S]{0,500}(?:đều\s+)?bị\s+hệ\s+thống\s+chặn"
    r"[\s\S]{0,180}(?:nội\s+dung|cảnh)"
    r"|\bboth\b[\s\S]{0,250}\bchannels?\b[\s\S]{0,250}"
    r"\bblocked\b[\s\S]{0,200}\b(?:content|scene)\b",
    re.IGNORECASE,
)
CONTENT_POLICY_SCENE_NO_RETRY_PATTERN = re.compile(
    r"không\s+cho\s+phép\s+thử\s+lại\s+(?:ngay|lúc\s+này|hiện\s+tại)"
    r"|\b(?:does\s+not|doesn't|will\s+not|won't)\s+allow\s+"
    r"(?:(?:an?\s+)?immediate\s+)?retr(?:y|ies|ying)"
    r"(?:\s+(?:right\s+)?(?:now|immediately|yet))?\b"
    r"|\b(?:not\s+allowed|not\s+permitted)\s+to\s+retry"
    r"(?:\s+(?:right\s+)?(?:now|immediately|yet))?\b"
    r"|\bretrying\s+(?:right\s+)?(?:now|immediately)\s+"
    r"(?:is\s+)?not\s+(?:currently\s+)?allowed\b",
    re.IGNORECASE,
)
CONTENT_POLICY_REJECTION_MESSAGE = (
    "Dola từ chối nội dung nhạy cảm; Gateway sẽ viết lại prompt an toàn bằng chat mới."
)
CONTENT_POLICY_NO_RETRY_MESSAGE = (
    "Dola đã chặn yêu cầu theo chính sách và xác nhận không thể thử lại nội dung này. "
    "Hãy điều chỉnh prompt hoặc ảnh tham chiếu rồi gửi lại."
)
CONTENT_POLICY_FINAL_MESSAGE = (
    "Dola vẫn từ chối prompt hoặc ảnh tham chiếu sau khi Gateway đã thử viết lại "
    "theo hướng an toàn; đã dừng để tránh lặp cùng một yêu cầu."
)

# Dola sometimes answers a single-video request by describing its internal
# two-video/15-second segmentation workflow. This is an instruction response,
# not a completed video. Ask once in the same conversation for one output and
# never send the same correction repeatedly.
MULTI_VIDEO_SEGMENT_PATTERN = re.compile(
    r"only\s+two\s+videos?\s+can\s+be\s+generated\s+at\s+a\s+time"
    r"[\s\S]{0,600}?"
    r"(?:first\s+15[-\s]?second\s+segment|remaining\s+segments?|"
    r"subsequent\s+rounds?)",
    re.IGNORECASE,
)
SINGLE_VIDEO_INSTRUCTION = (
    "Please create exactly one video only. Do not create multiple videos or "
    "split this request into separate segments. Keep the current settings, "
    "prompt, and reference images."
)
SINGLE_VIDEO_RETRY_MESSAGE = (
    "Dola vẫn yêu cầu chia thành nhiều video sau khi đã yêu cầu chỉ tạo một video duy nhất."
)

LIKENESS_REJECTION_PATTERN = re.compile(
    r"likeness\s+protection|only\s+supports\s+generating\s+videos\s+featuring\s+yourself|肖像保護",
    re.IGNORECASE,
)
LIKENESS_REJECTION_MESSAGE = (
    "Nhân vật trong hình ảnh bị Dola từ chối do chính sách bảo vệ danh tính. "
    "Hãy dùng ảnh khác hoặc tạo video từ văn bản."
)

PROVIDER_REJECTION_PATTERN = re.compile(
    r"video\s+generation\s+currently\s+supports\s+durations?\s+from\s+4\s*(?:to|[-–—])\s*15\s+seconds?|"
    r"something\s+went\s+wrong\s*[.!…-]*\s*please\s+try\s+again|"
    r"肖像保護|別の画像を使用|テキストから動画を作成|"
    r"ご希望のコンテンツを生成できません|他の内容をお試しください|"
    r"i\s+can(?:not|'t|’t)\s+generate\s+(?:the\s+)?requested\s+content|"
    r"i\s+can(?:not|'t|’t)\s+generate\s+(?:the\s+)?video[.!\s]*no\s+credits?\s+were\s+used|"
    r"content\s+policy|policy\s+(?:violation|rejected)|"
    r"(?:image|prompt|content).*(?:policy|violation|rejected|not\s+allowed)|"
    r"(?:画像|内容|プロンプト|ポリシー).*(?:生成|制作).*(?:できません|不可|拒否)|"
    r"(?:生成|制作).*(?:禁止|拒否)|"
    r"(?:无法|不能).*(?:生成|制作).*(?:政策|内容|图片|图像)|"
    r"(?:生成|制作).*(?:失败|失敗|拒绝).*(?:内容|图片|图像|政策)",
    re.IGNORECASE,
)

# The provider sometimes emits a normal SSE response with no numeric error
# code when the account or region is temporarily overloaded. Treating this
# as an ordinary assistant message makes the poller wait the entire render
# window and hides the actionable retry reason.
PROVIDER_BUSY_PATTERN = re.compile(
    r"high\s+demand|try\s+again\s+later|temporarily\s+(?:busy|unavailable)|quá\s+tải|"
    r"(?:系统|服務|服务).*(?:繁忙|忙碌|过载|過載)|"
    r"(?:稍后|稍後).*(?:重试|再试|再試)|"
    r"しばらく.*(?:お待ち|後で)|混雑",
    re.IGNORECASE,
)

DOLA_RISK_CONTROL_PATTERN = re.compile(
    r"710022004|shark_admin|risk[\s_-]*control|anti[\s_-]*bot|"
    r"captcha|verification challenge",
    re.IGNORECASE,
)


class AccountLimitedError(Exception):
    """Account reached daily video generation limit."""


class CreditInsufficientError(Exception):
    """Insufficient points prior to generation."""


class SeedanceImageBridgeUnavailableError(RuntimeError):
    """SeedancePro's MAIN-world image bridge is not present on this tab."""


class SeedanceImageBridgeError(RuntimeError):
    """SeedancePro's MAIN-world bridge rejected an image attachment."""


class SeedancePromptBridgeUnavailableError(RuntimeError):
    """SeedancePro's prompt bridge is not present on this tab."""


class SeedancePromptBridgeError(RuntimeError):
    """SeedancePro's prompt bridge rejected a prompt injection."""


class _SkipReferenceUploadAttempt(Exception):
    """Leave the event-listener scope before handling a retryable upload error."""


class SessionExpiredError(RuntimeError):
    """Persistent browser profile no longer has an authenticated Dola session."""


class PreSubmitSessionExpiredError(SessionExpiredError):
    """Login UI before transmission: allow one Gmail relogin on this profile."""

    retry_same_profile = True


class PreSubmitRiskControlError(RiskControlError):
    """Dola risk-control response before a conversation is accepted.

    This subtype tells the pool that Dola rejected the pre-submit request
    (logout/login wall, anti-bot challenge, or a rate-limit response) without
    returning a durable conversation. The pool can mark only this profile and
    safely try the next one. Errors after a conversation is accepted continue
    using the generic ``RiskControlError`` path so the task is never duplicated.
    """


class PreSubmitSetupError(RuntimeError):
    """Composer controls failed before the prompt was submitted.

    Model, ratio and duration selectors are rendered after the composer and
    image previews settle. A transient missing control is safe to retry on
    another profile because no prompt or provider conversation exists yet.
    """


class PreSubmitPromptSetupError(PreSubmitSetupError):
    """Prompt setup failed after the task may already own attachments."""


class PreSubmitAttachmentSetupError(PreSubmitSetupError):
    """The composer still contains a previous task's reference attachments.

    This is recoverable only on the same persistent profile. Rotating after
    the current profile has received the image manifest replays those files
    into another persistent composer and is the source of the ``1 image ->
    many images`` failure mode.
    """


class SubmissionAuthExpiredError(PreSubmitRiskControlError):
    """Dola logged out while acknowledging a request with no conversation id.

    Keep the historical class name for callers that import it, but classify
    the event as account-level risk control. No provider conversation was
    observed after the ACK grace period, so the pool can safely try the next
    profile instead of reopening Gmail in the profile that was logged out.
    """

    retry_same_profile = False


class RenderStillProcessingError(TimeoutError):
    """The conversation exists, but Dola has not returned a video yet."""


class PostSubmitCreditError(RuntimeError):
    """Provider reported a credit error after the prompt was accepted."""


class PostSubmitAccountLimitError(RuntimeError):
    """Provider reported a daily limit after the prompt was accepted."""


class ProviderGenerationRejectedError(RuntimeError):
    """Dola accepted the conversation but rejected the generation request."""


class ImageLikenessRejectedError(ProviderGenerationRejectedError):
    failure_code = "IMAGE_LIKENESS_REJECTED"


class FreshChatRetryError(ProviderGenerationRejectedError):
    """Dola produced no usable video and the task can retry in a new chat."""


class FastModeFallbackError(FreshChatRetryError):
    """The 7-day Pro allowance is exhausted and this task can retry in Fast."""

    failure_code = "FAST_MODE_FALLBACK"


class ProviderBusyError(FreshChatRetryError):
    """Dola was temporarily overloaded after accepting a chat.

    Provider overload is recoverable at the task level. It must not be treated
    as a global risk-control event, otherwise one busy response pauses every
    queued video request for the full risk cooldown window.
    """

    failure_code = "PROVIDER_BUSY"


def _submission_error_exception(error_message: str, *, conversation_accepted: bool):
    """Route explicit provider overload to task-local profile rotation.

    Dola may return an overload error and a conversation ACK in the same
    streamed response. The overload response is a known no-video outcome and
    has its own bounded retry policy; it must not be promoted to a shared
    risk-control cooldown merely because an ACK was also observed.
    """
    if _is_seven_day_free_limit(error_message):
        return FastModeFallbackError(FAST_MODE_FALLBACK_MESSAGE)
    if _is_provider_task_id_empty_technical_error(error_message):
        return ProviderTaskIdEmptyError(error_message)
    if error_message == CONTENT_POLICY_NO_RETRY_MESSAGE:
        return ContentPolicyFinalRefusalError(error_message)
    if error_message == CONTENT_POLICY_REJECTION_MESSAGE:
        return ContentPolicyRejectedError(error_message)
    if error_message == PROFILE_ROTATION_NO_VIDEO_MESSAGE:
        return ProfileRotationRetryError(error_message)
    if error_message == CANNOT_ANSWER_QUESTION_MESSAGE:
        return CannotAnswerQuestionError(error_message)
    if is_rate_limit_response(error_message):
        if conversation_accepted:
            return PostSubmitRateLimitError(error_message)
        return RateLimitError(error_message)
    if PROVIDER_BUSY_PATTERN.search(str(error_message or "")):
        return ProviderBusyError(error_message)
    if conversation_accepted:
        return RiskControlError(error_message)
    return PreSubmitRiskControlError(error_message)


class DurationCapabilityMismatchError(FreshChatRetryError):
    """Dola accepted no usable video because this chat exposed only 4–15s.

    The provider has not produced a video for this request. This is kept
    separate from normal content moderation refusals so callers can classify
    the provider response explicitly without changing the task duration.
    """

    failure_code = "DURATION_CAPABILITY_MISMATCH"


class SomethingWentWrongError(FreshChatRetryError):
    """Dola returned its generic transient error without creating a video."""


class CannotAnswerQuestionError(FreshChatRetryError):
    """Dola returned its no-video ``I can't answer your question`` response."""

    failure_code = "PROVIDER_CANNOT_ANSWER"


class ProfileRotationRetryError(CannotAnswerQuestionError):
    """Dola gave a generic no-video response; retry once on another profile."""

    failure_code = "PROVIDER_NO_VIDEO_PROFILE_RETRY"


class NoVideoCreationError(FreshChatRetryError):
    """Dola explicitly said it could not create a video for the accepted chat."""

    failure_code = "PROVIDER_NO_VIDEO"


class ProviderTaskIdEmptyError(FreshChatRetryError):
    """Dola/backend returned no task id, so this conversation cannot render."""

    failure_code = "PROVIDER_TASK_ID_EMPTY"


class ContentPolicyRejectedError(FreshChatRetryError):
    """Dola refused the accepted conversation under its content standards."""

    failure_code = "CONTENT_POLICY_REJECTED"


class ContentPolicyFinalRefusalError(ContentPolicyRejectedError):
    """Dola explicitly disallowed another attempt at the refused request."""


class SingleVideoOnlyError(FreshChatRetryError):
    """Dola continued asking for segmented output after one correction."""


class PromptPayloadError(RuntimeError):
    """The browser request did not contain a recoverable full prompt."""


class ReferenceImageUploadTimeoutError(TimeoutError):
    """Dola did not confirm all reference images in the current composer."""


class ConversationIdTimeoutError(TimeoutError):
    """Dola accepted the browser request but did not expose its conversation id."""


# Dola changes this label with the profile locale. Keep the Japanese label
# for existing profiles and accept the English/Chinese variants observed in
# Chromium so a locale change cannot turn into a false submit timeout.
VIDEO_ENTRY_SELECTORS = (
    "text=動画を作成",
    "text=Create Videos",
    "text=Create Video",
    "text=创建视频",
    "text=生成视频",
    "text=视频生成",
)
CAPTCHA_FRAME_KEY = "bdcaptcha.html"   # Captcha verifycenter iframe

# Dola changes the visible labels with the account locale. Keep the
# automation keyed by the value shown in the action bar, but accept the
# Japanese, Chinese and English variants observed in the browser UI. A missing
# requested item is terminal for this profile; continuing would leave Dola's
# default (usually 10s) in the request.
_DURATION_LABEL_RE = re.compile(
    r"^\s*(?P<seconds>5|10|15)\s*(?:s|sec(?:ond)?s?|秒(?:間)?)\s*$",
    re.IGNORECASE,
)
_DURATION_SELECTOR = (
    'button, [role="button"], [role="option"], [role="menuitem"], '
    '[role="radio"], [data-value], [data-option-key]'
)


def _canonical_model_key(model: str) -> str:
    """Normalise public model aliases to the values Dola expects."""
    value = str(model or "").strip().lower().replace("-", "_")
    if value in {"seedance_2.0", "seedance_v2.0", "seedance_20", "seedance_v20"}:
        return "seedance_v2.0"
    if value in {"seedance_2.5", "seedance_v2.5", "seedance_25", "seedance_v25"}:
        return "seedance_v2.5"
    raise ValueError("Chỉ hỗ trợ Seedance 2.0 hoặc Seedance 2.5")


def _coerce_duration(value):
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number in (5, 10, 15, 30) else None


def _normalise_model_value(value) -> str:
    return str(value or "").strip().lower().replace("-", "_")


def _model_value_matches(expected: str, actual) -> bool:
    """Allow Dola's standard/fast suffix while keeping the model family exact."""
    expected_key = _normalise_model_value(expected)
    actual_key = _normalise_model_value(actual)
    if not expected_key or not actual_key:
        return False
    if expected_key == "seedance_v2.5":
        return actual_key in {
            "seedance_v2.5",
            "seedance_2.5",
            "seedance_v2.5_fast",
            "seedance_2.5_fast",
            "seedance_v2.5_std",
            "seedance_2.5_std",
        }
    if expected_key == "seedance_v2.0":
        return actual_key in {
            "seedance_v2.0",
            "seedance_2.0",
            "seedance_v2.0_fast",
            "seedance_2.0_fast",
            "seedance_v2.0_std",
            "seedance_2.0_std",
            "seedance_v2.0_mini",
            "seedance_2.0_mini",
        }
    return False


async def _wait_for_prompt_editor(page, timeout: int = 60000):
    """Find Dola's active visible prompt editor without a fixed sleep.

    Uploading a reference can leave the old ProseMirror node mounted for a
    short time while Dola inserts a new composer node. Picking the first
    visible textarea/contenteditable made the extension write to one node and
    the Gateway verify another. Score the same bottom-most chat editor the
    SeedancePro content script uses, so post-upload verification follows the
    node that Dola will submit.
    """
    deadline = time.monotonic() + max(1, timeout) / 1000
    selectors = ('[contenteditable="true"]', "textarea", '[role="textbox"]')
    next_auth_check = 0.0
    while time.monotonic() < deadline:
        if time.monotonic() >= next_auth_check:
            # The logout page can keep the video-entry label visible briefly
            # while replacing the composer. Detect it here so the pool marks
            # the profile as risk-control instead of reporting a generic
            # prompt-editor timeout and losing the reason for rotation.
            try:
                logged_out = await _page_has_logged_out_marker(page)
            except Exception:
                logged_out = False
            if logged_out:
                try:
                    page_context = getattr(page, "context", None)
                    cookies = (
                        await page_context.cookies("https://www.dola.com")
                        if page_context is not None
                        else []
                    )
                except Exception:
                    cookies = []
                if has_dola_session(cookies):
                    raise PreSubmitRiskControlError(
                        "Dola hiển thị màn hình đăng nhập khi mở composer; cookie "
                        "vẫn còn nên profile được đánh dấu risk-control"
                    )
                raise PreSubmitRiskControlError(
                    "Dola đã logout khi mở composer; profile được đánh dấu "
                    "risk-control và sẽ đổi profile"
                )
            next_auth_check = time.monotonic() + 1
        candidates = []
        order = 0
        for selector in selectors:
            try:
                locator = page.locator(selector)
                count = await locator.count()
            except Exception:
                continue
            for index in range(count):
                candidate = locator.nth(index)
                try:
                    if not await candidate.is_visible():
                        continue
                    metadata = await candidate.evaluate(
                        """element => {
                            const rect = element.getBoundingClientRect();
                            const style = getComputedStyle(element);
                            const identity = [
                                element.getAttribute('placeholder'),
                                element.getAttribute('data-placeholder'),
                                element.getAttribute('aria-label'),
                                element.getAttribute('data-testid'),
                                String(element.className || '')
                            ].filter(Boolean).join(' ').toLowerCase();
                            return {
                                tag: element.tagName.toLowerCase(),
                                contenteditable: element.getAttribute('contenteditable') === 'true',
                                width: rect.width,
                                height: rect.height,
                                top: rect.top,
                                bottom: rect.bottom,
                                viewportHeight: window.innerHeight,
                                identity,
                                inChrome: Boolean(element.closest(
                                    'header, nav, aside, [class*="sidebar" i]'
                                )) || style.display === 'none'
                            };
                        }"""
                    )
                except Exception:
                    metadata = None
                if not isinstance(metadata, dict):
                    order += 1
                    continue
                if metadata.get("inChrome"):
                    order += 1
                    continue
                try:
                    width = float(metadata.get("width") or 0)
                    height = float(metadata.get("height") or 0)
                    top = float(metadata.get("top") or 0)
                    bottom = float(metadata.get("bottom") or 0)
                    viewport_height = float(metadata.get("viewportHeight") or 0)
                except (TypeError, ValueError):
                    order += 1
                    continue
                if width <= 0 or height <= 0:
                    order += 1
                    continue
                identity = str(metadata.get("identity") or "")
                score = order
                if metadata.get("tag") == "textarea":
                    score += 20
                if metadata.get("contenteditable"):
                    score += 40
                if re.search(r"prompt|describe|message|action|video|nhập|mô tả", identity, re.I):
                    score += 100
                if viewport_height and bottom >= viewport_height * 0.45:
                    score += 30
                if width >= 320:
                    score += 20
                candidates.append((score, bottom, order, candidate))
                order += 1
        if candidates:
            candidates.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
            return candidates[0][3]
        await page.wait_for_timeout(100)
    raise TimeoutError("Không tìm thấy ô nhập prompt trên Dola")


async def _wait_for_extension_ready(page, timeout: int = 60000) -> None:
    """Read attachment state from the legacy Dola30 service worker."""
    deadline = time.monotonic() + max(1, timeout) / 1000
    while time.monotonic() < deadline:
        try:
            ready = False
            for worker in page.context.service_workers:
                if not worker.url.startswith("chrome-extension://"):
                    continue
                ready = await worker.evaluate(
                    """async url => {
                        if (typeof attachedTabs === 'undefined') return false;
                        if (typeof createThirtySecondOption !== 'function'
                            || createThirtySecondOption([]).option_key !== '30') return false;
                        const tabs = await chrome.tabs.query({});
                        return tabs.some(tab => tab.url === url && attachedTabs.has(tab.id));
                    }""", page.url
                )
                if ready:
                    break
        except Exception:
            ready = False
        if ready is True:
            return
        await page.wait_for_timeout(100)
    raise PreSubmitSetupError(
        f"Extension gốc 30s chưa được xác minh sau {max(1, timeout) / 1000:.0f} giây; đóng/mở lại profile để nạp bản hiện tại; "
        "chưa gửi yêu cầu tạo video"
    )


def _is_pre_submit_navigation_timeout(error) -> bool:
    """Recognize a browser navigation timeout before Dola owns the task.

    Patchright raises its own timeout/error object for ``page.goto`` and the
    exception does not inherit Python's built-in ``TimeoutError`` on every
    driver version. Matching only the stable navigation message lets the pool
    rotate before any prompt or provider conversation exists.
    """
    text = str(error or "").casefold()
    return (
        ("page.goto" in text or "page.reload" in text)
        and ("err_proxy_connection_failed" in text
             or "err_tunnel_connection_failed" in text
             or "err_timed_out" in text or "timed out" in text
             or "err_aborted" in text or "frame was detached" in text
             or ("timeout" in text and "exceeded" in text))
    )


def _is_page_or_browser_closed(error) -> bool:
    """Do not hide a closed-browser error behind a New Chat timeout."""
    text = str(error or "").casefold()
    return (
        "target page, context or browser has been closed" in text
        or "target page or browser has been closed" in text
        or "browsercontext.close: connection closed" in text
    )


async def _reload_before_submit(page):
    """Retry an interrupted navigation once, never a sent video request."""
    for attempt in range(2):
        try:
            return await page.reload(timeout=90000, wait_until="domcontentloaded")
        except Exception as error:
            if not _is_pre_submit_navigation_timeout(error):
                raise
            if attempt:
                raise PreSubmitSetupError(
                    f"Không tải lại được trang trước khi nhập prompt: {str(error).splitlines()[0]}"
                ) from error
            await page.wait_for_timeout(750)


async def _goto_dola_chat(page, url: str = "https://www.dola.com/chat"):
    """Navigate to Dola and turn pre-submit network timeouts into rotations."""
    try:
        return await page.goto(url, timeout=90000, wait_until="domcontentloaded")
    except Exception as error:
        if _is_pre_submit_navigation_timeout(error):
            raise PreSubmitSetupError(
                "Dola không tải được trang chat trước khi gửi prompt; "
                f"đang đổi profile để thử lại ({str(error).splitlines()[0]})"
            ) from error
        raise


async def _wait_for_default_mode_setting(page, timeout_ms: int):
    """Prefer Dola's current setting label and accept its previous label."""
    selectors = (
        'xpath=//div[text()="Set Default Mode"]',
        'xpath=//div[text()="Default Mode for New Chats"]',
    )
    deadline = time.monotonic() + max(1, int(timeout_ms)) / 1000
    while time.monotonic() < deadline:
        for selector in selectors:
            try:
                locator = page.locator(selector)
                for index in range(await locator.count()):
                    candidate = locator.nth(index)
                    if await candidate.is_visible():
                        return candidate
            except Exception:
                continue
        await page.wait_for_timeout(100)
    raise TimeoutError(
        "Dola Settings did not show Set Default Mode or Default Mode for New Chats"
    )


async def _set_default_chat_mode(
    page, mode: str = "Pro", account: str = "profile"
) -> None:
    """Set Dola's default model for new chats from its Settings modal."""
    mode = " ".join(str(mode or "Pro").split()).title()
    if mode not in {"Fast", "Pro"}:
        raise ValueError("Dola default chat mode must be Fast or Pro")
    settings_button = page.locator('xpath=//button[@aria-label="Settings"]')
    mode_indicator = page.locator(f'xpath=//span[text()="{mode}"]')
    mode_option = page.locator(f'xpath=//span[text()="{mode}"]')
    close_button = page.locator(
        'xpath=//div[@data-testid="setting-modal-close"]'
    )
    modal_open = False

    try:
        # A profile may have left the Settings modal open from a prior visit.
        # Reuse it instead of clicking the obscured header button.
        modal_open = await close_button.is_visible()
        if not modal_open:
            await settings_button.wait_for(
                state="visible", timeout=SETTINGS_BUTTON_WAIT_MS
            )
            try:
                await settings_button.click(timeout=SETTINGS_BUTTON_WAIT_MS)
                modal_open = True
            except Exception as click_error:
                # If a previous visit left the modal open but its close button
                # had not mounted yet, the header click can be intercepted.
                # Wait for the modal control before treating this as a setup
                # failure; otherwise preserve the original click error.
                try:
                    await close_button.wait_for(
                        state="visible", timeout=SETTINGS_MODAL_BUTTON_WAIT_MS
                    )
                    modal_open = True
                except Exception:
                    raise click_error

        # Wait for the modal itself to finish mounting before checking any of
        # its controls. A slow settings panel must not be mistaken for a
        # missing close button or a failed profile.
        await close_button.wait_for(
            state="visible", timeout=SETTINGS_MODAL_BUTTON_WAIT_MS
        )
        already_selected = False
        for index in range(await mode_indicator.count()):
            if await mode_indicator.nth(index).is_visible():
                already_selected = True
                break
        if not already_selected:
            default_mode = await _wait_for_default_mode_setting(
                page, timeout_ms=SETTINGS_MODAL_BUTTON_WAIT_MS
            )
            await default_mode.click(timeout=SETTINGS_MODAL_BUTTON_WAIT_MS)
            await mode_option.wait_for(
                state="visible", timeout=SETTINGS_MODAL_BUTTON_WAIT_MS
            )
            await mode_option.click(timeout=SETTINGS_MODAL_BUTTON_WAIT_MS)
            await page.wait_for_timeout(250)
            await mode_indicator.wait_for(
                state="visible", timeout=SETTINGS_MODAL_BUTTON_WAIT_MS
            )
        await close_button.click(timeout=SETTINGS_MODAL_BUTTON_WAIT_MS)
        await close_button.wait_for(
            state="hidden", timeout=SETTINGS_MODAL_CLOSE_WAIT_MS
        )
        action = (
            f"default mode already {mode}"
            if already_selected
            else f"default mode for new chats set to {mode}"
        )
        print(f"[{account}] Dola {action}", flush=True)
    except Exception as error:
        if modal_open:
            try:
                await close_button.wait_for(
                    state="visible", timeout=SETTINGS_MODAL_BUTTON_WAIT_MS
                )
                await close_button.click(timeout=SETTINGS_MODAL_BUTTON_WAIT_MS)
                await close_button.wait_for(
                    state="hidden", timeout=SETTINGS_MODAL_CLOSE_WAIT_MS
                )
            except Exception:
                pass
        raise PreSubmitSetupError(
            f"{account} không đặt được Default Mode for New Chats thành {mode} "
            f"trong Settings: {str(error).splitlines()[0]}"
        ) from error


def _is_dola_chat_url(url: str) -> bool:
    """Accept only Dola's chat/composer routes before using page-wide controls."""
    try:
        parsed = urlparse(str(url or ""))
    except Exception:
        return False
    host = str(parsed.hostname or "").casefold()
    path = str(parsed.path or "/").rstrip("/") or "/"
    return host in {"dola.com", "www.dola.com"} and bool(
        re.fullmatch(r"/chat(?:/\d+)?", path)
    )


_ACCOUNT_SETTINGS_MODAL_STATE_JS = r"""() => {
  const visible = node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0;
  };
  const roots = Array.from(document.querySelectorAll(
    '[role="dialog"], [aria-modal="true"], dialog[open], '
    + '[data-radix-dialog-content], [data-slot*="dialog"]'
  )).filter(visible);
  const hasSettings = /\bsettings?\b|cài\s*đặt|设置|設定/i;
  const hasAccount = /\baccount\b|\bprofile\b|\bemail\b|\bsubscription\b|tài\s*khoản|hồ\s*sơ|账户|账号|アカウント/i;
  const explicitAccountSettings = /\b(?:account|profile)\s+settings?\b|\bsettings?\s+(?:for\s+)?(?:your\s+)?(?:account|profile)\b|cài\s*đặt\s*(?:tài\s*khoản|hồ\s*sơ)|(?:tài\s*khoản|hồ\s*sơ)\s*cài\s*đặt|账户设置|账号设置|アカウント設定/i;
  let root = roots.find(node => {
    const text = `${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`
      .replace(/\s+/g, ' ').trim().slice(0, 12000);
    return explicitAccountSettings.test(text)
      || (hasSettings.test(text) && hasAccount.test(text));
  });
  if (!root) {
    const settingClose = Array.from(document.querySelectorAll(
      '[data-testid="setting-modal-close"]'
    )).find(visible);
    const candidates = settingClose ? [
      settingClose.closest(
        '[role="dialog"], [aria-modal="true"], dialog[open], '
        + '[data-radix-dialog-content], [data-slot*="dialog"]'
      ),
      settingClose.parentElement,
      settingClose.parentElement && settingClose.parentElement.parentElement,
    ].filter(Boolean) : [];
    root = candidates.find(node => {
      if (!visible(node)) return false;
      const text = `${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`
        .replace(/\s+/g, ' ').trim().slice(0, 12000);
      return explicitAccountSettings.test(text)
        || (hasSettings.test(text) && hasAccount.test(text));
    }) || null;
  }
  if (!root) return {open: false, closeAvailable: false};
  const closeLabels = /^(?:close(?: dialog)?|dismiss|đóng|×|✕|x|閉じる|关闭|關閉)$/i;
  const settingClose = root.querySelector('[data-testid="setting-modal-close"]');
  const closeButton = (settingClose && visible(settingClose) ? settingClose : null)
    || Array.from(root.querySelectorAll('button, [role="button"], [data-testid*="close" i]')).find(button => {
    if (!visible(button)) return false;
    const labels = [button.getAttribute('aria-label'), button.getAttribute('title'),
      button.innerText, button.textContent].filter(Boolean).map(value => value.trim());
    return labels.some(label => closeLabels.test(label));
  });
  return {open: true, closeAvailable: Boolean(closeButton)};
}"""

# These variants let Playwright wait for a close button that Dola mounts after
# the dialog shell. They deliberately derive from the same detector so the
# polling and final verification recognize exactly the same dialog variants.
_ACCOUNT_SETTINGS_MODAL_CLOSE_READY_JS = (
    _ACCOUNT_SETTINGS_MODAL_STATE_JS
    .replace("return {open: false, closeAvailable: false};", "return false;")
    .replace(
        "return {open: true, closeAvailable: Boolean(closeButton)};",
        "return Boolean(closeButton);",
    )
)
_ACCOUNT_SETTINGS_MODAL_CLOSED_JS = (
    _ACCOUNT_SETTINGS_MODAL_STATE_JS
    .replace("return {open: false, closeAvailable: false};", "return true;")
    .replace(
        "return {open: true, closeAvailable: Boolean(closeButton)};",
        "return false;",
    )
)

_CLOSE_ACCOUNT_SETTINGS_MODAL_JS = r"""() => {
  const visible = node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0;
  };
  const roots = Array.from(document.querySelectorAll(
    '[role="dialog"], [aria-modal="true"], dialog[open], '
    + '[data-radix-dialog-content], [data-slot*="dialog"]'
  )).filter(visible);
  const hasSettings = /\bsettings?\b|cài\s*đặt|设置|設定/i;
  const hasAccount = /\baccount\b|\bprofile\b|\bemail\b|\bsubscription\b|tài\s*khoản|hồ\s*sơ|账户|账号|アカウント/i;
  const explicitAccountSettings = /\b(?:account|profile)\s+settings?\b|\bsettings?\s+(?:for\s+)?(?:your\s+)?(?:account|profile)\b|cài\s*đặt\s*(?:tài\s*khoản|hồ\s*sơ)|(?:tài\s*khoản|hồ\s*sơ)\s*cài\s*đặt|账户设置|账号设置|アカウント設定/i;
  let root = roots.find(node => {
    const text = `${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`
      .replace(/\s+/g, ' ').trim().slice(0, 12000);
    return explicitAccountSettings.test(text)
      || (hasSettings.test(text) && hasAccount.test(text));
  });
  if (!root) {
    const settingClose = Array.from(document.querySelectorAll(
      '[data-testid="setting-modal-close"]'
    )).find(visible);
    const candidates = settingClose ? [
      settingClose.closest(
        '[role="dialog"], [aria-modal="true"], dialog[open], '
        + '[data-radix-dialog-content], [data-slot*="dialog"]'
      ),
      settingClose.parentElement,
      settingClose.parentElement && settingClose.parentElement.parentElement,
    ].filter(Boolean) : [];
    root = candidates.find(node => {
      if (!visible(node)) return false;
      const text = `${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`
        .replace(/\s+/g, ' ').trim().slice(0, 12000);
      return explicitAccountSettings.test(text)
        || (hasSettings.test(text) && hasAccount.test(text));
    }) || null;
  }
  if (!root) return false;
  const closeLabels = /^(?:close(?: dialog)?|dismiss|đóng|×|✕|x|閉じる|关闭|關閉)$/i;
  const settingClose = root.querySelector('[data-testid="setting-modal-close"]');
  const closeButton = (settingClose && visible(settingClose) ? settingClose : null)
    || Array.from(root.querySelectorAll('button, [role="button"], [data-testid*="close" i]')).find(button => {
    if (!visible(button)) return false;
    const labels = [button.getAttribute('aria-label'), button.getAttribute('title'),
      button.innerText, button.textContent].filter(Boolean).map(value => value.trim());
    return labels.some(label => closeLabels.test(label));
  });
  if (!closeButton) return false;
  closeButton.click();
  return true;
}"""


async def _dismiss_account_settings_modal(page, account: str = "profile") -> bool:
    """Close a Dola account-settings dialog before using chat controls."""
    try:
        state = await page.evaluate(_ACCOUNT_SETTINGS_MODAL_STATE_JS)
    except Exception:
        return False
    if not isinstance(state, dict) or not state.get("open"):
        return False

    print(
        f"[{account}] Dola đang mở modal cài đặt tài khoản; đóng trước khi chọn mode",
        flush=True,
    )
    # The dialog shell can be visible before its close control is mounted.
    # Wait for the control, click it, then wait for the dialog to disappear.
    # This prevents the worker from treating a slow modal as an uncloseable one.
    try:
        await page.wait_for_function(
            _ACCOUNT_SETTINGS_MODAL_CLOSE_READY_JS,
            timeout=SETTINGS_MODAL_BUTTON_WAIT_MS,
            polling=250,
        )
        closed = await page.evaluate(_CLOSE_ACCOUNT_SETTINGS_MODAL_JS)
        if closed:
            await page.wait_for_function(
                _ACCOUNT_SETTINGS_MODAL_CLOSED_JS,
                timeout=SETTINGS_MODAL_CLOSE_WAIT_MS,
                polling=250,
            )
            return True
    except Exception:
        pass

    # Escape is a bounded fallback for Dola dialog variants without a labeled
    # close button. Never click outside the modal, which could hit account UI.
    try:
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(250)
        await page.wait_for_function(
            _ACCOUNT_SETTINGS_MODAL_CLOSED_JS,
            timeout=SETTINGS_MODAL_CLOSE_WAIT_MS,
            polling=250,
        )
        state = {"open": False}
    except Exception:
        state = {"open": True}
    if not isinstance(state, dict) or not state.get("open"):
        return True
    raise PreSubmitSetupError(
        f"{account} Dola đang mở modal cài đặt tài khoản nhưng không đóng được; "
        "đã dừng trước khi chọn mode hoặc nhập prompt"
    )


async def _ensure_dola_chat_route(
    page, context, account: str, *, default_mode: str = "Pro"
) -> None:
    """Recover one Dola redirect and set the requested default chat mode.

    Persistent profiles can reopen on a settings/account page. Return to /chat,
    set the account's default mode using the current Settings control, then let
    the caller explicitly select the per-task mode in the composer.
    """
    if _is_dola_chat_url(page.url):
        await _set_default_chat_mode(page, default_mode, account)
        return

    previous_path = urlparse(str(page.url or "")).path or "/"
    print(
        f"[{account}] Dola opened {previous_path} instead of the chat composer; "
        "reopening /chat before selecting controls",
        flush=True,
    )
    await _goto_dola_chat(page)
    await page.wait_for_timeout(350)
    if _is_dola_chat_url(page.url):
        await _set_default_chat_mode(page, default_mode, account)
        return

    cookies = await context.cookies("https://www.dola.com")
    session_present = has_dola_session(cookies)
    login_ui = (
        await _page_has_logged_out_marker(page)
        or await _page_has_login_button(page)
        or await _page_has_google_login_button(page)
    )
    if login_ui and session_present:
        raise PreSubmitRiskControlError(
            f"{account} Dola hiển thị màn hình đăng nhập sau khi mở /chat "
            "dù session cookie vẫn còn"
        )
    if not session_present or login_ui:
        raise PreSubmitSessionExpiredError(
            f"{account} Dola yêu cầu đăng nhập lại sau khi mở /chat"
        )
    current_path = urlparse(str(page.url or "")).path or "/"
    raise PreSubmitSetupError(
        f"{account} Dola chuyển tới {current_path} thay vì /chat; "
        "đã dừng trước khi nhập prompt hoặc click cài đặt"
    )


_IS_ANCHORED_MODE_MENU_OPTION_JS = """(element, anchor) => {
  if (!anchor || element.closest(
    'header, nav, aside, [role="navigation"], [role="dialog"], '
    + '[aria-modal="true"], dialog, [data-testid*="account" i], '
    + '[aria-label*="account" i], [class*="account" i], [id*="account" i], '
    + '[data-testid*="setting" i], [aria-label*="setting" i], '
    + '[class*="setting" i], [id*="setting" i]'
  )) return false;

  const visible = node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0;
  };
  const menu = element.closest(
    '[role="menu"], [role="listbox"], [data-radix-menu-content], '
    + '[data-radix-popper-content-wrapper], [data-slot*="dropdown-menu-content"], '
    + '[class*="semi-dropdown"], [class*="dropdown-menu"], [class*="menu-content"]'
  );
  if (!menu || !visible(menu)) return false;

  const bounds = menu.getBoundingClientRect();
  const horizontalGap = Math.max(0, anchor.x - bounds.right, bounds.left - (anchor.x + anchor.width));
  const verticalGap = Math.max(0, anchor.y - bounds.bottom, bounds.top - (anchor.y + anchor.height));
  return horizontalGap <= 320 && verticalGap <= 360;
}"""


async def _find_visible_chat_control(
    page, label: str, *, menu=False, anchor_box: dict | None = None
):
    """Find an exact Fast/Pro control across Dola's locale/DOM variants."""
    if menu and not anchor_box:
        # A page-wide Pro/Fast match can select a profile/account control.
        # Menu choices must be tied to the model trigger opened by this task.
        return None
    wanted = " ".join(str(label or "").split()).casefold()
    selectors = (
        'button, [role="button"], [role="menuitem"], [role="option"], [role="radio"]'
        if menu else 'button, [role="button"]'
    )
    try:
        locator = page.locator(selectors)
        count = await locator.count()
    except Exception:
        return None
    for index in range(count - 1, -1, -1):
        candidate = locator.nth(index)
        try:
            if not await candidate.is_visible():
                continue
            text = " ".join((await candidate.inner_text()).split()).casefold()
            aria = " ".join(str(await candidate.get_attribute("aria-label") or "").split()).casefold()
            title = " ".join(str(await candidate.get_attribute("title") or "").split()).casefold()
            if wanted in {text, aria, title}:
                # Fast/Pro also occur in Dola's account menu. Accept these
                # labels only when the control is next to the active chat
                # composer, including when Dola renders a menu portal.
                if wanted in {"fast", "pro"} and not await _is_chat_composer_control(candidate):
                    continue
                if menu and not await _is_anchored_mode_menu_option(
                    candidate, anchor_box
                ):
                    continue
                return candidate
        except Exception:
            continue
    # Some Dola builds render menu entries as a plain portal div/span with no
    # semantic role. Keep a bounded exact-text fallback, but inspect every
    # visible candidate instead of relying on get_by_text(...).last, which can
    # wait on a stale hidden portal and cause the SUBMIT_FAILED timeout.
    if not menu:
        return None
    try:
        text_locator = page.get_by_text(
            re.compile(rf"^\s*{re.escape(label)}\s*$", re.IGNORECASE),
            exact=False,
        )
        text_count = await text_locator.count()
    except Exception:
        text_locator = None
        text_count = 0
    for index in range(text_count - 1, -1, -1):
        candidate = text_locator.nth(index)
        try:
            if not await candidate.is_visible():
                continue
            text = " ".join((await candidate.inner_text()).split()).casefold()
            if text == wanted:
                if wanted in {"fast", "pro"} and not await _is_chat_composer_control(candidate):
                    continue
                if not await _is_anchored_mode_menu_option(candidate, anchor_box):
                    continue
                return candidate
        except Exception:
            continue
    return None


async def _wait_visible_chat_control(
    page, label: str, *, menu=False, anchor_box: dict | None = None, timeout=60000
):
    """Wait for a labeled chat control without using brittle exact text locators."""
    deadline = time.monotonic() + max(1, timeout) / 1000
    while time.monotonic() < deadline:
        control = await _find_visible_chat_control(
            page, label, menu=menu, anchor_box=anchor_box
        )
        if control is not None:
            return control
        await page.wait_for_timeout(100)
    return None


async def _is_anchored_mode_menu_option(candidate, anchor_box: dict | None) -> bool:
    """Accept a model menu item only inside the popup next to its trigger."""
    if not anchor_box:
        return False
    try:
        return bool(await candidate.evaluate(
            _IS_ANCHORED_MODE_MENU_OPTION_JS, anchor_box
        ))
    except Exception:
        return False


async def _is_chat_composer_control(candidate) -> bool:
    """Reject page-header/account controls that happen to share Fast/Pro text."""
    try:
        return bool(await candidate.evaluate("""element => {
          if (element.closest(
            'header, nav, aside, [role="navigation"], '
            + '[role="dialog"], [aria-modal="true"], dialog, '
            + '[data-testid*="account" i], [aria-label*="account" i], '
            + '[class*="account" i], [id*="account" i], '
            + '[data-testid*="setting" i], [aria-label*="setting" i], '
            + '[class*="setting" i], [id*="setting" i]'
          )) return false;
          const visible = node => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return rect.width > 80 && rect.height > 15
              && style.display !== 'none' && style.visibility !== 'hidden';
          };
          const editors = Array.from(document.querySelectorAll(
            '[contenteditable="true"], textarea, [role="textbox"]'
          )).filter(visible).filter(node => !node.closest('header, nav, aside'));
          if (!editors.length) return false;
          editors.sort((left, right) =>
            right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom
          );
          const editor = editors[0].getBoundingClientRect();
          const control = element.getBoundingClientRect();
          const gapX = Math.max(0, editor.left - control.right, control.left - editor.right);
          const gapY = Math.max(0, editor.top - control.bottom, control.top - editor.bottom);
          return gapX <= Math.max(320, editor.width * 0.6)
            && gapY <= Math.max(300, editor.height * 2 + 80);
        }"""))
    except Exception:
        return False


async def _reopen_dola_chat_and_retry_mode(
    page, account: str, mode: str, reason: str
) -> bool:
    """Reset to the known chat route once; never fall through to account UI."""
    print(
        f"[{account}] Fast/Pro control for {mode} did not resolve ({reason}); "
        "reopening dola.com/chat and retrying once",
        flush=True,
    )
    try:
        await page.keyboard.press("Escape")
    except Exception:
        pass
    await _goto_dola_chat(page)
    await _ensure_dola_chat_route(
        page, page.context, account, default_mode=mode
    )
    await _wait_for_prompt_editor(page, timeout=60000)
    await _select_chat_mode(page, mode, account, allow_chat_retry=False)
    return True


async def _select_chat_mode(
    page, mode: str, account: str = "profile", *, allow_chat_retry=True
):
    """Select Fast or Pro on the ordinary chat composer and verify it."""
    mode = " ".join(str(mode or "").split()).title()
    if mode not in {"Fast", "Pro"}:
        raise ValueError("Dola chat mode must be Fast or Pro")
    other_mode = "Pro" if mode == "Fast" else "Fast"
    modal_dismissed = await _dismiss_account_settings_modal(page, account)
    if not _is_dola_chat_url(page.url):
        await _ensure_dola_chat_route(
            page, page.context, account, default_mode=mode
        )
        modal_dismissed = (
            await _dismiss_account_settings_modal(page, account)
            or modal_dismissed
        )
        await _wait_for_prompt_editor(page, timeout=60000)
    elif modal_dismissed:
        await _wait_for_prompt_editor(page, timeout=60000)

    selected = await _wait_visible_chat_control(page, mode, timeout=1000)
    if selected is not None:
        print(f"[chat-mode] {mode} already selected; continue without clicking", flush=True)
        return False

    # Always use the composer-scoped finder. A direct page-wide role locator
    # can resolve Dola's account/settings menu before the chat control.
    current_mode = await _wait_visible_chat_control(page, other_mode, timeout=60000)
    if current_mode is None:
        if allow_chat_retry:
            return await _reopen_dola_chat_and_retry_mode(
                page, account, mode, "không thấy Fast/Pro trong composer"
            )
        raise PreSubmitSetupError(
            "Dola không hiển thị bộ chọn Fast/Pro trên composer sau khi mở lại /chat"
        )
    try:
        trigger_box = await current_mode.bounding_box()
    except Exception:
        trigger_box = None
    try:
        await current_mode.click(timeout=20000)
    except Exception as click_error:
        try:
            await current_mode.click(timeout=20000, force=True)
        except Exception as force_error:
            if allow_chat_retry:
                return await _reopen_dola_chat_and_retry_mode(
                    page, account, mode, "không mở được bộ chọn Fast/Pro"
                )
            raise PreSubmitSetupError(
                f"Không mở được bộ chọn Fast/Pro trên Dola: {str(force_error).splitlines()[0]}"
            ) from click_error
    await page.wait_for_timeout(300)

    # A mistaken Pro match can open Dola's account settings instead of the
    # model popup. Close it and stop this profile before any prompt is typed.
    if await _dismiss_account_settings_modal(page, account):
        if allow_chat_retry:
            return await _reopen_dola_chat_and_retry_mode(
                page, account, mode,
                f"click {other_mode} mở modal cài đặt tài khoản",
            )
        raise PreSubmitSetupError(
            f"Dola mở modal cài đặt tài khoản sau khi mở bộ chọn {other_mode}; "
            "đã đóng modal và dừng trước khi nhập prompt"
        )

    # Dola can render the menu option as a role=menuitem, add an icon, or
    # hydrate its portal one frame later. Only accept an option in a popup
    # spatially anchored to the exact composer trigger opened above.
    mode_option = await _wait_visible_chat_control(
        page, mode, menu=True, anchor_box=trigger_box, timeout=20000
    )
    if mode_option is None:
        if allow_chat_retry:
            return await _reopen_dola_chat_and_retry_mode(
                page, account, mode, f"menu không có lựa chọn {mode} gần composer"
            )
        raise PreSubmitSetupError(
            f"Dola đã mở bộ chọn model nhưng không tìm thấy lựa chọn {mode} sau khi mở lại /chat"
        )
    try:
        await mode_option.click(timeout=20000)
    except Exception as click_error:
        try:
            await mode_option.click(timeout=20000, force=True)
        except Exception as force_error:
            if allow_chat_retry:
                return await _reopen_dola_chat_and_retry_mode(
                    page, account, mode,
                    f"không click được lựa chọn {mode} trong menu composer"
                )
            raise PreSubmitSetupError(
                f"Không click được lựa chọn {mode} trên Dola: {str(force_error).splitlines()[0]}"
            ) from click_error

    if await _dismiss_account_settings_modal(page, account):
        if allow_chat_retry:
            return await _reopen_dola_chat_and_retry_mode(
                page, account, mode,
                f"click {mode} mở modal cài đặt tài khoản",
            )
        raise PreSubmitSetupError(
            f"Click {mode} mở modal cài đặt tài khoản thay vì đổi mode; "
            "đã đóng modal và dừng trước khi nhập prompt"
        )

    # A visible menu label is not proof that the composer changed mode.
    # Require the actual trigger and disappearance of the previous mode.
    selected = await _wait_visible_chat_control(page, mode, timeout=20000)
    other_remaining = await _find_visible_chat_control(page, other_mode)
    if selected is None or other_remaining is not None:
        if allow_chat_retry:
            return await _reopen_dola_chat_and_retry_mode(
                page, account, mode, f"Dola chưa xác nhận chuyển sang {mode}"
            )
        raise PreSubmitSetupError(
            f"Đã click {mode} nhưng Dola chưa xác nhận chuyển sang {mode} sau khi mở lại /chat"
        )
    return False


async def _select_chat_pro(page, account: str = "profile", *, allow_chat_retry=True):
    """Compatibility wrapper for callers that explicitly require Pro."""
    return await _select_chat_mode(
        page, "Pro", account, allow_chat_retry=allow_chat_retry
    )


_NEW_CHAT_RE = re.compile(
    r"^\s*(?:New Chat|New chat|new conversation|新建对话|新建聊天|"
    r"新しいチャット|新規チャット|cuộc trò chuyện mới|đoạn chat mới)\s*$",
    re.IGNORECASE,
)


async def _open_fresh_chat(
    page,
    previous_id: str = "",
    timeout_ms: int = 12000,
    force: bool = False,
):
    """Open a new Dola chat with bounded locator and keyboard fallbacks.

    ``/chat`` is also the URL Dola uses for a restored, unsent draft.  A
    normal URL check therefore cannot prove that the composer is new.  Image
    jobs use ``force=True`` so an old attachment draft is never reused merely
    because the address bar already says ``/chat``.
    """
    deadline = time.monotonic() + max(1, timeout_ms) / 1000
    clicked = False
    while time.monotonic() < deadline and not clicked:
        try:
            candidates = page.get_by_text(_NEW_CHAT_RE, exact=False)
            count = await candidates.count()
        except Exception:
            count = 0
            candidates = None
        for index in range(count - 1, -1, -1):
            candidate = candidates.nth(index)
            try:
                if not await candidate.is_visible():
                    continue
                await candidate.click(timeout=1500)
                clicked = True
                break
            except Exception:
                try:
                    await candidate.click(timeout=1000, force=True)
                    clicked = True
                    break
                except Exception as error:
                    if _is_page_or_browser_closed(error):
                        raise
                    continue
        if not clicked:
            # Dola's documented shortcut remains available when the sidebar
            # label is hidden or rendered in a portal outside the text locator.
            try:
                await page.keyboard.press("ControlOrMeta+Shift+K")
                clicked = True
            except Exception as error:
                if _is_page_or_browser_closed(error):
                    raise
                pass
        if not clicked:
            await page.wait_for_timeout(100)

    while time.monotonic() < deadline:
        try:
            path = urlparse(str(page.url or "")).path
        except Exception:
            path = ""
        if re.fullmatch(r"/chat/?", path) and (not force or clicked):
            try:
                await _wait_for_prompt_editor(page, timeout=1200)
                return
            except Exception:
                pass
        current_id = await _page_conversation_id(page)
        if current_id and previous_id and current_id != previous_id:
            # A few Dola builds allocate the new conversation id before
            # changing the visible URL. The editor check below still guards
            # against accepting a stale page.
            try:
                await _wait_for_prompt_editor(page, timeout=1200)
                return
            except Exception:
                pass
        await page.wait_for_timeout(100)
    raise PreSubmitSetupError(
        "Không mở được New Chat trong thời gian ngắn; dừng trước khi nhập prompt "
        "để tránh gửi vào conversation cũ"
    )


async def _find_video_entry(page, timeout: int = 60000):
    """Find Dola's video entry point across the profile's UI locales."""
    deadline = time.monotonic() + max(1, timeout) / 1000
    # Keep the old locator/wait contract as a quick path. Besides avoiding a
    # needless polling loop when the Japanese profile is already rendered,
    # this preserves compatibility with lightweight mocked pages used by the
    # lifecycle tests.
    try:
        legacy = page.locator(VIDEO_ENTRY_SELECTORS[0]).first
        await legacy.wait_for(state="visible", timeout=min(250, max(1, timeout)))
        return legacy
    except Exception:
        pass
    while time.monotonic() < deadline:
        for selector in VIDEO_ENTRY_SELECTORS:
            try:
                locator = page.locator(selector)
                count = await locator.count()
            except Exception:
                continue
            for index in range(count):
                candidate = locator.nth(index)
                try:
                    if await candidate.is_visible():
                        return candidate
                except Exception:
                    continue
        await page.wait_for_timeout(100)
    raise TimeoutError(
        "Không tìm thấy nút tạo video trên Dola "
        f"(labels={', '.join(VIDEO_ENTRY_SELECTORS)})"
    )


async def _click_video_entry(page, timeout: int = 60000):
    """Open the video composer even when Dola's text wrapper is not clickable."""
    entry = await _find_video_entry(page, timeout=timeout)
    try:
        await entry.click(timeout=min(timeout, 30000))
    except Exception as click_error:
        # Dola sometimes leaves a visible text div under a disabled/animated
        # wrapper. Dispatching a click on the nearest semantic button is safe
        # after the visible entry was found and avoids a false task failure.
        try:
            await entry.click(timeout=20000, force=True)
        except Exception:
            try:
                clicked = await entry.evaluate(
                    """node => {
                        const target = node.closest('button,[role="button"]') || node;
                        if (target.disabled || target.getAttribute('aria-disabled') === 'true') return false;
                        target.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
                        return true;
                    }"""
                )
            except Exception:
                raise click_error
            if not clicked:
                raise click_error
    return await _wait_for_prompt_editor(page, timeout=60000)


async def _open_reference_attachment_menu(page):
    """Open the chat attachment control, including its icon-only variant."""
    controls = page.get_by_role("button", name=re.compile(
        r"^(?:Attach(?: files?)?|Upload(?: files?)?|Add files?|Thêm tệp|Đính kèm|上传|添加附件|\+)$", re.I))
    for index in range(await controls.count()):
        if await controls.nth(index).is_visible():
            await controls.nth(index).click(timeout=5000)
            return True
    # Restrict icon-only matching to the composer containing the Pro trigger.
    trigger = page.get_by_role("button", name="Pro", exact=True).first
    # Dola's attachment trigger is an unlabeled popup immediately left of Pro.
    # Scope it to the nearest shared toolbar, not the page-wide icon names.
    pro_box = await trigger.bounding_box()
    for depth in range(1, 5):
        scope = trigger.locator("xpath=" + "/".join([".."] * depth))
        popups = scope.locator('[aria-haspopup]')
        candidates = []
        for index in range(await popups.count()):
            popup = popups.nth(index)
            box = await popup.bounding_box()
            if box and pro_box and box['width'] > 0 and box['width'] <= 64 and box['x'] < pro_box['x'] and pro_box['x'] - box['x'] < 100 and abs(box['y'] - pro_box['y']) < 30:
                if not (await popup.inner_text()).strip():
                    candidates.append((box['width'], popup))
        if candidates:
            popup = min(candidates, key=lambda item: item[0])[1]
            if await popup.get_attribute("data-state") == "open":
                return True
            try:
                await popup.click(timeout=2000)
            except Exception:
                # The composer can remount while Dola hydrates. Re-resolve it
                # on the next bounded iteration rather than forcing a click.
                return False
            return True
    for depth in range(1, 5):
        scope = trigger.locator("xpath=" + "/".join([".."] * depth))
        icons = scope.locator('button, [role="button"]')
        for index in range(await icons.count()):
            icon = icons.nth(index)
            identity = await icon.evaluate("el => [el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.innerHTML].join(' ')")
            if re.search(r"(?:icon[-_]?plus|icon[-_]?add|attach|paperclip|upload|name=[\"']plus)", identity, re.I) and await icon.is_visible():
                await icon.click(timeout=5000)
                return True
    return False


async def _wait_for_file_input(page, timeout: int = 60000):
    """Handle both mounted inputs and native file choosers in Pro chat."""
    chooser = []
    def on_chooser(value):
        chooser.append(value)
    page.on("filechooser", on_chooser)
    try:
        return await _wait_for_reference_input(page, chooser, timeout)
    finally:
        page.remove_listener("filechooser", on_chooser)


async def _wait_for_reference_input(page, chooser, timeout):
    """Wait for Dola's lazily mounted reference-file input."""
    deadline = time.monotonic() + max(1, timeout) / 1000
    next_auth_check = 0.0
    menu_opened = False
    upload_clicked = False
    menu_retry_at = 0.0
    while time.monotonic() < deadline:
        if chooser:
            class ChooserInput:
                async def set_input_files(self, paths):
                    await chooser[0].set_files(paths)
            return ChooserInput()
        if time.monotonic() >= next_auth_check:
            if await _page_has_logged_out_marker(page):
                try:
                    page_context = getattr(page, "context", None)
                    cookies = (
                        await page_context.cookies("https://www.dola.com")
                        if page_context is not None
                        else []
                    )
                except Exception:
                    cookies = []
                if has_dola_session(cookies):
                    raise PreSubmitRiskControlError(
                        "Dola yêu cầu đăng nhập khi mở composer ảnh nhưng cookie "
                        "vẫn còn; tạm dừng do risk-control"
                    )
                raise PreSubmitRiskControlError(
                    "Dola yêu cầu đăng nhập khi mở composer ảnh, trước khi gửi prompt"
                )
            next_auth_check = time.monotonic() + 1
        try:
            inputs = page.locator('input[type="file"]')
            if await inputs.count():
                return inputs.first
        except Exception:
            pass
        if not menu_opened:
            menu_opened = await _open_reference_attachment_menu(page)
            menu_retry_at = time.monotonic() + 1
        elif not upload_clicked:
            upload = page.get_by_text(re.compile(
                r"^(?:Upload(?: files?| images?| photos?| File or Image)?|From (?:computer|device)|Tải (?:ảnh|tệp|lên)|上传(?:文件|图片)?|从电脑上传)$", re.I))
            for index in range(await upload.count()):
                if await upload.nth(index).is_visible():
                    await upload.nth(index).click(timeout=5000)
                    upload_clicked = True
                    break
            if not upload_clicked and time.monotonic() >= menu_retry_at:
                # A click before hydration may do nothing despite succeeding.
                # Re-open until the upload item/input really exists.
                menu_opened = False
        await page.wait_for_timeout(250)
    raise TimeoutError("Dola chưa mount input tải ảnh tham chiếu")


async def _prompt_editor_value(editor) -> str:
    """Reads the value from either a textarea or a contenteditable editor."""
    try:
        tag_name = await editor.evaluate("element => element.tagName")
    except Exception:
        tag_name = ""
    if str(tag_name).upper() in {"TEXTAREA", "INPUT"}:
        return await editor.input_value()
    return await editor.evaluate("element => element.innerText || element.textContent || ''")


def _normalise_editor_text(value) -> str:
    """Normalize browser-editor line endings without changing prompt content."""
    return (
        str(value or "")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\u200b", "")
        .replace("\u00a0", " ")
        .strip()
    )


def _prompt_compare_key(value) -> str:
    """Compare prompt content while ignoring editor-only whitespace layout.

    Dola's contenteditable implementation can serialize one logical line as
    multiple block boundaries. ``innerText`` then adds spaces/newlines that are
    not part of the prompt submitted to the provider. Collapse whitespace for
    verification, but keep the original prompt untouched for submission.
    """
    return re.sub(r"\s+", " ", _normalise_editor_text(value)).strip()


async def _wait_for_prompt_value(page, editor, expected: str, timeout_ms: int = 60000):
    """Wait for a controlled editor, refreshing its locator after re-render."""
    deadline = time.monotonic() + max(1, timeout_ms) / 1000
    actual = ""
    next_editor_refresh = time.monotonic()
    while time.monotonic() < deadline:
        try:
            actual = await _prompt_editor_value(editor)
        except Exception:
            actual = ""
        if _prompt_compare_key(actual) == _prompt_compare_key(expected):
            return actual
        if time.monotonic() >= next_editor_refresh:
            try:
                refreshed = await _wait_for_prompt_editor(page, timeout=350)
            except Exception:
                refreshed = None
            if refreshed is not None:
                editor = refreshed
            next_editor_refresh = time.monotonic() + 250 / 1000
        await page.wait_for_timeout(50)
    return actual


def _truncate_prompt(prompt) -> str:
    """Keep the browser submission within Dola's configured prompt limit."""
    return video_prompt(prompt, config.MAX_PROMPT_CHARS)


def _dedupe_reference_paths(values) -> tuple[str, ...]:
    """Freeze an ordered, task-owned reference manifest without duplicates."""
    if not isinstance(values, (list, tuple, set)):
        return ()
    normalized = []
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            normalized.append(text)
    return tuple(dict.fromkeys(normalized))


async def _focus_prompt_editor(page, timeout: int = 60000):
    """Dismiss leftover menus and verify keyboard focus before typing/sending."""
    try:
        await page.keyboard.press("Escape")
        editor = await _wait_for_prompt_editor(page, timeout=timeout)
        # Focus does not depend on pointer hit-testing through floating menus.
        await editor.focus(timeout=timeout)
        focused = await editor.evaluate(
            "element => document.activeElement === element || element.contains(document.activeElement)"
        )
        if not focused:
            raise RuntimeError("Ô nhập prompt chưa nhận keyboard focus")
        return editor
    except Exception as error:
        raise PreSubmitSetupError(
            f"Không thể focus ô nhập prompt trước khi gửi: {str(error).splitlines()[0]}"
        ) from error


async def _fill_prompt_fast(
    page,
    prompt: str,
    *,
    prepared: bool = False,
    timeout_ms: int = 60000,
):
    """Type quickly, verify, then retry more slowly if the editor lost text."""
    if not prepared:
        prompt = _truncate_prompt(prompt)
    actual = ""
    for attempt in range(2):
        delay = config.PROMPT_KEY_DELAY_MS if attempt == 0 else max(5, config.PROMPT_KEY_DELAY_MS)
        editor = await _focus_prompt_editor(page, timeout=timeout_ms)
        await page.keyboard.press("ControlOrMeta+A")
        await page.keyboard.press("Backspace")
        # Preserve multiline prompts without pressing Enter (which submits).
        for index, line in enumerate(prompt.split("\n")):
            if index:
                await page.keyboard.press("Shift+Enter")
            await page.keyboard.type(line, delay=delay)
        actual = await _wait_for_prompt_value(
            page, editor, prompt, timeout_ms=timeout_ms
        )
        if _prompt_compare_key(actual) == _prompt_compare_key(prompt):
            return
    if _prompt_compare_key(actual) != _prompt_compare_key(prompt):
        raise RuntimeError(
            "Dola không nhận đủ nội dung prompt sau khi gõ từng ký tự "
            f"(expected={len(_normalise_editor_text(prompt))}, "
            f"actual={len(_normalise_editor_text(actual))})"
        )
    return editor


async def _click_prompt_send_fallback(page, timeout_ms: int = 0) -> bool:
    """Click Dola's composer send control when Enter did not submit.

    The keyboard shortcut is not wired consistently across Dola locales and
    profile states.  Keep Enter as the fast path, then target the composer
    button explicitly only when no request was observed.  The control can be
    mounted a little after the editor value is visible, so optionally wait for
    a visible, enabled button instead of sampling it once.  Returning whether
    a control was clicked lets the caller keep the payload watchdog.
    """
    selectors = (
        # The current English video composer renders its submit control as
        # `#flow-end-msg-send`.  Enter is not wired for this composer, so
        # omitting this selector leaves the task in Dola's editor without a
        # completion request and makes the watchdog report a false payload
        # timeout.
        "#flow-end-msg-send",
        'button[id*="msg-send"]',
        'button[aria-disabled="false"][id*="send"]',
        'button[data-testid*="send" i]',
        '[role="button"][data-testid*="send" i]',
        'button[data-e2e*="send" i]',
        ".send-btn-wrapper button",
        'button[type="submit"]',
        'button[aria-label*="gửi" i]',
        'button[aria-label*="送信"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="发送"]',
        'button[title*="send" i]',
        '[class*="send-msg-btn"]',
    )
    deadline = time.monotonic() + max(0, timeout_ms) / 1000
    while True:
        for selector in selectors:
            try:
                locator = page.locator(selector)
                count = await locator.count()
            except Exception:
                continue
            for index in range(count - 1, -1, -1):
                candidate = locator.nth(index)
                try:
                    if not await candidate.is_visible():
                        continue
                    # ``is_disabled`` only covers the native property. Dola
                    # also toggles ``aria-disabled``/``aria-busy`` while the
                    # action bar is hydrating, so treat those attributes as
                    # authoritative too.
                    state = await candidate.evaluate(
                        """element => ({
                            disabled: !!element.disabled
                              || String(element.getAttribute('aria-disabled') || '').toLowerCase() === 'true'
                              || String(element.getAttribute('aria-busy') || '').toLowerCase() === 'true'
                        })"""
                    )
                    if state.get("disabled"):
                        continue
                    # Prefer a trusted browser pointer event. DOM element.click()
                    # can return successfully without the composer accepting it.
                    try:
                        await candidate.click(timeout=1000)
                        return True
                    except Exception:
                        pass
                    try:
                        # Dola's send button is covered by a transparent media
                        # panel in the video composer. A DOM click reaches the
                        # React handler without relying on the overlay's pointer
                        # hit-test and is the most reliable path in Chromium.
                        dispatched = await candidate.evaluate(
                            "element => { element.click(); return true; }"
                        )
                        if dispatched:
                            return True
                    except Exception:
                        pass
                    # The composer keeps an empty overlay (`watermark-free-
                    # media-panel`) over the circular button in this Dola
                    # build. Force the click only after the visibility and
                    # disabled checks above.
                    await candidate.click(timeout=20000, force=True)
                    return True
                except Exception:
                    continue
        if time.monotonic() >= deadline:
            return False
        await page.wait_for_timeout(100)


def _parse_json_string(value):
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "[{":
        return value
    try:
        return json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return value


def _find_ability_param(value, depth: int = 0):
    """Find the generation ability config in a Dola request body."""
    if depth > 8 or value is None:
        return None
    if isinstance(value, str):
        parsed = _parse_json_string(value)
        return _find_ability_param(parsed, depth + 1) if parsed is not value else None
    if isinstance(value, dict):
        ability = value.get("chat_ability")
        if isinstance(ability, dict) and "ability_param" in ability:
            parsed = _parse_json_string(ability.get("ability_param"))
            if isinstance(parsed, dict):
                return parsed
        if "ability_param" in value:
            parsed = _parse_json_string(value.get("ability_param"))
            if isinstance(parsed, dict):
                return parsed
        if "duration" in value and ("model" in value or "model_name" in value):
            return value
        for child in value.values():
            found = _find_ability_param(child, depth + 1)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_ability_param(child, depth + 1)
            if found is not None:
                return found
    return None


def _extract_submission_config(post_data):
    """Return ``{model, duration}`` from a /chat/completion request body."""
    if not post_data:
        return None
    raw = post_data.decode("utf-8", "replace") if isinstance(post_data, bytes) else str(post_data)
    try:
        body = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        body = raw
    ability = _find_ability_param(body)
    if not isinstance(ability, dict):
        duration_match = re.search(r"[\"']duration[\"']\s*:\s*[\"']?(\d+)", raw, re.IGNORECASE)
        model_match = re.search(r"[\"']model(?:_name)?[\"']\s*:\s*[\"']([^\"']+)", raw, re.IGNORECASE)
        if not duration_match and not model_match:
            return None
        ability = {
            "duration": duration_match.group(1) if duration_match else None,
            "model": model_match.group(1) if model_match else None,
        }
    return {
        "duration": _coerce_duration(ability.get("duration")),
        "model": ability.get("model") or ability.get("model_name"),
    }


_CONVERSATION_ID_KEY_RE = re.compile(
    r"[\"']?(?:conversation[_-]?id|conversationId|conversationID|conv[_-]?id|convId)"
    r"[\"']?\s*[=:]\s*[\"']?(?P<id>\d{6,})",
    re.IGNORECASE,
)


def _extract_conversation_id(value, depth: int = 0) -> str:
    """Extract Dola's numeric conversation id from JSON or an SSE response.

    The chat endpoint returns the id in ``SSE_ACK.ack_client_meta``. The UI
    normally navigates to ``/chat/<id>``, but that navigation is asynchronous
    and is not guaranteed when the composer is submitted from a background
    profile. Keep the extraction scoped to conversation-id field names so
    timestamps, message ids and account ids are never mistaken for a task.
    """
    if depth > 8 or value is None:
        return ""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, dict):
        priority = (
            "conversation_id", "conversationId", "conversationID",
            "conv_id", "convId",
        )
        for key in priority:
            candidate = value.get(key)
            if candidate is not None:
                if isinstance(candidate, int) and candidate > 0:
                    return str(candidate)
                if isinstance(candidate, str) and re.fullmatch(r"\d{6,}", candidate.strip()):
                    return candidate.strip()
                found = _extract_conversation_id(candidate, depth + 1)
                if found:
                    return found
        for key, child in value.items():
            if str(key).lower().replace("-", "_") in {
                "local_conversation_id", "localconversationid",
            }:
                continue
            found = _extract_conversation_id(child, depth + 1)
            if found:
                return found
        return ""
    if isinstance(value, (list, tuple)):
        for child in value:
            found = _extract_conversation_id(child, depth + 1)
            if found:
                return found
        return ""
    if not isinstance(value, str):
        return ""
    text = value.strip()
    if not text:
        return ""
    parsed = _parse_json_string(text)
    if parsed is not text:
        found = _extract_conversation_id(parsed, depth + 1)
        if found:
            return found
    match = _CONVERSATION_ID_KEY_RE.search(text)
    return match.group("id") if match else ""


def _submission_error_codes(value) -> list[str]:
    """Only log numeric provider codes, never response prompts or tokens."""
    raw = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value or "")
    return sorted(set(re.findall(r'["\x27]?(?:error_code|status_code)["\x27]?\s*[:=]\s*["\x27]?(\d+)', raw)))


def _classify_submission_error(value) -> str:
    """Map Dola's SSE ``STREAM_ERROR`` to a stable worker error.

    Dola often returns HTTP 200 for a rejected chat request. The actual
    failure is in the SSE body, so relying on the page URL turns risk-control
    responses into the misleading ``conversation_id`` timeout.
    """
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    if _is_seven_day_free_limit(raw):
        return FAST_MODE_FALLBACK_MESSAGE
    if DURATION_CAPABILITY_PATTERN.search(raw):
        return DURATION_CAPABILITY_MESSAGE
    if SOMETHING_WENT_WRONG_PATTERN.search(raw):
        return SOMETHING_WENT_WRONG_MESSAGE
    if _is_provider_task_id_empty_technical_error(raw):
        return "Dola/backend không tạo task video (task_id trống); cần gửi lại trên chat/profile mới."
    if _is_content_policy_rejection_error(raw):
        if _provider_is_retrying_after_filter_error(raw):
            return ""
        if _is_final_content_policy_refusal(raw):
            return CONTENT_POLICY_NO_RETRY_MESSAGE
        return CONTENT_POLICY_REJECTION_MESSAGE
    if _is_profile_rotation_no_video_error(raw):
        if _provider_is_retrying_after_filter_error(raw):
            return ""
        return PROFILE_ROTATION_NO_VIDEO_MESSAGE
    if CANNOT_ANSWER_QUESTION_PATTERN.search(raw):
        return CANNOT_ANSWER_QUESTION_MESSAGE
    if CREDIT_COST_EXCEEDED_PATTERN.search(raw):
        return _credit_cost_error_message(raw)
    if "710022004" in raw or re.search(r"(?:slide|shark_admin|risk.?control)", raw, re.I):
        return "Dola yêu cầu xác minh chống bot (slide), chưa chấp nhận conversation"
    if is_rate_limit_response(raw):
        return "Dola đang giới hạn tần suất tạo video, chưa chấp nhận conversation"
    if DAILY_LIMIT_PATTERN.search(raw):
        return VIDEO_LIMIT_MESSAGE
    if PROVIDER_BUSY_PATTERN.search(raw):
        return "Dola đang quá tải, chưa chấp nhận conversation; hãy thử lại sau"
    if LIKENESS_REJECTION_PATTERN.search(raw):
        return LIKENESS_REJECTION_MESSAGE
    if PROVIDER_REJECTION_PATTERN.search(raw):
        return "Dola từ chối nội dung yêu cầu, chưa chấp nhận conversation"
    if CREDIT_FAIL_PATTERN.search(raw):
        return "Tài khoản Dola không đủ credit, chưa chấp nhận conversation"
    return ""


def _is_duration_capability_error(value) -> bool:
    """Recognize the provider's 4–15s response before generic rejection logic."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(
        DURATION_CAPABILITY_PATTERN.search(raw)
        or DURATION_CAPABILITY_MESSAGE in raw
    )


def _nearest_supported_duration(value) -> int | None:
    """Read a duration Dola offered as its nearest supported option."""
    if isinstance(value, bytes):
        raw = value.decode("utf-8", "replace")
    elif isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    match = DURATION_NEAREST_PATTERN.search(raw)
    if not match:
        return None
    try:
        return int(match.group(1) or match.group(2))
    except (TypeError, ValueError):
        return None


def _is_something_went_wrong_error(value) -> bool:
    """Recognize Dola's generic no-video retry response."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(
        SOMETHING_WENT_WRONG_PATTERN.search(raw)
        or SOMETHING_WENT_WRONG_MESSAGE in raw
    )


def _is_cannot_answer_question_error(value) -> bool:
    """Recognize Dola's plain-text no-video answer that needs a fresh chat."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    # This is an actionable consent question, not a no-video refusal. The
    # poller answers it in the same accepted conversation and keeps waiting.
    if VIDEO_GENERATION_CONFIRMATION_PATTERN.search(raw):
        return False
    return bool(
        CANNOT_ANSWER_QUESTION_PATTERN.search(raw)
        or CANNOT_ANSWER_QUESTION_MESSAGE in raw
    )


def _is_explicit_no_video_creation_error(value) -> bool:
    """Recognize final no-video wording without treating quota failures as generic refusals."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(
        raw.strip()
        and not NO_VIDEO_QUOTA_CONTEXT_PATTERN.search(raw)
        and NO_VIDEO_CREATION_RESPONSE_PATTERN.search(raw)
    )


def _is_provider_task_id_empty_error(value) -> bool:
    """Recognize a provider response that confirms no render task was created."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(PROVIDER_EMPTY_TASK_ID_PATTERN.search(raw))


def _is_content_policy_rejection_error(value) -> bool:
    """Recognize a provider content-standards refusal in a chat message."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(
        CONTENT_POLICY_REJECTION_PATTERN.search(raw)
        or CONTENT_POLICY_SCENE_BLOCK_PATTERN.search(raw)
        or CONTENT_POLICY_REJECTION_MESSAGE in raw
    )


def _is_final_content_policy_refusal(value) -> bool:
    """Detect a provider instruction not to retry a refused request."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(
        CONTENT_POLICY_NO_RETRY_PATTERN.search(raw)
        or CONTENT_POLICY_SCENE_NO_RETRY_PATTERN.search(raw)
    )


def _is_provider_task_id_empty_technical_error(value) -> bool:
    """Identify missing-task failures without treating a real policy refusal as transient.

    Dola's final summaries may recap earlier content-filter attempts and then
    say the request is safe while reporting an empty backend task id. Those
    mixed summaries belong on the technical retry path; a final refusal with
    no safe-content confirmation remains a policy result.
    """
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    if not PROVIDER_EMPTY_TASK_ID_PATTERN.search(raw):
        return False
    if _provider_is_retrying_after_filter_error(raw):
        return False
    has_content_policy_refusal = _is_content_policy_rejection_error(raw)
    if has_content_policy_refusal and _is_final_content_policy_refusal(raw):
        # A previous safe-content confirmation or empty task id must not
        # override Dola's final instruction that this request is blocked and
        # cannot be retried.
        return False
    return not has_content_policy_refusal or bool(
        PROVIDER_SAFE_CONTENT_CONFIRMATION_PATTERN.search(raw)
    )


def _is_profile_rotation_no_video_error(value) -> bool:
    """Recognize a no-video response eligible for one untried profile retry."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(
        PROFILE_ROTATION_NO_VIDEO_PATTERN.search(raw)
        or PROFILE_ROTATION_PROMPT_ADJUSTMENT_PATTERN.search(raw)
    )


def _provider_is_retrying_after_filter_error(value) -> bool:
    """Do not treat an intermediate tool failure as Dola's final answer."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    # Dola's prompt-adjustment question is a completed no-video response.
    # Its quoted request to "try again" must not be mistaken for Dola still
    # retrying internally.
    if PROFILE_ROTATION_PROMPT_ADJUSTMENT_PATTERN.search(raw):
        return False
    retry_steps = list(PROVIDER_RETRY_STEP_PATTERN.finditer(raw))
    if not retry_steps:
        return False
    final_results = list(PROVIDER_FINAL_RESULT_PATTERN.finditer(raw))
    final_results.extend(CONTENT_POLICY_SCENE_BLOCK_PATTERN.finditer(raw))
    final_results.extend(CONTENT_POLICY_SCENE_NO_RETRY_PATTERN.finditer(raw))
    last_final_at = max((match.start() for match in final_results), default=-1)
    return retry_steps[-1].start() > last_final_at


def _is_multi_video_segment_response(value) -> bool:
    """Recognize Dola's response proposing multiple 15-second segments."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(MULTI_VIDEO_SEGMENT_PATTERN.search(raw))


def _is_fresh_chat_retry_error(value) -> bool:
    """Return whether Dola created no video and needs one fresh chat."""
    return (
        _is_duration_capability_error(value)
        or _is_something_went_wrong_error(value)
        or _is_provider_task_id_empty_technical_error(value)
        or _is_content_policy_rejection_error(value)
        or _is_profile_rotation_no_video_error(value)
        or _is_cannot_answer_question_error(value)
        or _is_explicit_no_video_creation_error(value)
    )


def _terminal_provider_response_error(value):
    """Return a terminal exception for text already visible in the Dola chat.

    The normal poll path gets assistant text from ``/im/chain/single``. When
    that request fails, the active chat can still contain the final provider
    response, so the fallback must use the same terminal classifications
    instead of treating every visible page as an in-progress render.
    """
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    if not raw.strip():
        return None
    # Some diagnostics/tests pass a prompt with an explicit label. It is not
    # an assistant/provider response and must never trigger account/task
    # handling based on words the user supplied.
    if re.match(r"^\s*(?:user\s+)?prompt\s*:", raw, re.IGNORECASE):
        return None
    if _is_seven_day_free_limit(raw):
        return FastModeFallbackError(
            f"{FAST_MODE_FALLBACK_MESSAGE} Phản hồi: {raw[-180:]}"
        )
    # Some final summaries recap earlier content-filter attempts, then confirm
    # the prompt is safe and report that the backend never returned a task id.
    # Route that technical failure through profile rotation. A final policy
    # refusal without that confirmation remains terminal below.
    if _is_provider_task_id_empty_technical_error(raw):
        return ProviderTaskIdEmptyError(
            "Dola/backend không tạo task video (task_id trống); đã dừng poll conversation."
        )
    if _is_content_policy_rejection_error(raw):
        if _provider_is_retrying_after_filter_error(raw):
            return None
        refusal_type = (
            ContentPolicyFinalRefusalError
            if _is_final_content_policy_refusal(raw)
            else ContentPolicyRejectedError
        )
        refusal_message = (
            CONTENT_POLICY_NO_RETRY_MESSAGE
            if refusal_type is ContentPolicyFinalRefusalError
            else CONTENT_POLICY_REJECTION_MESSAGE
        )
        return refusal_type(f"{refusal_message} Phản hồi: {raw[-240:]}")
    if _is_credit_cost_exceeded_error(raw):
        return PostSubmitCreditError(_credit_cost_error_message(raw))
    if _is_profile_rotation_no_video_error(raw):
        if _provider_is_retrying_after_filter_error(raw):
            return None
        return ProfileRotationRetryError(
            f"{PROFILE_ROTATION_NO_VIDEO_MESSAGE} Phản hồi: {raw[-180:]}"
        )
    if _is_cannot_answer_question_error(raw):
        return CannotAnswerQuestionError(
            f"{CANNOT_ANSWER_QUESTION_MESSAGE} Phản hồi: {raw[-180:]}"
        )
    if DAILY_LIMIT_PATTERN.search(raw):
        return PostSubmitAccountLimitError(
            f"Dola báo đã đạt giới hạn tạo video sau khi nhận yêu cầu: {raw[-180:]}"
        )
    if is_rate_limit_response(raw):
        return PostSubmitRateLimitError(
            f"Dola giới hạn tần suất sau khi nhận yêu cầu: {raw[-180:]}"
        )
    if DOLA_RISK_CONTROL_PATTERN.search(raw):
        return RiskControlError(
            f"Dola bật risk-control sau khi nhận yêu cầu: {raw[-180:]}"
        )
    if PROVIDER_BUSY_PATTERN.search(raw):
        return ProviderBusyError(
            f"Dola đang quá tải sau khi nhận yêu cầu: {raw[-180:]}"
        )
    if _is_explicit_no_video_creation_error(raw):
        return NoVideoCreationError(
            f"Dola báo không thể tạo video sau khi nhận yêu cầu: {raw[-180:]}"
        )
    if _is_duration_capability_error(raw):
        return DurationCapabilityMismatchError(
            f"{DURATION_CAPABILITY_MESSAGE} Phản hồi: {raw[-180:]}"
        )
    if _is_something_went_wrong_error(raw):
        return SomethingWentWrongError(
            f"{SOMETHING_WENT_WRONG_MESSAGE} Phản hồi: {raw[-180:]}"
        )
    if LIKENESS_REJECTION_PATTERN.search(raw):
        return ImageLikenessRejectedError(LIKENESS_REJECTION_MESSAGE)
    if PROVIDER_REJECTION_PATTERN.search(raw):
        return ProviderGenerationRejectedError(
            f"Dola từ chối yêu cầu tạo video: {raw[-180:]}"
        )
    if CREDIT_FAIL_PATTERN.search(raw):
        return PostSubmitCreditError(
            f"Insufficient quota after submit: {raw[-120:]}"
        )
    return None


# Installed immediately before pressing Enter. Dola streams SSE_ACK through
# fetch, but it may not navigate the page to /chat/<conversation_id> when the
# profile is hidden or the response is handled by a delayed React transition.
# Cloning the response leaves Dola's own reader untouched while allowing us to
# parse the ACK as soon as the first SSE chunk arrives.
_INSTALL_CONVERSATION_CAPTURE_JS = r"""
({reset = false} = {}) => {
  const existing = window.__dolaRenderConversationCapture;
  if (existing && existing.installed) {
    if (reset) {
      existing.ids = [];
      existing.errors = [];
      existing.eventName = '';
      existing.assistantText = '';
      existing.streamComplete = false;
    }
    return true;
  }
  const state = {
    installed: true, ids: [], errors: [], eventName: '', assistantText: '', streamComplete: false,
  };
  window.__dolaRenderConversationCapture = state;
  const addId = (value) => {
    const match = String(value || '').match(/\d{6,}/);
    if (match && !state.ids.includes(match[0])) {
      state.ids.push(match[0]);
      if (typeof window.__dolaPersistConversation === 'function') {
        window.__dolaPersistConversation(match[0]).catch(() => {});
      }
    }
  };
  const inspect = (text) => {
    const source = String(text || '');
    if (source.startsWith('event:')) {
      state.eventName = source.slice(6).trim();
      if (state.eventName === 'SSE_REPLY_END') state.streamComplete = true;
      return;
    }
    const pattern = /["']?(?:conversation[_-]?id|conversationId|conversationID|conv[_-]?id|convId)["']?\s*[=:]\s*["']?(\d{6,})/gi;
    let match;
    while ((match = pattern.exec(source)) !== null) addId(match[1]);
    if (!source.startsWith('data:')) return;
    const dataText = source.slice(5).trim();
    if (dataText.includes('error_code')) state.errors.push(dataText.slice(0, 1000));
    let eventData;
    try { eventData = JSON.parse(dataText); } catch (error) { return; }
    if (!['STREAM_MSG_NOTIFY', 'STREAM_CHUNK'].includes(state.eventName)) return;
    const visibleTexts = [];
    const seenTexts = new Set();
    const addVisibleText = (value) => {
      if (typeof value !== 'string') return;
      const text = value.trim();
      if (text && !seenTexts.has(text)) {
        seenTexts.add(text);
        visibleTexts.push(text);
      }
    };
    const collectTextBlocks = (node, depth = 0) => {
      if (!node || depth > 8) return;
      if (Array.isArray(node)) {
        for (const item of node) collectTextBlocks(item, depth + 1);
        return;
      }
      if (typeof node !== 'object') return;
      addVisibleText(node.content?.text_block?.text);
      addVisibleText(node.text_block?.text);
      addVisibleText(node.content?.text);
      addVisibleText(node.text);
      for (const key of ['content_block', 'content', 'patch_value', 'patch_op', 'blocks', 'text_block']) {
        if (node[key] !== undefined) collectTextBlocks(node[key], depth + 1);
      }
    };
    collectTextBlocks(eventData?.content);
    collectTextBlocks(eventData?.patch_op);
    if (visibleTexts.length) {
      state.assistantText = (state.assistantText + '\n' + visibleTexts.join('\n')).slice(-4000);
      // A plain-text overload response may follow the conversation ACK and
      // carry no error_code. Detect it from assistant text blocks immediately
      // so the worker can release this profile and rotate without waiting for
      // the full SSE response body to close. Thinking blocks are intentionally
      // excluded above.
      const overload = /high\s+demand|temporarily\s+(?:busy|unavailable)|quá\s+tải|(?:系统|服務|服务).{0,40}(?:繁忙|忙碌|过载|過載)|(?:稍后|稍後).{0,40}(?:重试|再试|再試)/i;
      if (overload.test(state.assistantText) &&
          !state.errors.some((item) => String(item).startsWith('provider_busy_response:'))) {
        state.errors.push('provider_busy_response:' + state.assistantText.slice(-500));
      }
    }
  };
  const consume = async (response) => {
    try {
      const reader = response.body && response.body.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let pending = '';
      const watchdog = setTimeout(() => reader.cancel().catch(() => {}), 120000);
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) {
            state.streamComplete = true;
            break;
          }
          pending += decoder.decode(item.value, {stream: true});
          const lines = pending.split('\n');
          pending = lines.pop();
          for (const line of lines) inspect(line);
          if (state.errors.some((item) => String(item).startsWith('provider_busy_response:'))) break;
        }
        const remainder = pending + decoder.decode();
        if (remainder.trim()) inspect(remainder);
      } finally {
        clearTimeout(watchdog);
        reader.cancel().catch(() => {});
      }
    } catch (error) {
      state.errors.push(String(error && error.message || error).slice(0, 300));
    }
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    let url = '';
    try { url = String(typeof args[0] === 'string' ? args[0] : args[0]?.url || response.url || ''); }
    catch (error) { url = ''; }
    if (url.includes('/chat/completion') && response.body) {
      try { consume(response.clone()); } catch (error) {
        state.errors.push(String(error && error.message || error).slice(0, 300));
      }
    }
    return response;
  };
  return true;
}
"""


async def _page_conversation_id(page) -> str:
    """Read an id captured from SSE or exposed by Dola's current URL/state."""
    try:
        captured = await page.evaluate(
            """() => {
                const state = window.__dolaRenderConversationCapture || {};
                return (state.ids && state.ids[0]) || '';
            }"""
        )
        found = _extract_conversation_id({"conversation_id": captured})
        if found:
            return found
    except Exception:
        pass
    try:
        current_url = str(page.url or "")
        match = re.search(r"/(\d{6,})(?:[/?#]|$)", current_url)
        if match:
            return match.group(1)
    except Exception:
        pass
    return ""


async def _page_conversation_capture_errors(page) -> list[str]:
    """Return short error markers collected by the page-side SSE clone."""
    try:
        errors = await page.evaluate(
            """() => {
                const state = window.__dolaRenderConversationCapture || {};
                return Array.isArray(state.errors) ? state.errors.slice(-8) : [];
            }"""
        )
        return errors if isinstance(errors, list) else []
    except Exception:
        return []


def _prompt_digest(value) -> str:
    """Return a short non-reversible diagnostic for prompt verification logs."""
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()[:16]


def _is_video_generation_body(value, depth: int = 0) -> bool:
    """Detect a video request before applying prompt-specific route logic."""
    if depth > 8 or value is None:
        return False
    if isinstance(value, dict):
        ability = value.get("chat_ability")
        if isinstance(ability, dict) and str(ability.get("ability_type", "")) == "17":
            return True
        if _find_ability_param(value) is not None:
            return True
        return any(_is_video_generation_body(child, depth + 1) for child in value.values())
    if isinstance(value, list):
        return any(_is_video_generation_body(child, depth + 1) for child in value)
    return False


def _iter_message_lists(value, depth: int = 0):
    """Yield message arrays from the provider's known nested request shapes."""
    if depth > 8 or value is None:
        return
    if isinstance(value, dict):
        messages = value.get("messages")
        if isinstance(messages, list):
            yield messages
        for key, child in value.items():
            if key != "messages":
                yield from _iter_message_lists(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_message_lists(child, depth + 1)


def _prompt_text_with_wrapper(current, prompt: str, ratio: str | None = None) -> str:
    """Replace prompt text while preserving Dola's optional video prefix/suffix."""
    current_text = str(current or "")
    prefix_match = re.match(
        r"^\s*((?:生成影片|生成视频|生成视频内容|生成された動画|Generated video)\s*[:：]\s*)",
        current_text,
        re.IGNORECASE,
    )
    prefix = prefix_match.group(1) if prefix_match else ""
    suffix = ""
    ratio_value = str(ratio or "").strip()
    if prefix and ratio_value:
        suffix_match = re.search(
            rf"\s*[,，]\s*{re.escape(ratio_value)}\s*$",
            current_text,
            re.IGNORECASE,
        )
        if suffix_match:
            suffix = suffix_match.group(0)
    return prefix + prompt + suffix


def _prompt_without_wrapper(value, ratio: str | None = None) -> str:
    """Remove only the fixed wrapper used by some Dola request versions."""
    text = str(value or "")
    prefix_match = re.match(
        r"^\s*((?:生成影片|生成视频|生成视频内容|生成された動画|Generated video)\s*[:：]\s*)",
        text,
        re.IGNORECASE,
    )
    if not prefix_match:
        return text
    text = text[prefix_match.end():]
    ratio_value = str(ratio or "").strip()
    if ratio_value:
        text = re.sub(
            rf"\s*[,，]\s*{re.escape(ratio_value)}\s*$",
            "",
            text,
            flags=re.IGNORECASE,
        )
    return text


def _set_prompt_in_message(message, prompt: str, ratio: str | None = None):
    """Set the last message's text without touching attachments or ability data."""
    if not isinstance(message, dict):
        return None

    content_blocks = message.get("content_block")
    if isinstance(content_blocks, dict):
        content_blocks = [content_blocks]
    if isinstance(content_blocks, list):
        for block in reversed(content_blocks):
            if not isinstance(block, dict):
                continue
            content = block.get("content")
            if not isinstance(content, dict):
                continue
            text_block = content.get("text_block")
            if isinstance(text_block, dict) and isinstance(text_block.get("text"), str):
                old_value = text_block["text"]
                new_value = _prompt_text_with_wrapper(old_value, prompt, ratio)
                text_block["text"] = new_value
                return {"old": old_value, "new": new_value, "path": "content_block.text_block.text"}

    content = message.get("content")
    if isinstance(content, list):
        for part in reversed(content):
            if not isinstance(part, dict) or not isinstance(part.get("text"), str):
                continue
            old_value = part["text"]
            new_value = _prompt_text_with_wrapper(old_value, prompt, ratio)
            part["text"] = new_value
            return {"old": old_value, "new": new_value, "path": "content[].text"}
    if isinstance(content, dict):
        text_block = content.get("text_block")
        if isinstance(text_block, dict) and isinstance(text_block.get("text"), str):
            old_value = text_block["text"]
            new_value = _prompt_text_with_wrapper(old_value, prompt, ratio)
            text_block["text"] = new_value
            return {"old": old_value, "new": new_value, "path": "content.text_block.text"}
        for key in ("text", "prompt", "message_text"):
            if isinstance(content.get(key), str):
                old_value = content[key]
                new_value = _prompt_text_with_wrapper(old_value, prompt, ratio)
                content[key] = new_value
                return {"old": old_value, "new": new_value, "path": "content." + key}
    if isinstance(content, str):
        parsed = _parse_json_string(content)
        if isinstance(parsed, dict):
            nested = _set_prompt_in_message(parsed, prompt, ratio)
            if nested:
                old_value = content
                message["content"] = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
                return {"old": old_value, "new": message["content"], "path": "content.json"}
        old_value = content
        message["content"] = prompt
        return {"old": old_value, "new": prompt, "path": "content"}

    for key in ("text", "prompt", "message_text", "query"):
        if isinstance(message.get(key), str):
            old_value = message[key]
            new_value = _prompt_text_with_wrapper(old_value, prompt, ratio)
            message[key] = new_value
            return {"old": old_value, "new": new_value, "path": key}
    return None


def _replace_prompt_in_payload(body, prompt: str, ratio: str | None = None):
    """Replace the latest user message and return the changed payload field."""
    for messages in _iter_message_lists(body):
        candidates = list(enumerate(messages))
        # Prefer the last non-system/assistant message. Dola's video request
        # normally has one role-less content_block message, which remains a
        # valid candidate through the fallback below.
        candidates.sort(key=lambda item: (
            str(item[1].get("role", "")).strip().lower() in {"system", "assistant"}
            if isinstance(item[1], dict) else True,
            -item[0],
        ))
        for _, message in candidates:
            if not isinstance(message, dict):
                continue
            role = str(message.get("role", "")).strip().lower()
            if role in {"system", "assistant"}:
                continue
            match = _set_prompt_in_message(message, prompt, ratio)
            if match:
                return match
    return None


def _rewrite_ability_config(value, expected_model: str, expected_duration: int, depth: int = 0) -> bool:
    """Update a video ability while preserving whether its parameter is JSON text."""
    if depth > 8 or value is None:
        return False
    if isinstance(value, dict):
        ability = value.get("chat_ability")
        if isinstance(ability, dict):
            raw_param = ability.get("ability_param")
            param = _parse_json_string(raw_param)
            if isinstance(param, dict):
                if _model_value_matches(expected_model, param.get("model")) and param.get("duration") == int(expected_duration):
                    return True
                param["model"] = expected_model
                param["duration"] = int(expected_duration)
                ability["ability_param"] = (
                    json.dumps(param, ensure_ascii=False, separators=(",", ":"))
                    if isinstance(raw_param, str) else param
                )
                return True
            if "model" in ability or "model_name" in ability or "duration" in ability:
                ability["model"] = expected_model
                ability["duration"] = int(expected_duration)
                return True
        raw_param = value.get("ability_param")
        param = _parse_json_string(raw_param)
        if isinstance(param, dict):
            if _model_value_matches(expected_model, param.get("model")) and param.get("duration") == int(expected_duration):
                return True
            param["model"] = expected_model
            param["duration"] = int(expected_duration)
            value["ability_param"] = (
                json.dumps(param, ensure_ascii=False, separators=(",", ":"))
                if isinstance(raw_param, str) else param
            )
            return True
        for child in value.values():
            if _rewrite_ability_config(child, expected_model, expected_duration, depth + 1):
                return True
    elif isinstance(value, list):
        for child in value:
            if _rewrite_ability_config(child, expected_model, expected_duration, depth + 1):
                return True
    return False


def _new_video_ability_config(
    expected_model: str,
    expected_duration: int,
    expected_prompt: str,
    expected_ratio: str | None = None,
) -> dict:
    """Build the current Dola root-level video capability payload."""
    param = {
        "ratio": expected_ratio or "",
        "model": expected_model,
        "duration": int(expected_duration),
        "input_box_content": {
            "user_input_content": expected_prompt,
            "reply_message_format": "生成された動画：%s",
        },
    }
    return {
        "ability_type": 17,
        "ability_param": json.dumps(param, ensure_ascii=False, separators=(",", ":")),
    }


def _sync_ability_prompt(
    value,
    prompt: str,
    ratio: str | None = None,
    depth: int = 0,
) -> tuple[bool, str]:
    """Synchronise ``input_box_content.user_input_content`` in video ability."""
    if depth > 8 or value is None:
        return False, ""
    if isinstance(value, dict):
        ability = value.get("chat_ability")
        if isinstance(ability, dict):
            changed, found = _sync_ability_prompt(ability, prompt, ratio, depth + 1)
            if changed or found:
                return changed, found

        if "ability_param" in value:
            raw_param = value.get("ability_param")
            param = _parse_json_string(raw_param)
            if isinstance(param, dict):
                input_box = param.get("input_box_content")
                if not isinstance(input_box, dict):
                    input_box = {}
                    param["input_box_content"] = input_box
                current = input_box.get("user_input_content")
                changed = current != prompt
                input_box["user_input_content"] = prompt
                if ratio is not None and param.get("ratio") != ratio:
                    param["ratio"] = ratio
                    changed = True
                value["ability_param"] = raw_param if not changed else (
                    json.dumps(param, ensure_ascii=False, separators=(",", ":"))
                    if isinstance(raw_param, str) else param
                )
                return changed, str(input_box.get("user_input_content") or "")

        for child in value.values():
            changed, found = _sync_ability_prompt(child, prompt, ratio, depth + 1)
            if changed or found:
                return changed, found
    elif isinstance(value, list):
        for child in value:
            changed, found = _sync_ability_prompt(child, prompt, ratio, depth + 1)
            if changed or found:
                return changed, found
    return False, ""


def _looks_like_image_attachment(value) -> bool:
    """Recognise Dola image attachment variants without relying on one schema."""
    if not isinstance(value, dict):
        return False
    if isinstance(value.get("image"), dict):
        return True
    if any(key in value for key in ("image_ori", "image_raw", "image_url")):
        return True
    value_type = str(value.get("type") or value.get("content_type") or "").strip().lower()
    return value_type in {"1", "image", "image_url", "image_reference", "vlm_image", "10052"}


def _image_attachment_identity(value) -> str:
    """Build a stable in-memory key for one uploaded image."""
    sources = [value]
    if isinstance(value, dict) and isinstance(value.get("image"), dict):
        sources.insert(0, value["image"])
    for source in sources:
        for key in ("identifier", "id", "uri", "key", "url", "src", "name"):
            current = source.get(key) if isinstance(source, dict) else None
            if current:
                return f"{key}:{current}"
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _collect_image_attachments(value, found: set[str], has_container: list[bool], depth: int = 0):
    """Collect image attachments from known and nested message payload shapes."""
    if depth > 10 or value is None:
        return
    if isinstance(value, str):
        parsed = _parse_json_string(value)
        if parsed is not value:
            _collect_image_attachments(parsed, found, has_container, depth + 1)
        return
    if isinstance(value, dict):
        # Newer Dola builds put image blocks directly in ``content`` (for
        # example ``{"type":"image", "image_url": ...}``) instead of
        # wrapping them in ``attachments``. Recognize the block itself before
        # walking its scalar fields; this closes the path where the validator
        # previously logged ``references=None`` for a request with images.
        if _looks_like_image_attachment(value):
            has_container[0] = True
            found.add(_image_attachment_identity(value))
            return
        for key, child in value.items():
            if key in {"attachments", "references"}:
                # ``references: []`` is present in some ordinary text/video
                # messages even when no image is attached. Only use a nonempty
                # references list as an authoritative image container when it
                # actually looks like image data; ``attachments`` remains
                # authoritative even when empty so a known 0/expected mismatch
                # can still be rejected.
                if key == "references" and not (
                    isinstance(child, list)
                    and any(
                        _looks_like_image_attachment(item)
                        or (
                            isinstance(item, str)
                            and item.strip().lower().startswith(
                                ("http://", "https://", "data:image/", "tos-")
                            )
                        )
                        for item in child
                    )
                ):
                    continue
                has_container[0] = True
                if isinstance(child, list):
                    for item in child:
                        if _looks_like_image_attachment(item):
                            found.add(_image_attachment_identity(item))
                        elif isinstance(item, str) and (
                            item.strip().lower().startswith(("http://", "https://", "data:image/", "tos-"))
                        ):
                            found.add(f"url:{item.strip()}")
                        else:
                            _collect_image_attachments(item, found, has_container, depth + 1)
                elif isinstance(child, dict):
                    _collect_image_attachments(child, found, has_container, depth + 1)
                continue
            _collect_image_attachments(child, found, has_container, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _collect_image_attachments(child, found, has_container, depth + 1)


def _submission_message_contains_prompt(value, expected_prompt: str, depth: int = 0) -> bool:
    """Return whether a request message contains the task's submitted text.

    Dola may send conversation history together with the current composer
    message. Attachment validation must be anchored to the message carrying
    this task's prompt; otherwise an old user message can make a clean
    three-image submission look like a 19-image submission. Do not compare
    media URLs or arbitrary payload strings as prompt text.
    """
    if depth > 10 or value is None:
        return False
    expected_key = _prompt_compare_key(expected_prompt)
    if not expected_key:
        return False
    if isinstance(value, str):
        candidate = _prompt_compare_key(value)
        if not candidate or len(candidate) > max(len(expected_key) * 3, len(expected_key) + 2400):
            return False
        if candidate == expected_key or expected_key in candidate:
            return True
        # Some request versions wrap the text as ``Generated video: ...`` or
        # append the selected ratio after the prompt.
        unwrapped = _prompt_compare_key(_prompt_without_wrapper(value))
        return unwrapped == expected_key or expected_key in unwrapped
    if isinstance(value, dict):
        return any(
            _submission_message_contains_prompt(child, expected_prompt, depth + 1)
            for key, child in value.items()
            if key not in {"attachments", "references", "image", "image_url", "url", "src", "data"}
        )
    if isinstance(value, list):
        return any(
            _submission_message_contains_prompt(child, expected_prompt, depth + 1)
            for child in value
        )
    return False


def _extract_submission_reference_count(body, expected_prompt: str | None = None):
    """Return the task message's image count, or None for unknown schemas.

    Prefer the user message that contains ``expected_prompt``. This avoids
    counting attachments from Dola's conversation history when the provider
    serializes more than one user message in the generation request. Keep the
    previous latest-user fallback for payloads that do not echo prompt text.
    """
    fallback_count = None
    prompt_count = None
    prompt_message_found = False
    for messages in _iter_message_lists(body):
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = str(message.get("role", "")).strip().lower()
            if role in {"system", "assistant"}:
                continue
            contains_prompt = bool(
                expected_prompt
                and _submission_message_contains_prompt(message, expected_prompt)
            )
            if contains_prompt:
                # A current text-only message may legitimately omit an
                # attachment container even though the serialized history
                # contains images from an older conversation turn. Treat that
                # current message as an authoritative zero, not as unknown.
                prompt_message_found = True
            found = set()
            has_container = [False]
            _collect_image_attachments(message, found, has_container)
            if not has_container[0] and not contains_prompt:
                continue
            count = len(found)
            if has_container[0]:
                fallback_count = count
            if contains_prompt:
                prompt_count = count
    return prompt_count if prompt_message_found else fallback_count


def _submission_reference_diagnostics(body, expected_prompt: str | None = None) -> list[dict]:
    """Describe reference-bearing message fields without logging user data."""
    diagnostics = []
    for list_index, messages in enumerate(_iter_message_lists(body)):
        for message_index, message in enumerate(messages):
            if not isinstance(message, dict):
                continue
            role = str(message.get("role", "")).strip().lower()
            found = set()
            has_container = [False]
            _collect_image_attachments(message, found, has_container)
            fields = {}
            for key, value in message.items():
                key_text = str(key)
                if not re.search(r"attach|refer|image|media|file|upload|content", key_text, re.IGNORECASE):
                    continue
                if isinstance(value, list):
                    fields[key_text] = {"type": "list", "length": len(value)}
                elif isinstance(value, dict):
                    fields[key_text] = {
                        "type": "object",
                        "keys": [str(child) for child in list(value)[:16]],
                    }
                else:
                    fields[key_text] = {"type": type(value).__name__}
            diagnostics.append({
                "message": f"messages[{list_index}][{message_index}]",
                "role": role or "unknown",
                "prompt": bool(
                    expected_prompt
                    and _submission_message_contains_prompt(message, expected_prompt)
                ),
                "image_count": len(found),
                "has_image_container": has_container[0],
                "fields": fields,
            })
    return diagnostics[:40]


async def _click_visible_text(page, pattern, *, selector=None, timeout=20000,
                              skip_text: str = "", force: bool = False,
                              skip_element=None):
    """Click the last visible matching element (menus are rendered in a portal)."""
    skip = " ".join(str(skip_text or "").split()).casefold()
    locators = [page.locator(selector or _DURATION_SELECTOR)]
    # Text locators cover menu entries rendered as plain div/span elements.
    # They are tried after semantic controls so a parent container is not
    # preferred over the actual button/radio item.
    try:
        locators.append(page.get_by_text(pattern, exact=False))
    except Exception:
        pass
    for locator in locators:
        try:
            count = await locator.count()
        except Exception:
            continue
        for index in range(count - 1, -1, -1):
            candidate = locator.nth(index)
            try:
                if not await candidate.is_visible():
                    continue
                if skip_element is not None and await candidate.evaluate(
                    "(element, trigger) => element === trigger || trigger.contains(element) || element.contains(trigger)",
                    skip_element,
                ):
                    continue
                text = " ".join((await candidate.inner_text()).split())
                if not pattern.search(text):
                    continue
                if skip and text.casefold() == skip:
                    continue
                await candidate.click(timeout=timeout, force=force)
                return candidate
            except Exception:
                continue
    return None


async def _select_model(page, model_key: str) -> None:
    """Select a Seedance model using locale-independent visible labels."""
    # The action bar exposes a stable control key even while the translated
    # label is still being hydrated after an image upload. Prefer that
    # attribute so a valid composer is not rejected just because its text is
    # empty or rendered in a locale not covered by the label fallbacks.
    trigger = None
    trigger_text = ""
    trigger_clicked = False
    stable_trigger = page.locator(
        '[data-input-engine-actionbar-control-key="video-model"]'
    )
    stable_deadline = time.monotonic() + 30
    while time.monotonic() < stable_deadline and trigger is None:
        try:
            count = await stable_trigger.count()
        except Exception:
            count = 0
        for index in range(count - 1, -1, -1):
            candidate = stable_trigger.nth(index)
            try:
                if await candidate.is_visible():
                    trigger = candidate
                    trigger_text = " ".join((await candidate.inner_text()).split())
                    break
            except Exception:
                continue
        if trigger is None:
            await page.wait_for_timeout(100)

    if model_key == "seedance_v2.0":
        trigger_patterns = (
            re.compile(r"^\s*(?:モデル|模型|model)\s*2[.]0", re.IGNORECASE),
            re.compile(
                r"^\s*(?:dreamina\s+)?seedance\s*2[.]0"
                r"(?:\s*(?:fast|pro|standard|std|mini|高速|快速|新版))*\s*$",
                re.IGNORECASE,
            ),
        )
        option_patterns = (
            re.compile(
                r"dreamina\s*seedance\s*2[.]0"
                r"|seedance\s*2[.]0(?:\s*(?:fast|pro|standard|std|mini|高速|快速))*",
                re.IGNORECASE,
            ),
            re.compile(r"(?:模型|モデル|model)\s*2[.]0", re.IGNORECASE),
        )
    else:
        trigger_patterns = (
            re.compile(r"^\s*(?:モデル|模型|model)\s*2[.]5", re.IGNORECASE),
            re.compile(r"^\s*(?:dreamina\s+)?seedance\s*2[.]5(?:\s+(?:fast|pro|standard|new))*\s*$", re.IGNORECASE),
        )
        option_patterns = (
            re.compile(r"dreamina\s*seedance\s*2[.]5", re.IGNORECASE),
            re.compile(r"seedance\s*2[.]5", re.IGNORECASE),
            re.compile(r"(?:模型|モデル|model)\s*2[.]5", re.IGNORECASE),
        )
    # The trigger shows the CURRENT model, not the requested model. A native
    # 2.5 selection must still be opened before we can choose 2.0 (and vice versa).
    # Keep option_patterns target-specific so this does not change the model
    # requested by the task.
    trigger_patterns = (
        re.compile(r"^\s*(?:モデル|模型|model)\s*2[.][05]", re.IGNORECASE),
        re.compile(
            r"^\s*(?:dreamina\s+)?seedance\s*2[.][05]"
            r"(?:\s*(?:fast|pro|standard|std|mini|new|高速|快速|新版))*\s*$",
            re.IGNORECASE,
        ),
    )
    # The video composer exposes its prompt editor before the model control in
    # some Dola builds. A single lookup here races that render and makes a
    # valid logged-in profile look like it has no model selector.
    trigger_deadline = time.monotonic() + 60
    while time.monotonic() < trigger_deadline and trigger is None:
        for pattern in trigger_patterns:
            trigger = await _click_visible_text(
                page, pattern, selector='button, [role="button"]'
            )
            if trigger is not None:
                try:
                    trigger_text = " ".join((await trigger.inner_text()).split())
                except Exception:
                    trigger_text = ""
                trigger_clicked = True
                break
        if trigger is None:
            await page.wait_for_timeout(100)
    if trigger is None:
        if await _page_has_logged_out_marker(page):
            raise PreSubmitSessionExpiredError("Dola hiện Log In khi chờ model; cần Gmail relogin")
        raise RuntimeError("Không tìm thấy nút chọn model trên Dola")
    if any(pattern.search(trigger_text) for pattern in option_patterns):
        # The stable control already displays the requested model. Some menus
        # omit the selected option; do not fail waiting for a duplicate entry.
        if trigger_clicked:
            await page.keyboard.press("Escape")
        return
    # The stable-key path only locates the trigger; clicking is deliberately
    # done here after the fallback loop so both paths share the same timing
    # and force-click behaviour for animated action bars.
    if not trigger_clicked:
        try:
            await trigger.click(timeout=20000)
        except Exception:
            await trigger.click(timeout=20000, force=True)
    await page.wait_for_timeout(400)

    option_deadline = time.monotonic() + 60
    # A selected model and its menu option have identical labels. Exclude
    # the trigger by DOM identity, never by the visible model name.
    trigger_handle = await trigger.element_handle()
    while time.monotonic() < option_deadline:
        for pattern in option_patterns:
            selected = await _click_visible_text(
                page,
                pattern,
                selector='button, [role="button"], [role="option"], [role="menuitem"], [data-value]',
                skip_element=trigger_handle,
                force=True,
            )
            if selected is not None:
                await page.wait_for_timeout(500)
                return
        await page.wait_for_timeout(100)
    if await _page_has_logged_out_marker(page):
        raise PreSubmitSessionExpiredError("Dola hiện Log In khi chọn model; cần Gmail relogin")
    raise RuntimeError(f"Không tìm thấy lựa chọn {model_key} trên Dola")


async def _select_duration(page, duration: int) -> None:
    """Select an exact duration and fail instead of accepting Dola's default."""
    target_re = re.compile(
        rf"^\s*{int(duration)}\s*(?:s|sec(?:ond)?s?|秒(?:間)?)\s*$", re.IGNORECASE
    )
    # Some releases keep all options in the DOM, others show only the current
    # value until its dropdown is opened. Try the visible target first.
    if await _click_visible_text(page, target_re):
        await page.wait_for_timeout(350)
        return

    trigger_re = _DURATION_LABEL_RE
    trigger = await _click_visible_text(page, trigger_re)
    if trigger is not None:
        await page.wait_for_timeout(350)
        if await _click_visible_text(page, target_re):
            await page.wait_for_timeout(350)
            return

    # Last fallback for Radix/select implementations that expose the value
    # through a data attribute but not as a text node.
    attr = page.locator(
        f'[data-value="{int(duration)}"], [data-option-key="{int(duration)}"], '
        f'[value="{int(duration)}"]'
    )
    try:
        count = await attr.count()
        for index in range(count - 1, -1, -1):
            candidate = attr.nth(index)
            if await candidate.is_visible():
                await candidate.click(timeout=20000)
                await page.wait_for_timeout(350)
                return
    except Exception:
        pass
    raise RuntimeError(
        f"Không tìm thấy lựa chọn thời lượng {duration}s trên Dola; tác vụ chưa được gửi"
    )


async def _select_ratio(page, ratio: str) -> None:
    """Select an exact aspect ratio and fail instead of using Dola's default."""
    value = str(ratio or "").strip()
    if not value:
        return
    target_re = re.compile(rf"^\s*{re.escape(value)}\s*$", re.IGNORECASE)
    if await _click_visible_text(page, target_re):
        await page.wait_for_timeout(350)
        return

    trigger_patterns = (
        # A collapsed selector may display its current value (e.g. 9:16),
        # not the word "Ratio". Open that control before finding the target.
        re.compile(r"^\s*\d+\s*[:：]\s*\d+\s*$", re.IGNORECASE),
        re.compile(r"^\s*(?:比率|アスペクト比|画面比率|比例|画面比例)\s*$", re.IGNORECASE),
        re.compile(r"^\s*(?:aspect\s*ratio|ratio)\s*$", re.IGNORECASE),
    )
    for trigger_re in trigger_patterns:
        if await _click_visible_text(page, trigger_re, selector='button, [role="button"]'):
            await page.wait_for_timeout(350)
            if await _click_visible_text(page, target_re):
                await page.wait_for_timeout(350)
                return

    attr = page.locator(
        f'[data-value="{value}"], [data-option-key="{value}"], [value="{value}"]'
    )
    try:
        count = await attr.count()
        for index in range(count - 1, -1, -1):
            candidate = attr.nth(index)
            if await candidate.is_visible():
                await candidate.click(timeout=20000)
                await page.wait_for_timeout(350)
                return
    except Exception:
        pass
    raise RuntimeError(
        f"Không tìm thấy lựa chọn tỷ lệ {value} trên Dola; tác vụ chưa được gửi"
    )


async def _rewrite_generation_request(
    route,
    expected_model: str,
    expected_duration: int,
    expected_prompt: str | None = None,
    expected_ratio: str | None = None,
    expected_reference_count: int | None = None,
    expected_references_verified: bool = False,
    force_video_payload: bool = False,
    pro_chat: bool = False,
):
    """Validate native video input without changing the browser request bytes."""
    request = route.request
    raw = request.post_data
    try:
        body = json.loads(raw) if raw else None
        if not isinstance(body, dict):
            await route.continue_()
            return {"generation": False, "prompt_verified": False}

        if not pro_chat and not _is_video_generation_body(body):
            if not force_video_payload:
                await route.continue_()
                return {"generation": False, "prompt_verified": False}
            # Do not turn a plain chat into a synthetic video request. The
            # frontend must have committed the video composer state first.
            raise PromptPayloadError(
                "Dola composer gửi payload chat thường, chưa có cấu hình video; "
                "đã chặn request trước khi gửi, có thể thử profile khác"
            )

        param = _find_ability_param(body)
        if not pro_chat and (not param or not _model_value_matches(expected_model, param.get("model")) or _coerce_duration(param.get("duration")) != expected_duration):
            raise PromptPayloadError(
                "Cấu hình video native không khớp model/thời lượng; đã chặn request, không sửa payload"
            )
        if not pro_chat and expected_ratio and param.get("ratio") != expected_ratio:
            raise PromptPayloadError("Tỷ lệ video native không khớp; đã chặn request, không sửa payload")

        prompt_match = None
        if expected_prompt is not None:
            # The helper operates only on this parsed, throwaway object.
            # Verify OLD text; never send its replacement to the provider.
            prompt_match = _replace_prompt_in_payload(body, expected_prompt, expected_ratio)
            if not prompt_match:
                raise PromptPayloadError(
                    "Không tìm thấy trường prompt trong payload /chat/completion; "
                    "đã chặn request để tránh gửi prompt thiếu"
                )
            payload_prompt = _prompt_without_wrapper(prompt_match["old"], expected_ratio)
            if _prompt_compare_key(payload_prompt) != _prompt_compare_key(expected_prompt):
                raise PromptPayloadError(
                    "Prompt native không khớp nội dung đã nhập; đã chặn request "
                    f"(expected={len(_normalise_editor_text(expected_prompt))}, "
                    f"payload={len(_normalise_editor_text(payload_prompt))})"
                )
            ability_prompt = ((param or {}).get("input_box_content") or {}).get("user_input_content", "")
            if not pro_chat and _prompt_compare_key(ability_prompt) != _prompt_compare_key(expected_prompt):
                raise PromptPayloadError(
                    "Prompt trong ability native không khớp; đã chặn request "
                    f"(expected={len(_normalise_editor_text(expected_prompt))}, "
                    f"ability={len(_normalise_editor_text(ability_prompt))})"
                )

        reference_count = None
        # ``0`` is meaningful too: a text-only task must not inherit images
        # left in a persistent Dola draft. When the provider exposes a
        # reference container, require the exact task-owned count rather than
        # merely checking that the request has at least enough images.
        if expected_reference_count is not None:
            reference_count = _extract_submission_reference_count(
                body, expected_prompt=expected_prompt
            )
            if reference_count is not None and reference_count != expected_reference_count:
                if reference_count < expected_reference_count and expected_references_verified:
                    # SeedancePro/native upload completion is already verified
                    # before this route is armed. Some Dola builds serialize
                    # the current image list outside the prompt-bearing
                    # message, so the request inspector can see 0/2 even
                    # though the provider will receive the committed files.
                    # Keep the hard upper-bound guard for stale/duplicate
                    # attachments, but do not reject a verified upload merely
                    # because this schema exposes fewer current images.
                    print(
                        "[submit] Dola payload không phản ánh đủ số ảnh trong "
                        f"message hiện tại ({reference_count}/{expected_reference_count}); "
                        "đã dùng bằng chứng upload đã xác nhận",
                        flush=True,
                    )
                elif reference_count < expected_reference_count:
                    print(
                        "[submit-debug] reference schema="
                        + json.dumps(
                            _submission_reference_diagnostics(
                                body, expected_prompt=expected_prompt
                            ),
                            ensure_ascii=False,
                            separators=(",", ":"),
                        )[:6000],
                        flush=True,
                    )
                    raise PromptPayloadError(
                        "Dola payload chưa có đủ ảnh tham chiếu "
                        f"({reference_count}/{expected_reference_count}); "
                        "đã chặn request để tránh tạo video thiếu ảnh"
                    )
                else:
                    print(
                        "[submit-debug] reference schema="
                        + json.dumps(
                            _submission_reference_diagnostics(
                                body, expected_prompt=expected_prompt
                            ),
                            ensure_ascii=False,
                            separators=(",", ":"),
                        )[:6000],
                        flush=True,
                    )
                    raise PromptPayloadError(
                        "Dola payload có thừa ảnh tham chiếu "
                        f"({reference_count}/{expected_reference_count}); "
                        "đã chặn request để tránh gửi lại ảnh cũ của composer"
                    )

        # Always preserve the original request, including wrappers and JSON
        # formatting. Never transmit the throwaway object used for inspection.
        payload_changed = False
        await route.continue_()
        return {
            "generation": True,
            "payload_changed": payload_changed,
            "prompt_verified": expected_prompt is not None,
            "prompt_replaced": False,
            "prompt_path": prompt_match["path"] if prompt_match else None,
            "prompt_chars": len(expected_prompt) if expected_prompt is not None else None,
            "prompt_digest": _prompt_digest(expected_prompt) if expected_prompt is not None else None,
            "reference_count": reference_count,
        }
    except PromptPayloadError:
        raise
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise PromptPayloadError(
            "Payload /chat/completion không đọc được để xác nhận prompt: "
            f"{str(error)[:120]}"
        ) from error


# Read-only balance pre-check from recent conversations
def _provider_day_start_timestamp(now: float | None = None) -> float:
    """Return today's reset boundary in the same timezone as account usage."""
    try:
        tz = ZoneInfo(config.LIMIT_RESET_TZ)
    except Exception:
        tz = timezone(timedelta(hours=7))
    moment = datetime.now(tz) if now is None else datetime.fromtimestamp(now, tz)
    return datetime.combine(moment.date(), dt_time.min, tzinfo=tz).timestamp()


def _coerce_message_timestamp(value) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        timestamp = float(value)
        if timestamp > 1e14:
            timestamp /= 1e6
        elif timestamp > 1e11:
            timestamp /= 1e3
        return timestamp if timestamp > 0 else None
    except (TypeError, ValueError):
        pass
    try:
        raw = str(value).strip()
        if not raw:
            return None
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except (TypeError, ValueError, OverflowError):
        return None


BALANCE_JS = r"""
async ({msToken, fp, dayStart}) => {
  const params = new URLSearchParams({
    version_code: "20800", language: "ja", device_platform: "web",
    doubao_device_platform: "web", aid: "495671", real_aid: "495671",
    pkg_type: "release_version", pc_version: "3.32.62", doubao_pc_version: "3.32.62",
    region: "JP", sys_region: "JP", samantha_web: "1", web_platform: "browser",
    "use-olympus-account": "1", web_tab_id: crypto.randomUUID(),
  });
  if (msToken) params.set("msToken", msToken);
  if (fp) params.set("fp", fp);
  const headers = {
    "Content-Type": "application/json; encoding=utf-8",
    "agw-js-conv": "str", "Accept": "*/*",
  };
  const recent = await fetch("/im/chain/recent_conv?" + params.toString(), {
    method: "POST", headers,
    body: JSON.stringify({
      cmd: 3200,
      uplink_body: {pull_recent_conv_chain_uplink_body: {
        limit: 20, message_count_per_conv: 10, api_version: 1, conv_version: 0,
        direction: 3,
        option: {not_need_message: false, need_complete_conversation: true,
          need_coco_conversation: true, need_coco_bot: true,
          need_pc_pin_chain: true, pc_pin_query_type: 0},
      }},
      sequence_id: crypto.randomUUID(), channel: 2, version: "1",
    }), credentials: "include",
  });
  if (!recent.ok) return {ok: false, texts: []};
  const recentData = await recent.json();
  const body = recentData.downlink_body || {};
  const down = body.pull_recent_conv_chain_downlink_body || {};
  const cells = down.cells || [];
  const ids = cells.map(c => (c.conversation || {}).conversation_id || c.id)
    .filter(Boolean).slice(0, 10);
  if (!ids.length) return {ok: true, texts: []};

  const batch = await fetch("/im/chain/batch_single?" + params.toString(), {
    method: "POST", headers,
    body: JSON.stringify({
      cmd: 3101,
      uplink_body: {batch_pull_singe_chain_uplink_body: {
        conversation_type: 3, direction: 3, limit: 1,
        params: ids.map(conversation_id => ({conversation_id})),
        evaluate_ab_params: "", evaluate_common_params: "", ext: {},
      }},
      sequence_id: crypto.randomUUID(), channel: 2, version: "1",
    }), credentials: "include",
  });
  if (!batch.ok) return {ok: true, texts: []};
  const data = await batch.json();
  const messages = [];
  const seen = new Set();
  const timestampKeys = new Set([
    "create_time", "created_at", "send_time", "sent_at", "timestamp",
    "createTime", "createdAt", "sendTime", "sentAt", "timestamp_ms",
  ]);
  const timestampValue = value => {
    if (value == null || typeof value === "boolean") return null;
    const raw = typeof value === "string" ? value.trim() : value;
    if (!raw) return null;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e14 ? numeric / 1e6 : numeric > 1e11 ? numeric / 1e3 : numeric;
    }
    const parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  };
  const walk = (v, inheritedTimestamp = null) => {
    if (typeof v === "string") {
      const lower = v.toLowerCase();
      if (lower.includes("credit") && v.length < 1200 && !seen.has(v)) {
        seen.add(v);
        messages.push({text: v, timestamp: inheritedTimestamp});
      }
      if ((v.includes("ポイント") || v.includes("积分") || v.toLowerCase().includes("points")
        || v.includes("上限") || v.includes("limit")) && v.length < 1200 && !seen.has(v)) {
        seen.add(v); messages.push({text: v, timestamp: inheritedTimestamp});
      }
      try {
        const t = v.trim();
        if (t.startsWith("{") || t.startsWith("[")) walk(JSON.parse(t), inheritedTimestamp);
      } catch (e) {}
      return;
    }
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x, inheritedTimestamp); return; }
    let timestamp = inheritedTimestamp;
    for (const [key, value] of Object.entries(v)) {
      if (timestampKeys.has(key)) {
        const parsed = timestampValue(value);
        if (parsed) timestamp = parsed;
      }
    }
    for (const [key, value] of Object.entries(v)) {
      if (!timestampKeys.has(key)) walk(value, timestamp);
    }
  };
  walk(data);
  const now = Date.now() / 1000;
  const currentDayMessages = messages
    .filter(message => Number.isFinite(message.timestamp)
      && message.timestamp >= dayStart && message.timestamp <= now + 300)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 80);
  return {ok: true, messages: currentDayMessages};
}
""";


def find_captcha_frame(page):
    for f in page.frames:
        if CAPTCHA_FRAME_KEY in f.url:
            return f
    return None


async def _fetch_bytes(url: str, proxy: dict | str | None = None) -> bytes:
    async with aiohttp.ClientSession() as s:
        proxy_url = proxy.get("server") if isinstance(proxy, dict) else proxy
        proxy_auth = None
        if isinstance(proxy, dict) and proxy.get("username"):
            proxy_auth = aiohttp.BasicAuth(
                str(proxy.get("username")), str(proxy.get("password") or "")
            )
        async with s.get(url, proxy=proxy_url or config.PROXY or None,
                         proxy_auth=proxy_auth) as r:
            return await r.read()



def _reference_upload_phase(url: str, method: str = "") -> str:
    """Classify the two network stages used by Dola's browser uploader.

    Dola has changed the TOS host and occasionally the upload path between
    releases. Counting only one literal URL caused a real upload to be
    reported as missing even though the browser had finished it.
    """
    try:
        parsed = urlparse(str(url or ""))
    except ValueError:
        return ""
    path = (parsed.path or "").lower()
    host = (parsed.hostname or "").lower()
    if "/alice/resource/prepare_upload" in path:
        return "prepare"
    if "/upload/v1" in path:
        return "tos"
    # Keep the fallback limited to cross-origin storage uploads. This avoids
    # mistaking a Dola application endpoint such as /api/upload for TOS.
    if (
        method.upper() in {"POST", "PUT"}
        and "/upload/" in path
        and host
        and not host.endswith("dola.com")
    ):
        return "tos"
    return ""


def _safe_upload_endpoint(url: str) -> str:
    """Return upload host/path for diagnostics without leaking query tokens."""
    try:
        parsed = urlparse(str(url or ""))
        host = parsed.hostname or "unknown-host"
        path = parsed.path or "/"
        return f"{host}{path[:100]}"
    except ValueError:
        return "unknown-upload-endpoint"


async def _reference_image_snapshot(page) -> list[dict]:
    """Capture image nodes so diagnostics ignore pre-existing page images."""
    try:
        return await page.locator("img").evaluate_all(
            """nodes => nodes.map(node => ({
                src: node.currentSrc || node.src || '',
                alt: node.alt || '',
                className: String(node.className || '')
            })).filter(item => item.src || item.alt || item.className)"""
        )
    except Exception:
        return []


_CLEAR_COMPOSER_ATTACHMENTS_JS = r"""
async () => {
    const EDITOR_SELECTOR = 'textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], input[type="text"]';
    const CONTROL_SELECTOR = 'button, [role="button"], [aria-label], [title]';
    const IMAGE_SELECTOR = [
        'img',
        '[style*="blob:"]',
        '[style*="data:image"]',
        'input[type="file"]',
        '[class*="attachment" i]',
        '[class*="preview" i]',
        '[data-testid*="attachment" i]',
        '[data-testid*="preview" i]',
        '[data-testid*="upload" i]'
    ].join(', ');
    const REMOVE_WORDS = /remove|delete|discard|clear|close|xóa|xoá|gỡ|loại bỏ|移除|删除|取消/i;
    const IMAGE_WORDS = /image|photo|picture|attachment|file|upload|preview|reference|ảnh|hình|tệp|đính kèm|图片|照片|附件/i;
    const ATTACHMENT_MARKERS = /attachment|preview|upload|reference|file|đính\s*kèm|附件|上传|预览/i;

    const queryAllDeep = (selector) => {
        const result = [];
        const roots = [document];
        while (roots.length) {
            const root = roots.shift();
            let nodes = [];
            try { nodes = Array.from(root.querySelectorAll(selector)); } catch {}
            result.push(...nodes);
            let descendants = [];
            try { descendants = Array.from(root.querySelectorAll('*')); } catch {}
            descendants.forEach(node => {
                if (node.shadowRoot) roots.push(node.shadowRoot);
            });
        }
        return Array.from(new Set(result));
    };
    const visible = (element) => {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const identity = (element) => [
        element.getAttribute?.('aria-label'),
        element.getAttribute?.('title'),
        element.getAttribute?.('data-testid'),
        element.getAttribute?.('data-tooltip-content'),
        String(element.className || ''),
        String(element.textContent || '')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

    const editor = queryAllDeep(EDITOR_SELECTOR)
        .filter(visible)
        .map((element, index) => {
            const rect = element.getBoundingClientRect();
            const text = identity(element);
            let score = index;
            if (IMAGE_WORDS.test(text) || /prompt|message|video|describe|create/i.test(text)) score += 100;
            if (rect.bottom >= window.innerHeight * 0.45) score += 30;
            if (rect.width >= Math.min(320, window.innerWidth * 0.3)) score += 20;
            return {element, score};
        })
        .sort((left, right) => right.score - left.score)[0]?.element;
    if (!editor) return {removed: 0, remaining: 0, composer: false};

    let surface = editor.closest?.('.guidance-input-surface, [class*="guidance-input-surface"], [class*="input-content-container"]') || editor;
    let current = editor;
    for (let depth = 0; current && depth < 12; depth += 1) {
        const rect = current.getBoundingClientRect();
        const hasEditor = current.matches?.(EDITOR_SELECTOR) || Boolean(current.querySelector?.(EDITOR_SELECTOR));
        if (hasEditor && rect.width >= 240 && rect.height >= 24 && rect.height <= 640) surface = current;
        if (rect.height > 640) break;
        current = current.parentElement || current.getRootNode?.().host || null;
    }

    const surfaceRect = surface.getBoundingClientRect();
    const nearSurface = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.right >= surfaceRect.left - 100 && rect.left <= surfaceRect.right + 100 &&
            rect.bottom >= surfaceRect.top - 260 && rect.top <= surfaceRect.bottom + 280;
    };
    const isComposerFileInput = (element) => {
        if (!(element instanceof HTMLInputElement) || element.type !== 'file') return false;
        const accept = String(element.getAttribute('accept') || '').toLowerCase();
        const identityText = identity(element);
        if (/avatar|profile|logo|cover/.test(identityText)) return false;
        if (!/image|photo|picture|reference|attachment|upload|file/.test(accept + ' ' + identityText)) {
            return false;
        }
        if (surface.contains(element)) return true;
        let node = element.parentElement || element.getRootNode?.().host || null;
        for (let depth = 0; node && depth < 12; depth += 1) {
            if (node === surface || surface.contains(node)) return true;
            node = node.parentElement || node.getRootNode?.().host || null;
        }
        const inputId = element.getAttribute('id');
        if (inputId) {
            const escaped = typeof CSS?.escape === 'function'
                ? CSS.escape(inputId)
                : inputId.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
            try {
                return queryAllDeep(`label[for="${escaped}"]`).some(label => surface.contains(label));
            } catch {}
        }
        return false;
    };
    // Playwright's set_input_files replaces the DOM FileList, but Dola's
    // React state can retain the old attachment chips. Empty the active image
    // inputs first and emit the same events Dola handles for a user change.
    // This is deliberately scoped to the current composer, never the profile
    // avatar or another page upload control.
    let clearedInputs = 0;
    for (const input of queryAllDeep('input[type="file"]')) {
        if (!isComposerFileInput(input)) continue;
        try {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
            if (descriptor?.set) {
                const transfer = new DataTransfer();
                descriptor.set.call(input, transfer.files);
            } else {
                input.value = '';
            }
            input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
            input.dispatchEvent(new Event('change', {bubbles: true, composed: true}));
            clearedInputs += 1;
        } catch {}
    }
    const hasImageAncestor = (element) => {
        let node = element.parentElement || element.getRootNode?.().host || null;
        for (let depth = 0; node && depth < 8; depth += 1) {
            if (IMAGE_WORDS.test(identity(node))) return true;
            try {
                if (node.querySelector(IMAGE_SELECTOR)) return true;
            } catch {}
            if (node === surface) break;
            node = node.parentElement || node.getRootNode?.().host || null;
        }
        return false;
    };
    const attachmentRoots = () => {
        const roots = new Set();
        // Do not count every <img> near the composer. Dola keeps icons,
        // avatars and empty-state artwork in the same bottom area; treating
        // those as references caused a clean chat to be reported as
        // `previews=1`. A real upload is either a blob/data image or carries
        // an attachment/preview/upload marker in its own node or ancestor.
        const imageNodes = queryAllDeep(
            'img, [style*="blob:"], [style*="data:image"]'
        ).filter(element => !element.closest?.('#studio-relay-page-overlays'))
        .filter(element => {
            const source = [
                element.currentSrc,
                element.src,
                element.getAttribute?.('style'),
            ].filter(Boolean).join(' ');
            return /blob:/i.test(source) ||
                ATTACHMENT_MARKERS.test(identity(element));
        });
        for (const image of imageNodes) {
            if (!visible(image) || !nearSurface(image) || image === editor) continue;
            let node = image.parentElement || image.getRootNode?.().host || null;
            let fallback = null;
            for (let depth = 0; node && depth < 10; depth += 1) {
                if (node === surface) break;
                const rect = node.getBoundingClientRect?.();
                const nodeIdentity = identity(node);
                let hasControl = false;
                try {
                    hasControl = Boolean(node.querySelector('button, [role="button"]'));
                } catch {}
                const marked = ATTACHMENT_MARKERS.test(nodeIdentity);
                if (hasControl && rect && rect.width > 0 && rect.height > 0 && rect.height <= 320) {
                    if (!fallback) fallback = node;
                    if (marked) {
                        roots.add(node);
                        fallback = null;
                        break;
                    }
                }
                node = node.parentElement || node.getRootNode?.().host || null;
            }
            if (fallback) roots.add(fallback);
        }
        return Array.from(roots);
    };
    const isUnlabelledAttachmentClose = (element, roots) => {
        const semanticText = [
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('title'),
            element.getAttribute?.('data-tooltip-content'),
            String(element.textContent || '')
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (semanticText) return false;
        const rect = element.getBoundingClientRect();
        // Dola's current preview remove control is sometimes an icon-only
        // button with no aria-label/title. Restrict this fallback to a small
        // SVG control inside an actual preview root so the composer +/send
        // buttons are never treated as remove actions.
        if (rect.width <= 0 || rect.width > 52 || rect.height <= 0 || rect.height > 52) return false;
        if (!element.querySelector?.('svg')) return false;
        return roots.some(root => root !== surface && root.contains(element));
    };
    const candidates = () => {
        const roots = attachmentRoots();
        return queryAllDeep(CONTROL_SELECTOR)
        .filter(visible)
        .filter(element => !element.closest?.('#studio-relay-page-overlays'))
        .filter(element => surface.contains(element) || nearSurface(element))
        .filter(element => {
            const text = identity(element);
            return (
                (REMOVE_WORDS.test(text) && (IMAGE_WORDS.test(text) || hasImageAncestor(element)))
                || isUnlabelledAttachmentClose(element, roots)
            );
        });
    };

    const attachmentCount = () => attachmentRoots().length;
    const fileInputsWithFiles = () => queryAllDeep('input[type="file"]')
        .filter(isComposerFileInput)
        .filter(input => {
            try { return Number(input.files?.length || 0) > 0; } catch { return false; }
        }).length;

    let removed = 0;
    const attempted = new Set();
    for (let pass = 0; pass < 40; pass += 1) {
        const visibleCandidates = candidates();
        const candidate = visibleCandidates.find(element => !attempted.has(element));
        if (!candidate) break;
        attempted.add(candidate);
        try {
            candidate.focus?.({preventScroll: true});
            candidate.click();
            removed += 1;
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 120));
    }
    return {
        removed,
        clearedInputs,
        remaining: candidates().length,
        attachmentCount: attachmentCount(),
        fileInputsWithFiles: fileInputsWithFiles(),
        composer: true
    };
}
"""


async def _clear_composer_reference_attachments(page, task_id: str | None = None) -> dict:
    """Best-effort remove stale image chips from the active Dola composer.

    Persistent profiles can retain an unfinished draft after a browser-side
    upload or a pre-submit retry. Dola may append the next File to that draft,
    so a task requesting one reference can accidentally submit many. The
    outbound request validator remains the final guard when Dola changes its
    remove-button markup or the composer cannot be inspected.
    """
    label = f" task={task_id}" if task_id else ""
    try:
        result = await page.evaluate(_CLEAR_COMPOSER_ATTACHMENTS_JS)
    except Exception as error:
        print(
            f"[upload] Không thể dọn attachment cũ{label}: {str(error)[:160]}",
            flush=True,
        )
        return {
            "removed": 0,
            "remaining": None,
            "composer": False,
            "error": str(error)[:240],
        }
    if not isinstance(result, dict):
        return {
            "removed": 0,
            "remaining": None,
            "composer": False,
            "error": "clear script returned a non-object result",
        }
    try:
        removed = max(0, int(result.get("removed") or 0))
    except (TypeError, ValueError):
        removed = 0
    remaining = result.get("remaining")
    try:
        cleared_inputs = max(0, int(result.get("clearedInputs") or 0))
    except (TypeError, ValueError):
        cleared_inputs = 0
    try:
        attachment_count = max(0, int(result.get("attachmentCount") or 0))
    except (TypeError, ValueError):
        attachment_count = None
    try:
        file_inputs_with_files = max(0, int(result.get("fileInputsWithFiles") or 0))
    except (TypeError, ValueError):
        file_inputs_with_files = None
    if removed or cleared_inputs or remaining or attachment_count or file_inputs_with_files:
        print(
            f"[upload] Dọn attachment cũ{label}: removed={removed}, "
            f"file_inputs={cleared_inputs}, "
            f"remaining={remaining if remaining is not None else 'unknown'}, "
            f"previews={attachment_count if attachment_count is not None else 'unknown'}, "
            f"file_inputs_with_files={file_inputs_with_files if file_inputs_with_files is not None else 'unknown'}",
            flush=True,
        )
    return result


def _snapshot_key(item: dict) -> str:
    if not isinstance(item, dict):
        return ""
    return "\u001f".join(
        str(item.get(key) or "") for key in ("src", "alt", "className")
    )


def _new_reference_preview_count(before: list[dict], after: list[dict]) -> int:
    before_keys = {_snapshot_key(item) for item in before}
    return len({
        _snapshot_key(item)
        for item in after
        if _snapshot_key(item) and _snapshot_key(item) not in before_keys
    })


def _seedance_image_mime_type(image_path: Path) -> str:
    """Return a MIME type accepted by SeedancePro's image bridge."""
    mime_type = (mimetypes.guess_type(image_path.name)[0] or "").lower()
    if mime_type in SEEDANCE_IMAGE_MIME_TYPES:
        return mime_type
    suffix_map = {
        ".avif": "image/avif",
        ".gif": "image/gif",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }
    return suffix_map.get(image_path.suffix.lower(), "")


async def _dispatch_seedance_image_request(
    page, event_name: str, response_name: str, detail: str, request_id: str,
    timeout_ms: int = SEEDANCE_IMAGE_BRIDGE_TIMEOUT_MS,
    timeout_error: str = SEEDANCE_IMAGE_BRIDGE_TIMEOUT_ERROR,
    repeat_ms: int = 0,
) -> dict:
    """Dispatch one extension DOM request and await its response.

    A content script can be one render turn behind a newly opened Dola tab.
    Optional short redispatches let a request reach a late-loaded extension
    listener without making the caller reload the profile or wait for a long
    fixed timeout. Consumers that enable this must de-duplicate request IDs.
    """
    try:
        result = await page.evaluate(
            """async ({requestEvent, responseEvent, detail, requestId, timeoutMs, timeoutError, repeatMs}) => {
                let timer = null;
                let repeatTimer = null;
                let settled = false;
                let onResponse = null;
                const finish = (value) => {
                    if (settled) return value;
                    settled = true;
                    if (timer !== null) window.clearTimeout(timer);
                    if (repeatTimer !== null) window.clearInterval(repeatTimer);
                    if (onResponse) {
                        document.removeEventListener(responseEvent, onResponse, true);
                    }
                    return value;
                };
                const dispatch = () => {
                    try {
                        document.dispatchEvent(new CustomEvent(requestEvent, {detail}));
                        return true;
                    } catch (error) {
                        resolveOnce(finish({
                            success: false,
                            committed: false,
                            error: String(error?.message || error)
                        }));
                        return false;
                    }
                };
                let resolveOnce = () => {};
                return await new Promise((resolve) => {
                    resolveOnce = resolve;
                    onResponse = (event) => {
                        if (typeof event.detail !== 'string') return;
                        let value;
                        try { value = JSON.parse(event.detail); } catch { return; }
                        if (value?.requestId !== requestId) return;
                        resolve(finish(value));
                    };
                    document.addEventListener(responseEvent, onResponse, true);
                    timer = window.setTimeout(() => resolve(finish({
                        success: false,
                        committed: false,
                        error: timeoutError
                    })), Number(timeoutMs) || 7000);
                    dispatch();
                    const intervalMs = Math.max(0, Number(repeatMs) || 0);
                    if (intervalMs > 0) {
                        repeatTimer = window.setInterval(() => {
                            if (!settled) dispatch();
                        }, intervalMs);
                    }
                });
            }""",
            {
                "requestEvent": event_name,
                "responseEvent": response_name,
                "detail": detail,
                "requestId": request_id,
                "timeoutMs": timeout_ms,
                "timeoutError": timeout_error,
                "repeatMs": repeat_ms,
            },
        )
    except Exception as error:
        # A tab reload can destroy the execution context while the composer is
        # hydrating. Let the caller use the existing native fallback in that
        # case instead of reporting a misleading Dola upload failure.
        raise SeedanceImageBridgeUnavailableError(str(error)) from error

    if not isinstance(result, dict):
        raise SeedanceImageBridgeUnavailableError(
            "SeedancePro image bridge did not respond"
        )
    return result


async def _fill_prompt_with_seedance_extension(
    page, prompt: str, task_label: str = ""
) -> str:
    """Let SeedancePro fill the exact, already-canonical prompt into Dola.

    The Gateway remains the single owner of prompt formatting. SeedancePro is
    responsible for the browser-side editor injection, just like it is for
    the reference-image bridge. Keeping the payload canonical here prevents
    the extension's optional popup formatter from appending a second prefix,
    duration, ratio, model, or human-artifact instruction.
    """
    value = str(prompt or "").strip()
    if not value:
        raise SeedancePromptBridgeError("Prompt rỗng; không thể gửi qua SeedancePro")

    label = f"{task_label}: " if task_label else ""
    last_error: Exception | None = None
    for attempt in range(1, SEEDANCE_PROMPT_BRIDGE_ATTEMPTS + 1):
        request_id = f"studio-prompt-{uuid4().hex}"
        detail = json.dumps(
            {
                "v": 1,
                "requestId": request_id,
                "prompt": value,
                "autoSubmit": False,
                "mode": "pro",
                "attempt": attempt,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        try:
            result = await _dispatch_seedance_image_request(
                page,
                SEEDANCE_WORKER_PROMPT_REQUEST_EVENT,
                SEEDANCE_WORKER_PROMPT_RESPONSE_EVENT,
                detail,
                request_id,
                timeout_ms=SEEDANCE_PROMPT_BRIDGE_TIMEOUT_MS,
                timeout_error=SEEDANCE_PROMPT_BRIDGE_TIMEOUT_ERROR,
                repeat_ms=SEEDANCE_PROMPT_BRIDGE_REPEAT_MS,
            )
        except SeedanceImageBridgeUnavailableError as error:
            last_error = SeedancePromptBridgeUnavailableError(
                "SeedancePro prompt bridge không khả dụng trên tab hiện tại"
            )
        else:
            if result.get("error") == SEEDANCE_PROMPT_BRIDGE_TIMEOUT_ERROR:
                last_error = SeedancePromptBridgeUnavailableError(
                    f"{label}SeedancePro không phản hồi bridge nhập prompt"
                )
            elif not result.get("success"):
                last_error = SeedancePromptBridgeError(
                    str(result.get("error") or "SeedancePro không nhập được prompt")
                )
            else:
                injected = str(result.get("prompt") or value)
                if _prompt_compare_key(injected) != _prompt_compare_key(value):
                    last_error = SeedancePromptBridgeError(
                        "SeedancePro xác nhận nội dung prompt khác với payload Gateway"
                    )
                else:
                    try:
                        # The extension response is deliberately quick. Keep
                        # this second check short so a detached editor does not
                        # consume the global 60-second Playwright timeout.
                        editor = await _wait_for_prompt_editor(page, timeout=5000)
                        actual = await _wait_for_prompt_value(
                            page, editor, value, timeout_ms=4000
                        )
                    except (PreSubmitRiskControlError, PreSubmitSessionExpiredError):
                        raise
                    except Exception as error:
                        last_error = SeedancePromptBridgeError(
                            "SeedancePro đã phản hồi nhưng chưa xác nhận được nội dung trong ô prompt"
                        )
                        last_error.__cause__ = error
                    else:
                        if _prompt_compare_key(actual) == _prompt_compare_key(value):
                            return injected
                        last_error = SeedancePromptBridgeError(
                            "Nội dung trong ô prompt khác với payload Gateway sau khi extension nhập"
                        )

        if attempt < SEEDANCE_PROMPT_BRIDGE_ATTEMPTS:
            print(
                f"[prompt-bridge] {label}thử lại nhập prompt qua SeedancePro "
                f"({attempt + 1}/{SEEDANCE_PROMPT_BRIDGE_ATTEMPTS}): {last_error}",
                flush=True,
            )
            # A Dola composer re-render usually settles in one or two frames;
            # do not reload the profile just because the first editor node was
            # replaced after the image upload.
            await page.wait_for_timeout(350 if attempt == 1 else 600)

    if last_error is not None:
        raise last_error
    raise SeedancePromptBridgeError("SeedancePro không nhập được prompt")


async def _seedance_main_world_attach(
    page, image_path: str | Path, replace_existing: bool = False,
) -> dict:
    """Attach one image through SeedancePro's verified DOM bridge.

    The extension's isolated content script first uses its verified uploader,
    which silently activates Dola's ``+`` menu and waits for an attachment
    preview. If that content script is not present yet, fall back to the
    extension's MAIN-world assignment bridge. Both paths avoid waiting for a
    native file chooser or relying on Playwright's isolated-world input
    locator, which caused the ``file_input_missing`` failures.
    """
    path = Path(str(image_path))
    if not path.is_file():
        raise SeedanceImageBridgeError(f"Reference image does not exist: {path.name}")
    raw = await asyncio.to_thread(path.read_bytes)
    if not raw:
        raise SeedanceImageBridgeError(f"Reference image is empty: {path.name}")
    if len(raw) > SEEDANCE_MAX_IMAGE_BYTES:
        raise SeedanceImageBridgeError(
            f"Reference image is larger than 25 MB: {path.name}"
        )
    mime_type = _seedance_image_mime_type(path)
    if not mime_type:
        raise SeedanceImageBridgeError(
            f"Unsupported reference image type: {path.suffix or path.name}"
        )

    request_id = f"studio-{uuid4().hex}"
    data_url = f"data:{mime_type};base64,{base64.b64encode(raw).decode('ascii')}"
    image_payload = {
        "name": path.name,
        "type": mime_type,
        "size": len(raw),
        "lastModified": int(path.stat().st_mtime * 1000),
        "dataUrl": data_url,
        # The first image starts a new task-owned attachment set. Subsequent
        # images in the same task must append to that set.
        "replaceExisting": bool(replace_existing),
    }
    worker_detail = json.dumps(
        {
            "v": 1,
            "requestId": request_id,
            "image": image_payload,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )

    try:
        result = await _dispatch_seedance_image_request(
            page,
            SEEDANCE_WORKER_IMAGE_REQUEST_EVENT,
            SEEDANCE_WORKER_IMAGE_RESPONSE_EVENT,
            worker_detail,
            request_id,
            repeat_ms=350,
        )
    except SeedanceImageBridgeUnavailableError:
        result = {"error": "__seedance_image_bridge_timeout__"}
    if result.get("error") == "__seedance_image_bridge_timeout__":
        main_detail = json.dumps(
            {"v": 2, "requestId": request_id, "image": image_payload},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        result = await _dispatch_seedance_image_request(
            page,
            SEEDANCE_MAIN_IMAGE_REQUEST_EVENT,
            SEEDANCE_MAIN_IMAGE_RESPONSE_EVENT,
            main_detail,
            request_id,
            repeat_ms=350,
        )
    if result.get("error") == "__seedance_image_bridge_timeout__":
        raise SeedanceImageBridgeUnavailableError(
            "SeedancePro MAIN-world image bridge did not respond"
        )
    if not result.get("success") or not (
        result.get("committed") or result.get("verified")
    ):
        raise SeedanceImageBridgeError(
            str(result.get("error") or "SeedancePro could not attach the reference image")
        )
    return result


async def _attach_references_with_seedance_bridge(
    page, image_paths: list[str], task_label: str = "", wait_for_upload=None,
) -> list[dict] | bool:
    """Use the SeedancePro uploader for all references, or report unavailable.

    Return the bridge results so the caller can use SeedancePro's own verified
    preview signal when the storage upload requests are not visible to
    Playwright. ``False`` still means the extension bridge was unavailable.
    """
    attached = []
    for index, image_path in enumerate(image_paths, start=1):
        try:
            result = await _seedance_main_world_attach(
                page, image_path, replace_existing=(index == 1)
            )
        except SeedanceImageBridgeUnavailableError:
            if attached:
                raise SeedanceImageBridgeError(
                    "SeedancePro image bridge disappeared after a partial upload"
                )
            return False
        attached.append(result)
        if wait_for_upload:
            # The extension can verify the attachment in the composer even
            # when the upload request is issued by a page/service worker that
            # Patchright cannot observe. Pass that verified result through so
            # the caller can use a bounded extension-evidence fallback without
            # assigning the same image again through the native input.
            try:
                accepts_result = any(
                    parameter.kind in (
                        inspect.Parameter.POSITIONAL_ONLY,
                        inspect.Parameter.POSITIONAL_OR_KEYWORD,
                        inspect.Parameter.VAR_POSITIONAL,
                    )
                    for parameter in inspect.signature(wait_for_upload).parameters.values()
                ) and len(inspect.signature(wait_for_upload).parameters) >= 2
            except (TypeError, ValueError):
                accepts_result = False
            if accepts_result:
                await wait_for_upload(index, result)
            else:
                await wait_for_upload(index)
        print(
            f"[upload] SeedancePro MAIN bridge attached reference {index}/"
            f"{len(image_paths)}{task_label} (method={result.get('method', 'unknown')})",
            flush=True,
        )
        # Let Dola process the change event before the next DataTransfer is
        # assigned to the same lazily-mounted input.
        await page.wait_for_timeout(250)
    return attached


async def _reset_video_composer(page, chat_mode: str = "Pro") -> None:
    """Start a clean video composer before retrying a failed image upload."""
    try:
        await _reload_before_submit(page)
    except Exception as error:
        if _is_pre_submit_navigation_timeout(error):
            raise PreSubmitSetupError(
                f"Dola không reload được composer trước khi gửi: {str(error).splitlines()[0]}"
            ) from error
        raise
    # Reloading /chat can restore the previous profile draft. Always open a
    # task-owned chat after a failed upload attempt so the native fallback
    # cannot append to that restored draft.
    await _wait_for_prompt_editor(page, timeout=60000)
    await _open_fresh_chat(page, previous_id="", timeout_ms=15000, force=True)
    await _select_chat_mode(page, chat_mode)


def _clear_result_attachment_count(result: dict) -> int | None:
    """Return the observable stale-attachment count from a clear pass."""
    if not isinstance(result, dict):
        return None
    counts = []
    for key in ("attachmentCount", "fileInputsWithFiles", "remaining"):
        value = result.get(key)
        if value is None:
            continue
        try:
            counts.append(max(0, int(value)))
        except (TypeError, ValueError):
            continue
    return max(counts) if counts else None


async def _ensure_clean_video_composer(
    page, task_id: str | None = None, *, chat_mode: str = "Pro"
) -> dict:
    """Clear the persistent Dola draft and prove it is safe to reuse.

    A persistent profile can hold React attachment state even after the native
    FileList is empty. Never proceed with a new manifest when the clear script
    cannot inspect the composer or still observes an attachment. Reopen a
    fresh chat once, then fail before upload if the state is still unknown.
    """
    label = f" task={task_id}" if task_id else ""
    result = await _clear_composer_reference_attachments(page, task_id)
    count = _clear_result_attachment_count(result)
    verified = isinstance(result, dict) and result.get("composer") is True
    if verified and count == 0:
        return result

    if not verified:
        reason = "không xác minh được trạng thái composer"
    else:
        reason = f"còn {count if count is not None else 'không rõ số'} attachment cũ"
    print(
        f"[upload] Composer cần reset{label}: {reason}; mở chat mới trước khi tiếp tục",
        flush=True,
    )
    await _reset_video_composer(page, chat_mode=chat_mode)
    result = await _clear_composer_reference_attachments(page, task_id)
    count = _clear_result_attachment_count(result)
    if not isinstance(result, dict) or result.get("composer") is not True:
        raise PreSubmitAttachmentSetupError(
            f"Không xác minh được composer sau khi reset{label}; "
            "đã dừng trước khi upload để tránh nối ảnh cũ"
        )
    if count != 0:
        raise PreSubmitAttachmentSetupError(
            f"Dola composer còn {count if count is not None else 'không rõ số'} "
            f"attachment cũ sau khi reset{label}; đã dừng trước khi upload "
            "để tránh nhân ảnh tham chiếu"
        )
    return result


async def _wait_for_reference_network_quiet(
    page, last_upload_activity: list[float],
    quiet_seconds: float = 1.2, timeout_ms: int = 3500,
) -> None:
    """Give Dola one short commit window after the final image upload.

    The upload request can finish before React copies the object URLs into
    the composer message. Waiting on a fixed long sleep either races that
    commit or makes every task slow. Poll the existing activity timestamp and
    stop as soon as the short quiet window is reached.
    """
    deadline = time.monotonic() + max(1, timeout_ms) / 1000
    while time.monotonic() < deadline:
        if time.monotonic() - last_upload_activity[0] >= quiet_seconds:
            return
        await page.wait_for_timeout(100)


async def attach_reference_images(
    page, image_paths: list[str], task_id: str | None = None,
    on_profile_bound=None, chat_mode: str = "Pro",
) -> None:
    """Upload references and wait for the provider's final object uploads.

    ``prepare_upload`` is a metadata/pre-sign step and is not guaranteed to
    produce one response per file on every Dola build. The TOS upload response
    plus a short settle window is the reliable completion signal; requiring an
    exact prepare count caused false failures such as prepare=3/4, tos=4/4.
    A single clean composer retry handles transient TOS failures, which were
    previously surfaced as a hard render timeout after the first attempt.
    """
    if not image_paths:
        return
    expected = len(image_paths)
    task_label = f" task={task_id}" if task_id else ""
    # A bridge can assign a File before it returns its final verification
    # result. Reserve the profile at the start of the image workflow so any
    # later upload timeout/error cannot make the pool replay the same manifest
    # on another persistent profile.
    if on_profile_bound:
        on_profile_bound()
    last_stats = {
        "prepare": 0,
        "tos": 0,
        "pending": 0,
        "failed": [],
        "previews": 0,
        "bridge_verified": 0,
        "bridge_committed": 0,
        "signal": "none",
    }
    # One retry is enough for a transient missing TOS response and prevents a
    # bad provider response from multiplying uploads indefinitely.
    for attempt in range(2):
        # A persistent profile can keep the previous task's attachment chips
        # in Dola's draft. Clear and verify them before taking the baseline
        # snapshot so the next task owns exactly its own reference manifest.
        await _ensure_clean_video_composer(page, task_id, chat_mode=chat_mode)
        before_images = await _reference_image_snapshot(page)
        requests = {}
        last_upload_activity = [time.monotonic()]
        upload_started_at = time.monotonic()

        def on_request(request):
            phase = _reference_upload_phase(request.url, request.method)
            if not phase:
                return
            last_upload_activity[0] = time.monotonic()
            requests[id(request)] = {
                # Keep the wrapper alive until the attempt finishes. Patchright
                # can otherwise garbage-collect a request between the request
                # and response events and reuse its Python id for the next
                # upload, making a 4-file upload look like 3 files.
                "request": request,
                "phase": phase,
                "url": request.url,
                "method": request.method,
                "status": None,
                "done": False,
                "ok": False,
            }

        def on_response(response):
            request = response.request
            phase = _reference_upload_phase(request.url, request.method)
            if not phase:
                return
            last_upload_activity[0] = time.monotonic()
            item = requests.setdefault(id(request), {
                "request": request,
                "phase": phase,
                "url": request.url,
                "method": request.method,
                "status": None,
                "done": False,
                "ok": False,
            })
            item["status"] = response.status
            item["done"] = True
            item["ok"] = 200 <= response.status < 300

        def on_request_finished(request):
            item = requests.get(id(request))
            if item:
                last_upload_activity[0] = time.monotonic()
                item["done"] = True

        def on_request_failed(request):
            item = requests.get(id(request))
            if item:
                last_upload_activity[0] = time.monotonic()
                item["done"] = True
                item["ok"] = False

        # Uploads may originate from a worker rather than the visible page.
        # Observe the owning browser context, as we do for submission ACKs.
        upload_scope = getattr(page, "context", None) or page
        upload_scope.on("request", on_request)
        upload_scope.on("response", on_response)
        upload_scope.on("requestfinished", on_request_finished)
        upload_scope.on("requestfailed", on_request_failed)
        input_timeout_error = None
        bridge_error = None
        try:
            # SeedancePro owns a MAIN-world uploader that can activate the
            # icon-only + menu and assign a File without exposing a native
            # file chooser to Playwright. Prefer it for this extension. The
            # old Playwright input path remains available for older profiles
            # or a tab that has not loaded SeedancePro yet.
            try:
                async def wait_for_uploaded_image(index, bridge_result=None):
                    # The first bridge/native assignment is the point at which
                    # this profile owns the task's input. Bind it before
                    # waiting for storage confirmation so a timeout cannot
                    # rotate the same image prompt to another profile.
                    if index == 1 and on_profile_bound:
                        on_profile_bound()
                    # committed acknowledges FileList assignment, not the
                    # asynchronous upload. Do not replace the input again
                    # until the preceding image has reached storage.
                    deadline = time.monotonic() + SEEDANCE_IMAGE_UPLOAD_CONFIRM_TIMEOUT_SECONDS
                    # Worker/page network events are not guaranteed to expose
                    # uploads issued by Dola's own service worker. The
                    # SeedancePro content script has already waited for a
                    # composer-level attachment signal in this case. Give
                    # Dola a short settle window, then accept that verified
                    # result instead of falling back to native input and
                    # attaching the same image a second time.
                    extension_evidence_deadline = (
                        time.monotonic() + 15
                        if isinstance(bridge_result, dict)
                        and bridge_result.get("verified") is True
                        else None
                    )
                    while time.monotonic() < deadline:
                        uploads = [item for item in requests.values() if item["phase"] == "tos"]
                        if any(item["done"] and not item["ok"] for item in uploads):
                            raise SeedanceImageBridgeError(f"Reference {index}/{expected}: storage upload failed")
                        if sum(item["done"] and item["ok"] for item in uploads) >= index:
                            await page.wait_for_timeout(450)
                            return
                        # A MAIN-world FileList assignment is only a local
                        # commit. When neither upload requests nor composer
                        # evidence appear, waiting the full storage timeout
                        # only parks the task before its clean native retry.
                        if (
                            not requests
                            and extension_evidence_deadline is None
                            and time.monotonic() - upload_started_at
                            >= SEEDANCE_IMAGE_NO_SIGNAL_TIMEOUT_SECONDS
                            and _new_reference_preview_count(
                                before_images, await _reference_image_snapshot(page)
                            ) == 0
                        ):
                            raise SeedanceImageBridgeError(
                                f"Reference {index}/{expected}: no upload signal after "
                                f"{SEEDANCE_IMAGE_NO_SIGNAL_TIMEOUT_SECONDS}s"
                            )
                        if (
                            extension_evidence_deadline is not None
                            and time.monotonic() >= extension_evidence_deadline
                        ):
                            # Dola can expose a TOS request to the browser
                            # context without exposing its service-worker
                            # response. The extension has already verified
                            # the attachment in the live composer, so a
                            # pending/hidden request is not permission to
                            # assign the same File through the native input.
                            # A genuinely failed request remains terminal.
                            if any(
                                item["done"] and not item["ok"]
                                for item in uploads
                            ):
                                raise SeedanceImageBridgeError(
                                    f"Reference {index}/{expected}: storage upload failed"
                                )
                            print(
                                f"[upload] SeedancePro đã xác nhận reference {index}/{expected} "
                                "trên composer; không lặp lại bằng native input vì Dola không "
                                f"expose upload event cho Patchright (observed={len(uploads)}, "
                                f"pending={sum(not item['done'] for item in uploads)})",
                                flush=True,
                            )
                            await page.wait_for_timeout(1000)
                            return
                        await page.wait_for_timeout(250)
                    raise SeedanceImageBridgeError(
                        f"Reference {index}/{expected}: upload not confirmed after "
                        f"{SEEDANCE_IMAGE_UPLOAD_CONFIRM_TIMEOUT_SECONDS}s "
                        f"(observed={len(uploads)}, "
                        f"completed={sum(item['done'] and item['ok'] for item in uploads)}, "
                        f"pending={sum(not item['done'] for item in uploads)})"
                    )

                # After a failed attempt, use Dola's native uploader on the
                # fresh composer instead of repeating the same bridge failure.
                bridge_used = await _attach_references_with_seedance_bridge(
                    page, image_paths, task_label=task_label,
                    wait_for_upload=wait_for_uploaded_image,
                ) if attempt == 0 else False
                # A verified SeedancePro result is the authoritative signal
                # when Dola uploads from its service worker: Patchright may
                # observe zero page/context upload requests even though the
                # extension has confirmed every composer attachment. Do not
                # fall through to the native input after that confirmation.
                if (
                    isinstance(bridge_used, list)
                    and len(bridge_used) == expected
                    and all(
                        isinstance(item, dict) and item.get("verified") is True
                        for item in bridge_used
                    )
                ):
                    print(
                        f"[upload] Reference images uploaded: {expected} image(s)"
                        f"{task_label} (SeedancePro verified composer; "
                        "service-worker upload event hidden from Patchright)",
                        flush=True,
                    )
                    await page.wait_for_timeout(450)
                    return
            except SeedanceImageBridgeError as error:
                bridge_used = False
                bridge_error = error

            if bridge_error is None and not bridge_used:
                print(
                    f"[upload] SeedancePro MAIN bridge unavailable; dùng native "
                    f"file input cho{task_label or ' current task'}",
                    flush=True,
                )
                try:
                    # The extension bridge already gets a full bounded chance
                    # before this legacy path. Do not leave a task parked for
                    # a minute waiting for an input that Dola will never
                    # mount; the clean retry below is faster and safer.
                    file_input = await _wait_for_file_input(page, timeout=30000)
                except TimeoutError as error:
                    input_timeout_error = error
                else:
                    await file_input.set_input_files(image_paths)

            if input_timeout_error is not None or bridge_error is not None:
                # Finish this attempt after removing listeners below, then
                # recreate the composer cleanly before the single retry.
                pass
            else:
                # Setting the file input, or the bridge's DataTransfer change
                # event, hands the reference payload to this browser profile.
                # Bind it before waiting for every upload ACK so a
                # partial/slow upload can never make the pool submit the same
                # image prompt through another profile.
                if on_profile_bound:
                    on_profile_bound()
            if input_timeout_error is not None or bridge_error is not None:
                raise _SkipReferenceUploadAttempt()
            # Setting the file input hands the reference payload to this
            # browser profile. Bind it before waiting for every upload ACK so
            # a partial/slow upload can never make the pool submit the same
            # image prompt through another profile.
            deadline = time.monotonic() + max(120, expected * 20)
            while time.monotonic() < deadline:
                prepare_count = sum(
                    item["phase"] == "prepare" and item["ok"]
                    for item in requests.values()
                )
                tos_count = sum(
                    item["phase"] == "tos" and item["ok"]
                    for item in requests.values()
                )
                pending_count = sum(
                    item["phase"] == "tos" and not item["done"]
                    for item in requests.values()
                )
                failed = [
                    f"{item['method']} {_safe_upload_endpoint(item['url'])}"
                    f" status={item['status'] or 'failed'}"
                    for item in requests.values()
                    if item["phase"] == "tos" and item["done"] and not item["ok"]
                ]
                after_images = await _reference_image_snapshot(page)
                preview_count = _new_reference_preview_count(before_images, after_images)
                bridge_verified_count = (
                    sum(bool(item.get("verified")) for item in bridge_used)
                    if isinstance(bridge_used, list)
                    else 0
                )
                # Bridge acknowledgements are diagnostic only. FileList
                # assignment and local thumbnails do not prove upload success.
                bridge_committed_count = (
                    sum(
                        bool(item.get("committed") or item.get("verified"))
                        for item in bridge_used
                    )
                    if isinstance(bridge_used, list)
                    else 0
                )
                last_stats = {
                    "prepare": prepare_count,
                    "tos": tos_count,
                    "pending": pending_count,
                    "failed": failed,
                    "previews": preview_count,
                    "bridge_verified": bridge_verified_count,
                    "bridge_committed": bridge_committed_count,
                    "signal": "tos" if tos_count >= expected else "none",
                }
                if tos_count >= expected and pending_count == 0 and not failed:
                    # A successful TOS response is not quite the same as a
                    # committed composer attachment. Let the last response
                    # and Dola's React attachment state settle briefly before
                    # the prompt bridge runs.
                    await _wait_for_reference_network_quiet(
                        page, last_upload_activity, quiet_seconds=1.2, timeout_ms=3500
                    )
                    await page.wait_for_timeout(450)
                    print(
                        f"[upload] Reference images uploaded: {expected} image(s){task_label} "
                        f"(prepare={prepare_count}/{expected}, tos={tos_count}/{expected}, "
                        f"attempt={attempt + 1}/2)",
                        flush=True,
                    )
                    return
                observed_tos = sum(item["phase"] == "tos" for item in requests.values())
                # A failed TOS request is terminal for this composer. Do not
                # burn the full 120-second watchdog before the clean retry.
                if (
                    pending_count == 0
                    and failed
                    and observed_tos > 0
                    and time.monotonic() - last_upload_activity[0] >= 1.5
                ):
                    break
                # A native fallback can otherwise keep polling the 120-second
                # deadline when neither Dola nor the browser emits any upload
                # signal. Retry the composer while the failure is still
                # pre-submit and cannot have created a video.
                if (
                    not requests
                    and preview_count == 0
                    and time.monotonic() - upload_started_at >= 15
                ):
                    last_stats["signal"] = "no_upload_signal"
                    break
                await page.wait_for_timeout(250)
        except _SkipReferenceUploadAttempt:
            pass
        finally:
            upload_scope.remove_listener("request", on_request)
            upload_scope.remove_listener("response", on_response)
            upload_scope.remove_listener("requestfinished", on_request_finished)
            upload_scope.remove_listener("requestfailed", on_request_failed)

        if input_timeout_error is not None:
            last_stats["signal"] = "file_input_missing"
            if attempt == 0:
                print(
                    f"[upload] Dola chưa mount input ảnh; mở lại composer "
                    f"cho{task_label or ' current task'}",
                    flush=True,
                )
                await _reset_video_composer(page)
                continue
            raise ReferenceImageUploadTimeoutError(
                f"Reference image input timeout{task_label} after 2 attempts: "
                f"expected={expected}, signal=file_input_missing"
            ) from input_timeout_error

        if bridge_error is not None:
            last_stats["signal"] = "seedance_bridge_failed"
            last_stats["failed"] = [str(bridge_error)]
            if attempt == 0:
                print(
                    f"[upload] SeedancePro bridge upload chưa hoàn tất; mở lại "
                    f"composer cho{task_label or ' current task'}: {bridge_error}",
                    flush=True,
                )
                await _reset_video_composer(page)
                continue
            raise ReferenceImageUploadTimeoutError(
                f"Reference image upload timeout{task_label} after 2 attempts: "
                f"expected={expected}, signal=seedance_bridge_failed: {bridge_error}"
            ) from bridge_error

        if attempt == 0:
            print(
                f"[upload] Reference upload incomplete; retrying clean composer "
                f"for{task_label or ' current task'} "
                f"(prepare={last_stats['prepare']}/{expected}, "
                f"tos={last_stats['tos']}/{expected}, "
                f"pending={last_stats['pending']}, "
                f"failed={len(last_stats['failed'])})",
                flush=True,
            )
            await _reset_video_composer(page)

    failure_detail = "; ".join(last_stats["failed"][:2])
    if failure_detail:
        failure_detail = f", failed={failure_detail}"
    raise ReferenceImageUploadTimeoutError(
        f"Reference image upload timeout{task_label} after 2 attempts: "
        f"prepare={last_stats['prepare']}/{expected}, "
        f"tos={last_stats['tos']}/{expected}, "
        f"pending={last_stats['pending']}, "
        f"new_previews={last_stats['previews']}/{expected}, "
        f"signal={last_stats['signal']}{failure_detail}"
    )


def _gen_track(distance: float):
    """Generates humanized mouse drag trajectory."""
    steps = random.randint(45, 65)
    overshoot = random.uniform(3, 9)
    pts = []
    for i in range(1, steps + 1):
        t = i / steps
        s = 10 * t**3 - 15 * t**4 + 6 * t**5
        x = (distance + overshoot) * s
        y = random.uniform(-1.5, 1.5) if 0.1 < t < 0.95 else 0
        pts.append((x, y, random.randint(8, 22)))
    for i in range(1, random.randint(3, 5) + 1):
        pts.append((distance + overshoot * (1 - i / 5), random.uniform(-0.8, 0.8), random.randint(15, 30)))
    return pts


async def solve_slider(page, frame, attempt: int, proxy: dict | str | None = None) -> bool:
    """Solves captcha slider notch within iframe and performs drag."""
    await frame.wait_for_selector("img", timeout=60000)
    await frame.evaluate("""async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 10000) {
            const imgs = [...document.images];
            if (imgs.length >= 2 && imgs.every(im => im.complete && im.naturalWidth > 0)) return;
            await new Promise(r => setTimeout(r, 200));
        }
        throw new Error("captcha images load timeout");
    }""")
    await page.wait_for_timeout(800)

    imgs = await frame.evaluate("""() => [...document.images].map(im => ({
        src: im.src, w: im.naturalWidth, h: im.naturalHeight,
        bw: im.getBoundingClientRect().width,
        left: im.getBoundingClientRect().left,
    }))""")
    bg = next((i for i in imgs if ".jpeg" in i["src"] or "-2." in i["src"]), None)
    piece = next((i for i in imgs if i is not bg and (".png" in i["src"] or "-1." in i["src"])), None)
    if not bg or not piece:
        print("  ✗ Captcha background or puzzle image not found", flush=True)
        return False

    bg_bytes = await _fetch_bytes(bg["src"], proxy)
    piece_bytes = await _fetch_bytes(piece["src"], proxy)
    Path("dbg_bg.jpg").write_bytes(bg_bytes)
    Path("dbg_piece.png").write_bytes(piece_bytes)

    gap_x, conf = find_gap_x(bg_bytes, piece_bytes)
    scale = bg["bw"] / bg["w"] if bg["w"] else 340 / 552
    distance = (gap_x - (piece["left"] - bg["left"]) / scale) * scale
    print(f"  [solve#{attempt}] gap_x={gap_x} conf={conf:.3f} scale={scale:.2f} distance={distance:.0f}px", flush=True)

    btn = frame.locator(".captcha-slider-btn")
    bb = await btn.bounding_box()
    if not bb:
        print("  ✗ Drag handle .captcha-slider-btn not found", flush=True)
        return False
    sx, sy = bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2
    await page.mouse.move(sx, sy)
    await page.wait_for_timeout(random.randint(150, 350))
    await page.mouse.down()
    await page.wait_for_timeout(random.randint(80, 180))
    for dx, dy, dt in _gen_track(distance):
        await page.mouse.move(sx + dx, sy + dy)
        await asyncio.sleep(dt / 1000)
    await page.wait_for_timeout(random.randint(120, 260))
    await page.mouse.up()

    for _ in range(10):
        await page.wait_for_timeout(700)
        if not find_captcha_frame(page):
            return True
    return False



_BALANCE_PATTERNS = (
    re.compile(r"(?:本日は|今日(?:还剩|剩余)?|今天).*?(\d+)\s*(?:ポイント|积分|points?)", re.I),
    re.compile(r"(?:remaining|left)\s*[:：]?\s*(\d+)\s*points?", re.I),
    re.compile(r"(?:还剩|剩余|还有)\s*(\d+)\s*(?:积分|点)", re.I),
    # English Dola responses put the number before "left":
    # "You only have 4 left today" or "You still have 0 video credits left".
    re.compile(
        r"(?:only\s+have|still\s+have|have\s+only)\s+(\d+)\s+"
        r"(?:(?:video\s+)?credits?\s+)?(?:left|remaining)\b",
        re.I,
    ),
)


def _parse_balance_texts(
    texts: list[str], *, valid_after: float | None = None
) -> tuple[int | None, bool, str]:
    normalized_texts = []
    for item in texts:
        if isinstance(item, dict):
            text = str(item.get("text") or "")
            timestamp = _coerce_message_timestamp(item.get("timestamp"))
        else:
            text = str(item or "")
            timestamp = None
        if valid_after is not None and (timestamp is None or timestamp < valid_after):
            continue
        if text:
            normalized_texts.append(text)
    for text in normalized_texts:
        if DAILY_LIMIT_PATTERN.search(text):
            return None, True, text
    for text in normalized_texts:
        for pattern in _BALANCE_PATTERNS:
            match = pattern.search(text)
            if match:
                return int(match.group(1)), False, text
    return None, False, ""


async def _preflight_balance(
    page, ms_token: str, fp: str, required: int, on_balance=None
) -> dict:
    """Observe the balance but let Dola decide this model's actual credit cost.

    Fast and Pro can have different costs, so a cached balance (including one
    credit) is not enough to reject a new request before it reaches Dola. The
    `required` argument remains for compatibility with older callers; Dola
    validates the exact cost for the selected mode.
    """
    try:
        result = await asyncio.wait_for(page.evaluate(
            BALANCE_JS, {
                "msToken": ms_token,
                "fp": fp,
                "dayStart": _provider_day_start_timestamp(),
            }), timeout=30)
        entries = result.get("messages")
        if not isinstance(entries, list):
            entries = result.get("texts", [])
        balance, daily_limited, source = _parse_balance_texts(
            entries, valid_after=_provider_day_start_timestamp()
        )
        if daily_limited:
            # BALANCE_JS reads messages from several recent conversations.
            # A daily-limit reply remains in chat history after the provider
            # resets the account, so it is not evidence that the account is
            # currently blocked. The active conversation is checked after
            # submission in poll_conversation, where a fresh provider limit
            # response can safely disable this account until its next reset.
            print(
                "  Ignoring daily-limit text from recent chat history during "
                "preflight; current task response will determine availability.",
                flush=True,
            )
            return {"balance": None, "source": "historical daily-limit text ignored"}
        if balance is not None and on_balance:
            on_balance(balance, source)
        return {"balance": balance, "source": source}
    except (AccountLimitedError, CreditInsufficientError):
        raise
    except Exception as e:
        print(f"  Balance pre-check indeterminate (proceeding with submit): {str(e)[:120]}", flush=True)
        return {"balance": None, "source": ""}


def _texts_after_confirmation(texts, previous_texts):
    """Subtract the pre-confirmation snapshot, preserving repeated new replies."""
    remaining = list(previous_texts)
    result = []
    for text in texts:
        if text in remaining:
            remaining.remove(text)
        else:
            result.append(text)
    return result


async def _confirm_duration_in_chat(page, conversation_id, duration, texts, *, model=None, ratio=None):
    """Reply in the accepted chat so Dola can continue at the exact duration.

    This is a normal assistant clarification, not a new video submission. The
    resumed chat may not expose its generation controls, so verify the reply
    text itself instead of trying to reconfigure the video composer.
    """
    key = f"dola-duration-confirmation:{conversation_id}"
    saved = await page.evaluate("key => JSON.parse(localStorage.getItem(key) || 'null')", key)
    if isinstance(saved, dict):
        if saved.get("status") == "sent":
            return saved
        saved_message = str(saved.get("message") or "").strip()
        if saved_message:
            already_visible = await page.evaluate(
                DURATION_CONFIRMATION_VISIBLE_JS, saved_message
            )
            if already_visible:
                saved["status"] = "sent"
                await page.evaluate(
                    "({key, saved}) => localStorage.setItem(key, JSON.stringify(saved))",
                    {"key": key, "saved": saved},
                )
                return saved
        elif saved.get("status") is None:
            # Legacy marker without its message: preserve at-most-once behavior.
            return saved
    if not str(page.url).rstrip('/').endswith(f"/chat/{conversation_id}"):
        raise RuntimeError("Không xác nhận thời lượng ở chat khác với task")
    previous_texts = (
        list(saved.get("previous_texts") or [])
        if isinstance(saved, dict) else list(texts)
    )
    message = str(saved.get("message") or "").strip() if isinstance(saved, dict) else ""
    if not message:
        offered_duration = _nearest_supported_duration(texts)
        if offered_duration == int(duration):
            message = (
                f"Đúng, hãy tạo video với thời lượng {int(duration)} giây như yêu cầu ban đầu. "
                "Giữ nguyên model, nội dung, ảnh tham chiếu và tỷ lệ đã chọn."
            )
        else:
            offered_note = (
                f" Không đổi sang thời lượng gần nhất {offered_duration} giây."
                if offered_duration is not None else ""
            )
            message = (
                f"Hãy tạo video với thời lượng chính xác {int(duration)} giây theo yêu cầu ban đầu."
                f"{offered_note} Giữ nguyên model, nội dung, ảnh tham chiếu và tỷ lệ đã chọn."
            )
    await _fill_prompt_fast(page, message, prepared=True)
    # Persist a prepared marker before Enter. Recovery can retry it if the
    # provider never received the message, while recognizing a visible user
    # message as already sent to avoid duplicates.
    saved = {"previous_texts": previous_texts, "message": message, "status": "prepared"}
    await page.evaluate("({key, saved}) => localStorage.setItem(key, JSON.stringify(saved))", {"key": key, "saved": saved})
    verified = asyncio.get_running_loop().create_future()

    async def guard_confirmation(route):
        if route.request.method != "POST":
            await route.continue_()
            return
        raw = route.request.post_data or ""
        try:
            body = json.loads(raw)
        except (TypeError, ValueError):
            body = raw
        valid = _submission_message_contains_prompt(body, message) or message in raw
        if valid:
            await route.continue_()
        else:
            await route.abort()
        if not verified.done():
            verified.set_result(valid)

    await page.route("**/chat/completion*", guard_confirmation)
    try:
        await page.keyboard.press("Enter")
        if not await asyncio.wait_for(verified, timeout=30):
            raise RuntimeError("Đã chặn xác nhận thời lượng: payload không chứa câu trả lời đúng")
    finally:
        await page.unroute("**/chat/completion*", guard_confirmation)
    print(f"[duration-confirmation] conversation={conversation_id} confirmed={duration}s; waiting for a new reply", flush=True)
    return saved


async def _confirm_single_video_in_chat(page, conversation_id, texts):
    """Tell Dola once to return one video instead of segmented output."""
    key = f"dola-single-video-only:{conversation_id}"
    saved = await page.evaluate("key => JSON.parse(localStorage.getItem(key) || 'null')", key)
    if isinstance(saved, dict):
        return saved
    if not str(page.url).rstrip('/').endswith(f"/chat/{conversation_id}"):
        raise RuntimeError("Không xác nhận yêu cầu một video ở chat khác với task")
    await _fill_prompt_fast(page, SINGLE_VIDEO_INSTRUCTION, prepared=True)
    # Persist before Enter. If the browser closes after the message is sent,
    # recovery must not send a second correction into the same conversation.
    saved = {"previous_texts": list(texts), "message": SINGLE_VIDEO_INSTRUCTION}
    await page.evaluate(
        "({key, saved}) => localStorage.setItem(key, JSON.stringify(saved))",
        {"key": key, "saved": saved},
    )
    await page.keyboard.press("Enter")
    print(
        f"[single-video-only] conversation={conversation_id}; requested one video",
        flush=True,
    )
    return saved


async def _confirm_video_generation_in_chat(page, conversation_id, texts):
    """Confirm Dola's explicit video-start prompt once in the active chat."""
    key = f"dola-video-generation-confirmation:{conversation_id}"
    saved = await page.evaluate("key => JSON.parse(localStorage.getItem(key) || 'null')", key)
    if isinstance(saved, dict):
        return saved
    if not str(page.url).rstrip('/').endswith(f"/chat/{conversation_id}"):
        raise RuntimeError("Không xác nhận tạo video ở chat khác với task")
    message = "Có, tôi xác nhận. Hãy bắt đầu tạo video với các tham số này."
    await _fill_prompt_fast(page, message, prepared=True)
    # Save before Enter so a restarted poller cannot submit this confirmation twice.
    saved = {"previous_texts": list(texts), "message": message}
    await page.evaluate(
        "({key, saved}) => localStorage.setItem(key, JSON.stringify(saved))",
        {"key": key, "saved": saved},
    )
    await page.keyboard.press("Enter")
    print(
        f"[video-generation-confirmation] conversation={conversation_id}; confirmed once",
        flush=True,
    )
    return saved


async def poll_conversation(account: str, page, context, conversation_id: str,
                            timeout: int, on_poll=None, on_balance=None,
                            expected_duration: int | None = None,
                            expected_ratio: str | None = None,
                            proxy: dict | str | None = None,
                            expected_model: str | None = None,
                            prompt_text: str | None = None) -> dict:
    """Polls accepted conversation for video completion."""
    cookies = await context.cookies("https://www.dola.com")
    ms_token, fp = cookie_value(cookies, "msToken"), cookie_value(cookies, "s_v_web_id")
    start = time.time()
    last_callback = 0.0
    first_poll = True
    consecutive_poll_read_errors = 0
    last_visible_response_check = 0.0
    last_poll_diagnostic = 0.0
    confirmation = None
    single_video_confirmation = None
    duration_confirmation_key = f"dola-duration-confirmation:{conversation_id}"
    try:
        duration_confirmation = await page.evaluate(
            "key => JSON.parse(localStorage.getItem(key) || 'null')",
            duration_confirmation_key,
        )
    except Exception:
        duration_confirmation = None
    if not isinstance(duration_confirmation, dict):
        duration_confirmation = None

    async def confirm_duration_response(texts):
        nonlocal duration_confirmation
        duration = int(expected_duration or 0)
        if duration_confirmation is not None or duration not in (5, 10, 15):
            return False
        duration_confirmation = await _confirm_duration_in_chat(
            page,
            conversation_id,
            duration,
            texts,
            model=expected_model,
            ratio=expected_ratio,
        )
        return True

    while time.time() - start < timeout:
        # Query immediately once the conversation is known; subsequent polls
        # remain spaced to avoid unnecessary provider traffic.
        if not first_poll:
            remaining = timeout - (time.time() - start)
            if remaining <= 0:
                break
            await asyncio.sleep(min(5, remaining))
        first_poll = False
        remaining = timeout - (time.time() - start)
        if remaining <= 0:
            break
        try:
            poll = await asyncio.wait_for(page.evaluate(
                POLL_JS, {"conversationId": conversation_id, "msToken": ms_token, "fp": fp}),
                timeout=min(30, remaining),
            )
        except Exception as e:
            if time.time() - start >= timeout:
                break
            if "target page, context or browser has been closed" in str(e).lower():
                # The provider conversation is already accepted. Treat a
                # closed headed context as a recoverable poll-window failure;
                # the server will reopen this profile and continue polling
                # the same conversation instead of losing the task.
                raise RenderStillProcessingError(
                    "Render Chromium đã đóng trong lúc chờ video; giữ conversation_id "
                    "và sẽ mở lại profile để poll tiếp"
                ) from e
            # A network error in the page's fetch must not hide a terminal
            # provider response that is already visible in the active Dola
            # chat (for example a content-policy refusal). Detect known terminal provider classes
            # here; unknown errors remain recoverable and continue polling the
            # same chat.
            try:
                visible_text = await asyncio.wait_for(
                    page.evaluate(
                        VISIBLE_PROVIDER_TEXT_JS,
                        {"conversationId": conversation_id},
                    ),
                    timeout=5,
                )
            except Exception:
                visible_text = ""
            visible_text = _visible_text_without_prompt(visible_text, prompt_text)
            if VIDEO_GENERATION_CONFIRMATION_PATTERN.search(str(visible_text or "")):
                confirmation = await _confirm_video_generation_in_chat(
                    page, conversation_id, []
                )
                continue
            terminal_error = _terminal_provider_response_error(visible_text)
            if isinstance(terminal_error, DurationCapabilityMismatchError):
                if duration_confirmation is None:
                    if await confirm_duration_response([visible_text]):
                        continue
                else:
                    # A resumed poll can still see the original question in
                    # the chat DOM after the one-time confirmation was sent.
                    terminal_error = None
            if terminal_error is not None:
                print(
                    f"[{account}] Poll fallback detected terminal provider response: "
                    f"{type(terminal_error).__name__}",
                    flush=True,
                )
                raise terminal_error from e
            consecutive_poll_read_errors += 1
            if consecutive_poll_read_errors >= 3:
                raise RuntimeError(
                    "Dola poll failed to return a readable response 3 times in a row: "
                    f"{str(e)[:180]}"
                ) from e
            print(f"  Polling exception: {e}", flush=True)
            continue
        # fetch() may return a structured non-OK result instead of throwing.
        # Check the active chat before treating an empty response as an
        # ordinary in-progress render.
        # A concrete provider video payload is stronger evidence than a stale
        # or unrelated error message returned alongside it. Download and
        # validate the media instead of abandoning a conversation that has
        # already produced a video.
        has_video_payload = bool(
            isinstance(poll, dict) and poll.get("videos")
        )
        poll_texts = provider_response_texts(poll)
        provider_error = None if has_video_payload else _terminal_provider_response_error(
            poll.get("providerErrors", []) if isinstance(poll, dict) else []
        )
        if isinstance(provider_error, DurationCapabilityMismatchError):
            # Preserve the provider's structured error in the normal
            # confirmation path instead of failing before the chat can answer.
            poll_texts.append(str(provider_error))
            provider_error = None
        if provider_error is not None:
            raise provider_error
        # Dola may expose an explicit overload or policy refusal in an
        # assistant message before its metadata flips to ``done``. Those
        # terminal messages must be handled immediately; otherwise the
        # accepted conversation looks like an ordinary render until timeout.
        if not (poll.get("videos") if isinstance(poll, dict) else None):
            final_texts = set(poll_texts)
            for text in provider_response_texts(poll, include_in_progress=True):
                if text in final_texts:
                    continue
                # An in-progress assistant message may mention an earlier
                # filter result while Dola is still trying another route.
                # Defer those intermediate notices, but surface an explicit
                # no-retry refusal immediately. Technical empty-task errors
                # remain actionable when Dola confirms the prompt is safe.
                if (
                    _is_content_policy_rejection_error(text)
                    and not _is_provider_task_id_empty_technical_error(text)
                    and not _is_final_content_policy_refusal(text)
                ):
                    continue
                terminal_error = _terminal_provider_response_error(text)
                if (
                    terminal_error is not None
                    and not isinstance(terminal_error, DurationCapabilityMismatchError)
                ):
                    raise terminal_error
        # Dola can render a final refusal in the active chat while the chain
        # API still returns HTTP 200 with no attributable assistant text.
        # Check that chat periodically instead of treating every such reply
        # as an indefinitely running video. The DOM selector reads only
        # assistant-authored nodes, so prompt wording cannot trigger this.
        if (
            isinstance(poll, dict)
            and poll.get("ok", True)
            and not poll.get("videos")
            and time.monotonic() - last_visible_response_check >= 10
        ):
            last_visible_response_check = time.monotonic()
            try:
                visible_text = await asyncio.wait_for(
                    page.evaluate(
                        VISIBLE_PROVIDER_TEXT_JS,
                        {"conversationId": conversation_id},
                    ),
                    timeout=5,
                )
            except Exception:
                visible_text = ""
            visible_text = _visible_text_without_prompt(visible_text, prompt_text)
            terminal_error = _terminal_provider_response_error(visible_text)
            if isinstance(terminal_error, DurationCapabilityMismatchError):
                if duration_confirmation is None:
                    snapshot = poll_texts or [visible_text]
                    if await confirm_duration_response(snapshot):
                        continue
                else:
                    terminal_error = None
            if terminal_error is not None:
                print(
                    f"[{account}] Poll detected visible terminal provider response: "
                    f"{type(terminal_error).__name__}",
                    flush=True,
                )
                raise terminal_error
            try:
                visible_video_urls = await asyncio.wait_for(
                    page.evaluate(
                        VISIBLE_PROVIDER_VIDEO_URLS_JS,
                        {"conversationId": conversation_id},
                    ),
                    timeout=5,
                )
            except Exception:
                visible_video_urls = []
            if isinstance(visible_video_urls, list) and visible_video_urls:
                poll.setdefault("videos", [])
                poll.setdefault("videoModels", [])
                poll.setdefault("videoSources", [])
                known_urls = set(poll["videos"])
                for visible_url in visible_video_urls:
                    if not isinstance(visible_url, str) or not re.match(r"^https?://", visible_url, re.I):
                        continue
                    if visible_url in known_urls:
                        continue
                    known_urls.add(visible_url)
                    poll["videos"].append(visible_url)
                    poll["videoModels"].append("")
                    poll["videoSources"].append({
                        "url": visible_url,
                        "fallbackUrl": visible_url,
                        "source": "visible_chat_video",
                        "watermarkFree": False,
                    })
                if poll["videos"]:
                    print(
                        f"[{account}] Recovered {len(poll['videoSources'])} video source(s) from the chat player",
                        flush=True,
                    )
        if (
            not isinstance(poll, dict)
            or (
                not poll.get("ok", True)
                and not poll_texts
                and not poll.get("videos")
            )
        ):
            try:
                visible_text = await asyncio.wait_for(
                    page.evaluate(
                        VISIBLE_PROVIDER_TEXT_JS,
                        {"conversationId": conversation_id},
                    ),
                    timeout=5,
                )
            except Exception:
                visible_text = ""
            visible_text = _visible_text_without_prompt(visible_text, prompt_text)
            if VIDEO_GENERATION_CONFIRMATION_PATTERN.search(str(visible_text or "")):
                confirmation = await _confirm_video_generation_in_chat(
                    page, conversation_id, []
                )
                consecutive_poll_read_errors = 0
                continue
            terminal_error = _terminal_provider_response_error(visible_text)
            if isinstance(terminal_error, DurationCapabilityMismatchError):
                if duration_confirmation is None:
                    if await confirm_duration_response([visible_text]):
                        consecutive_poll_read_errors = 0
                        continue
                else:
                    terminal_error = None
            if terminal_error is not None:
                print(
                    f"[{account}] Poll fallback detected terminal provider response: "
                    f"{type(terminal_error).__name__}",
                    flush=True,
                )
                raise terminal_error
            consecutive_poll_read_errors += 1
            if consecutive_poll_read_errors >= 3:
                status = poll.get("status", "unknown") if isinstance(poll, dict) else "invalid"
                raise RuntimeError(
                    "Dola poll returned no readable data 3 times in a row "
                    f"(HTTP {status})"
                )
            continue
        consecutive_poll_read_errors = 0
        diagnostics = poll.get("diagnostics") if isinstance(poll, dict) else None
        if (
            not poll.get("videos")
            and isinstance(diagnostics, dict)
            and time.monotonic() - last_poll_diagnostic >= 60
        ):
            last_poll_diagnostic = time.monotonic()
            message_keys = ",".join(diagnostics.get("messageKeyNames") or []) or "-"
            role_kinds = ",".join(diagnostics.get("messageRoleKinds") or []) or "-"
            schema_kinds = ",".join(diagnostics.get("schemaKinds") or []) or "-"
            print(
                f"[{account}] Dola poll has no video yet; "
                f"message_lists={int(diagnostics.get('messageListCount') or 0)}, "
                f"messages={int(diagnostics.get('messageCount') or 0)}, "
                f"assistant_messages={int(diagnostics.get('assistantMessageCount') or 0)}, "
                f"video_candidates={int(diagnostics.get('videoCandidateCount') or 0)}, "
                f"message_keys={message_keys[:320]}, role_kinds={role_kinds[:160]}, "
                f"schema_kinds={schema_kinds[:500]}",
                flush=True,
            )
        now = time.time()
        if on_poll and now - last_callback >= 30:
            on_poll(now)
            last_callback = now
        # Concrete media takes precedence over earlier assistant warnings.
        texts = poll_texts
        if confirmation:
            texts = _texts_after_confirmation(texts, confirmation.get("previous_texts", []))
        if single_video_confirmation:
            texts = _texts_after_confirmation(
                texts, single_video_confirmation.get("previous_texts", [])
            )
        if duration_confirmation:
            texts = _texts_after_confirmation(
                texts, duration_confirmation.get("previous_texts", [])
            )
        confirmed_now = False
        for text in ([] if poll.get("videos") else texts):
            if VIDEO_GENERATION_CONFIRMATION_PATTERN.search(str(text or "")):
                if confirmation is None:
                    confirmation = await _confirm_video_generation_in_chat(
                        page, conversation_id, poll_texts
                    )
                    confirmed_now = True
                    break
                # Ignore a stale copy of the already-confirmed question while
                # waiting for Dola to emit its next assistant response.
                continue
            if _is_duration_capability_error(text):
                if await confirm_duration_response(poll_texts):
                    confirmed_now = True
                    break
                raise DurationCapabilityMismatchError(
                    f"{DURATION_CAPABILITY_MESSAGE} Phản hồi sau xác nhận: {text[:180]}"
                )
            if _is_provider_task_id_empty_technical_error(text):
                raise ProviderTaskIdEmptyError(
                    "Dola/backend không tạo task video (task_id trống); "
                    f"đã dừng poll conversation. Phản hồi: {text[:180]}"
                )
            balance, _, source = _parse_balance_texts([text])
            if balance is not None and on_balance:
                on_balance(balance, source)
            if _is_credit_cost_exceeded_error(text):
                # This is a terminal provider response: Dola has already
                # compared the requested cost with today's balance and will
                # never render this conversation. Do not wait for the render
                # timeout; the pool may rotate to another profile.
                raise PostSubmitCreditError(_credit_cost_error_message(text))
            if _is_seven_day_free_limit(text):
                # Dola explicitly offers Fast mode when the Pro allowance is
                # exhausted. Keep the retry on this profile and let the task
                # scheduler submit the same prompt once with Seedance 2.0.
                raise FastModeFallbackError(
                    f"{FAST_MODE_FALLBACK_MESSAGE} Phản hồi: {text[:180]}"
                )
            if DAILY_LIMIT_PATTERN.search(text):
                # The conversation already exists at this point. Do not let
                # the pool submit the same prompt through another account.
                raise PostSubmitAccountLimitError(
                    f"Account video limit after submit: {text[:120]}"
                )
            if is_rate_limit_response(text):
                raise PostSubmitRateLimitError(
                    f"Dola giới hạn tần suất sau khi nhận yêu cầu: {text[:180]}"
                )
            if DOLA_RISK_CONTROL_PATTERN.search(text):
                raise RiskControlError(
                    f"Dola bật risk-control sau khi nhận yêu cầu: {text[:180]}"
                )
            if _is_content_policy_rejection_error(text):
                if _provider_is_retrying_after_filter_error(text):
                    continue
                if _is_final_content_policy_refusal(text):
                    raise ContentPolicyFinalRefusalError(
                        f"{CONTENT_POLICY_NO_RETRY_MESSAGE} Phản hồi: {text[:240]}"
                    )
                # Dola can return a policy explanation as a normal assistant
                # message after creating the conversation. It will never
                # produce media for that chat; let the server release this
                # poll reservation and start one safe rewritten chat.
                raise ContentPolicyRejectedError(
                    f"{CONTENT_POLICY_REJECTION_MESSAGE} Phản hồi: {text[:240]}"
                )
            if _is_profile_rotation_no_video_error(text):
                if _provider_is_retrying_after_filter_error(text):
                    continue
                raise ProfileRotationRetryError(
                    f"{PROFILE_ROTATION_NO_VIDEO_MESSAGE} Phản hồi: {text[:180]}"
                )
            if _is_cannot_answer_question_error(text):
                raise CannotAnswerQuestionError(
                    f"{CANNOT_ANSWER_QUESTION_MESSAGE} Phản hồi: {text[:180]}"
                )
            if PROVIDER_BUSY_PATTERN.search(text):
                raise ProviderBusyError(
                    f"Dola đang quá tải sau khi nhận yêu cầu: {text[:180]}"
                )
            if _is_explicit_no_video_creation_error(text):
                raise NoVideoCreationError(
                    f"Dola báo không thể tạo video sau khi nhận yêu cầu: {text[:180]}"
                )
            if _is_multi_video_segment_response(text):
                if single_video_confirmation is None:
                    single_video_confirmation = await _confirm_single_video_in_chat(
                        page, conversation_id, poll_texts
                    )
                    confirmed_now = True
                    break
                raise SingleVideoOnlyError(
                    f"{SINGLE_VIDEO_RETRY_MESSAGE} Phản hồi: {text[:180]}"
                )
            if _is_something_went_wrong_error(text):
                # This generic provider error also means that this
                # conversation produced no video. Keep it distinct from a
                # content rejection for the caller's retry policy.
                raise SomethingWentWrongError(
                    f"{SOMETHING_WENT_WRONG_MESSAGE} Phản hồi: {text[:180]}"
                )
            if _is_cannot_answer_question_error(text):
                # This is a provider no-video response, not content that
                # should be sent again in the same conversation. The server
                # owns the bounded fresh-chat retry policy.
                raise CannotAnswerQuestionError(
                    f"{CANNOT_ANSWER_QUESTION_MESSAGE} Phản hồi: {text[:180]}"
                )
            if LIKENESS_REJECTION_PATTERN.search(text):
                raise ImageLikenessRejectedError(LIKENESS_REJECTION_MESSAGE)
            if PROVIDER_REJECTION_PATTERN.search(text):
                # Dola uses generic phrases such as "cannot generate" for
                # content moderation as well as quota errors.  Check the
                # provider's content decision before the broad credit regex,
                # otherwise a rejected prompt is mislabeled as a credit
                # failure and the account is incorrectly quota-blocked.
                raise ProviderGenerationRejectedError(
                    f"Dola từ chối yêu cầu tạo video: {text[:180]}"
                )
            if CREDIT_FAIL_PATTERN.search(text):
                # The conversation already exists at this point. Let the pool
                # mark the attempt used and fail it; re-submitting on another
                # account would create a duplicate video.
                raise PostSubmitCreditError(f"Insufficient quota after submit: {text[:80]}")
        if confirmed_now:
            continue
        if poll.get("videos"):
            videos = poll["videos"]
            sources = poll.get("videoSources", [])
            if sources and isinstance(sources[0], dict):
                source = sources[0]
            else:
                video_models = poll.get("videoModels", [])
                source = {
                    "url": extract_unwatermarked_url(
                        video_models[0] if video_models else "", videos[0]),
                    "fallbackUrl": videos[0],
                    "source": "download_url",
                    "watermarkFree": False,
                }
            print(
                f"[{account}] Completed! Downloading ({source.get('source', 'download_url')})...",
                flush=True,
            )
            local, used_url, watermark_free, watermark_removed = await _download_video_source(
                source, account, proxy=proxy
            )
            metadata = await asyncio.to_thread(
                validate_video_output, local, expected_duration, expected_ratio
            )
            metadata.update({
                "watermark_free": watermark_free,
                "watermark_removed": watermark_removed,
                "media_source": source.get("source", "download_url")
                if not watermark_removed else "download_url_delogo",
            })
            print(f"[{account}] Downloaded {local} ({local.stat().st_size / 1e6:.1f} MB)", flush=True)
            return {"video_url": used_url, "local_path": str(local),
                    "conversation_id": conversation_id, "account": account,
                    "video_metadata": metadata}
        print(f"  ...Generating ({int(time.time() - start)}s)", flush=True)
    raise RenderStillProcessingError(
        f"Dola vẫn đang tạo video; cửa sổ poll {int(time.time() - start)}s đã kết thúc "
        f"(conversation_id={conversation_id})"
    )


@asynccontextmanager
async def _managed_video_context(account: str, *, external_context=None,
                                 use_extension: bool = True,
                                 proxy: dict | str | None = None):
    """Yield either a worker-owned context or a caller-owned external context.

    The normal worker owns the persistent Chromium context and closes it at
    the end of the poll window. A caller-owned context remains open until its
    owner releases it.
    """
    if external_context is not None:
        yield external_context
        return

    async with async_playwright() as p:
        yield await launch_account_context(
            p,
            account,
            headless=False,
            use_extension=use_extension,
            hide_window=config.HIDE_RENDER_WINDOWS,
            proxy=proxy,
        )


async def resume_video(account: str, conversation_id: str, timeout: int,
                       on_poll=None, on_balance=None, duration: int | None = None,
                       ratio: str | None = None, external_context=None,
                       proxy: dict | str | None = None, model: str | None = None,
                       prompt_text: str | None = None,
                       confirm_duration: bool = False) -> dict:
    """Recovers accepted session after server restart without re-sending prompt."""
    poll_window_started = time.monotonic()
    async with _managed_video_context(
        account,
        external_context=external_context,
        use_extension=True,
        proxy=proxy,
    ) as context:
        try:
            pages = list(context.pages)
            page = next((candidate for candidate in pages if "dola.com" in str(candidate.url)), None)
            page = page or (pages[0] if pages else await context.new_page())
            page.set_default_timeout(60000)
            page.set_default_navigation_timeout(90000)
            await page.goto(f"https://www.dola.com/chat/{conversation_id}",
                            timeout=90000, wait_until="domcontentloaded")
            await page.locator("body").wait_for(state="attached", timeout=30000)
            await page.wait_for_timeout(250)
            cookies = await context.cookies("https://www.dola.com")
            if not has_dola_session(cookies):
                raise SessionExpiredError(
                    f"{account} session expired while resuming {conversation_id}; please re-login"
                )
            if confirm_duration:
                if duration not in (5, 10, 15):
                    raise DurationCapabilityMismatchError(
                        f"{DURATION_CAPABILITY_MESSAGE} Thời lượng task không được hỗ trợ."
                    )
                visible_videos = await page.evaluate(
                    VISIBLE_PROVIDER_VIDEO_URLS_JS,
                    {"conversationId": conversation_id},
                )
                if not isinstance(visible_videos, list) or not visible_videos:
                    visible_messages = await page.evaluate(
                        VISIBLE_PROVIDER_TEXT_JS,
                        {"conversationId": conversation_id, "asMessages": True},
                    )
                    if isinstance(visible_messages, str):
                        visible_messages = [visible_messages]
                    if not isinstance(visible_messages, list):
                        visible_messages = []
                    visible_messages = [
                        text
                        for text in (
                            _visible_text_without_prompt(value, prompt_text)
                            for value in visible_messages
                        )
                        if text
                    ]
                    await _confirm_duration_in_chat(
                        page,
                        conversation_id,
                        int(duration),
                        visible_messages,
                        model=model,
                        ratio=ratio,
                    )
            remaining_poll_window = timeout - (time.monotonic() - poll_window_started)
            if remaining_poll_window <= 0:
                raise RenderStillProcessingError(
                    "Dola vẫn đang tạo video; profile mở lại đã dùng hết cửa sổ poll "
                    f"(conversation_id={conversation_id})"
                )
            return await poll_conversation(
                account,
                page,
                context,
                conversation_id,
                remaining_poll_window,
                on_poll,
                on_balance,
                expected_duration=duration,
                expected_ratio=ratio,
                proxy=proxy,
                expected_model=model,
                prompt_text=prompt_text,
            )
        finally:
            if external_context is None:
                await context.close()


async def _save_debug_screenshot(page, path: str, task_id: str | None = None) -> bool:
    """Best-effort screenshot for diagnostics; never mask the real failure."""
    try:
        await page.screenshot(path=path, timeout=20000)
        return True
    except Exception as exc:
        label = f" task={task_id}" if task_id else ""
        print(
            f"[debug] Không thể chụp screenshot{label}: {str(exc)[:160]}",
            flush=True,
        )
        return False


async def generate_video(account: str, prompt: str, ratio: str = None,
                         duration: int = None, timeout: int = None,
                         model: str = "seedance_v2.5", use_extension: bool = True,
                         on_conversation_id=None, on_profile_bound=None,
                         before_submission=None,
                         on_poll=None, on_balance=None,
                         reference_image_paths: list[str] | None = None,
                         on_timing=None, task_id: str | None = None,
                         external_context=None,
                         proxy: dict | str | None = None,
                         chat_mode: str | None = None) -> dict:
    """Full generation flow via UI automation."""
    original_prompt = str(prompt or "")
    # Apply the safety rewrite at the browser boundary as well as at API
    # admission. This repairs legacy rows and explicit retries created before
    # a newer safety rule existed, while keeping the original task id and
    # reference manifest intact.
    safe_prompt = rewrite_sensitive_prompt(original_prompt)
    if safe_prompt.changed:
        print(
            f"[{account}] Prompt safe rewrite at generation boundary "
            f"categories={','.join(safe_prompt.categories)} "
            f"replacements={safe_prompt.replacements} chars="
            f"{len(original_prompt)}->{len(safe_prompt.text)}",
            flush=True,
        )
        original_prompt = safe_prompt.text
    duration = 15 if duration is None else int(duration)
    ratio = ratio or "16:9"
    prompt = pro_video_prompt(original_prompt, ratio, duration, config.MAX_PROMPT_CHARS)
    if prompt != original_prompt.strip():
        print(f"[{account}] Prompt formatting normalized: "
              f"{len(original_prompt)} -> {len(prompt)} chars", flush=True)
    rewrite = safe_rewrite_summary(original_prompt)
    if rewrite["changed"]:
        print(
            f"[{account}] Prompt safe rewrite categories={','.join(rewrite['categories'])} "
            f"replacements={rewrite['replacements']} chars="
            f"{rewrite['input_chars']}->{rewrite['output_chars']}",
            flush=True,
        )
    # Keep the direct worker entry point safe too; some recovery/test callers
    # invoke generate_video without going through server._run_task.
    reference_image_paths = _dedupe_reference_paths(reference_image_paths)
    timeout = min(
        config.VIDEO_HARD_MAX_WAIT_SEC,
        timeout or config.VIDEO_TIMEOUT,
    )
    model_key = _canonical_model_key(model)
    chat_mode = " ".join(str(chat_mode or "Pro").split()).title()
    if chat_mode not in {"Fast", "Pro"}:
        raise ValueError("Dola chat mode must be Fast or Pro")
    if duration is not None and duration not in (5, 10, 15, 30):
        raise ValueError("Dola supports durations of 5s, 10s, 15s, and 30s")
    if reference_image_paths:
        timeout = min(
            config.VIDEO_HARD_MAX_WAIT_SEC,
            max(timeout, config.REFERENCE_VIDEO_TIMEOUT),
        )
    # Keep each browser context bounded; the server will reopen it when the
    # conversation is still processing.
    poll_window = min(timeout, config.VIDEO_POLL_WINDOW_SEC)
    async with _managed_video_context(
        account,
        external_context=external_context,
        use_extension=use_extension,
        proxy=proxy,
    ) as context:
        try:
            pages = list(context.pages)
            page = next((candidate for candidate in pages if "dola.com" in str(candidate.url)), None)
            page = page or (pages[0] if pages else await context.new_page())
            profile_bound_notified = False

            def notify_profile_bound():
                """Tell the pool when this profile owns the composer input."""
                nonlocal profile_bound_notified
                if profile_bound_notified:
                    return
                profile_bound_notified = True
                if on_profile_bound:
                    on_profile_bound(account)

            submission_response_tasks = set()
            submission_response_handler = None
            conversation_watch_task = None
            accepted_conversation_id = ""
            previous_conversation_ids = set()
            submission_armed = False

            def persist_conversation(conversation_id):
                nonlocal accepted_conversation_id
                found = _extract_conversation_id({"conversation_id": conversation_id})
                if not submission_armed or not found or accepted_conversation_id or found in previous_conversation_ids:
                    return
                if on_conversation_id:
                    on_conversation_id(
                        account, found,
                        time.time() + max(timeout, config.VIDEO_MAX_WAIT_SEC),
                    )
                accepted_conversation_id = found
                print(f"[{account}] task={task_id} conversation saved={found}", flush=True)

            async def watch_conversation():
                # Capture URL/page state during submission and captcha waits,
                # not only after those waits have finished.
                while not accepted_conversation_id and not page.is_closed():
                    persist_conversation(await _page_conversation_id(page))
                    await asyncio.sleep(0.1)

            async def check_session(stage):
                if on_timing:
                    on_timing("current_stage", stage)
                current_cookies = await context.cookies("https://www.dola.com")
                logged_out = await _page_has_logged_out_marker(page)
                present = has_dola_session(current_cookies)
                print(
                    f"[{account}] task={task_id} auth stage={stage} "
                    f"session_cookie={present} login_ui={logged_out} "
                    f"path={urlparse(str(page.url)).path}", flush=True,
                )
                if (not present or logged_out) and not accepted_conversation_id:
                    raise PreSubmitSessionExpiredError(
                        f"{account} Dola cần đăng nhập lại tại {stage} "
                        f"(cookie_present={present}, login_ui={logged_out})"
                    )
                if not present or logged_out:
                    raise SessionExpiredError(
                        f"{account} Dola session unavailable at {stage} "
                        f"(session_cookie={present}, login_ui={logged_out})"
                    )

            await page.expose_function("__dolaPersistConversation", persist_conversation)
            await _goto_dola_chat(page)
            if use_extension and _extension_requires_legacy_handshake():
                # The first navigation may have started before the debugger
                # finished attaching. Wait for the explicit extension
                # handshake, then reload so Dola's effective capability is
                # fetched through the interceptor instead of the real 4-15s
                # response from the first navigation.
                await _wait_for_extension_ready(page, timeout=60000)
                try:
                    await _reload_before_submit(page)
                except Exception as error:
                    if _is_pre_submit_navigation_timeout(error):
                        raise PreSubmitSetupError(
                            "Dola không reload được sau khi extension ready; "
                            f"đang đổi profile để thử lại ({str(error).splitlines()[0]})"
                        ) from error
                    raise
                await _wait_for_extension_ready(page, timeout=60000)
                print(f"[{account}] Original 30s extension runtime verified; debugger attached", flush=True)
            elif use_extension:
                print(
                    f"[{account}] SeedancePro extension loaded; legacy Dola30 debugger handshake skipped",
                    flush=True,
                )
            # The first meaningful action after opening Dola is an explicit
            # Login-button check. Do not inspect credit, open the composer,
            # upload images, or select a model until this check is clear.
            await page.wait_for_timeout(300)
            if await _page_has_login_button(page) or await _page_has_google_login_button(page):
                print(
                    f"[{account}] Dola Login/Google-login control detected at initial page check; "
                    "starting Gmail relogin before continuing",
                    flush=True,
                )
                raise PreSubmitSessionExpiredError(
                    f"{account} Dola hiển thị nút Log In hoặc đăng nhập bằng Google/Gmail khi vừa mở; "
                    "phải đăng nhập Gmail trước khi tiếp tục"
                )
            # Give the header one short render turn, then repeat the same
            # Login-button check before reading cookies or proceeding.
            await page.wait_for_timeout(450)
            if await _page_has_login_button(page) or await _page_has_google_login_button(page):
                print(
                    f"[{account}] Dola Login/Google-login control appeared during initial check; "
                    "starting Gmail relogin before continuing",
                    flush=True,
                )
                raise PreSubmitSessionExpiredError(
                    f"{account} Dola hiển thị nút Log In hoặc đăng nhập bằng Google/Gmail sau khi tải trang; "
                    "phải đăng nhập Gmail trước khi tiếp tục"
                )
            cookies = await context.cookies("https://www.dola.com")
            session_cookie = has_dola_session(cookies)
            login_marker = (
                "from_logout" in str(page.url or "")
                or await _page_has_logged_out_marker(page)
            )
            if not session_cookie:
                raise PreSubmitSessionExpiredError(
                    f"{account} Dola session expired or logged out before the "
                    "composer; Gmail relogin required"
                )
            if login_marker:
                raise PreSubmitSessionExpiredError(
                    f"{account} Dola login wall before composer; "
                    "stored cookie does not prove authentication, Gmail relogin required"
                )
            await _ensure_dola_chat_route(
                page, context, account, default_mode=chat_mode
            )
            # The action button is the real readiness signal. The previous
            # fixed 5-second sleep made every queued task pay the same cost
            # even when Dola had already rendered the chat UI.
            try:
                await _wait_for_prompt_editor(page, timeout=60000)
            except TimeoutError as exc:
                # Re-check the auth state so a late logout redirect still
                # reaches the bounded risk-control rotation.
                cookies = await context.cookies("https://www.dola.com")
                session_cookie = has_dola_session(cookies)
                login_marker = (
                    "from_logout" in str(page.url or "")
                    or await _page_has_logged_out_marker(page)
                )
                if not session_cookie:
                    raise PreSubmitSessionExpiredError(
                        f"{account} Dola session expired or logged out while "
                        "opening video entry; Gmail relogin required"
                    ) from exc
                if login_marker:
                    raise PreSubmitSessionExpiredError(
                        f"{account} Dola login button/wall appeared while opening "
                        "video entry; Gmail relogin required"
                    ) from exc
                raise
            ms_token, fp = cookie_value(cookies, "msToken"), cookie_value(cookies, "s_v_web_id")
            await _preflight_balance(
                page,
                ms_token,
                fp,
                0,
                on_balance=on_balance,
            )
            await check_session("before_composer")

            # Restored profiles can redirect /chat into their last conversation.
            # Start a new chat before input and never accept that old ID as ACK.
            # If the URL is already /chat, the attachment cleanup immediately
            # before upload also clears any unfinished draft without sending a
            # synthetic New Chat keyboard event during the normal lifecycle.
            old_match = re.fullmatch(r"/chat/(\d+)/?", urlparse(str(page.url)).path)
            if old_match:
                previous_conversation_ids.add(old_match.group(1))
                await _open_fresh_chat(page, previous_id=old_match.group(1))
                await check_session("after_new_chat")
            elif reference_image_paths:
                # Dola can restore an unfinished attachment draft at plain
                # /chat, so the URL alone is not proof that this is a clean
                # composer. Start a fresh chat before the first image upload.
                # This is especially important when a pre-submit prompt
                # fallback is needed: the same profile must not inherit the
                # previous attempt's attachment chips.
                await _open_fresh_chat(
                    page, previous_id="", timeout_ms=15000, force=True
                )
                await check_session("after_new_chat")

            # ---- UI Submission ----
            await _select_chat_mode(page, chat_mode, account)
            await check_session(f"after_{chat_mode.lower()}_selection")
            if reference_image_paths:
                if on_timing:
                    on_timing("current_stage", "uploading_references")
                await attach_reference_images(
                    page,
                    reference_image_paths,
                    task_id=task_id,
                    on_profile_bound=notify_profile_bound,
                    chat_mode=chat_mode,
                )
                # The upload helper binds as soon as the first image is
                # assigned; keep this idempotent fallback for test doubles and
                # native paths that complete without an intermediate callback.
                notify_profile_bound()
            else:
                # Text-only tasks have no attachment boundary, so bind just
                # before the prompt is filled. They still need a clear pass:
                # a previous image task may have left React attachment state
                # in the persistent profile draft.
                await _ensure_clean_video_composer(
                    page, task_id, chat_mode=chat_mode
                )
                notify_profile_bound()
            # Uploading an image can make Dola restore the last conversation
            # while it rehydrates the composer. Re-open a clean chat before
            # injecting the prompt, then replay the already requested images
            # once; this is still pre-submit, so it cannot duplicate a video.
            stale_after_upload = re.fullmatch(
                r"/chat/(\d+)/?", urlparse(str(page.url)).path
            )
            if stale_after_upload:
                stale_id = stale_after_upload.group(1)
                previous_conversation_ids.add(stale_id)
                print(
                    f"[{account}] Composer quay về conversation cũ sau upload; "
                    "mở New Chat và gắn lại input trước khi nhập prompt",
                    flush=True,
                )
                await _open_fresh_chat(page, previous_id=stale_id)
                await check_session("after_upload_chat_reset")
                try:
                    await _select_chat_mode(page, chat_mode, account)
                except PreSubmitSetupError as error:
                    raise PreSubmitAttachmentSetupError(
                        f"Không khôi phục được {chat_mode} trong chat mới sau upload: {error}"
                    ) from error
                if reference_image_paths:
                    await attach_reference_images(
                        page,
                        reference_image_paths,
                        task_id=task_id,
                        on_profile_bound=notify_profile_bound,
                        chat_mode=chat_mode,
                    )
            # Image hydration can restore the other mode after selection. If
            # resolving the requested mode needs a /chat reload, the old draft may
            # disappear, so replay the requested images on the same profile.
            # Text-only jobs already selected the mode before composer cleanup.
            if reference_image_paths:
                try:
                    chat_reopened_for_mode = await _select_chat_mode(
                        page, chat_mode, account
                    )
                except PreSubmitSetupError as error:
                    raise PreSubmitAttachmentSetupError(
                        f"Không xác nhận được {chat_mode} sau khi gắn ảnh tham chiếu: {error}"
                    ) from error
                if chat_reopened_for_mode:
                    await attach_reference_images(
                        page,
                        reference_image_paths,
                        task_id=task_id,
                        on_profile_bound=notify_profile_bound,
                        chat_mode=chat_mode,
                    )
            if await _page_has_logged_out_marker(page):
                try:
                    cookies_before_submit = await context.cookies("https://www.dola.com")
                except Exception:
                    cookies_before_submit = []
                if has_dola_session(cookies_before_submit):
                    raise PreSubmitRiskControlError(
                        f"{account} Dola risk control before prompt submission: "
                        "login wall shown while session cookie is still present"
                    )
                raise PreSubmitRiskControlError(
                    f"{account} Dola showed the login page before submission; please re-login {account}"
                )
            prompt_started = time.monotonic()
            if on_timing:
                on_timing("current_stage", "typing_prompt")
            if use_extension:
                try:
                    await _fill_prompt_with_seedance_extension(
                        page, prompt, task_label=f"task={task_id}" if task_id else ""
                    )
                except (
                    SeedancePromptBridgeUnavailableError,
                    SeedancePromptBridgeError,
                ) as error:
                    # SeedancePro can report success against an editor node
                    # that Dola replaces one render turn later. Do not rotate
                    # the account after images have already been attached: that
                    # is what made a one/two-image task appear with many images
                    # across repeated profiles. Repair the current composer on
                    # the same profile with the exact canonical prompt, then
                    # let the normal request validator decide whether it is
                    # safe to submit.
                    print(
                        f"[{account}] SeedancePro prompt bridge lệch editor; "
                        "fallback nhập nguyên prompt trên cùng profile, "
                        f"không upload lại ảnh: {str(error)[:180]}",
                        flush=True,
                    )
                    try:
                        await _fill_prompt_fast(
                            page, prompt, prepared=True, timeout_ms=15000
                        )
                    except Exception as fallback_error:
                        raise PreSubmitPromptSetupError(
                            "SeedancePro không nhập được prompt và fallback "
                            f"trên cùng profile cũng thất bại: {str(fallback_error).splitlines()[0]}"
                        ) from error
                    prompt_input_method = "Playwright fallback (same profile)"
                else:
                    prompt_input_method = "SeedancePro extension"
            else:
                await _fill_prompt_fast(page, prompt, prepared=True)
                prompt_input_method = "Playwright"
            print(
                f"[{account}] Prompt nhập qua {prompt_input_method} trong "
                f"{(time.monotonic() - prompt_started) * 1000:.0f}ms",
                flush=True,
            )
            if on_timing:
                on_timing(
                    "prompt_input_ms",
                    round((time.monotonic() - prompt_started) * 1000),
                )
            await check_session("prompt_filled")
            # Bind text-only tasks immediately after the full prompt is in the
            # composer. For image tasks this is idempotent after the upload.
            notify_profile_bound()
            # Allow composer effects to commit after model/duration/upload
            # changes. Payload validation below remains authoritative.
            await page.wait_for_timeout(1000)

            # Validate the native action-bar state and prompt. A mismatch is
            # blocked before transmission, never repaired in the signed body.
            submission_requests = []
            # A raw request signal is separate from a validated payload. The
            # request event fires before the route callback finishes parsing
            # and continuing the SSE request. It prevents a second click from
            # being mistaken for a missing request while validation is still
            # in flight.
            submission_dispatches = []
            generation_route_errors = []
            submission_conversation_ids = []
            submission_response_errors = []
            # An external browser may dispatch the completion fetch from its
            # service worker. Page-level routing/events then miss the request
            # even though the SPA navigates to a local conversation. Attach to
            # the owning BrowserContext so both page and service worker
            # requests are observed and rewritten.
            submission_scope = getattr(page, "context", None) or page

            async def normalize_generation_route(route):
                try:
                    route_url = route.request.url
                except Exception:
                    route_url = ""
                try:
                    body_available = bool(route.request.post_data)
                except Exception:
                    body_available = False
                submission_dispatches.append({
                    "url": route_url,
                    "body_available": body_available,
                })
                try:
                    result = await _rewrite_generation_request(
                        route,
                        model_key,
                        duration or 10,
                        expected_prompt=prompt,
                        expected_ratio=ratio,
                        expected_reference_count=len(reference_image_paths or []),
                        expected_references_verified=bool(reference_image_paths),
                        pro_chat=True,
                    )
                except PromptPayloadError as error:
                    generation_route_errors.append(str(error))
                    try:
                        await route.abort()
                    except Exception:
                        pass
                    return
                except Exception as error:
                    # Route callbacks run outside the worker's main task. An
                    # unexpected payload shape must be surfaced to the
                    # watchdog and the request must be stopped, otherwise the
                    # browser can continue with an unverified prompt while
                    # the worker reports that no payload was observed.
                    generation_route_errors.append(
                        f"Không xử lý được payload tạo video: {str(error)[:240]}"
                    )
                    try:
                        await route.abort()
                    except Exception:
                        pass
                    return
                if result.get("generation"):
                    print(
                        f"[{account}] submission payload model={model_key} "
                        f"duration={int(duration or 10)}s "
                        f"rewritten={result.get('payload_changed', False)} "
                        f"references={result.get('reference_count')}",
                        flush=True,
                    )
                    # Playwright emits the request event before route
                    # continuation, so record the post-rewrite values here as
                    # well as the raw request event below.
                    submission_requests.append({
                        "url": route.request.url,
                        "config": {"model": model_key, "duration": int(duration or 10)},
                        "prompt_verified": result.get("prompt_verified") is True,
                        "prompt_replaced": result.get("prompt_replaced") is True,
                        "prompt_path": result.get("prompt_path"),
                        "prompt_chars": result.get("prompt_chars"),
                        "prompt_digest": result.get("prompt_digest"),
                        "reference_count": result.get("reference_count"),
                    })

            def observe_submission(request):
                if request.method.upper() != "POST" or "/chat/completion" not in request.url:
                    return
                try:
                    body_available = bool(request.post_data)
                except Exception:
                    body_available = False
                submission_dispatches.append({
                    "url": request.url,
                    "body_available": body_available,
                })
                parsed = _extract_submission_config(request.post_data)
                if parsed is not None:
                    submission_requests.append({"url": request.url, "config": parsed})

            async def inspect_submission_response(response):
                """Read the streamed ACK without consuming Dola's response."""
                try:
                    body = await asyncio.wait_for(response.text(), timeout=60)
                    error_message = _classify_submission_error(body)
                    codes = _submission_error_codes(body)
                    if codes or error_message:
                        print(f"[{account}] submission response http={response.status} codes={codes} classification={error_message}", flush=True)
                    if error_message and error_message not in submission_response_errors:
                        submission_response_errors.append(error_message)
                    conversation_id = _extract_conversation_id(body)
                    if conversation_id and conversation_id not in submission_conversation_ids:
                        submission_conversation_ids.append(conversation_id)
                        persist_conversation(conversation_id)
                        print(
                            f"[{account}] conversation_id nhận từ SSE_ACK={conversation_id}",
                            flush=True,
                        )
                except Exception:
                    # The page-side clone below is the primary path. A closed
                    # or long-lived SSE response must never fail generation.
                    pass

            def observe_submission_response(response):
                try:
                    request = response.request
                    if (
                        request.method.upper() != "POST"
                        or "/chat/completion" not in request.url
                    ):
                        return
                    response_task = asyncio.create_task(inspect_submission_response(response))
                    submission_response_tasks.add(response_task)
                    response_task.add_done_callback(submission_response_tasks.discard)
                except Exception:
                    pass

            submission_response_handler = observe_submission_response
            route_registration = submission_scope.route(
                "**/chat/completion*", normalize_generation_route
            )
            # A few unit-test doubles expose ``page.context`` as a plain
            # MagicMock whose route method is synchronous. Fall back to the
            # page scope for those doubles while keeping the real async
            # BrowserContext route for service-worker requests.
            if inspect.isawaitable(route_registration):
                await route_registration
            else:
                submission_scope = page
                await page.route("**/chat/completion*", normalize_generation_route)
            submission_scope.on("request", observe_submission)
            submission_scope.on("response", observe_submission_response)
            try:
                try:
                  await page.evaluate(_INSTALL_CONVERSATION_CAPTURE_JS, {"reset": True})
                except Exception as capture_error:
                    print(
                        f"[{account}] Không cài được bộ bắt conversation SSE: "
                        f"{str(capture_error)[:120]}",
                        flush=True,
                    )
                # Session checks and action-bar hydration can move focus away
                # from the editor. Restore it immediately before Enter so the
                # keyboard path is deterministic; this does not alter text.
                prompt_editor = await _focus_prompt_editor(page, timeout=10000)
                stale_id = await _page_conversation_id(page)
                if stale_id:
                    previous_conversation_ids.add(stale_id)
                if re.fullmatch(r"/chat/\d+/?", urlparse(str(page.url)).path):
                    raise PreSubmitSetupError(
                        "Trang quay về conversation cũ trước khi gửi; chưa submit prompt"
                    )
                if before_submission:
                    await before_submission()
                submission_armed = True
                conversation_watch_task = asyncio.create_task(watch_conversation())
                await page.keyboard.press("Enter")
                # Enter is not handled by every Dola composer build (notably
                # after a fast contenteditable fill or a reference upload).
                # Give the normal shortcut a brief chance, then click the
                # actual send control if no chat request was observed.  This
                # fallback is deliberately request-gated so it cannot submit
                # a second generation after a successful Enter.
                await page.wait_for_timeout(1000)
                if not submission_dispatches and not generation_route_errors:
                    if await _click_prompt_send_fallback(page, timeout_ms=5000):
                        print(
                            f"[{account}] Enter không submit; đã bấm nút gửi composer",
                            flush=True,
                        )
                # The rewritten request is the authoritative signal that Dola
                # received the full prompt and the requested duration/model.
                expected_duration = int(duration or 10)
                expected_prompt_digest = _prompt_digest(prompt)
                deadline = time.monotonic() + config.SUBMISSION_ACK_TIMEOUT_SEC
                send_retry_count = 0
                next_send_retry = time.monotonic() + 3
                while time.monotonic() < deadline:
                    if LIKENESS_REJECTION_MESSAGE in submission_response_errors:
                        raise ImageLikenessRejectedError(LIKENESS_REJECTION_MESSAGE)
                    if generation_route_errors:
                        # The route aborted this request before transmission.
                        # Binding the editor is not provider acceptance.
                        route_error = generation_route_errors[0]
                        if "Dola payload" in route_error and "ảnh tham chiếu" in route_error:
                            raise PreSubmitAttachmentSetupError(route_error)
                        raise PreSubmitSetupError(route_error)
                    for item in submission_requests:
                        cfg = item["config"]
                        if (
                            cfg.get("duration") == expected_duration
                            and _model_value_matches(model_key, cfg.get("model"))
                            and item.get("prompt_verified") is True
                            and item.get("prompt_chars") == len(prompt)
                            and item.get("prompt_digest") == expected_prompt_digest
                        ):
                            print(
                                f"[{account}] UI submitted prompt: {prompt[:40]} "
                                f"({model_key}, {expected_duration}s, "
                                f"{len(prompt)} chars verified)",
                                flush=True,
                            )
                            break
                    else:
                        # If neither the Enter path nor the first button click
                        # caused a network event, retry only the UI gesture.
                        # Once a raw request is observed, never click again;
                        # route validation must finish before the watchdog can
                        # make a decision, avoiding duplicate provider jobs.
                        if (
                            not submission_dispatches
                            and not generation_route_errors
                            and send_retry_count < 2
                            and time.monotonic() >= next_send_retry
                        ):
                            if await _click_prompt_send_fallback(page, timeout_ms=1000):
                                send_retry_count += 1
                                next_send_retry = time.monotonic() + 3
                                print(
                                    f"[{account}] Chưa thấy request /chat/completion; "
                                    f"thử lại nút gửi ({send_retry_count}/2)",
                                    flush=True,
                                )
                        await page.wait_for_timeout(100)
                        continue
                    break
                else:
                    observed = [item["config"] for item in submission_requests]
                    if not submission_dispatches:
                        # No request exists to validate. Classify this as a
                        # composer/setup failure, not a malformed payload.
                        # Avoid exposing prompt text or media URLs in diagnostics.
                        try:
                            send_state = await page.locator("#flow-end-msg-send").evaluate(
                                """element => ({
                                    disabled: !!element.disabled,
                                    ariaDisabled: element.getAttribute('aria-disabled'),
                                    busy: element.getAttribute('aria-busy')
                                })""", timeout=1000
                            )
                        except Exception:
                            send_state = "không tìm thấy nút gửi"
                        raise PreSubmitSetupError(
                            "Dola chưa gửi yêu cầu tạo video: không phát sinh /chat/completion; "
                            f"trạng thái nút gửi={send_state}. Kiểm tra composer và ảnh upload."
                        )
                    else:
                        observed_detail = observed or "đã thấy request nhưng body chưa đọc được"
                    raise RuntimeError(
                        f"Dola chưa xác nhận payload (yêu cầu prompt={len(prompt)} chars, "
                        f"model={model_key}/{expected_duration}s, "
                        f"{observed_detail})"
                    )
            finally:
                submission_scope.remove_listener("request", observe_submission)
                try:
                    unroute_result = submission_scope.unroute(
                        "**/chat/completion*", normalize_generation_route
                    )
                    if inspect.isawaitable(unroute_result):
                        await unroute_result
                except Exception:
                    pass

            # ---- Captcha Solver (up to 3 attempts) ----
            solved_or_absent = False
            for attempt in range(1, 4):
                frame = None
                for _ in range(40):
                    if accepted_conversation_id:
                        break
                    frame = find_captcha_frame(page)
                    if frame:
                        break
                    await page.wait_for_timeout(250)
                if not frame:
                    solved_or_absent = True
                    break
                print(f"[{account}] Captcha detected, attempt {attempt} solving...", flush=True)
                if await solve_slider(page, frame, attempt, proxy):
                    print(f"[{account}] Captcha passed ✓", flush=True)
                    await page.wait_for_timeout(3000)  # Wait for frontend auto-retry
                    solved_or_absent = True
                    break
                print(f"[{account}] Captcha not passed, retrying...", flush=True)
            if not solved_or_absent:
                await _save_debug_screenshot(page, "solve_fail.png", task_id)
                # No conversation id can be observed when the challenge never
                # completes, so this attempt is safe to classify as a
                # profile-level pre-submit risk and rotate to the next one.
                raise PreSubmitRiskControlError(
                    "Captcha failed 3 times before conversation acceptance"
                )

            # ---- Wait for real conversation_id ----
            # Dola can briefly navigate to /chat/?from_logout=1 while the
            # streamed acknowledgement is still being delivered.  Checking
            # the login marker before reading the ACK discarded that response
            # and made the pool rotate a request that may already be accepted.
            # Give the ACK/capture path a short grace period first.
            conv_id = ""
            logout_seen_at = None
            for index in range(240):
                if submission_response_errors:
                    error_message = submission_response_errors[0]
                    if not _is_duration_capability_error(error_message):
                        if _is_credit_cost_exceeded_error(error_message):
                            # Dola has already rejected the requested cost. A
                            # conversation id may still be present in the ACK,
                            # so use the post-submit path to release it and let
                            # the pool try another profile when available.
                            raise PostSubmitCreditError(error_message)
                        if error_message == LIKENESS_REJECTION_MESSAGE:
                            raise ImageLikenessRejectedError(error_message)
                        if _is_something_went_wrong_error(error_message):
                            raise SomethingWentWrongError(error_message)
                        if _is_cannot_answer_question_error(error_message):
                            raise CannotAnswerQuestionError(error_message)
                        # Explicit overload has a bounded task-local recovery path,
                        # even when Dola also emitted an ACK. Other errors retain
                        # the conservative duplicate-submission guard.
                        raise _submission_error_exception(
                            error_message,
                            conversation_accepted=bool(
                                accepted_conversation_id or submission_conversation_ids
                            ),
                        )
                for capture_error in await _page_conversation_capture_errors(page):
                    if _is_credit_cost_exceeded_error(capture_error):
                        raise PostSubmitCreditError(_credit_cost_error_message(capture_error))
                    if _classify_submission_error(capture_error) == LIKENESS_REJECTION_MESSAGE:
                        raise ImageLikenessRejectedError(LIKENESS_REJECTION_MESSAGE)
                    if _is_duration_capability_error(capture_error):
                        # Keep waiting for the ACK. Once the conversation id is
                        # known, the poller can reply to this clarification in
                        # the same chat without submitting a duplicate task.
                        continue
                    if _is_something_went_wrong_error(capture_error):
                        raise SomethingWentWrongError(capture_error)
                    if _is_cannot_answer_question_error(capture_error):
                        raise CannotAnswerQuestionError(capture_error)
                    error_message = _classify_submission_error(capture_error)
                    if error_message:
                        print(f"[{account}] submission SSE codes={_submission_error_codes(capture_error)} classification={error_message}", flush=True)
                        raise _submission_error_exception(
                            error_message,
                            conversation_accepted=bool(
                                accepted_conversation_id or submission_conversation_ids
                            ),
                        )
                conv_id = accepted_conversation_id or (submission_conversation_ids[0] if submission_conversation_ids else "")
                if not conv_id:
                    conv_id = await _page_conversation_id(page)
                if conv_id:
                    break
                login_marker = (
                    "from_logout" in str(page.url or "")
                    or await _page_has_logged_out_marker(page)
                )
                if login_marker:
                    if logout_seen_at is None:
                        logout_seen_at = time.monotonic()
                    # Let an in-flight SSE ACK win over the navigation. If no
                    # id arrives after the grace window, this is a logout
                    # before provider acceptance. The pool classifies the
                    # profile as risk-control and rotates to the next one.
                    if time.monotonic() - logout_seen_at >= 5:
                        try:
                            cookies_after_submit = await context.cookies("https://www.dola.com")
                        except Exception:
                            cookies_after_submit = []
                        if has_dola_session(cookies_after_submit):
                            # A login wall with the old cookie still present
                            # is Dola's anti-abuse/risk response, not an
                            # expired Gmail session. There is no conversation
                            # id to poll, so rotate this profile as well.
                            raise PreSubmitRiskControlError(
                                f"{account} Dola mở màn hình đăng nhập sau khi gửi "
                                "(cookie còn hiệu lực, nghi ngờ giới hạn chống spam; "
                                f"conversation_id chưa nhận được, url={page.url})"
                            )
                        raise SubmissionAuthExpiredError(
                            f"{account} Dola logged out while acknowledging the request "
                            f"(conversation_id not observed, url={page.url})"
                        )
                else:
                    logout_seen_at = None
                await page.wait_for_timeout(250)
            if not conv_id:
                await _save_debug_screenshot(page, "no_conv.png", task_id)
                raise ConversationIdTimeoutError(
                    "conversation_id not acquired within 60s "
                    f"(SSE_ACK={bool(submission_conversation_ids)}, url={page.url})"
                )
            print(f"[{account}] conversation_id={conv_id}, polling for video...", flush=True)

            # ``timeout`` is one browser polling window. The task store keeps
            # a longer overall deadline so the server can reopen this profile
            # and continue polling without re-submitting the prompt.
            persist_conversation(conv_id)
            return await poll_conversation(
                account,
                page,
                context,
                conv_id,
                poll_window,
                on_poll,
                on_balance,
                expected_duration=duration,
                expected_ratio=ratio,
                expected_model=model_key,
                prompt_text=prompt,
            )
        finally:
            if conversation_watch_task is not None:
                conversation_watch_task.cancel()
                await asyncio.gather(conversation_watch_task, return_exceptions=True)
            if submission_response_handler is not None:
                try:
                    submission_scope.remove_listener("response", submission_response_handler)
                except Exception:
                    pass
            for response_task in list(submission_response_tasks):
                if not response_task.done():
                    response_task.cancel()
            if submission_response_tasks:
                await asyncio.gather(*submission_response_tasks, return_exceptions=True)
            if external_context is None:
                await context.close()


async def _main():
    account = sys.argv[1] if len(sys.argv) > 1 else "acc1"
    prompt = sys.argv[2] if len(sys.argv) > 2 else "An orange cat napping on a sunny windowsill"
    ratio = sys.argv[3] if len(sys.argv) > 3 else None
    duration = int(sys.argv[4]) if len(sys.argv) > 4 else None
    model = sys.argv[5] if len(sys.argv) > 5 else "seedance_v2.5"
    result = await generate_video(account, prompt, ratio, duration, model=model)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except Exception:
        import traceback
        traceback.print_exc()
