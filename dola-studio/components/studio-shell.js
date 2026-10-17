"use client";

import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Clock3,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Gauge,
  GripVertical,
  ImagePlus,
  Info,
  KeyRound,
  Layers3,
  LayoutDashboard,
  Link2,
  ListChecks,
  LoaderCircle,
  Mail,
  LogOut,
  Menu,
  Minus,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  UsersRound,
  WandSparkles,
  X,
  Zap
} from "lucide-react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UserApiKeysPanel from "@/components/user-api-keys-panel";
import {
  hasNonCanonicalGeneratedVideoEnvelope,
  stripGeneratedVideoEnvelope
} from "@/lib/seedance-prompt";

const NAV_ITEMS = [
  { id: "overview", slug: "tong-quan", label: "Tổng quan", icon: LayoutDashboard },
  { id: "batch", slug: "tao-hang-loat", label: "Tạo hàng loạt", icon: Layers3 },
  { id: "queue", slug: "hang-doi-render", label: "Hàng đợi render", icon: ListChecks },
  { id: "services", slug: "ket-noi-dich-vu", label: "Kết nối dịch vụ", icon: Network },
  { id: "accounts", slug: "tai-khoan-seedance", label: "Tài khoản Seedance", icon: UsersRound },
  { id: "proxies", slug: "quan-ly-proxy", label: "Quản lý proxy", icon: Network },
  { id: "settings", slug: "cai-dat", label: "Cài đặt", icon: Settings2 }
];
const PROXY_AUTO_RECHECK_BATCH_SIZE = 200;

function viewFromPathname(pathname) {
  const normalized = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (normalized === "/") return "overview";
  return NAV_ITEMS.find((item) => normalized === "/" + item.slug || normalized === "/" + item.id)?.id || "overview";
}

function pathForView(view) {
  return "/" + (NAV_ITEMS.find((item) => item.id === view)?.slug || "tong-quan");
}

function isLocalStudioHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function isLocalBatchReferenceUrl(value) {
  if (typeof window === "undefined") return false;
  try {
    const parsed = new URL(String(value || ""), window.location.origin);
    return isLocalStudioHostname(parsed.hostname)
      && /^\/api\/batches\/references\/[a-f0-9]{32}$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

const LOCAL_STUDIO_USER = {
  id: "dola-local-operator",
  email: "local@localhost",
  role: "user"
};

const SERVICE_FALLBACKS = [
  {
    id: "gateway",
    label: "Dola Gateway",
    description: "Điều phối Seedance và hàng đợi render",
    publicUrl: "https://seedance.maivideo.top",
    status: "unknown",
    accent: "blue"
  },
  {
    id: "maivideo",
    label: "MaiVideo",
    description: "Voice, phụ đề và media library",
    publicUrl: "https://maivideo.top",
    status: "unknown",
    accent: "mint"
  },
  {
    id: "htmlvideo",
    label: "HTMLVideo",
    description: "Pipeline script → scene → render",
    publicUrl: "https://html.maivideo.top",
    status: "unknown",
    accent: "violet"
  },
  {
    id: "facebook",
    label: "FB Publisher",
    description: "Lịch đăng và quản lý Page",
    publicUrl: "https://fb.maivideo.top",
    status: "unknown",
    accent: "orange"
  }
];

const STATUS_META = {
  queued: { label: "Đang chờ", tone: "queued", icon: Clock3 },
  submitting: { label: "Đang gửi", tone: "processing", icon: LoaderCircle },
  processing: { label: "Đang render", tone: "processing", icon: LoaderCircle },
  completed: { label: "Hoàn tất", tone: "completed", icon: CheckCircle2 },
  failed: { label: "Cần xử lý", tone: "failed", icon: CircleAlert },
  cancelled: { label: "Đã huỷ", tone: "failed", icon: CircleAlert },
  unknown: { label: "Chưa kiểm tra", tone: "unknown", icon: CircleDot }
};

const SUPPORTED_DURATIONS = [5, 10, 15];
const SUPPORTED_RATIOS = ["9:16", "16:9", "1:1", "4:3", "3:4"];
// New submissions must use the requested Seedance 2.5 model.
const ENABLED_MODEL = "seedance-2.5";
// Keep the prompt cap consistent across the browser, API, and Gateway.
const MAX_PROMPT_CHARS = 12000;
const QUEUE_PAGE_SIZE = 500;
const QUEUE_FETCH_PAGE_SIZE = 500;
// The API checks the MaiVideo session (up to 5s) before asking Gateway for
// the page (up to 12s); leave enough time for both operations and JSON parsing.
const QUEUE_SYNC_TIMEOUT_MS = 20000;
const JOBS_STORAGE_MAX_ITEMS = 100;
const JOBS_STORAGE_MAX_CHARS = 750_000;
const LOCAL_MEDIA_LIST_TIMEOUT_MS = 30000;
const MEDIA_UPLOAD_TIMEOUT_MS = 120000;
const MAX_REFERENCE_IMAGE_BYTES = 25 * 1024 * 1024;

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.unknown;
}

function isActiveJobStatus(status) {
  return status === "queued" || status === "submitting" || status === "processing";
}

function queueJobDateKey(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year && values.month && values.day
    ? values.year + "-" + values.month + "-" + values.day
    : "";
}

function queueMonthRange(monthOffset = 0) {
  const monthParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(monthParts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const start = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  const end = new Date(Date.UTC(year, month + monthOffset, 0));
  return { start: queueJobDateKey(start), end: queueJobDateKey(end) };
}

function isProviderRejectedJob(job) {
  return String(job?.failureCode || job?.failure_code || "").trim().toUpperCase() === "PROVIDER_REJECTED";
}

function canPollAcceptedConversation(job) {
  if (job?.status !== "failed" || !job?.account || job?.videoUrl || job?.video_url) return false;
  const failureCode = String(job?.failureCode || job?.failure_code || "").trim().toUpperCase();
  if (["POLL_FAILED", "AUTH_EXPIRED", "VIDEO_DOWNLOAD_FAILED"].includes(failureCode)) return true;
  return (failureCode === "RENDER_TIMEOUT" || !failureCode)
    && /Dola vẫn đang tạo video/i.test(String(job?.error || ""));
}

function isSketchReferenceJob(job) {
  const mode = String(job?.referenceImageMode || job?.reference_image_mode || "").trim().toLowerCase();
  return mode === "sketch" || /\[color restoration\]/i.test(String(job?.prompt || ""));
}

function providerRejectionGuidance(job) {
  const error = String(job?.error || "");
  if (/肖像保護|portrait|reference image|ảnh tham chiếu/i.test(error)) {
    return "Dola từ chối vì chính sách bảo vệ chân dung. Hãy dùng ảnh của chính bạn hoặc bỏ ảnh tham chiếu để tạo video từ text, rồi thử lại.";
  }
  if (/durations?\s+from\s+4\s+to\s+15|4[–-]15\s*(?:giây|seconds?)/i.test(error)) {
    return "Dola phản hồi giới hạn thời lượng của phiên này ở 4–15 giây; đây là giới hạn từ provider, không phải lỗi ký tự prompt.";
  }
  return "Dola đã từ chối nội dung ở bước kiểm duyệt. Hãy kiểm tra lại nội dung cảnh và prompt.";
}

function promptCharCount(value) {
  return Array.from(String(value ?? "")).length;
}

function truncatePrompt(value, maxChars = MAX_PROMPT_CHARS) {
  const normalized = String(value ?? "").replace(/^\uFEFF/, "");
  return Array.from(normalized).slice(0, Math.max(0, maxChars)).join("");
}

function decodePromptEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#[0-9]+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, token) => {
    const lower = token.toLowerCase();
    if (lower in named) return named[lower];
    const codePoint = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function normalisePromptText(value) {
  let text = decodePromptEntities(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/—/g, " ");
  // Remove document-only Markdown syntax while keeping the words and
  // punctuation that form the actual prompt.
  text = text
    .replace(/[ \t]+---[ \t]+(?=#{1,6}[ \t]+)/g, "\n\n")
    .replace(/(^|\n)[ \t]*#{1,6}[ \t]+/g, "$1")
    .replace(/(^|\n)[ \t]*\\\*[ \t]+/g, "$1")
    .replace(/(^|\n)[ \t]*\*[ \t]+/g, "$1")
    .replace(/(^|\n)[ \t]*-{3,}[ \t]*(?=$|\n)/g, "$1");
  return text.replace(/\s+/g, " ").trim();
}



function getSinglePrompt(text, maxChars = MAX_PROMPT_CHARS) {
  return truncatePrompt(stripGeneratedVideoEnvelope(normalisePromptText(text)), maxChars).trim();
}

function characterColorCharCount(value) {
  return promptCharCount(String(value ?? "").trim());
}

function promptBudgetForColorDescription(value) {
  return Math.max(0, MAX_PROMPT_CHARS - characterColorCharCount(value));
}

function combinedComposerCharCount(prompt, colorDescription) {
  return promptCharCount(prompt) + characterColorCharCount(colorDescription);
}

async function readJsonResponse(response, fallbackMessage) {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {
      error: fallbackMessage + " (HTTP " + response.status + ")"
    };
  }
}

function referenceFilenameFromUrl(value, index = 0) {
  try {
    const pathname = new URL(String(value || "")).pathname;
    const leaf = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1)).trim();
    if (leaf) return leaf;
  } catch {
    // Fall back to the positional label for legacy or malformed URLs.
  }
  return "Ảnh tham chiếu #" + (index + 1);
}

function referenceArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getJobReferenceManifest(job) {
  const valueCandidates = [job?.referenceImages, job?.reference_images, job?.references].map(referenceArray);
  const values = valueCandidates.find((value) => value.length) || [];
  const nameCandidates = [job?.referenceImageNames, job?.reference_image_names].map(referenceArray);
  const names = nameCandidates.find((value) => value.length) || [];
  const seen = new Set();
  const manifest = [];
  values.forEach((value, index) => {
    const url = String(typeof value === "object" && value !== null
      ? value.url || value.imageUrl || value.image_url || value.publicUrl || value.public_url || value.file_url || ""
      : value || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    manifest.push({
      url,
      name: String(
        (typeof value === "object" && value !== null
          ? value.name || value.title || value.fileName || value.file_name || value.filename
          : "")
        || names[index]
        || ""
      ).trim() || referenceFilenameFromUrl(url, manifest.length)
    });
  });
  return manifest.slice(0, 30);
}

function getJobReferenceUrls(job) {
  return getJobReferenceManifest(job).map((item) => item.url);
}

function formatTiming(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return "—";
  if (milliseconds < 1000) return Math.round(milliseconds) + " ms";
  return (milliseconds / 1000).toFixed(milliseconds >= 10000 ? 0 : 1) + " s";
}

function parseBulkAccounts(text) {
  const accounts = [];
  const errors = [];
  String(text || "").split(/\r?\n/).forEach((rawLine, index) => {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    // Accept rows copied from a Markdown table. A pasted table commonly has
    // one account inside `| ... |` and a separator row made only of dashes.
    if (line.startsWith("|") || line.endsWith("|")) {
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
      if (cells.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return;
      line = cells.length === 1 ? cells[0] : cells.join(",");
    }
    let parts;
    if (line.includes(",") || line.includes("\t")) {
      const separator = line.includes("\t") ? "\t" : ",";
      const fields = [];
      let field = "";
      let quoted = false;
      for (let cursor = 0; cursor < line.length; cursor += 1) {
        const character = line[cursor];
        if (character === '"' && line[cursor + 1] === '"' && quoted) {
          field += '"';
          cursor += 1;
        } else if (character === '"') {
          quoted = !quoted;
        } else if (character === separator && !quoted) {
          fields.push(field);
          field = "";
        } else {
          field += character;
        }
      }
      fields.push(field);
      if (quoted) {
        errors.push("Dòng " + (index + 1) + " có dấu ngoặc kép CSV chưa đóng");
        return;
      }
      parts = fields;
    } else {
      const delimiter = line.match(/\s*-{3,4}\s*/);
      if (!delimiter || delimiter.index == null) {
        errors.push("Dòng " + (index + 1) + " dùng CSV (email,password,totp) hoặc email----password----totp");
        return;
      }
      const emailPart = line.slice(0, delimiter.index);
      const remainder = line.slice(delimiter.index + delimiter[0].length);
      const totpDelimiter = remainder.match(/\s*-{3,4}\s*/);
      parts = totpDelimiter && totpDelimiter.index != null
        ? [emailPart, remainder.slice(0, totpDelimiter.index), remainder.slice(totpDelimiter.index + totpDelimiter[0].length)]
        : [emailPart, remainder];
    }
    const [rawEmail, password, ...totpParts] = parts;
    const email = String(rawEmail || "").trim().replace(/\\@/g, "@");
    if (index === 0 && email.toLowerCase() === "email"
      && String(password || "").trim().toLowerCase() === "password") {
      return;
    }
    if (!email.trim() || !password) {
      errors.push("Dòng " + (index + 1) + " thiếu email hoặc mật khẩu");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      errors.push("Dòng " + (index + 1) + " có email không hợp lệ");
      return;
    }
    accounts.push({
      email: email.trim(),
      password,
      totp: totpParts.join("----").trim()
    });
  });
  return { accounts, errors };
}

function parseBulkProxies(text) {
  const proxies = [];
  const errors = [];
  String(text || "").split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const validUrl = /^(?:https?|socks5):\/\/[^\s]+$/i.test(line);
    const parts = line.split(line.includes(",") ? "," : ":");
    const validLegacy = parts.length >= 2 && parts[0].trim() && /^\d{1,5}$/.test(parts[1].trim());
    if (!validUrl && !validLegacy) {
      errors.push("Dòng " + (index + 1) + " dùng host:port:user:password hoặc URL proxy");
      return;
    }
    proxies.push(line);
  });
  return { proxies, errors };
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function formatUnixDate(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  return formatDate(timestamp * 1000);
}

function formatProxyCountdown(value, nowMs, readyLabel) {
  const timestamp = Number(value);
  const secondsLeft = Math.ceil(timestamp - Number(nowMs || Date.now()) / 1000);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || secondsLeft <= 0) return readyLabel;
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;
  if (hours) return `${hours} giờ ${minutes} phút`;
  if (minutes) return `${minutes} phút ${seconds} giây`;
  return `${seconds} giây`;
}

function formatProviderCreditDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "chưa rõ thời điểm";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date(timestamp * 1000));
  } catch {
    return formatUnixDate(timestamp);
  }
}

function providerDateKey(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function creditCheckLabel(account) {
  const checkedAt = Number(account?.credit_checked_at);
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) return "Chưa có lần xác minh credit";
  const dateLabel = formatProviderCreditDateTime(checkedAt);
  if (!account?.credit_stale) return "Đã xác minh hôm nay · " + dateLabel;

  const checkedDay = providerDateKey(checkedAt * 1000);
  const todayDay = providerDateKey(Date.now());
  const [year, month, day] = todayDay.split("-").map(Number);
  const yesterdayDay = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  const ageLabel = checkedDay === yesterdayDay ? "hôm qua" : "ngày " + dateLabel;
  return "Cache cũ từ " + ageLabel + " · sẽ thử xác minh trước khi gửi";
}

function creditBalanceSummary(account) {
  if (account?.credit_balance == null) return "Credit chưa rõ";
  const balance = Number(account.credit_balance);
  if (!Number.isFinite(balance)) return "Credit chưa rõ";
  return "Credit " + balance + (account.credit_stale
    ? " · cache cũ"
    : balance < 2 ? " · Dola xác nhận theo chế độ" : "");
}

function creditBalanceDetails(account) {
  return [
    creditCheckLabel(account),
    account?.quota_reason ? "Dola: " + account.quota_reason : ""
  ].filter(Boolean).join(" · ");
}

function truncate(value, length = 92) {
  const text = String(value || "");
  return text.length > length ? text.slice(0, length - 1) + "…" : text;
}

function getMediaItemId(item) {
  return String(item?.id || item?.previewUrl || item?.file_url || item?.relative_path || item?.file_name || "");
}

const MEDIA_ORIGINAL_NAMES_STORAGE_KEY = "dola-studio-media-original-names-v1";

function readStoredMediaOriginalNames() {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.sessionStorage.getItem(MEDIA_ORIGINAL_NAMES_STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function mediaItemKeys(item) {
  return [item?.id, item?.previewUrl, item?.file_url, item?.relative_path, item?.file_name]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function getMediaItemTitle(item) {
  return [
    item?.title,
    item?.metadata?.title,
    item?.metadata?.name
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

function mediaPathVariants(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const values = [raw];
  try {
    const parsed = new URL(raw, "http://dola-media.local");
    values.push(parsed.pathname);
    for (const key of ["path", "relative_path"]) {
      const queryValue = parsed.searchParams.get(key);
      if (queryValue) values.push(queryValue);
    }
  } catch {
    // Keep the raw value for legacy or malformed media URLs.
  }
  return Array.from(new Set(values.map((item) => {
    try {
      return decodeURIComponent(String(item || ""));
    } catch {
      return String(item || "");
    }
  }).map((item) => item.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "").toLowerCase()).filter(Boolean)));
}

function mediaLabelVariants(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const values = [raw];
  try {
    values.push(decodeURIComponent(raw));
  } catch {
    // Keep the original title when it is not URI encoded.
  }
  return Array.from(new Set(values.flatMap((item) => {
    const normalized = String(item || "").trim();
    if (!normalized) return [];
    const leaf = normalized.replaceAll("\\", "/").split("/").pop()?.trim() || normalized;
    return [normalized, leaf];
  }).map((item) => item.toLowerCase()).filter(Boolean)));
}

function mediaItemMatchesReference(item, reference) {
  const referenceUrl = typeof reference === "object" ? reference?.url : reference;
  const referencePaths = mediaPathVariants(referenceUrl);
  const itemPaths = [
    item?.previewUrl,
    item?.thumbnail,
    item?.file_url,
    item?.publicUrl,
    item?.public_url,
    item?.relative_path,
    item?.file_name,
    item?.originalFileName,
    item?.original_file_name,
    item?.title
  ].flatMap(mediaPathVariants);
  const referenceLeaves = referencePaths.map((value) => value.split("/").pop()).filter(Boolean);
  const itemLeaves = itemPaths.map((value) => value.split("/").pop()).filter(Boolean);
  const pathMatches = referencePaths.some((referencePath) => itemPaths.some((itemPath) => (
    referencePath === itemPath
      || referencePath.endsWith("/" + itemPath)
      || itemPath.endsWith("/" + referencePath)
  ))) || referenceLeaves.some((referenceLeaf) => itemLeaves.some((itemLeaf) => (
    itemLeaf === referenceLeaf || itemLeaf.endsWith("_" + referenceLeaf)
  )));
  const referenceTitles = [
    typeof reference === "object" ? reference?.name : "",
    typeof reference === "object" ? reference?.title : ""
  ].flatMap(mediaLabelVariants);
  const itemTitles = [
    getMediaItemTitle(item),
    item?.name,
    item?.originalFileName,
    item?.original_file_name
  ].flatMap(mediaLabelVariants);
  const titleMatches = referenceTitles.length > 0 && referenceTitles.some((referenceTitle) => (
    itemTitles.includes(referenceTitle)
  ));
  return pathMatches || titleMatches;
}

function getMediaItemName(item, rememberedNames = {}) {
  const title = getMediaItemTitle(item);
  if (title) return title;

  const remembered = mediaItemKeys(item)
    .map((key) => String(rememberedNames?.[key] || "").trim())
    .find(Boolean);
  return remembered
    || String(item?.name || item?.originalFileName || item?.original_file_name || item?.file_name || "Ảnh tham chiếu").trim()
    || "Ảnh tham chiếu";
}

function isTimeoutError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || error || "");
  return name === "TimeoutError" || /signal timed out|timed out|timeout|không phản hồi kịp thời/i.test(message);
}

function formatReferenceImageSize(bytes) {
  const value = Number(bytes || 0) / (1024 * 1024);
  return Number.isFinite(value) && value > 0 ? value.toFixed(1) + " MB" : "kích thước không xác định";
}

function toAbsoluteUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("data:") || /^https?:\/\//i.test(raw) || typeof window === "undefined") return raw;
  try {
    return new URL(raw, window.location.origin).toString();
  } catch {
    return raw;
  }
}

function getMediaItemReferenceUrl(item) {
  return item?.publicUrl
    || item?.public_url
    || item?.file_url
    || item?.previewUrl
    || item?.thumbnail
    || "";
}

function getJobVideoPreviewUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  // Route Gateway-owned output through the current Studio origin. This keeps
  // local previews working even when the task stores the public
  // seedance.maivideo.top URL, and lets Next forward byte-range requests to
  // the local Gateway.
  if (typeof window === "undefined") return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.pathname.startsWith("/videos/")) {
      return parsed.pathname + parsed.search;
    }
    return parsed.toString();
  } catch {
    return toAbsoluteUrl(raw);
  }
}

function readMaiVideoSessionId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("accountSessionId")
    || window.sessionStorage.getItem("accountSessionId")
    || window.sessionStorage.getItem("publicToolSessionId")
    || window.localStorage.getItem("sessionId")
    || window.sessionStorage.getItem("sessionId")
    || "";
}

function readMaiVideoAuthToken() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem("dola-maivideo-auth-token")
    || window.localStorage.getItem("authToken")
    || window.sessionStorage.getItem("authToken")
    || "";
}

function clearMaiVideoClientStorage() {
  if (typeof window === "undefined") return;
  const keys = [
    "dola-maivideo-auth-token",
    "authToken",
    "accountSessionId",
    "publicToolSessionId",
    "sessionId"
  ];
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of keys) {
      try {
        storage.removeItem(key);
      } catch {
        // Storage can be unavailable in some private browser contexts.
      }
    }
  }
}

function jobsStorageKey(user) {
  const identity = String(user?.id || user?.user_id || user?.email || "").trim().toLowerCase();
  return identity
    ? "dola-studio-jobs:" + encodeURIComponent(identity)
    : "dola-studio-jobs:anonymous";
}

function readQueueOwnerFilter(storageKey) {
  try {
    const value = window.sessionStorage.getItem(storageKey + ":queue-owner");
    return value === "all" || value === "me" || /^[a-f0-9]{64}$/i.test(value || "")
      ? value || "me"
      : "me";
  } catch {
    return "me";
  }
}

function projectJobForStorage(job, includeDetails) {
  const referenceImages = Array.isArray(job?.referenceImages) ? job.referenceImages : [];
  const referenceImageNames = Array.isArray(job?.referenceImageNames) ? job.referenceImageNames : [];
  const videoMetadata = job?.videoMetadata && typeof job.videoMetadata === "object"
    ? {
        duration: job.videoMetadata.duration,
        width: job.videoMetadata.width,
        height: job.videoMetadata.height,
        watermark_free: job.videoMetadata.watermark_free,
        watermark_removed: job.videoMetadata.watermark_removed,
        duration_mismatch: job.videoMetadata.duration_mismatch
      }
    : null;
  return {
    id: String(job?.id || ""),
    status: job?.status || "unknown",
    model: job?.model || null,
    duration: job?.duration || null,
    account: job?.account || null,
    ratio: job?.ratio || null,
    prompt: String(job?.prompt || "").slice(0, includeDetails ? MAX_PROMPT_CHARS : 1600),
    submittedAt: job?.submittedAt || null,
    createdAt: job?.createdAt || null,
    startedAt: job?.startedAt || null,
    finishedAt: job?.finishedAt || null,
    updatedAt: job?.updatedAt || null,
    videoUrl: includeDetails ? job?.videoUrl || null : null,
    error: String(job?.error || "").slice(0, 800) || null,
    failureCode: job?.failureCode || null,
    videoMetadata: includeDetails ? videoMetadata : null,
    timings: includeDetails ? job?.timings || null : null,
    referenceImages: referenceImages
      .slice(0, includeDetails ? 30 : 3)
      .map((value) => String(value || "").slice(0, includeDetails ? 4000 : 1200)),
    referenceImageNames: referenceImageNames
      .slice(0, includeDetails ? 30 : 3)
      .map((value) => String(value || "").slice(0, 300)),
    referenceImageMode: job?.referenceImageMode || "none",
    retryOf: job?.retryOf || null,
    retryCount: Math.max(0, Number(job?.retryCount || 0) || 0),
    provider: job?.provider || "gateway"
  };
}

function serializeJobsForStorage(jobList) {
  const sorted = hideSupersededJobs(jobList)
    .slice()
    .sort((left, right) => (Date.parse(right?.submittedAt || "") || 0) - (Date.parse(left?.submittedAt || "") || 0));
  const active = sorted.filter((job) => isActiveJobStatus(job?.status)).slice(0, 60);
  const localFailures = sorted
    .filter((job) => String(job?.id || "").startsWith("local_failed_"))
    .slice(0, 20);
  const selectedIds = new Set([...active, ...localFailures].map((job) => String(job?.id || "")));
  const remaining = sorted.filter((job) => !selectedIds.has(String(job?.id || "")));
  const candidates = [...active, ...localFailures, ...remaining]
    .slice(0, JOBS_STORAGE_MAX_ITEMS)
    .sort((left, right) => (Date.parse(right?.submittedAt || "") || 0) - (Date.parse(left?.submittedAt || "") || 0));

  let snapshot = candidates.map((job, index) => projectJobForStorage(job, index < 20));
  let serialized = JSON.stringify(snapshot);
  if (serialized.length > JOBS_STORAGE_MAX_CHARS) {
    snapshot = candidates.slice(0, 50).map((job) => projectJobForStorage(job, false));
    serialized = JSON.stringify(snapshot);
  }
  while (serialized.length > JOBS_STORAGE_MAX_CHARS && snapshot.length > 20) {
    snapshot.pop();
    serialized = JSON.stringify(snapshot);
  }
  return serialized;
}

function readStoredJobs(user) {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(jobsStorageKey(user)) || "[]");
    return Array.isArray(saved) ? hideSupersededJobs(saved) : [];
  } catch {
    return [];
  }
}

function hideSupersededJobs(jobList) {
  const jobs = Array.isArray(jobList) ? jobList : [];
  const retriedIds = new Set(
    jobs
      .map((job) => String(job?.retryOf || "").trim())
      .filter(Boolean)
  );
  return jobs.filter((job) => job?.id && !retriedIds.has(String(job.id)));
}

function mergeGatewayJobs(currentJobs, gatewayJobs, { replaceGateway = false } = {}) {
  const originalJobs = Array.isArray(currentJobs) ? currentJobs : [];
  const baseJobs = replaceGateway
    ? originalJobs.filter((job) => String(job?.id || "").startsWith("local_failed_"))
    : originalJobs;
  const merged = new Map();
  for (const job of baseJobs) {
    if (job?.id) merged.set(String(job.id), job);
  }
  for (const incoming of Array.isArray(gatewayJobs) ? gatewayJobs : []) {
    if (!incoming?.id) continue;
    const id = String(incoming.id);
    const current = merged.get(id) || {};
    const next = { ...current, ...incoming, id };
    // Keep richer browser-side data while a task is still being written to the
    // shared SQLite store (for example a just-created video URL or metadata).
    for (const field of ["account", "ratio", "prompt", "submittedAt", "createdAt", "startedAt", "finishedAt", "updatedAt", "videoUrl", "videoMetadata", "timings", "referenceImages", "referenceImageNames", "retryOf", "retryCount"]) {
      if (incoming[field] == null || incoming[field] === "") {
        if (current[field] != null && current[field] !== "") next[field] = current[field];
      }
    }
    merged.set(id, next);
  }
  const result = hideSupersededJobs(Array.from(merged.values()))
    .sort((left, right) => {
      const leftTime = Date.parse(left.submittedAt || "") || 0;
      const rightTime = Date.parse(right.submittedAt || "") || 0;
      return rightTime - leftTime;
    });
  if (!replaceGateway && result.length === originalJobs.length && result.every((job, index) => {
    const previous = originalJobs[index];
    return previous?.id === job.id
      && previous?.status === job.status
      && previous?.model === job.model
      && previous?.duration === job.duration
      && previous?.account === job.account
      && previous?.ratio === job.ratio
      && previous?.prompt === job.prompt
      && previous?.submittedAt === job.submittedAt
      && previous?.createdAt === job.createdAt
      && previous?.startedAt === job.startedAt
      && previous?.finishedAt === job.finishedAt
      && previous?.updatedAt === job.updatedAt
      && previous?.videoUrl === job.videoUrl
      && JSON.stringify(previous?.timings || null) === JSON.stringify(job.timings || null)
      && JSON.stringify(previous?.referenceImages || []) === JSON.stringify(job.referenceImages || [])
      && JSON.stringify(previous?.referenceImageNames || []) === JSON.stringify(job.referenceImageNames || [])
      && previous?.retryOf === job.retryOf
      && previous?.retryCount === job.retryCount
      && previous?.error === job.error
      && previous?.failureCode === job.failureCode
      && JSON.stringify(previous?.videoMetadata || null) === JSON.stringify(job.videoMetadata || null);
  })) return originalJobs;
  return result;
}

function parseQueueValue(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function queueTimestamp(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeQueueTask(row) {
  if (!row || typeof row !== "object") return null;
  const referenceImages = parseQueueValue(row.referenceImages ?? row.reference_images, []);
  const referenceImageNames = parseQueueValue(row.referenceImageNames ?? row.reference_image_names, []);
  const timings = parseQueueValue(row.timings ?? row.timings_json, null);
  const videoMetadata = parseQueueValue(row.videoMetadata ?? row.video_metadata, null);
  return {
    ...row,
    id: String(row.id || row.task_id || row.taskId || ""),
    status: String(row.status || "unknown"),
    model: row.model || null,
    duration: Number(row.duration || 0) || null,
    account: row.account || null,
    ratio: row.ratio && row.ratio !== "default" ? String(row.ratio) : null,
    prompt: String(row.prompt || ""),
    submittedAt: queueTimestamp(row.submittedAt || row.last_retry_at || row.createdAt || row.created_at),
    createdAt: queueTimestamp(row.createdAt || row.created_at),
    startedAt: queueTimestamp(row.startedAt || row.started_at),
    finishedAt: queueTimestamp(row.finishedAt || row.finished_at),
    updatedAt: queueTimestamp(row.updatedAt || row.updated_at),
    videoUrl: row.videoUrl || row.video_url || null,
    error: row.error || null,
    failureCode: row.failureCode || row.failure_code || null,
    timings: timings && typeof timings === "object" ? timings : null,
    videoMetadata: videoMetadata && typeof videoMetadata === "object" ? videoMetadata : null,
    referenceImages: Array.isArray(referenceImages) ? referenceImages : [],
    referenceImageNames: Array.isArray(referenceImageNames) ? referenceImageNames : [],
    referenceImageMode: row.referenceImageMode || row.reference_image_mode || "none",
    retryOf: row.retryOf || row.retry_of || null,
    retryCount: Math.max(0, Number(row.retryCount ?? row.retry_count ?? 0) || 0),
    provider: row.provider || "gateway"
  };
}

function queueRowsFromPayload(payload, allowLegacyUserTasks) {
  const rows = Array.isArray(payload?.jobs)
    ? payload.jobs
    : allowLegacyUserTasks && Array.isArray(payload?.tasks)
      ? payload.tasks
      : null;
  return rows?.map(normalizeQueueTask).filter((job) => job?.id) || null;
}

function readStoredBatches() {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem("dola-studio-batches") || "[]");
    return Array.isArray(saved) ? saved.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function downloadFile(url, filename) {
  if (!url || typeof document === "undefined") return;
  const anchor = document.createElement("a");
  // Route Gateway outputs through the currently open Studio origin. Tasks may
  // store the public tunnel URL even when Studio is open locally; using that
  // absolute URL bypasses the local proxy and can make Chrome open the video
  // inline instead of honoring the download attribute.
  try {
    const downloadUrl = new URL(getJobVideoPreviewUrl(url), window.location.href);
    downloadUrl.searchParams.set("download", "1");
    downloadUrl.searchParams.set("filename", filename || "video.mp4");
    // Do not reuse a previously cached response if the Gateway replaced a
    // watermarked fallback with a cleaned output.
    downloadUrl.searchParams.set("_", String(Date.now()));
    anchor.href = downloadUrl.toString();
  } catch {
    anchor.href = url;
  }
  anchor.download = filename;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function readResponsePayload(response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { error: raw.slice(0, 300) };
  }
}

const IMAGE_FILE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const IMAGE_FILE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isImageReferenceFile(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  if (mimeType) return IMAGE_FILE_MIME_TYPES.has(mimeType);
  const name = String(file?.name || "").toLowerCase();
  return IMAGE_FILE_EXTENSIONS.has(name.slice(name.lastIndexOf(".")));
}

function getClipboardImageFiles(clipboardData) {
  if (!clipboardData) return [];
  const files = Array.from(clipboardData.files || []).filter(isImageReferenceFile);
  if (files.length) return files;
  return Array.from(clipboardData.items || [])
    .filter((item) => item.kind === "file" && item.type?.toLowerCase().startsWith("image/"))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
}

function getDroppedImageFiles(dataTransfer) {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files || []).filter(isImageReferenceFile);
  if (files.length) return files;
  return Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === "file" && item.type?.toLowerCase().startsWith("image/"))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
}

export default function StudioShell({ embedded = false, initialView = "overview", initialLocalMode = false } = {}) {
  const [activeView, setActiveView] = useState(initialView);
  const [promptText, setPromptText] = useState("");
  const [mediaImages, setMediaImages] = useState([]);
  const [mediaOriginalNames, setMediaOriginalNames] = useState(() => readStoredMediaOriginalNames());
  const mediaOriginalNamesRef = useRef(mediaOriginalNames);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [mediaNotice, setMediaNotice] = useState("");
  const [mediaPanelOpen, setMediaPanelOpen] = useState(false);
  const [mediaSearch, setMediaSearch] = useState("");
  const [selectedMediaIds, setSelectedMediaIds] = useState([]);
  const [referenceOrder, setReferenceOrder] = useState([]);
  const [referenceDragKey, setReferenceDragKey] = useState("");
  const [referenceDragOverKey, setReferenceDragOverKey] = useState("");
  const [mediaBulkSelectedIds, setMediaBulkSelectedIds] = useState([]);
  const [mediaBulkDeleting, setMediaBulkDeleting] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaDragActive, setMediaDragActive] = useState(false);
  const [mediaLoginEmail, setMediaLoginEmail] = useState("");
  const [mediaLoginPassword, setMediaLoginPassword] = useState("");
  const [mediaLoginSubmitting, setMediaLoginSubmitting] = useState(false);
  const [maivideoLogoutSubmitting, setMaivideoLogoutSubmitting] = useState(false);
  const [mediaDeletingId, setMediaDeletingId] = useState("");
  const [model, setModel] = useState(ENABLED_MODEL);
  const [duration, setDuration] = useState(15);
  useEffect(() => {
    if (!SUPPORTED_DURATIONS.includes(duration)) setDuration(15);
  }, [duration]);
  const [ratio, setRatio] = useState("9:16");
  const [referenceImageMode, setReferenceImageMode] = useState("none");
  const [characterColorDescription, setCharacterColorDescription] = useState("");
  const [inheritedReferenceUrls, setInheritedReferenceUrls] = useState([]);
  const [inheritedReferenceNames, setInheritedReferenceNames] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [batches, setBatches] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [hydratedIdentity, setHydratedIdentity] = useState("");
  const [services, setServices] = useState(SERVICE_FALLBACKS);
  const [serviceLoading, setServiceLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [accountJobs, setAccountJobs] = useState({});
  const [selectedAccountNames, setSelectedAccountNames] = useState([]);
  const [accountActivityFilter, setAccountActivityFilter] = useState("all");
  const [accountsBulkDeleting, setAccountsBulkDeleting] = useState(false);
  const [accountsBulkScheduling, setAccountsBulkScheduling] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountAdminKey, setAccountAdminKey] = useState("");
  const [openProfiles, setOpenProfiles] = useState({});
  const [accountProfileActionName, setAccountProfileActionName] = useState("");
  const [accountSessionReloginName, setAccountSessionReloginName] = useState("");
  const [accountsBulkSessionRelogin, setAccountsBulkSessionRelogin] = useState(false);
  const [bulkAccountText, setBulkAccountText] = useState("");
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [manualProfileName, setManualProfileName] = useState("");
  const [manualProfileSubmitting, setManualProfileSubmitting] = useState(false);
  const [accountVerifyingName, setAccountVerifyingName] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  const [accountError, setAccountError] = useState("");
  const [proxies, setProxies] = useState([]);
  const [proxySummary, setProxySummary] = useState({ total: 0, healthy: 0, errors: 0, rotating: 0, assigned: 0 });
  const [proxyClock, setProxyClock] = useState(() => Date.now());
  const proxyAutoRecheckRef = useRef({ ids: [], busy: false, inFlight: false });
  const [proxyText, setProxyText] = useState("");
  const [proxyProtocol, setProxyProtocol] = useState("HTTP");
  const [proxyMode, setProxyMode] = useState("rotating");
  const [proxyNamePrefix, setProxyNamePrefix] = useState("JP rotating");
  const [proxySelectedIds, setProxySelectedIds] = useState([]);
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxySubmitting, setProxySubmitting] = useState(false);
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyDeleting, setProxyDeleting] = useState(false);
  const [proxyBulkAssignId, setProxyBulkAssignId] = useState("");
  const [proxyAssigning, setProxyAssigning] = useState(false);
  const [proxyDistributing, setProxyDistributing] = useState(false);
  const [proxyRenameId, setProxyRenameId] = useState("");
  const [proxyRenameValue, setProxyRenameValue] = useState("");
  const [proxyRenameSubmitting, setProxyRenameSubmitting] = useState(false);
  const [proxyfbApiKey, setProxyfbApiKey] = useState("");
  const [proxyfbLocationId, setProxyfbLocationId] = useState("1");
  const [proxyfbName, setProxyfbName] = useState("ProxyFB JP");
  const [proxyfbBulkText, setProxyfbBulkText] = useState("");
  const [proxyfbSubmitting, setProxyfbSubmitting] = useState(false);
  const [proxyfbBulkSubmitting, setProxyfbBulkSubmitting] = useState(false);
  const [proxyfbRotatingId, setProxyfbRotatingId] = useState("");
  const [proxyfbBulkRotating, setProxyfbBulkRotating] = useState(false);
  const [maivideoSession, setMaivideoSession] = useState(() => initialLocalMode
    ? { loading: false, authenticated: true, user: LOCAL_STUDIO_USER, error: "" }
    : { loading: true, authenticated: false, user: null, error: "" });
  const [localMode, setLocalMode] = useState(initialLocalMode);
  const [authMode, setAuthMode] = useState("login");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [authRemember, setAuthRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [queueScope, setQueueScope] = useState("user");
  const [queueOwnerFilter, setQueueOwnerFilter] = useState("me");
  const [queueOwners, setQueueOwners] = useState([]);
  const [queueCurrentOwnerId, setQueueCurrentOwnerId] = useState("");
  const [queueLoadedOwnerSelection, setQueueLoadedOwnerSelection] = useState("");
  const [queueSyncError, setQueueSyncError] = useState("");
  const [queueFilter, setQueueFilter] = useState("all");
  const [queueSearch, setQueueSearch] = useState("");
  const [queueDateStart, setQueueDateStart] = useState("");
  const [queueDateEnd, setQueueDateEnd] = useState("");
  const [queuePage, setQueuePage] = useState(1);
  const [selectedJobIds, setSelectedJobIds] = useState([]);
  const [jobsBulkDeleting, setJobsBulkDeleting] = useState(false);
  const [jobsCancelling, setJobsCancelling] = useState(false);
  const [retryingJobIds, setRetryingJobIds] = useState([]);
  const [loadingComposerJobIds, setLoadingComposerJobIds] = useState([]);
  const [jobInfo, setJobInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const promptInputRef = useRef(null);
  const promptSyncTimerRef = useRef(null);
  const promptTruncatedRef = useRef(false);
  const mediaInlineFileInputRef = useRef(null);
  const mediaFileInputRef = useRef(null);
  const mediaLibraryButtonRef = useRef(null);
  const mediaModalCloseRef = useRef(null);
  const pendingReferenceSelectionRef = useRef([]);
  const maivideoSessionRequestIdRef = useRef(0);
  const jobsRef = useRef(jobs);
  const queueIdentityRef = useRef("");
  const metadataChecksRef = useRef(new Map());
  jobsRef.current = jobs;
  const maivideoUserId = String(maivideoSession.user?.id || maivideoSession.user?.user_id || "");
  const maivideoUserEmail = String(maivideoSession.user?.email || "");
  const currentJobsStorageKey = jobsStorageKey({ id: maivideoUserId, email: maivideoUserEmail });

  useEffect(() => () => {
    if (promptSyncTimerRef.current) window.clearTimeout(promptSyncTimerRef.current);
  }, []);

  const singlePrompt = useMemo(() => getSinglePrompt(promptText), [promptText]);
  const bulkAccounts = useMemo(() => parseBulkAccounts(bulkAccountText), [bulkAccountText]);
  const bulkProxies = useMemo(() => parseBulkProxies(proxyText), [proxyText]);
  const proxyfbBulkKeys = useMemo(
    () => String(proxyfbBulkText || "").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")),
    [proxyfbBulkText]
  );
  const reloginEligibleAccounts = useMemo(() => accounts.filter((account) => {
    const jobStatus = accountJobs[account.name]?.status;
    return account.login_ok !== 1
      && jobStatus !== "queued"
      && jobStatus !== "running"
      && !account.busy
      && !openProfiles[account.name];
  }), [accounts, accountJobs, openProfiles]);
  const sessionReloginEligibleAccounts = useMemo(() => accounts.filter((account) => {
    const jobStatus = accountJobs[account.name]?.status;
    const riskControlled = account.cooldown_reason === "risk_control";
    return (account.login_ok !== 1 || riskControlled)
      && jobStatus !== "queued"
      && jobStatus !== "running"
      && !account.busy
      && !openProfiles[account.name];
  }), [accounts, accountJobs, openProfiles]);
  const riskControlEligibleAccounts = useMemo(() => accounts.filter((account) => {
    const jobStatus = accountJobs[account.name]?.status;
    return account.cooling
      && account.cooldown_reason === "risk_control"
      && jobStatus !== "queued"
      && jobStatus !== "running"
      && !account.busy
      && !openProfiles[account.name];
  }), [accounts, accountJobs, openProfiles]);
  const selectedReloginAccounts = useMemo(
    () => reloginEligibleAccounts.filter((account) => selectedAccountNames.includes(account.name)),
    [reloginEligibleAccounts, selectedAccountNames]
  );
  const selectedSessionReloginAccounts = useMemo(
    () => sessionReloginEligibleAccounts.filter((account) => selectedAccountNames.includes(account.name)),
    [selectedAccountNames, sessionReloginEligibleAccounts]
  );
  const selectedMediaItems = useMemo(
    () => selectedMediaIds
      .map((id) => mediaImages.find((item) => getMediaItemId(item) === id))
      .filter(Boolean),
    [mediaImages, selectedMediaIds]
  );
  const maxReferenceImages = 30;
  const referenceEntries = useMemo(() => {
    const entries = [];
    const seenUrls = new Set();
    const addEntry = (entry) => {
      if (!entry.url || seenUrls.has(entry.url)) return;
      seenUrls.add(entry.url);
      entries.push(entry);
    };

    inheritedReferenceUrls.forEach((value, index) => {
      const url = toAbsoluteUrl(value);
      addEntry({
        key: "inherited:" + url,
        kind: "inherited",
        url,
        previewUrl: url,
        label: inheritedReferenceNames[index] || "Ảnh từ video gốc"
      });
    });
    selectedMediaItems.forEach((item) => {
      const id = getMediaItemId(item);
      const url = toAbsoluteUrl(getMediaItemReferenceUrl(item));
      const previewUrl = toAbsoluteUrl(item.previewUrl || item.file_url || item.thumbnail);
      addEntry({
        key: "media:" + id,
        kind: "media",
        id,
        url,
        previewUrl,
        label: getMediaItemName(item, mediaOriginalNames),
        size: Number(item.size || 0)
      });
    });
    return entries;
  }, [inheritedReferenceNames, inheritedReferenceUrls, mediaOriginalNames, selectedMediaItems]);
  const orderedReferenceEntries = useMemo(() => {
    const entriesByKey = new Map(referenceEntries.map((entry) => [entry.key, entry]));
    const ordered = referenceOrder
      .map((key) => entriesByKey.get(key))
      .filter(Boolean);
    const orderedKeys = new Set(ordered.map((entry) => entry.key));
    return ordered.concat(referenceEntries.filter((entry) => !orderedKeys.has(entry.key))).slice(0, maxReferenceImages);
  }, [maxReferenceImages, referenceEntries, referenceOrder]);
  useEffect(() => {
    const keys = referenceEntries.map((entry) => entry.key);
    setReferenceOrder((current) => {
      const available = new Set(keys);
      const next = current.filter((key) => available.has(key));
      const alreadyIncluded = new Set(next);
      keys.forEach((key) => {
        if (!alreadyIncluded.has(key)) {
          next.push(key);
          alreadyIncluded.add(key);
        }
      });
      if (next.length === current.length && next.every((key, index) => key === current[index])) return current;
      return next;
    });
  }, [referenceEntries]);
  const combinedReferenceEntries = useMemo(() => {
    const seen = new Set();
    return orderedReferenceEntries.filter((entry) => {
      if (!entry.url || seen.has(entry.url)) return false;
      seen.add(entry.url);
      return true;
    }).slice(0, maxReferenceImages);
  }, [maxReferenceImages, orderedReferenceEntries]);
  const combinedReferences = useMemo(
    () => combinedReferenceEntries.map((entry) => entry.url),
    [combinedReferenceEntries]
  );
  const combinedReferenceNames = useMemo(
    () => combinedReferenceEntries.map((entry, index) => entry.label || "Ảnh tham chiếu #" + (index + 1)),
    [combinedReferenceEntries]
  );
  const filteredMediaImages = useMemo(() => {
    const needle = mediaSearch.trim().toLowerCase();
    if (!needle) return mediaImages;
    return mediaImages.filter((item) => [getMediaItemName(item, mediaOriginalNames), item.title, item.file_name, item.relative_path]
      .some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [mediaImages, mediaOriginalNames, mediaSearch]);
  const filteredMediaIds = useMemo(
    () => filteredMediaImages.map(getMediaItemId).filter(Boolean),
    [filteredMediaImages]
  );
  const allVisibleMediaSelected = filteredMediaIds.length > 0
    && filteredMediaIds.every((id) => mediaBulkSelectedIds.includes(id));
  const someVisibleMediaSelected = filteredMediaIds.some((id) => mediaBulkSelectedIds.includes(id));
  const currentUserIsAdmin = String(maivideoSession.user?.role || "").trim().toLowerCase() === "admin";
  const queueDataReady = hydrated
    && hydratedIdentity === currentJobsStorageKey
    && !queueSyncError
    && queueLoadedOwnerSelection === queueOwnerFilter;
  const visibleJobs = useMemo(() => {
    const current = hideSupersededJobs(jobs);
    const isAdminQueue = queueScope === "admin" || currentUserIsAdmin;
    if (!isAdminQueue) return current;
    // Never briefly render a cached all-users queue while an admin's selected
    // owner scope is being refreshed. Owner IDs are opaque and are attached by
    // the Gateway; legacy cache entries without one are intentionally hidden.
    if (queueLoadedOwnerSelection !== queueOwnerFilter) return [];
    if (queueOwnerFilter === "all") return current;
    const selectedOwnerId = queueOwnerFilter === "me" ? queueCurrentOwnerId : queueOwnerFilter;
    if (!selectedOwnerId) return [];
    return current.filter((job) => String(job.ownerId || "") === selectedOwnerId
      || (queueOwnerFilter === "me" && String(job.id || "").startsWith("local_failed_")));
  }, [currentUserIsAdmin, jobs, queueCurrentOwnerId, queueLoadedOwnerSelection, queueOwnerFilter, queueScope]);
  const hasQueueDateFilter = Boolean(queueDateStart || queueDateEnd);
  const previousQueueMonth = queueMonthRange(-1);
  const currentQueueMonth = queueMonthRange(0);
  const counts = useMemo(() => {
    if (!queueDataReady) {
      return { total: "—", queued: "—", submitting: "—", processing: "—", completed: "—", failed: "—", cancelled: "—", active: "—" };
    }
    const count = (status) => visibleJobs.filter((job) => job.status === status).length;
    return {
      total: visibleJobs.length,
      queued: count("queued"),
      submitting: count("submitting"),
      processing: count("processing"),
      completed: count("completed"),
      failed: count("failed"),
      cancelled: count("cancelled"),
      active: visibleJobs.filter((job) => isActiveJobStatus(job.status)).length
    };
  }, [queueDataReady, visibleJobs]);
  const filteredJobs = useMemo(() => {
    const needle = queueSearch.trim().toLowerCase();
    return visibleJobs.filter((job) => {
      const matchesFilter = queueFilter === "all"
        || (queueFilter === "processing" ? isActiveJobStatus(job.status) : job.status === queueFilter);
      const jobDate = queueJobDateKey(job.submittedAt || job.createdAt);
      const matchesDate = (!queueDateStart || jobDate >= queueDateStart)
        && (!queueDateEnd || jobDate <= queueDateEnd);
      const matchesSearch = !needle
        || String(job.prompt || "").toLowerCase().includes(needle)
        || String(job.id || "").toLowerCase().includes(needle)
        || String(job.account || "").toLowerCase().includes(needle);
      return matchesFilter && matchesDate && matchesSearch;
    });
  }, [visibleJobs, queueDateEnd, queueDateStart, queueFilter, queueSearch]);
  const queuePageCount = Math.max(1, Math.ceil(filteredJobs.length / QUEUE_PAGE_SIZE));
  const activeQueuePage = Math.min(Math.max(queuePage, 1), queuePageCount);
  const pagedFilteredJobs = useMemo(
    () => filteredJobs.slice(
      (activeQueuePage - 1) * QUEUE_PAGE_SIZE,
      activeQueuePage * QUEUE_PAGE_SIZE,
    ),
    [activeQueuePage, filteredJobs]
  );
  const filteredJobIds = useMemo(
    () => filteredJobs.filter((job) => job.id).map((job) => String(job.id)),
    [filteredJobs]
  );
  const allFilteredJobsSelected = filteredJobIds.length > 0
    && filteredJobIds.every((id) => selectedJobIds.includes(id));
  const failedJobIds = useMemo(
    () => filteredJobs
      .filter((job) => job.status === "failed" && job.id)
      .map((job) => String(job.id)),
    [filteredJobs]
  );
  const completedJobIds = useMemo(
    () => filteredJobs
      .filter((job) => job.status === "completed" && job.id)
      .map((job) => String(job.id)),
    [filteredJobs]
  );
  const cancelledJobIds = useMemo(
    () => filteredJobs
      .filter((job) => job.status === "cancelled" && job.id)
      .map((job) => String(job.id)),
    [filteredJobs]
  );
  const allFailedJobsSelected = failedJobIds.length > 0
    && failedJobIds.every((id) => selectedJobIds.includes(id));
  const allCompletedJobsSelected = completedJobIds.length > 0
    && completedJobIds.every((id) => selectedJobIds.includes(id));
  const allCancelledJobsSelected = cancelledJobIds.length > 0
    && cancelledJobIds.every((id) => selectedJobIds.includes(id));
  const visibleDeletableJobIds = useMemo(
    () => pagedFilteredJobs
      .filter((job) => job.id)
      .map((job) => String(job.id)),
    [pagedFilteredJobs]
  );
  const allVisibleDeletableJobsSelected = visibleDeletableJobIds.length > 0
    && visibleDeletableJobIds.every((id) => selectedJobIds.includes(id));
  const selectedActiveJobCount = useMemo(
    () => selectedJobIds.filter((id) => jobs.some(
      (job) => String(job?.id || "") === id && isActiveJobStatus(job.status)
    )).length,
    [jobs, selectedJobIds]
  );
  const onlineServices = services.filter((service) => service.status === "online").length;
  const gateway = services.find((service) => service.id === "gateway");
  const gatewayPort = (() => {
    try { return new URL(gateway?.localUrl || "http://127.0.0.1:8210").port || "80"; }
    catch { return "8210"; }
  })();
  const pageTitle = NAV_ITEMS.find((item) => item.id === activeView)?.label || "Tổng quan";
  const sourceLabel = "Dola Gateway · Seedance 2.5";

  useEffect(() => {
    setQueuePage((current) => Math.min(Math.max(current, 1), queuePageCount));
  }, [queuePageCount]);

  useEffect(() => {
    setQueuePage(1);
    setSelectedJobIds([]);
  }, [queueDateEnd, queueDateStart, queueFilter, queueOwnerFilter, queueSearch]);

  const getMaiVideoLoginUrl = useCallback(() => {
    if (typeof window === "undefined") return "https://maivideo.top/?auth=login";
    const current = new URL(window.location.href);
    const hostname = current.hostname.toLowerCase();
    const isSharedHost = hostname === "seedance.maivideo.top"
      || hostname === "maivideo.top"
      || hostname.endsWith(".maivideo.top");
    const returnUrl = isSharedHost ? current.toString() : "https://seedance.maivideo.top/";
    const loginUrl = new URL("https://maivideo.top/");
    loginUrl.searchParams.set("auth", "login");
    loginUrl.searchParams.set("redirect", returnUrl);
    return loginUrl.toString();
  }, []);

  const loadMaiVideoSession = useCallback(async () => {
    if (typeof window !== "undefined" && isLocalStudioHostname(window.location.hostname)) {
      setLocalMode(true);
      setMaivideoSession({ loading: false, authenticated: true, user: LOCAL_STUDIO_USER, error: "" });
      return;
    }
    const requestId = ++maivideoSessionRequestIdRef.current;
    setMaivideoSession((current) => ({ ...current, loading: true, error: "" }));
    try {
      const headers = {};
      const token = readMaiVideoAuthToken();
      const sessionId = readMaiVideoSessionId();
      if (token) headers["X-MaiVideo-Auth-Token"] = token;
      if (sessionId) headers["X-MaiVideo-Session-ID"] = sessionId;
      const response = await fetch("/api/maivideo/session", { cache: "no-store", headers });
      const payload = await response.json();
      if (!response.ok && response.status !== 401) {
        const sessionError = new Error(payload.error || "Không kiểm tra được phiên MaiVideo");
        sessionError.status = response.status;
        throw sessionError;
      }
      setMaivideoSession((current) => {
        if (requestId !== maivideoSessionRequestIdRef.current) return current;
        return {
          loading: false,
          authenticated: Boolean(payload.authenticated && payload.user),
          user: payload.user || null,
          error: payload.error || ""
        };
      });
    } catch (sessionError) {
      setMaivideoSession((current) => {
        if (requestId !== maivideoSessionRequestIdRef.current) return current;
        const status = Number(sessionError?.status || 0);
        const transient = !status || status >= 500;
        return {
          loading: false,
          // A health check failure must not turn a valid account into a
          // logout. Only an explicit 401 response is allowed to clear it.
          authenticated: transient ? current.authenticated : false,
          user: transient ? current.user : null,
          error: sessionError?.message || "Không kiểm tra được phiên MaiVideo"
        };
      });
    }
  }, []);

  const loadServices = useCallback(async () => {
    setServiceLoading(true);
    try {
      const response = await fetch("/api/services", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.services)) {
        throw new Error(payload.error || "Không đọc được trạng thái dịch vụ");
      }
      setServices(payload.services);
    } catch {
      setServices((current) => current.map((service) => ({
        ...service,
        status: service.status === "unknown" ? "offline" : service.status
      })));
    } finally {
      setServiceLoading(false);
    }
  }, []);

  const accountHeaders = useCallback(() => {
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    const key = accountAdminKey.trim();
    if (key) headers["X-Gateway-Admin-Key"] = key;
    return headers;
  }, [accountAdminKey]);

  const accountRequest = useCallback(async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      cache: "no-store",
      headers: { ...accountHeaders(), ...(options.headers || {}) }
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { error: raw.slice(0, 300) };
    }
    if (!response.ok) {
      throw new Error(payload.error || payload.detail || "Gateway từ chối thao tác tài khoản");
    }
    return payload;
  }, [accountHeaders]);

  const loadProxies = useCallback(async () => {
    setProxyLoading(true);
    try {
      const payload = await accountRequest("/api/proxies");
      const items = Array.isArray(payload.proxies) ? payload.proxies : [];
      setProxies(items);
      setProxySummary(payload.summary || {});
      setProxySelectedIds((current) => current.filter((id) => items.some((item) => item.id === id)));
      return items;
    } catch (loadError) {
      setAccountError(loadError?.message || "Không đọc được danh sách proxy từ Gateway.");
      return [];
    } finally {
      setProxyLoading(false);
    }
  }, [accountRequest]);

  async function submitBulkProxies(event) {
    event?.preventDefault?.();
    setAccountNotice("");
    setAccountError("");
    if (!bulkProxies.proxies.length) {
      setAccountError("Hãy nhập ít nhất một dòng proxy hợp lệ.");
      return;
    }
    if (bulkProxies.proxies.length > 1000) {
      setAccountError("Mỗi lần tối đa 1000 proxy.");
      return;
    }
    setProxySubmitting(true);
    try {
      const payload = await accountRequest("/api/proxies/bulk", {
        method: "POST",
        body: JSON.stringify({
          text: proxyText,
          protocol: proxyProtocol,
          mode: proxyMode,
          name_prefix: proxyNamePrefix
        })
      });
      const summary = payload.summary || {};
      setAccountNotice("Đã thêm " + Number(summary.created || 0) + " proxy, cập nhật " + Number(summary.updated || 0) + " proxy." + (summary.errors ? " Có " + summary.errors + " dòng lỗi." : ""));
      setProxyText("");
      await loadProxies();
    } catch (submitError) {
      setAccountError(submitError?.message || "Không thể nhập proxy hàng loạt.");
    } finally {
      setProxySubmitting(false);
    }
  }

  async function submitProxyfb(event) {
    event?.preventDefault?.();
    setAccountNotice("");
    setAccountError("");
    if (!String(proxyfbApiKey || "").trim()) {
      setAccountError("Hãy nhập ProxyFB API key.");
      return;
    }
    setProxyfbSubmitting(true);
    try {
      const payload = await accountRequest("/api/proxies/proxyfb", {
        method: "POST",
        body: JSON.stringify({
          name: proxyfbName,
          api_key: proxyfbApiKey,
          location_id: proxyfbLocationId,
          force_change: true
        })
      });
      const proxy = payload.proxy || {};
      setAccountNotice("Đã " + (payload.action === "updated" ? "cập nhật" : "thêm") + " ProxyFB " + (proxy.name || proxyfbName) + " (" + (proxy.host || "endpoint mới") + ":" + (proxy.port || "—") + ").");
      setProxyfbApiKey("");
      await Promise.all([loadProxies(), loadAccounts()]);
    } catch (submitError) {
      setAccountError(submitError?.message || "Không thể thêm ProxyFB API key.");
    } finally {
      setProxyfbSubmitting(false);
    }
  }

  async function submitProxyfbBulk(event) {
    event?.preventDefault?.();
    setAccountNotice("");
    setAccountError("");
    if (!proxyfbBulkKeys.length) {
      setAccountError("Hãy nhập ít nhất một ProxyFB API key.");
      return;
    }
    if (proxyfbBulkKeys.length > 50) {
      setAccountError("Mỗi lần tối đa 50 ProxyFB API key.");
      return;
    }
    setProxyfbBulkSubmitting(true);
    try {
      const payload = await accountRequest("/api/proxies/proxyfb/bulk", {
        method: "POST",
        body: JSON.stringify({
          text: proxyfbBulkText,
          location_id: proxyfbLocationId,
          name_prefix: proxyfbName
        })
      });
      const summary = payload.summary || {};
      setAccountNotice("Đã thêm " + Number(summary.created || 0) + ", cập nhật " + Number(summary.updated || 0) + " ProxyFB." + (summary.errors ? " Có " + summary.errors + " key lỗi." : ""));
      setProxyfbBulkText("");
      await Promise.all([loadProxies(), loadAccounts()]);
    } catch (submitError) {
      setAccountError(submitError?.message || "Không thể nhập ProxyFB hàng loạt.");
    } finally {
      setProxyfbBulkSubmitting(false);
    }
  }

  async function rotateProxyfb(proxy) {
    if (!proxy?.id) return;
    setProxyfbRotatingId(proxy.id);
    setAccountNotice("Đang đổi IP; kiểm tra qua proxyfb.com/check.php từ 60s, rồi poll mỗi 10s đến tối đa 120s...");
    setAccountError("");
    try {
      const payload = await accountRequest("/api/proxies/" + encodeURIComponent(proxy.id) + "/rotate", { method: "POST" });
      const item = payload.proxy || {};
      setAccountNotice("Đã yêu cầu ProxyFB đổi IP cho " + (item.name || proxy.name) + ". Hãy đóng và mở lại profile đang gán proxy này để nhận endpoint mới.");
      await Promise.all([loadProxies(), loadAccounts()]);
    } catch (rotateError) {
      setAccountError(rotateError?.message || "Không thể đổi IP ProxyFB.");
    } finally {
      setProxyfbRotatingId("");
    }
  }

  async function rotateSelectedProxyfb(all = false) {
    const targetIds = all
      ? proxies.filter((proxy) => proxy.enabled && proxy.source === "proxyfb").map((proxy) => proxy.id)
      : proxySelectedIds.filter((id) => proxies.some((proxy) => proxy.id === id && proxy.source === "proxyfb"));
    if (!targetIds.length) {
      setAccountError(all ? "Chưa có ProxyFB đang bật để đổi IP." : "Hãy chọn ít nhất một ProxyFB để đổi IP.");
      return;
    }
    const targetLabel = all ? "toàn bộ " + targetIds.length + " ProxyFB đang bật" : targetIds.length + " ProxyFB đã chọn";
    if (!window.confirm("Đổi IP cho " + targetLabel + "? Profile Chromium đang mở vẫn giữ IP hiện tại đến khi đóng và mở lại.")) return;
    setProxyfbBulkRotating(true);
    setAccountNotice("Đang đổi IP hàng loạt; mỗi proxy sẽ kiểm tra từ 60s, rồi poll mỗi 10s đến tối đa 120s qua proxyfb.com/check.php...");
    setAccountError("");
    try {
      const payload = await accountRequest("/api/proxies/bulk-rotate", {
        method: "POST",
        body: JSON.stringify(all ? { all: true } : { ids: targetIds })
      });
      const summary = payload.summary || {};
      const failed = Array.isArray(payload.failed) ? payload.failed : [];
      const skipped = Array.isArray(payload.skipped) ? payload.skipped : [];
      setAccountNotice(
        "Đổi IP hàng loạt: " + Number(summary.rotated || 0) + " thành công, "
        + Number(summary.failed || failed.length || 0) + " lỗi, "
        + Number(summary.skipped || skipped.length || 0) + " bỏ qua."
      );
      const details = failed.concat(skipped).slice(0, 3).map((item) => (item.name || item.proxy_id) + ": " + (item.error || "không xác định"));
      if (details.length) setAccountError("Chi tiết: " + details.join("; "));
      await Promise.all([loadProxies(), loadAccounts()]);
    } catch (rotateError) {
      setAccountError(rotateError?.message || "Không thể đổi IP ProxyFB hàng loạt.");
    } finally {
      setProxyfbBulkRotating(false);
    }
  }

  async function testSelectedProxies(all = false) {
    const ids = all ? [] : proxySelectedIds;
    if (!all && !ids.length) {
      setAccountError("Hãy chọn proxy để kiểm tra.");
      return;
    }
    setProxyTesting(true);
    setAccountError("");
    setAccountNotice(all ? "Đang kiểm tra toàn bộ proxy..." : "Đang kiểm tra " + ids.length + " proxy...");
    try {
      const payload = await accountRequest("/api/proxies/bulk-test", {
        method: "POST",
        body: JSON.stringify(all ? { all: true } : { ids })
      });
      const summary = payload.summary || {};
      setAccountNotice("Đã kiểm tra " + Number(summary.total || 0) + " proxy: " + Number(summary.healthy || 0) + " hoạt động, " + Number(summary.failed || 0) + " lỗi.");
      await loadProxies();
    } catch (testError) {
      setAccountError(testError?.message || "Không thể kiểm tra proxy.");
    } finally {
      setProxyTesting(false);
    }
  }

  async function testSelectedProxiesForOne(proxyId) {
    setProxyTesting(true);
    setAccountError("");
    try {
      const payload = await accountRequest("/api/proxies/" + encodeURIComponent(proxyId) + "/test", { method: "POST" });
      const result = Array.isArray(payload.results) ? payload.results[0] : null;
      setAccountNotice(result?.ok ? "Proxy đã phản hồi thành công." : "Proxy kiểm tra lỗi: " + (result?.message || "không xác định"));
      await loadProxies();
    } catch (testError) {
      setAccountError(testError?.message || "Không thể kiểm tra proxy.");
    } finally {
      setProxyTesting(false);
    }
  }

  async function deleteSelectedProxies() {
    if (!proxySelectedIds.length) {
      setAccountError("Hãy chọn proxy để xóa.");
      return;
    }
    if (!window.confirm("Xóa " + proxySelectedIds.length + " proxy đã chọn? Các profile đang dùng sẽ quay về proxy mặc định.")) return;
    setProxyDeleting(true);
    try {
      const payload = await accountRequest("/api/proxies/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids: proxySelectedIds })
      });
      setAccountNotice("Đã xóa " + Number(payload.deleted || 0) + " proxy.");
      setProxySelectedIds([]);
      await Promise.all([loadProxies(), loadAccounts()]);
    } catch (deleteError) {
      setAccountError(deleteError?.message || "Không thể xóa proxy.");
    } finally {
      setProxyDeleting(false);
    }
  }

  async function deleteOneProxy(proxyId, proxyName) {
    if (!window.confirm("Xóa proxy " + proxyName + "? Profile đang gán sẽ quay về proxy mặc định.")) return;
    setProxyDeleting(true);
    try {
      await accountRequest("/api/proxies/" + encodeURIComponent(proxyId), { method: "DELETE" });
      setAccountNotice("Đã xóa proxy " + proxyName + ".");
      await Promise.all([loadProxies(), loadAccounts()]);
    } catch (deleteError) {
      setAccountError(deleteError?.message || "Không thể xóa proxy.");
    } finally {
      setProxyDeleting(false);
    }
  }

  async function assignProxyToAccounts(names, proxyId) {
    const selectedNames = Array.from(new Set((names || []).filter(Boolean)));
    if (!selectedNames.length) {
      setAccountError("Hãy chọn profile để gán proxy.");
      return;
    }
    setProxyAssigning(true);
    try {
      const payload = await accountRequest("/api/accounts/bulk-proxy", {
        method: "POST",
        body: JSON.stringify({ names: selectedNames, proxy_id: proxyId || null })
      });
      setAccountNotice("Đã gán proxy cho " + Number(payload.updated || 0) + "/" + selectedNames.length + " profile." + (payload.failed ? " Có " + payload.failed + " profile lỗi." : ""));
      await loadAccounts();
    } catch (assignError) {
      setAccountError(assignError?.message || "Không thể gán proxy cho profile.");
    } finally {
      setProxyAssigning(false);
    }
  }

  async function distributeProxiesEvenly() {
    const targetNames = selectedAccountNames.length
      ? Array.from(new Set(selectedAccountNames.filter(Boolean)))
      : accounts.map((account) => account.name).filter(Boolean);
    const selectedProxyItems = proxySelectedIds.length
      ? proxySelectedIds
        .map((id) => proxies.find((proxy) => proxy.id === id))
        .filter((proxy) => proxy?.enabled)
      : [];
    const fallbackProxyItems = proxies.filter((proxy) => proxy.enabled && proxy.source === "proxyfb").length
      ? proxies.filter((proxy) => proxy.enabled && proxy.source === "proxyfb")
      : proxies.filter((proxy) => proxy.enabled);
    const targetProxies = proxySelectedIds.length ? selectedProxyItems : fallbackProxyItems;
    if (!targetNames.length) {
      setAccountError("Chưa có profile để chia proxy.");
      return;
    }
    if (!targetProxies.length) {
      setAccountError("Chưa có proxy đang bật để chia cho profile.");
      return;
    }
    setProxyDistributing(true);
    setAccountNotice("");
    setAccountError("");
    try {
      const payload = await accountRequest("/api/accounts/distribute-proxy", {
        method: "POST",
        body: JSON.stringify({
          names: targetNames,
          proxy_ids: targetProxies.map((proxy) => proxy.id),
        }),
      });
      const distribution = Array.isArray(payload.distribution) ? payload.distribution.filter((item) => Number(item.count || 0) > 0) : [];
      const detail = distribution.map((item) => (item.proxy_name || item.proxy_id) + ": " + Number(item.count || 0)).join(", ");
      setAccountNotice("Đã gán vòng tròn " + Number(payload.proxies || targetProxies.length) + " proxy cho " + Number(payload.updated || targetNames.length) + " profile theo đúng thứ tự. Profile đang mở cần đóng/mở lại để nhận proxy mới." + (detail ? " Phân bổ: " + detail + "." : ""));
      await Promise.all([loadAccounts(), loadProxies()]);
    } catch (distributionError) {
      setAccountError(distributionError?.message || "Không thể chia đều proxy cho profile.");
    } finally {
      setProxyDistributing(false);
    }
  }

  function startProxyRename(proxy) {
    setProxyRenameId(proxy.id);
    setProxyRenameValue(proxy.name || "");
    setAccountNotice("");
    setAccountError("");
  }

  function cancelProxyRename() {
    if (proxyRenameSubmitting) return;
    setProxyRenameId("");
    setProxyRenameValue("");
  }

  async function renameProxy(proxy) {
    const name = proxyRenameValue.trim();
    if (!name) {
      setAccountError("Tên profile proxy không được để trống.");
      return;
    }
    if (name.length > 80) {
      setAccountError("Tên profile proxy tối đa 80 ký tự.");
      return;
    }
    setProxyRenameSubmitting(true);
    setAccountNotice("");
    setAccountError("");
    try {
      const payload = await accountRequest("/api/proxies/" + encodeURIComponent(proxy.id) + "/name", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      const savedName = payload.proxy?.name || name;
      setProxyRenameId("");
      setProxyRenameValue("");
      setAccountNotice("Đã đổi tên proxy thành “" + savedName + "”.");
      await Promise.all([loadProxies(), loadAccounts()]);
    } catch (renameError) {
      setAccountError(renameError?.message || "Không thể đổi tên proxy.");
    } finally {
      setProxyRenameSubmitting(false);
    }
  }

  async function setAccountProxy(name, proxyId) {
    setProxyAssigning(true);
    try {
      await accountRequest("/api/accounts/" + encodeURIComponent(name), {
        method: "PATCH",
        body: JSON.stringify({ proxy_id: proxyId || "" })
      });
      setAccountNotice("Đã cập nhật proxy cho " + (accounts.find((item) => item.name === name)?.email || name) + ". Proxy sẽ áp dụng ở lần mở profile/render tiếp theo.");
      await loadAccounts();
    } catch (proxyError) {
      setAccountError(proxyError?.message || "Không thể cập nhật proxy cho profile.");
    } finally {
      setProxyAssigning(false);
    }
  }

  const mediaHeaders = useCallback((includeJson = false) => {
    const headers = { Accept: "application/json" };
    if (includeJson) headers["Content-Type"] = "application/json";
    const token = readMaiVideoAuthToken();
    const sessionId = readMaiVideoSessionId();
    if (token) headers["X-MaiVideo-Auth-Token"] = token;
    if (sessionId) headers["X-MaiVideo-Session-ID"] = sessionId;
    return headers;
  }, []);

  const rememberUploadedMediaNames = useCallback((items, files) => {
    const next = { ...mediaOriginalNamesRef.current };
    Array.from(items || []).forEach((item, index) => {
      const name = String(files?.[index]?.name || "").trim();
      if (!name) return;
      mediaItemKeys(item).forEach((key) => {
        next[key] = name;
      });
    });
    mediaOriginalNamesRef.current = next;
    setMediaOriginalNames(next);
    try {
      window.sessionStorage.setItem(MEDIA_ORIGINAL_NAMES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Session storage is only a convenience; the API's file_name remains
      // the fallback when the browser blocks storage.
    }
  }, []);

  const loadMediaImages = useCallback(async ({ throwOnError = false, applyPendingReferences = true } = {}) => {
    setMediaLoading(true);
    setMediaError("");
    try {
      const response = await fetch("/api/batches/references", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(LOCAL_MEDIA_LIST_TIMEOUT_MS)
      });
      const raw = await response.text();
      let payload = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { error: raw.slice(0, 300) };
      }
      if (!response.ok) throw new Error(payload.error || payload.detail || "Không đọc được thư viện ảnh local");
      const items = (Array.isArray(payload.items) ? payload.items : []).map((item) => {
        const title = getMediaItemTitle(item);
        const normalizedItem = title ? { ...item, title } : item;
        const rememberedName = mediaItemKeys(item)
          .map((key) => String(mediaOriginalNamesRef.current?.[key] || "").trim())
          .find(Boolean);
        return rememberedName ? { ...normalizedItem, originalFileName: rememberedName } : normalizedItem;
      });
      const pendingReferences = applyPendingReferences ? pendingReferenceSelectionRef.current : [];
      const matchedReferences = pendingReferences.map((reference) => ({
        reference,
        item: items.find((candidate) => mediaItemMatchesReference(candidate, reference))
      }));
      const matchedIds = matchedReferences.map(({ item }) => getMediaItemId(item)).filter(Boolean);
      if (applyPendingReferences && pendingReferences.length) pendingReferenceSelectionRef.current = [];
      setMediaImages(items);
      setSelectedMediaIds((current) => {
        const availableIds = new Set(items.map(getMediaItemId));
        const keptIds = current.filter((id) => availableIds.has(id));
        return matchedIds.length
          ? Array.from(new Set([...keptIds, ...matchedIds])).slice(0, maxReferenceImages)
          : keptIds;
      });
      setMediaBulkSelectedIds((current) => current.filter((id) => items.some((item) => getMediaItemId(item) === id)));
      if (matchedIds.length) {
        const unmatchedReferences = matchedReferences.filter(({ item }) => !item);
        setInheritedReferenceUrls(unmatchedReferences.map(({ reference }) => reference.url));
        setInheritedReferenceNames(unmatchedReferences.map(({ reference }) => reference.name));
        setReferenceOrder(matchedReferences.map(({ reference, item }) => (
          item ? "media:" + getMediaItemId(item) : "inherited:" + toAbsoluteUrl(reference.url)
        )));
        setMediaNotice("Đã tự động chọn " + matchedIds.length + " ảnh chì đã tạo để dùng lại.");
      }
      return items;
    } catch (loadError) {
      setMediaError(isTimeoutError(loadError)
        ? "Đọc thư viện ảnh local quá lâu (đã chờ 30 giây). Hãy thử tải lại."
        : loadError?.message || "Không đọc được thư viện ảnh local.");
      if (throwOnError) throw loadError;
      return [];
    } finally {
      setMediaLoading(false);
    }
  }, []);

  const uploadMediaFiles = useCallback(async (incomingFiles) => {
    const files = Array.from(incomingFiles || []).filter(Boolean);
    const imageFiles = files.filter(isImageReferenceFile);
    if (!imageFiles.length) {
      setMediaError("Hãy kéo thả hoặc dán một file ảnh (PNG, JPG, WEBP...).");
      return;
    }
    if (imageFiles.length > 30) {
      setMediaError("Mỗi lần chỉ có thể thêm tối đa 30 ảnh tham chiếu.");
      return;
    }

    setMediaUploading(true);
    setMediaError("");
    setMediaNotice("");
    try {
      const formData = new FormData();
      imageFiles.forEach((file) => formData.append("files", file, file.name || "reference-image.png"));
      const response = await fetch("/api/batches/references", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json" },
        body: formData,
        signal: AbortSignal.timeout(MEDIA_UPLOAD_TIMEOUT_MS)
      });
      const raw = await response.text();
      let payload = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { error: raw.slice(0, 300) };
      }
      if (!response.ok) throw new Error(payload.error || payload.detail || "Không thể lưu ảnh vào máy");

      const uploadedItems = Array.isArray(payload.items)
        ? payload.items
        : payload.item
          ? [payload.item]
          : [];
      rememberUploadedMediaNames(uploadedItems, imageFiles);
      const uploadedIds = uploadedItems.map(getMediaItemId).filter(Boolean);
      const refreshedItems = await loadMediaImages();
      const availableIds = new Set(refreshedItems.map(getMediaItemId));
      const selectableIds = uploadedIds.filter((id) => availableIds.has(id));
      setSelectedMediaIds((current) => Array.from(new Set([...current, ...selectableIds])).slice(0, 30));
      const uploadedCount = Number(payload.uploaded_count || uploadedItems.length || imageFiles.length);
      setMediaNotice(
        "Đã lưu " + uploadedCount + " ảnh trên máy và chọn làm ảnh tham chiếu." +
        (selectableIds.length < uploadedIds.length ? " Một số ảnh chưa hiện trong phiên hiện tại." : "")
      );
    } catch (uploadError) {
      setMediaError(isTimeoutError(uploadError)
        ? "Lưu ảnh local quá lâu (đã chờ 120 giây). Hãy thử ảnh nhỏ hơn hoặc upload ít ảnh hơn mỗi lần."
        : uploadError?.message || "Không thể lưu ảnh vào máy.");
    } finally {
      setMediaUploading(false);
    }
  }, [loadMediaImages, rememberUploadedMediaNames]);

  async function resolveLocalReferenceManifest(manifest, actionLabel) {
    const references = Array.isArray(manifest) ? manifest : [];
    if (!references.length) return { urls: [], names: [] };

    const localItems = await loadMediaImages({ throwOnError: true, applyPendingReferences: false });
    const resolved = references.map((reference) => {
      const item = localItems.find((candidate) => mediaItemMatchesReference(candidate, reference));
      const url = item ? toAbsoluteUrl(getMediaItemReferenceUrl(item)) : "";
      return { reference, item, url };
    });
    const missing = resolved.filter(({ item, url }) => !item || !isLocalBatchReferenceUrl(url));
    if (missing.length) {
      const names = missing
        .map(({ reference }, index) => reference.name || referenceFilenameFromUrl(reference.url, index))
        .filter(Boolean);
      throw new Error(
        actionLabel + " không thể tiếp tục vì thiếu bản ảnh local cho " + missing.length + " ảnh"
        + (names.length ? " (" + names.join(", ") + ")" : "")
        + ". Hãy upload các ảnh này vào thư viện local rồi thử lại."
      );
    }
    return {
      urls: resolved.map(({ url }) => url),
      names: resolved.map(({ item, reference }) => getMediaItemName(item, mediaOriginalNames) || reference.name)
    };
  }

  function handleMediaFileInput(event) {
    uploadMediaFiles(event.target.files);
    event.target.value = "";
  }

  function handleMediaDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setMediaDragActive(false);
    uploadMediaFiles(getDroppedImageFiles(event.dataTransfer));
  }

  function handleMediaPaste(event) {
    const files = getClipboardImageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    uploadMediaFiles(files);
  }

  useEffect(() => {
    if (activeView !== "batch") return undefined;
    const handlePaste = (event) => {
      const files = getClipboardImageFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      uploadMediaFiles(files);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activeView, uploadMediaFiles]);

  useEffect(() => {
    if (!mediaPanelOpen) return undefined;
    const previousActiveElement = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => mediaModalCloseRef.current?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setMediaPanelOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElement instanceof HTMLElement) previousActiveElement.focus();
    };
  }, [mediaPanelOpen]);

  useEffect(() => {
    if (!mediaPanelOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mediaPanelOpen]);

  useEffect(() => {
    const syncViewFromUrl = () => setActiveView(viewFromPathname(window.location.pathname));
    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    return () => window.removeEventListener("popstate", syncViewFromUrl);
  }, []);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const [accountsPayload, jobsPayload] = await Promise.all([
        accountRequest("/api/accounts"),
        accountRequest("/api/accounts/jobs")
      ]);
      const nextAccounts = Array.isArray(accountsPayload.accounts) ? accountsPayload.accounts : [];
      const nextJobs = jobsPayload.jobs && typeof jobsPayload.jobs === "object" ? jobsPayload.jobs : {};
      // A newer successful verification supersedes a historical login failure.
      for (const account of nextAccounts) {
        const job = nextJobs[account.name];
        if (job?.status === "failed" && account.login_ok === 1
          && Number(account.login_checked_at) > Number(job.finished_at || 0)) {
          delete nextJobs[account.name];
        }
      }
      const nextOpenProfiles = jobsPayload.open_profiles && typeof jobsPayload.open_profiles === "object" ? jobsPayload.open_profiles : {};
      setAccounts(nextAccounts);
      setAccountJobs(nextJobs);
      setOpenProfiles(nextOpenProfiles);
      setSelectedAccountNames((current) => current.filter((name) => {
        const exists = nextAccounts.some((account) => account.name === name);
        const jobStatus = nextJobs[name]?.status;
        return exists && jobStatus !== "queued" && jobStatus !== "running";
      }));
      setAccountError("");
    } catch (loadError) {
      setAccountError(loadError?.message || "Không đọc được danh sách tài khoản từ Gateway.");
    } finally {
      setAccountsLoading(false);
    }
  }, [accountRequest]);

  const hasProfileSync = Object.values(accountJobs).some((job) => (
    job?.kind === "profile-sync" && (job.status === "queued" || job.status === "running")
  ));
  const hasAccountLoginJob = Object.values(accountJobs).some((job) => (
    job?.kind !== "profile-sync" && (job?.status === "queued" || job?.status === "running")
  ));

  useEffect(() => {
    proxyAutoRecheckRef.current.ids = proxies
      .filter((proxy) => proxy.enabled && proxy.status === "error")
      .map((proxy) => proxy.id);
    proxyAutoRecheckRef.current.busy = proxyTesting || proxyDeleting || proxyDistributing || proxyAssigning
      || proxySubmitting || proxyRenameSubmitting || proxyfbSubmitting || proxyfbBulkSubmitting
      || proxyfbRotatingId || proxyfbBulkRotating;
  }, [proxies, proxyTesting, proxyDeleting, proxyDistributing, proxyAssigning, proxySubmitting,
    proxyRenameSubmitting, proxyfbSubmitting, proxyfbBulkSubmitting, proxyfbRotatingId, proxyfbBulkRotating]);

  useEffect(() => {
    if (activeView !== "accounts" && activeView !== "proxies") return undefined;
    loadAccounts();
    loadProxies();
    const refreshTimer = window.setInterval(loadAccounts, hasProfileSync || hasAccountLoginJob ? 2000 : 8000);
    const proxyRefreshTimer = window.setInterval(loadProxies, 15000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(proxyRefreshTimer);
    };
  }, [activeView, hasAccountLoginJob, hasProfileSync, loadAccounts, loadProxies]);

  useEffect(() => {
    if (activeView !== "proxies") return undefined;
    const clockTimer = window.setInterval(() => setProxyClock(Date.now()), 1000);
    return () => window.clearInterval(clockTimer);
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "proxies") return undefined;
    const proxyAutoRecheckTimer = window.setInterval(async () => {
      const state = proxyAutoRecheckRef.current;
      if (state.inFlight || state.busy || !state.ids.length) return;

      state.inFlight = true;
      setProxyTesting(true);
      try {
        const proxyIds = [...state.ids];
        for (let offset = 0; offset < proxyIds.length; offset += PROXY_AUTO_RECHECK_BATCH_SIZE) {
          await accountRequest("/api/proxies/bulk-test", {
            method: "POST",
            body: JSON.stringify({ ids: proxyIds.slice(offset, offset + PROXY_AUTO_RECHECK_BATCH_SIZE) })
          });
        }
        await loadProxies();
      } catch {
        // Background checks should not replace notices from the user's actions.
      } finally {
        state.inFlight = false;
        setProxyTesting(false);
      }
    }, 120000);
    return () => window.clearInterval(proxyAutoRecheckTimer);
  }, [activeView, accountRequest, loadProxies]);

  useEffect(() => {
    if (!mediaPanelOpen) return undefined;
    loadMediaImages();
    return undefined;
  }, [mediaPanelOpen, loadMediaImages]);

  useEffect(() => {
    loadServices();
    // Gateway may be starting at the same time as Next.js. A 30-second
    // interval left the stale "Gateway chưa kết nối" banner visible long
    // after port 8200 had recovered; retry more quickly and refresh when the
    // operator returns to this tab.
    const refreshTimer = window.setInterval(loadServices, 5000);
    const refreshOnFocus = () => loadServices();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadServices]);

  useEffect(() => {
    if (isLocalStudioHostname(window.location.hostname)) {
      setLocalMode(true);
      setMaivideoSession({ loading: false, authenticated: true, user: LOCAL_STUDIO_USER, error: "" });
      return undefined;
    }
    setLocalMode(false);
    loadMaiVideoSession();
    const refreshTimer = window.setInterval(loadMaiVideoSession, 30000);
    return () => window.clearInterval(refreshTimer);
  }, [loadMaiVideoSession]);

  useEffect(() => {
    if (maivideoSession.loading) return;
    if (!maivideoSession.authenticated || !maivideoUserId && !maivideoUserEmail) {
      setJobs([]);
      setBatches([]);
      setQueueSyncError("");
      setHydratedIdentity("");
      setHydrated(false);
      setQueueScope("user");
      setQueueOwners([]);
      setQueueCurrentOwnerId("");
      setQueueLoadedOwnerSelection("");
      queueIdentityRef.current = "";
      return;
    }
    // Session checks run every 30 seconds. Re-reading the admin's local
    // cache here would overwrite a live all-users queue with personal jobs.
    if (queueIdentityRef.current === currentJobsStorageKey
      && hydratedIdentity === currentJobsStorageKey) return;
    if (queueIdentityRef.current !== currentJobsStorageKey) {
      setQueueOwnerFilter(currentUserIsAdmin ? readQueueOwnerFilter(currentJobsStorageKey) : "me");
      setQueueOwners([]);
      setQueueCurrentOwnerId("");
      setQueueLoadedOwnerSelection("");
    }
    queueIdentityRef.current = currentJobsStorageKey;
    setQueueSyncError("");
    setJobs(readStoredJobs({ id: maivideoUserId, email: maivideoUserEmail }));
    setBatches(readStoredBatches());
    setHydratedIdentity(currentJobsStorageKey);
    setHydrated(true);
  }, [
    currentJobsStorageKey,
    currentUserIsAdmin,
    hydratedIdentity,
    maivideoSession.authenticated,
    maivideoSession.loading,
    maivideoUserEmail,
    maivideoUserId
  ]);

  useEffect(() => {
    if (!hydrated || hydratedIdentity !== currentJobsStorageKey || !currentUserIsAdmin) return;
    try {
      window.sessionStorage.setItem(currentJobsStorageKey + ":queue-owner", queueOwnerFilter);
    } catch {
      // Session storage is optional; the active filter remains in React state.
    }
  }, [currentJobsStorageKey, currentUserIsAdmin, hydrated, hydratedIdentity, queueOwnerFilter]);

  useEffect(() => {
    try {
      setAccountAdminKey(window.sessionStorage.getItem("dola-gateway-admin-key") || "");
    } catch {
      setAccountAdminKey("");
    }
  }, []);

  useEffect(() => {
    if (!hydrated || hydratedIdentity !== currentJobsStorageKey) return;
    try {
      const isAdminQueue = queueScope === "admin" || currentUserIsAdmin;
      if (isAdminQueue && queueOwnerFilter !== "me") return;
      window.localStorage.setItem(currentJobsStorageKey, serializeJobsForStorage(visibleJobs));
    } catch {
      // This is only a convenience cache; quota/storage errors must never
      // crash the dashboard because the Gateway remains the source of truth.
      try {
        const fallback = visibleJobs.slice(0, 20).map((job) => projectJobForStorage(job, false));
        window.localStorage.setItem(currentJobsStorageKey, JSON.stringify(fallback));
      } catch {
        // Keep the live queue in memory when browser storage is full/disabled.
      }
    }
  }, [visibleJobs, hydrated, hydratedIdentity, currentJobsStorageKey, currentUserIsAdmin, queueOwnerFilter, queueScope]);

  useEffect(() => {
    if (!hydrated || hydratedIdentity !== currentJobsStorageKey) return undefined;
    let cancelled = false;
    let syncInFlight = false;
    const syncGatewayJobs = async () => {
      if (cancelled || syncInFlight) return;
      syncInFlight = true;
      try {
        const headers = { Accept: "application/json" };
        if (accountAdminKey.trim()) headers["X-Gateway-Admin-Key"] = accountAdminKey.trim();
        const fetchPage = async (offset) => {
          const query = new URLSearchParams({
            limit: String(QUEUE_FETCH_PAGE_SIZE),
            offset: String(offset),
            owner: queueOwnerFilter,
          });
          const response = await fetch(
            "/api/tasks?" + query.toString(),
            {
              cache: "no-store",
              headers,
              signal: AbortSignal.timeout(QUEUE_SYNC_TIMEOUT_MS)
            }
          );
          let payload = null;
          try {
            payload = await response.json();
          } catch {
            // Preserve the HTTP status below when an upstream returns a
            // non-JSON error page.
          }
          return {
            response,
            payload,
            contentType: response.headers.get("content-type") || "không rõ"
          };
        };
        const firstPage = await fetchPage(0);
        if (!firstPage.response.ok) {
          const detail = String(firstPage.payload?.error || "").trim();
          const reason = detail || `HTTP ${firstPage.response.status}`;
          if (!cancelled) setQueueSyncError(`Không đồng bộ được hàng đợi mới (${reason}); đang hiển thị dữ liệu đã lưu trên thiết bị.`);
          return;
        }
        if (cancelled) return;
        const allowLegacyUserTasks = !currentUserIsAdmin && queueOwnerFilter === "me";
        const firstJobs = queueRowsFromPayload(firstPage.payload, allowLegacyUserTasks);
        if (!firstJobs) {
          const keys = firstPage.payload && typeof firstPage.payload === "object"
            ? Object.keys(firstPage.payload).slice(0, 8).join(", ")
            : typeof firstPage.payload;
          setQueueSyncError(
            `Gateway/API trả payload hàng đợi sai định dạng (HTTP ${firstPage.response.status}, `
            + `Content-Type ${firstPage.contentType}, trường: ${keys || "rỗng"}); `
            + "danh sách đang hiển thị có thể đã cũ."
          );
          return;
        }
        const legacyUserScope = allowLegacyUserTasks && Array.isArray(firstPage.payload?.tasks);
        const firstScope = firstPage.payload?.scope
          || firstPage.payload?.queueScope
          || (legacyUserScope ? "user" : "");
        const firstOwnerSelection = firstPage.payload?.ownerSelection
          || firstPage.payload?.owner_selection
          || (legacyUserScope ? "me" : "");
        if ((currentUserIsAdmin && firstScope !== "admin")
          || firstOwnerSelection !== queueOwnerFilter) {
          setQueueSyncError("Gateway trả về phạm vi user khác bộ lọc đã chọn; hãy thử đồng bộ lại.");
          return;
        }
        const allJobs = [...firstJobs];
        const firstOffset = Number(firstPage.payload.offset);
        let nextOffset = (Number.isFinite(firstOffset) ? Math.max(0, firstOffset) : 0) + allJobs.length;
        const totalValue = Number(firstPage.payload.total);
        let total = Number.isFinite(totalValue) && totalValue >= 0
          ? totalValue
          : allJobs.length;
        // Owner summaries are computed from the full Gateway table. Some older
        // queue responses may report only the first 100 rows as `total`; use
        // the selected owner's aggregate as a lower bound so pagination keeps
        // fetching instead of treating that page as the complete history.
        const ownerSummaries = Array.isArray(firstPage.payload.owners)
          ? firstPage.payload.owners
          : [];
        const ownerIdForCount = queueOwnerFilter === "me"
          ? String(firstPage.payload.currentOwnerId || "").toLowerCase()
          : queueOwnerFilter === "all"
            ? ""
            : queueOwnerFilter.toLowerCase();
        const ownerAggregateCount = queueOwnerFilter === "all"
          ? ownerSummaries.reduce((sum, owner) => sum + (Number(owner?.count) || 0), 0)
          : Number(ownerSummaries.find((owner) => String(owner?.ownerId || owner?.owner_id || "").toLowerCase() === ownerIdForCount)?.count) || 0;
        total = Math.max(total, ownerAggregateCount);
        let hasMore = Boolean(firstPage.payload.hasMore ?? firstPage.payload.has_more)
          || allJobs.length < total;
        while (!cancelled && hasMore && allJobs.length < total) {
          const page = await fetchPage(nextOffset);
          const pageJobs = queueRowsFromPayload(page.payload, allowLegacyUserTasks);
          if (!page.response.ok || !pageJobs) {
            setQueueSyncError("Không tải đủ các trang hàng đợi mới; danh sách đang hiển thị có thể đã cũ.");
            return;
          }
          const pageLegacyUserScope = allowLegacyUserTasks && Array.isArray(page.payload?.tasks);
          const pageScope = page.payload?.scope
            || page.payload?.queueScope
            || (pageLegacyUserScope ? "user" : "");
          const pageOwnerSelection = page.payload?.ownerSelection
            || page.payload?.owner_selection
            || (pageLegacyUserScope ? "me" : "");
          if (pageScope !== firstScope || pageOwnerSelection !== queueOwnerFilter) {
            setQueueSyncError("Các trang hàng đợi không cùng phạm vi user; hãy thử đồng bộ lại.");
            return;
          }
          if (!pageJobs.length) {
            setQueueSyncError("Hàng đợi trả về thiếu dữ liệu phân trang; danh sách đang hiển thị có thể đã cũ.");
            return;
          }
          allJobs.push(...pageJobs);
          const pageOffset = Number(page.payload.offset);
          nextOffset = (Number.isFinite(pageOffset) ? Math.max(0, pageOffset) : nextOffset) + pageJobs.length;
          const pageTotal = Number(page.payload.total);
          if (Number.isFinite(pageTotal) && pageTotal > total) total = pageTotal;
          hasMore = Boolean(page.payload.hasMore ?? page.payload.has_more)
            || allJobs.length < total;
        }
        if (cancelled) return;
        if (hasMore || allJobs.length < total) {
          setQueueSyncError("Chưa tải hết hàng đợi mới; danh sách đang hiển thị có thể đã cũ.");
          return;
        }
        const scope = firstScope === "admin" ? "admin" : "user";
        setQueueScope(scope);
        if (scope === "admin") {
          const ownerId = String(firstPage.payload.currentOwnerId || "");
          setQueueCurrentOwnerId(ownerId);
          if (Array.isArray(firstPage.payload.owners)) setQueueOwners(firstPage.payload.owners);
        } else {
          setQueueCurrentOwnerId("");
          setQueueOwners([]);
        }
        setJobs((current) => mergeGatewayJobs(current, allJobs, { replaceGateway: true }));
        setQueueLoadedOwnerSelection(queueOwnerFilter);
        setQueueSyncError("");
      } catch (error) {
        // The existing per-job polling still reports known jobs if the shared
        // queue endpoint is temporarily unavailable.
        const reason = error?.name === "TimeoutError"
          ? `quá thời hạn ${QUEUE_SYNC_TIMEOUT_MS / 1000} giây`
          : "lỗi kết nối tới API hàng đợi";
        if (!cancelled) setQueueSyncError(`Không đồng bộ được hàng đợi mới (${reason}); đang hiển thị dữ liệu đã lưu trên thiết bị.`);
      } finally {
        syncInFlight = false;
      }
    };

    const refreshWhenForeground = () => {
      if (document.visibilityState === "visible") void syncGatewayJobs();
    };

    syncGatewayJobs();
    // The compact per-task status poll below already refreshes active jobs
    // every 5 seconds. A full queue sync can span several 200-row pages and
    // includes historical prompts, so keep that heavier reconciliation at a
    // lower cadence to avoid repeatedly serializing queue history. Active task
    // state is already polled separately every five seconds.
    const refreshTimer = window.setInterval(syncGatewayJobs, 60000);
    window.addEventListener("focus", refreshWhenForeground);
    window.addEventListener("pageshow", refreshWhenForeground);
    window.addEventListener("online", refreshWhenForeground);
    document.addEventListener("visibilitychange", refreshWhenForeground);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshWhenForeground);
      window.removeEventListener("pageshow", refreshWhenForeground);
      window.removeEventListener("online", refreshWhenForeground);
      document.removeEventListener("visibilitychange", refreshWhenForeground);
    };
  }, [accountAdminKey, currentJobsStorageKey, currentUserIsAdmin, hydrated, hydratedIdentity, queueOwnerFilter]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem("dola-studio-batches", JSON.stringify(batches.slice(0, 20)));
    } catch {
      try {
        window.localStorage.setItem("dola-studio-batches", JSON.stringify(batches.slice(0, 5)));
      } catch {
        // Batch history is cached for convenience and can be reloaded later.
      }
    }
  }, [batches, hydrated]);

  useEffect(() => {
    const available = new Set(visibleJobs.map((job) => String(job.id || "")));
    setSelectedJobIds((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
  }, [visibleJobs]);

  useEffect(() => {
    if (!hydrated || hydratedIdentity !== currentJobsStorageKey) return undefined;
    let cancelled = false;
    const poll = async () => {
      // Read the latest list from the ref so the interval stays stable when a
      // status update arrives. Recreating this effect for every `jobs` render
      // can otherwise leave multiple polling loops behind in open tabs.
      const activeJobs = jobsRef.current.filter(
        (job) => job.id && !job.id.startsWith("local_failed_") && isActiveJobStatus(job.status)
      );
      if (!activeJobs.length) return;
      let updates = [];
      try {
        const response = await fetch("/api/jobs/status", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(accountAdminKey.trim() ? { "X-Gateway-Admin-Key": accountAdminKey.trim() } : {})
          },
          body: JSON.stringify({ ids: activeJobs.map((job) => job.id) }),
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
          const payload = await response.json();
          const byId = new Map((Array.isArray(payload.tasks) ? payload.tasks : []).map((item) => [String(item.id), item]));
          updates = activeJobs.map((job) => {
            const payloadJob = byId.get(String(job.id));
            if (!payloadJob) return null;
            return {
              id: job.id,
              status: payloadJob.status || job.status,
              model: payloadJob.model || job.model,
              duration: Number(payloadJob.duration || job.duration || duration),
              account: payloadJob.account || job.account || null,
              videoUrl: payloadJob.video_url || payloadJob.videoUrl || job.videoUrl || null,
              error: payloadJob.error || null,
              failureCode: payloadJob.failure_code || payloadJob.failureCode || job.failureCode || null,
              videoMetadata: payloadJob.video_metadata || payloadJob.videoMetadata || job.videoMetadata || null,
              timings: payloadJob.timings || job.timings || null
            };
          });
        }
      } catch {
        // The shared queue poll below remains the fallback when the compact
        // status endpoint is temporarily unavailable.
      }
      if (cancelled) return;
      const updateMap = new Map(updates.filter(Boolean).map((update) => [update.id, update]));
      if (!updateMap.size) return;
      setJobs((current) => {
        let changed = false;
        const next = current.map((job) => {
          const update = updateMap.get(job.id);
          if (!update) return job;
          const hasChanges = Object.entries(update).some(([key, value]) => job[key] !== value);
          if (!hasChanges) return job;
          changed = true;
          return { ...job, ...update };
        });
        return changed ? next : current;
      });
    };

    const timer = window.setInterval(poll, 5000);
    poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountAdminKey, currentJobsStorageKey, duration, hydrated, hydratedIdentity]);

  useEffect(() => {
    if (!hydrated || hydratedIdentity !== currentJobsStorageKey
      || queueLoadedOwnerSelection !== queueOwnerFilter) return undefined;
    const now = Date.now();
    for (const [id, checkedAt] of metadataChecksRef.current) {
      if (now - checkedAt > 60 * 60 * 1000) metadataChecksRef.current.delete(id);
    }
    const jobsNeedingMetadata = pagedFilteredJobs.filter(
      (job) => job.id && !job.id.startsWith("local_failed_")
        && job.status === "completed"
        && typeof job.videoMetadata?.watermark_free !== "boolean"
        && now - (metadataChecksRef.current.get(String(job.id)) || 0) >= 5 * 60 * 1000
    ).slice(0, QUEUE_PAGE_SIZE);
    if (!jobsNeedingMetadata.length) return undefined;

    let cancelled = false;
    const requestedAt = Date.now();
    jobsNeedingMetadata.forEach((job) => metadataChecksRef.current.set(String(job.id), requestedAt));
    const loadMetadata = async () => {
      const chunks = [];
      for (let offset = 0; offset < jobsNeedingMetadata.length; offset += 100) {
        chunks.push(jobsNeedingMetadata.slice(offset, offset + 100));
      }
      const results = await Promise.all(chunks.map(async (chunk) => {
        try {
          const response = await fetch("/api/jobs/status", {
            method: "POST",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              ...(accountAdminKey.trim() ? { "X-Gateway-Admin-Key": accountAdminKey.trim() } : {})
            },
            body: JSON.stringify({ ids: chunk.map((job) => job.id) }),
            signal: AbortSignal.timeout(20000)
          });
          if (!response.ok) return [];
          const payload = await response.json();
          const jobsById = new Map((Array.isArray(payload.tasks) ? payload.tasks : [])
            .map((job) => [String(job.id || ""), job]));
          return chunk.flatMap((job) => {
            const latest = jobsById.get(String(job.id));
            const videoMetadata = latest?.video_metadata || latest?.videoMetadata || null;
            if (!videoMetadata || typeof videoMetadata.watermark_free !== "boolean") return [];
            return [{
              id: job.id,
              videoMetadata,
              videoUrl: latest.video_url || latest.videoUrl || job.videoUrl || null
            }];
          });
        } catch {
          return [];
        }
      }));
      if (cancelled) return;
      const updates = results.flat();
      if (cancelled) return;
      const updateMap = new Map(updates.filter(Boolean).map((update) => [update.id, update]));
      if (!updateMap.size) return;
      setJobs((current) => current.map((job) => {
        const update = updateMap.get(job.id);
        return update ? { ...job, ...update } : job;
      }));
    };
    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [accountAdminKey, currentJobsStorageKey, hydrated, hydratedIdentity, pagedFilteredJobs, queueLoadedOwnerSelection, queueOwnerFilter]);

  function selectView(view) {
    const nextView = NAV_ITEMS.some((item) => item.id === view) ? view : "overview";
    setActiveView(nextView);
    setMobileNavOpen(false);
    setError("");
    if (nextView !== "queue") setJobInfo(null);
    if (nextView !== "accounts" && nextView !== "proxies") {
      setAccountNotice("");
      setAccountError("");
      setSelectedAccountNames([]);
    }
    if (typeof window !== "undefined") {
      const nextPath = pathForView(nextView) + (embedded ? window.location.search : "");
      if (window.location.pathname + window.location.search !== nextPath) {
        window.history.pushState({ view: nextView }, "", nextPath);
      }
    }
  }

  function saveAccountAdminKey() {
    try {
      if (accountAdminKey.trim()) window.sessionStorage.setItem("dola-gateway-admin-key", accountAdminKey.trim());
      else window.sessionStorage.removeItem("dola-gateway-admin-key");
    } catch {
      // Session storage can be disabled in private browser contexts.
    }
    setAccountNotice(accountAdminKey.trim() ? "Đã lưu admin key trong phiên trình duyệt." : "Đã xoá admin key khỏi phiên.");
    loadAccounts();
  }

  async function submitBulkAccounts(event) {
    event.preventDefault();
    setAccountNotice("");
    setAccountError("");
    if (bulkAccounts.errors.length) {
      setAccountError(bulkAccounts.errors.slice(0, 3).join(" · "));
      return;
    }
    if (!bulkAccounts.accounts.length) {
      setAccountError("Hãy nhập ít nhất một dòng tài khoản.");
      return;
    }
    if (bulkAccounts.accounts.length > 50) {
      setAccountError("Mỗi lần tối đa 50 tài khoản để Gateway không mở quá nhiều trình duyệt cùng lúc.");
      return;
    }
    setAccountSubmitting(true);
    try {
      const payload = await accountRequest("/api/accounts/bulk", {
        method: "POST",
        body: JSON.stringify({ accounts: bulkAccounts.accounts })
      });
      const summary = payload.summary || {};
      const results = Array.isArray(payload.results) ? payload.results : [];
      const accepted = Number(summary.accepted || 0);
      const savedOnly = results.filter((item) => item.status === "accepted" && item.mode === "credentials-only").length;
      const queued = Math.max(0, accepted - savedOnly);
      const accountNoticeParts = [];
      if (savedOnly) accountNoticeParts.push("Đã lưu credential cho " + savedOnly + " profile đang hoạt động.");
      if (queued) accountNoticeParts.push("Đã xếp đăng nhập " + queued + "/" + (summary.total || bulkAccounts.accounts.length) + " tài khoản; Gateway chỉ mở một Chromium mỗi lượt, cách nhau 60 giây.");
      if (!accountNoticeParts.length) accountNoticeParts.push("Không có tài khoản nào được tiếp nhận.");
      setAccountNotice(accountNoticeParts.join(" "));
      if (summary.failed) {
        const failedEmails = results.filter((item) => item.status === "failed").map((item) => item.email || item.name).filter(Boolean).slice(0, 4);
        setAccountError(summary.failed + " dòng bị từ chối" + (failedEmails.length ? ": " + failedEmails.join(", ") : "."));
      }
      setBulkAccountText("");
      await loadAccounts();
    } catch (bulkError) {
      setAccountError(bulkError?.message || "Không thể khởi tạo danh sách tài khoản.");
    } finally {
      setAccountSubmitting(false);
    }
  }

  async function createManualProfile(event) {
    event.preventDefault();
    setAccountNotice("");
    setAccountError("");
    setManualProfileSubmitting(true);
    try {
      const created = await accountRequest("/api/accounts/manual-profile", {
        method: "POST",
        body: JSON.stringify({ name: manualProfileName.trim() }),
      });
      const name = String(created.name || "").trim();
      if (!name) throw new Error("Gateway đã tạo profile nhưng không trả về tên profile.");
      setManualProfileName("");
      setAccountNotice("Đã tạo profile " + name + ". Đang mở Chromium để bạn đăng nhập thủ công...");
      await loadAccounts();
      await openAccountProfile(name);
    } catch (createError) {
      setAccountError(createError?.message || "Không thể tạo profile đăng nhập thủ công.");
    } finally {
      setManualProfileSubmitting(false);
    }
  }

  async function verifyAccount(name) {
    const account = accounts.find((item) => item.name === name);
    const label = account?.email || name;
    setAccountNotice("");
    setAccountError("");
    setAccountVerifyingName(name);
    setAccountNotice("Đang kiểm tra session của " + label + "...");
    try {
      const payload = await accountRequest("/api/accounts/" + encodeURIComponent(name) + "/verify", { method: "POST" });
      setAccountNotice(label + (payload.ok ? " đang hoạt động." : " đã hết phiên hoặc chưa đăng nhập."));
      await loadAccounts();
    } catch (verifyError) {
      setAccountError(verifyError?.message || "Không thể kiểm tra session.");
    } finally {
      setAccountVerifyingName("");
      window.setTimeout(() => {
        document.querySelector(".account-banner")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    }
  }

  async function reloginAccountWithGmail(name) {
    const account = accounts.find((item) => item.name === name);
    const label = account?.email || name;
    const riskControlled = account?.cooldown_reason === "risk_control";
    if (!account || (account.login_ok === 1 && !riskControlled)) {
      setAccountError("Tài khoản đang hoạt động hoặc không còn trong danh sách.");
      return;
    }
    if (!window.confirm(
      "Đăng nhập lại Dola cho " + label + " bằng Gmail đang có trong đúng profile Chromium? "
      + "Gateway sẽ truy cập dola.com, mở đăng nhập Google và giữ nguyên profile hiện tại."
    )) return;

    setAccountSessionReloginName(name);
    setAccountNotice("Đang xếp đăng nhập lại Gmail trong profile của " + label + "...");
    setAccountError("");
    try {
      await accountRequest(
        "/api/accounts/" + encodeURIComponent(name) + "/relogin-session",
        { method: "POST" }
      );
      setAccountNotice(
        "Đã xếp đăng nhập lại " + label + ". Gateway sẽ mở đúng profile, truy cập dola.com, "
        + "chọn tài khoản Google đang đăng nhập và chỉ bật điều phối sau khi session Dola hợp lệ."
      );
      await loadAccounts();
    } catch (reloginError) {
      setAccountError(reloginError?.message || "Không thể xếp đăng nhập lại bằng Gmail trong profile.");
    } finally {
      setAccountSessionReloginName("");
      window.setTimeout(() => {
        document.querySelector(".account-banner")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    }
  }

  async function openAccountProfile(name) {
    const account = accounts.find((item) => item.name === name);
    const label = account?.email || name;
    setAccountNotice("");
    setAccountError("");
    setAccountProfileActionName(name);
    setAccountNotice("Đang mở profile Chromium của " + label + "...");
    try {
      const payload = await accountRequest("/api/accounts/" + encodeURIComponent(name) + "/open-profile", { method: "POST" });
      const proxyLabel = payload.proxy_name
        ? " Proxy: " + payload.proxy_name + " (" + (payload.proxy_status || "unknown") + ")."
        : " Profile đang dùng proxy mặc định.";
      const dolaLabel = payload.dola_navigation_ok === false
        ? " Dola chưa tải được qua proxy này (" + (payload.dola_navigation_error || "timeout") + "), nhưng profile vẫn giữ mở để bạn thử Google hoặc mở lại Dola thủ công."
        : " Dola đã được mở.";
      setAccountNotice(
        (payload.already_open ? "Profile Chromium của " : "Đã mở profile Chromium của ")
        + label
        + "." + proxyLabel + dolaLabel
        + " Kiểm tra rồi đóng cửa sổ hoặc bấm “Đóng profile” khi xong; Gateway sẽ tự xác minh lại session sau đó."
        + (payload.extension_loaded ? " Extension Dola đã được nạp." : "")
      );
      await loadAccounts();
    } catch (openError) {
      setAccountError(openError?.message || "Không thể mở profile Chromium.");
    } finally {
      setAccountProfileActionName("");
    }
  }

  async function pauseProfileSync(name, kind = "sync") {
    setAccountProfileActionName(name);
    setAccountError("");
    try {
      await accountRequest("/api/accounts/" + encodeURIComponent(name) + "/pause-" + kind, { method: "POST" });
      setAccountNotice(kind === "login" ? "Đã tạm dừng đăng nhập. Bạn có thể đăng nhập lại khi sẵn sàng." : "Đã tạm dừng đồng bộ session. Bấm Kiểm tra để xác minh lại khi sẵn sàng.");
      await loadAccounts();
    } catch (error) {
      setAccountError(error?.message || "Không thể tạm dừng tác vụ.");
    } finally {
      setAccountProfileActionName("");
    }
  }

  async function closeAccountProfile(name) {
    const account = accounts.find((item) => item.name === name);
    const label = account?.email || name;
    setAccountNotice("");
    setAccountError("");
    setAccountProfileActionName(name);
    setAccountNotice("Đang đóng profile Chromium của " + label + "...");
    try {
      const payload = await accountRequest("/api/accounts/" + encodeURIComponent(name) + "/open-profile", { method: "DELETE" });
      const loginLabel = payload.login_ok === true
        ? " Gateway đã xác nhận session; profile có thể nhận render."
        : payload.login_ok === false
          ? " Gateway chưa xác nhận session Dola; hãy hoàn tất đăng nhập rồi mở lại profile để thử."
          : " Gateway đang xác minh session ở chế độ nền; profile chỉ nhận render sau khi xác minh thành công.";
      setAccountNotice("Đã đóng profile Chromium của " + label + "." + loginLabel);
      await loadAccounts();
    } catch (closeError) {
      setAccountError(closeError?.message || "Không thể đóng profile Chromium.");
    } finally {
      setAccountProfileActionName("");
    }
  }

  function accountAutomaticPauseReason(account) {
    if (!account) return "";
    if (account.cooling) {
      return account.cooldown_reason === "provider_busy"
        ? "Dola đang quá tải"
        : "Dola risk-control";
    }
    if (account.rate_limited) return "Dola rate-limit";
    const limit = Number(account.limit || 10);
    if (Number(account.used_today || 0) >= limit) return "đã hết lượt nội bộ hôm nay";
    if (account.login_ok === false || account.login_ok === 0 || account.login_ok === "0") {
      return "session Dola hết hạn";
    }
    return "";
  }

  function accountCannotBeManuallyEnabled(account) {
    // Risk-control and rate-limit can be cleared only through the existing
    // explicit confirmation flow. A cached credit balance is informational.
    return Boolean(accountAutomaticPauseReason(account))
      && !account?.cooling
      && !account?.rate_limited;
  }

  function accountEffectivelyScheduled(account) {
    return Boolean(account?.scheduling) && !accountAutomaticPauseReason(account);
  }

  async function setAccountScheduling(name, scheduling) {
    const account = accounts.find((item) => item.name === name);
    const temporaryBlock = Boolean(account?.cooling || account?.rate_limited);
    if (scheduling && accountCannotBeManuallyEnabled(account)) {
      setAccountError(
        "Chưa thể bật điều phối cho " + (account?.email || name) + ": "
        + accountAutomaticPauseReason(account) + ". Hệ thống sẽ tự khôi phục khi trạng thái được gỡ."
      );
      return;
    }
    if (scheduling && temporaryBlock) {
      const label = account?.email || name;
      const reason = account?.cooling
        ? (account.cooldown_reason === "provider_busy" ? "Dola quá tải" : "risk-control")
        : "rate-limit";
      if (!window.confirm(
        "Bật lại điều phối cho " + label + " và xoá trạng thái " + reason + "? "
        + "Chỉ xác nhận nếu bạn vừa tự kiểm tra và tạo video thành công bằng profile này."
      )) return;
    }
    try {
      await accountRequest("/api/accounts/" + encodeURIComponent(name), {
        method: "PATCH",
        body: JSON.stringify({ scheduling })
      });
      await loadAccounts();
    } catch (scheduleError) {
      setAccountError(scheduleError?.message || "Không thể cập nhật điều phối tài khoản.");
    }
  }

  async function updateSelectedAccountScheduling(scheduling) {
    const selectedAccounts = accounts.filter((account) => selectedAccountNames.includes(account.name));
    const eligibleAccounts = selectedAccounts.filter((account) => {
      const status = accountJobs[account.name]?.status;
      return status !== "queued" && status !== "running"
        && !account.busy && !openProfiles[account.name];
    });
    if (!eligibleAccounts.length) {
      setAccountError("Hãy chọn ít nhất một tài khoản không đang đăng nhập/render và không mở profile.");
      return;
    }
    const accountsToUpdate = eligibleAccounts.filter((account) => {
      const effectivelyScheduled = accountEffectivelyScheduled(account);
      // Turning scheduling off is an explicit preference change even when a
      // temporary provider block already renders the switch as off. Enabling
      // compares against effective state so it can clear a confirmed block.
      return scheduling
        ? !effectivelyScheduled && !accountCannotBeManuallyEnabled(account)
        : Boolean(account.scheduling);
    });
    if (!accountsToUpdate.length) {
      setAccountError("");
      const blockedCount = scheduling
        ? eligibleAccounts.filter(accountCannotBeManuallyEnabled).length
        : 0;
      setAccountNotice(blockedCount
        ? "Chưa bật " + blockedCount + " profile vì "
          + "credit, lượt nội bộ hoặc session đang bị chặn; hệ thống giữ nguyên trạng thái và sẽ tự kiểm tra lại khi phù hợp."
        : "Các tài khoản đủ điều kiện đã " + (scheduling ? "bật" : "tắt") + " điều phối.");
      return;
    }
    const names = accountsToUpdate.map((account) => account.name);
    const preview = accountsToUpdate.slice(0, 5).map((account) => account.email || account.name).join(", ") + (names.length > 5 ? "…" : "");
    const action = scheduling ? "Bật" : "Tắt";
    const blockedCount = scheduling
      ? accountsToUpdate.filter((account) => account.cooling || account.rate_limited).length
      : 0;
    const manualOverrideNote = blockedCount
      ? " " + blockedCount + " profile đang rate-limit/risk-control sẽ được gỡ trạng thái; chỉ tiếp tục nếu đã tự tạo video thành công trên các profile đó."
      : "";
    if (!window.confirm(action + " điều phối cho " + names.length + " tài khoản (" + preview + ")?" + manualOverrideNote)) return;

    setAccountsBulkScheduling(true);
    setAccountNotice("");
    setAccountError("");
    try {
      const results = await Promise.allSettled(names.map((name) => accountRequest("/api/accounts/" + encodeURIComponent(name), {
        method: "PATCH",
        body: JSON.stringify({ scheduling })
      })));
      const failedAccounts = results
        .map((result, index) => result.status === "rejected" ? accountsToUpdate[index] : null)
        .filter(Boolean);
      const updatedCount = names.length - failedAccounts.length;
      const skippedCount = selectedAccounts.length - accountsToUpdate.length;
      const automaticBlockCount = scheduling
        ? eligibleAccounts.filter(accountCannotBeManuallyEnabled).length
        : 0;
      setAccountNotice("Đã " + (scheduling ? "bật" : "tắt") + " điều phối cho " + updatedCount + "/" + names.length + " tài khoản." + (skippedCount ? " Bỏ qua " + skippedCount + " tài khoản đang bận, mở profile, bị giới hạn hoặc đã ở trạng thái này." : "") + (automaticBlockCount ? " " + automaticBlockCount + " profile vẫn tạm dừng do credit/lượt nội bộ/session; trạng thái chặn không bị ghi đè." : ""));
      if (failedAccounts.length) {
        const failedLabels = failedAccounts.map((account) => account.email || account.name).slice(0, 5);
        setAccountError(failedAccounts.length + " tài khoản không thể cập nhật" + (failedLabels.length ? ": " + failedLabels.join(", ") : "."));
      }
      await loadAccounts();
    } catch (bulkScheduleError) {
      setAccountError(bulkScheduleError?.message || "Không thể cập nhật điều phối các tài khoản đã chọn.");
    } finally {
      setAccountsBulkScheduling(false);
    }
  }

  async function enableSelectedAccountScheduling() {
    await updateSelectedAccountScheduling(true);
  }

  async function disableSelectedAccountScheduling() {
    await updateSelectedAccountScheduling(false);
  }

  async function deleteAccount(name, label = name) {
    if (!window.confirm("Xoá tài khoản " + label + " khỏi Gateway? Session trình duyệt của tài khoản này sẽ bị xoá.")) return;
    try {
      await accountRequest("/api/accounts/" + encodeURIComponent(name), { method: "DELETE" });
      setAccountNotice("Đã xoá tài khoản " + label + ".");
      setSelectedAccountNames((current) => current.filter((selectedName) => selectedName !== name));
      await loadAccounts();
    } catch (deleteError) {
      setAccountError(deleteError?.message || "Không thể xoá tài khoản.");
    }
  }

  function toggleAccountSelection(name, checked) {
    setSelectedAccountNames((current) => {
      if (checked) return current.includes(name) ? current : [...current, name];
      return current.filter((selectedName) => selectedName !== name);
    });
  }

  function toggleAllAccountSelection(names, checked) {
    const visibleNames = new Set(names);
    setSelectedAccountNames((current) => {
      const hiddenSelection = current.filter((name) => !visibleNames.has(name));
      return checked ? Array.from(new Set([...hiddenSelection, ...names])) : hiddenSelection;
    });
  }

  function selectUnauthenticatedAccounts() {
    const names = reloginEligibleAccounts.map((account) => account.name);
    if (!names.length) {
      setAccountError("Không có tài khoản chưa đăng nhập nào có thể thao tác.");
      return;
    }
    const savedCount = reloginEligibleAccounts.filter((account) => account.credentials_saved).length;
    setSelectedAccountNames(names);
    setAccountError("");
    setAccountNotice(
      "Đã chọn " + names.length + " tài khoản chưa đăng nhập. Bấm “Đăng nhập lại đã chọn” để dùng "
      + (savedCount
        ? "thông tin đăng nhập đã lưu" + (savedCount < names.length ? " hoặc session Gmail của profile cũ" : "")
        : "session Gmail của profile cũ")
      + "."
    );
  }

  function selectRiskControlAccounts() {
    const names = riskControlEligibleAccounts.map((account) => account.name);
    if (!names.length) {
      setAccountError("Không có profile nào đang Tạm nghỉ risk-control và có thể Login Dola.");
      return;
    }
    setSelectedAccountNames(names);
    setAccountError("");
    setAccountNotice(
      "Đã chọn " + names.length + " profile Tạm nghỉ risk-control. "
      + "Bấm “Login Dola” để truy cập dola.com bằng Gmail trong đúng profile."
    );
  }

  async function startBulkRelogin() {
    if (!selectedReloginAccounts.length) {
      setAccountError("Hãy chọn ít nhất một tài khoản chưa đăng nhập để đăng nhập lại.");
      return;
    }
    const preview = selectedReloginAccounts
      .slice(0, 5)
      .map((account) => account.email || account.name)
      .join(", ") + (selectedReloginAccounts.length > 5 ? "…" : "");
    const savedCredentialsCount = selectedReloginAccounts.filter((account) => account.credentials_saved).length;
    const reloginSource = savedCredentialsCount === selectedReloginAccounts.length
      ? "thông tin đăng nhập đã lưu"
      : savedCredentialsCount
        ? "thông tin đăng nhập đã lưu cho một số profile và session Gmail cho profile còn lại"
        : "session Gmail đang có trong profile";
    if (!window.confirm(
      "Đăng nhập lại " + selectedReloginAccounts.length + " tài khoản (" + preview + ") bằng "
      + reloginSource + "? Gateway sẽ mở từng profile theo thứ tự."
    )) return;

    setAccountSubmitting(true);
    setAccountNotice("Đang xếp đăng nhập lại " + selectedReloginAccounts.length + " tài khoản...");
    setAccountError("");
    try {
      const payload = await accountRequest("/api/accounts/bulk-relogin", {
        method: "POST",
        body: JSON.stringify({ names: selectedReloginAccounts.map((account) => account.name) })
      });
      const summary = payload.summary || {};
      const failedNames = (payload.results || [])
        .filter((item) => item.status === "failed" && item.name)
        .map((item) => item.name);
      const savedAccepted = (payload.results || []).filter((item) => item.status === "accepted" && item.mode === "saved-credentials").length;
      const sessionAccepted = (payload.results || []).filter((item) => item.status === "accepted" && item.mode === "saved-session").length;
      setSelectedAccountNames(failedNames);
      setAccountNotice(
        "Đã xếp đăng nhập lại " + (summary.accepted || 0) + "/" + (summary.total || selectedReloginAccounts.length)
        + " tài khoản. "
        + (savedAccepted ? "Dùng thông tin đăng nhập đã lưu cho " + savedAccepted + " profile. " : "")
        + (sessionAccepted ? "Profile còn lại dùng session Gmail hiện có. " : "")
        + "Gateway chỉ mở một Chromium mỗi lượt."
      );
      if (summary.failed) {
        const failedLabels = (payload.results || [])
          .filter((item) => item.status === "failed")
          .map((item) => item.email || item.name)
          .filter(Boolean)
          .slice(0, 5);
        setAccountError(summary.failed + " tài khoản chưa được xếp" + (failedLabels.length ? ": " + failedLabels.join(", ") : "."));
      }
      await loadAccounts();
    } catch (bulkReloginError) {
      setAccountError(bulkReloginError?.message || "Không thể xếp đăng nhập lại hàng loạt.");
    } finally {
      setAccountSubmitting(false);
    }
  }

  async function startBulkSessionRelogin() {
    if (!selectedSessionReloginAccounts.length) {
      setAccountError("Hãy chọn ít nhất một profile hết phiên hoặc Tạm nghỉ risk-control để Login Dola.");
      return;
    }
    const preview = selectedSessionReloginAccounts
      .slice(0, 5)
      .map((account) => account.email || account.name)
      .join(", ") + (selectedSessionReloginAccounts.length > 5 ? "…" : "");
    if (!window.confirm(
      "Đăng nhập lại " + selectedSessionReloginAccounts.length + " profile (" + preview + ") "
      + "bằng Gmail đang có trong từng profile? Gateway sẽ mở từng profile, truy cập dola.com "
      + "và không thay profile hay credential đã lưu."
    )) return;

    setAccountsBulkSessionRelogin(true);
    setAccountNotice("Đang xếp login Gmail trong " + selectedSessionReloginAccounts.length + " profile...");
    setAccountError("");
    try {
      const payload = await accountRequest("/api/accounts/bulk-relogin", {
        method: "POST",
        body: JSON.stringify({
          names: selectedSessionReloginAccounts.map((account) => account.name),
          mode: "gmail-session"
        })
      });
      const summary = payload.summary || {};
      const results = Array.isArray(payload.results) ? payload.results : [];
      const failedNames = results
        .filter((item) => item.status === "failed" && item.name)
        .map((item) => item.name);
      setSelectedAccountNames(failedNames);
      setAccountNotice(
        "Đã xếp login Gmail " + (summary.accepted || 0) + "/" + (summary.total || selectedSessionReloginAccounts.length)
        + " profile. Gateway sẽ lần lượt truy cập dola.com trong đúng profile và chờ session Dola hợp lệ."
      );
      if (summary.failed) {
        const failedLabels = results
          .filter((item) => item.status === "failed")
          .map((item) => item.email || item.name)
          .filter(Boolean)
          .slice(0, 5);
        setAccountError(summary.failed + " tài khoản chưa được xếp" + (failedLabels.length ? ": " + failedLabels.join(", ") : "."));
      }
      await loadAccounts();
    } catch (bulkSessionReloginError) {
      setAccountError(bulkSessionReloginError?.message || "Không thể xếp login Gmail hàng loạt.");
    } finally {
      setAccountsBulkSessionRelogin(false);
    }
  }

  async function deleteSelectedAccounts() {
    const deletableNames = new Set(accounts.filter((account) => {
      const status = accountJobs[account.name]?.status;
      return status !== "queued" && status !== "running" && !openProfiles[account.name];
    }).map((account) => account.name));
    const selectedAccounts = accounts.filter((account) => selectedAccountNames.includes(account.name) && deletableNames.has(account.name));
    const names = selectedAccounts.map((account) => account.name);
    if (!names.length) {
      setAccountError("Hãy chọn ít nhất một tài khoản không đang đăng nhập hoặc render.");
      return;
    }
    const preview = selectedAccounts.slice(0, 5).map((account) => account.email || account.name).join(", ") + (names.length > 5 ? "…" : "");
    if (!window.confirm("Xoá " + names.length + " tài khoản đã chọn (" + preview + ")? Session trình duyệt sẽ bị xoá.")) return;

    setAccountsBulkDeleting(true);
    setAccountNotice("");
    setAccountError("");
    try {
      const payload = await accountRequest("/api/accounts/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ names })
      });
      const summary = payload.summary || {};
      setSelectedAccountNames([]);
      if (summary.deleted) {
        setAccountNotice("Đã xoá " + summary.deleted + "/" + (summary.requested || names.length) + " tài khoản.");
      } else {
        setAccountNotice("Không có tài khoản nào được xoá.");
      }
      if (summary.failed) {
        const failedAccounts = (payload.failed || []).map((item) => item.email || item.name).filter(Boolean).slice(0, 5);
        setAccountError(summary.failed + " tài khoản không thể xoá" + (failedAccounts.length ? ": " + failedAccounts.join(", ") : "."));
      }
      await loadAccounts();
    } catch (bulkDeleteError) {
      setAccountError(bulkDeleteError?.message || "Không thể xoá các tài khoản đã chọn.");
    } finally {
      setAccountsBulkDeleting(false);
    }
  }

  async function loginMaiVideo(event) {
    event.preventDefault();
    setMediaError("");
    setMediaNotice("");
    const isRegister = authMode === "register";
    if (!/^\S+@\S+\.\S+$/.test(mediaLoginEmail.trim()) || !mediaLoginPassword) {
      setMediaError("Hãy nhập email và mật khẩu MaiVideo.");
      return;
    }
    if (mediaLoginPassword.length < 8) {
      setMediaError("Mật khẩu cần ít nhất 8 ký tự.");
      return;
    }
    if (isRegister && mediaLoginPassword !== authPasswordConfirm) {
      setMediaError("Mật khẩu nhập lại chưa khớp.");
      return;
    }
    // Invalidate the video session poll before switching accounts. An older
    // response must not arrive after this login and overwrite the new user.
    maivideoSessionRequestIdRef.current += 1;
    setMediaLoginSubmitting(true);
    try {
      const response = await fetch(isRegister ? "/api/media/auth/register" : "/api/media/auth/login", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email: mediaLoginEmail.trim(),
          password: mediaLoginPassword,
          ...(isRegister
            ? { password_confirm: authPasswordConfirm }
            : { remember: authRemember })
        })
      });
      const raw = await response.text();
      let payload = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { error: raw.slice(0, 300) };
      }
      if (!response.ok) throw new Error(payload.error || payload.detail || "Đăng nhập MaiVideo thất bại");
      setMediaLoginPassword("");
      setAuthPasswordConfirm("");
      // Legacy MaiVideo tokens/session ids take precedence over the new
      // HttpOnly cookie in proxy headers. Clear them before checking the new
      // account so a second login cannot be mistaken for the old profile.
      clearMaiVideoClientStorage();
      if (payload.user) {
        setMaivideoSession({ loading: false, authenticated: true, user: payload.user, error: "" });
      }
      setMediaNotice((isRegister ? "Đã tạo tài khoản MaiVideo" : "Đã đăng nhập MaiVideo") + (payload.user?.email ? " bằng " + payload.user.email : "."));
      await loadMaiVideoSession();
      if (mediaPanelOpen) await loadMediaImages();
    } catch (loginError) {
      setMediaError(loginError?.message || "Đăng nhập MaiVideo thất bại.");
      // Restore the current cookie-backed session after a rejected switch.
      await loadMaiVideoSession();
    } finally {
      setMediaLoginSubmitting(false);
    }
  }

  async function logoutMaiVideo() {
    maivideoSessionRequestIdRef.current += 1;
    setMaivideoLogoutSubmitting(true);
    setMediaError("");
    setMediaNotice("");
    try {
      const response = await fetch("/api/maivideo/logout", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const raw = await response.text();
      let payload = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { error: raw.slice(0, 300) };
      }
      if (!response.ok) throw new Error(payload.error || "Đăng xuất MaiVideo không hoàn tất ở máy chủ");
    } catch (logoutError) {
      setMediaError(logoutError?.message || "Không thể đăng xuất MaiVideo ở máy chủ.");
    } finally {
      clearMaiVideoClientStorage();
      // Invalidate a poll that may have started while logout was in flight.
      maivideoSessionRequestIdRef.current += 1;
      setMaivideoSession({ loading: false, authenticated: false, user: null, error: "" });
      setMaivideoLogoutSubmitting(false);
    }
  }

  function toggleMediaImage(item) {
    const id = getMediaItemId(item);
    if (!id) return;
    if (selectedMediaIds.includes(id)) {
      setSelectedMediaIds((current) => current.filter((value) => value !== id));
      return;
    }
    if (combinedReferences.length >= maxReferenceImages) {
      setMediaError("Nguồn render hiện tại cho phép tối đa " + maxReferenceImages + " ảnh tham chiếu mỗi prompt.");
      return;
    }
    setSelectedMediaIds((current) => [...current, id]);
    setMediaError("");
  }

  function applySelectedMediaReferences() {
    if (!selectedMediaIds.length || mediaBulkDeleting) return;
    setMediaError("");
    setMediaNotice("Đã thêm " + selectedMediaIds.length + " ảnh làm ảnh tham chiếu cho prompt.");
    setMediaPanelOpen(false);
  }

  function removeSelectedMedia(id) {
    setSelectedMediaIds((current) => current.filter((value) => value !== id));
  }

  function reorderReferenceEntry(sourceKey, targetKey) {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    const keys = orderedReferenceEntries.map((entry) => entry.key);
    const sourceIndex = keys.indexOf(sourceKey);
    const targetIndex = keys.indexOf(targetKey);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = keys.slice();
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setReferenceOrder(next);
    setMediaNotice("Đã đổi thứ tự ảnh tham chiếu: " + (targetIndex + 1) + " ảnh được đặt trước.");
  }

  function handleReferenceDragStart(event, key) {
    if (!key || orderedReferenceEntries.length < 2) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/reference-key", key);
    event.dataTransfer.setData("text/plain", key);
    setReferenceDragKey(key);
    setReferenceDragOverKey(key);
  }

  function handleReferenceDragOver(event, key) {
    if (!referenceDragKey || referenceDragKey === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setReferenceDragOverKey(key);
  }

  function handleReferenceDrop(event, targetKey) {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData("text/reference-key")
      || event.dataTransfer.getData("text/plain")
      || referenceDragKey;
    reorderReferenceEntry(sourceKey, targetKey);
    setReferenceDragKey("");
    setReferenceDragOverKey("");
  }

  function handleReferenceDragEnd() {
    setReferenceDragKey("");
    setReferenceDragOverKey("");
  }

  function moveReferenceEntry(key, offset) {
    const keys = orderedReferenceEntries.map((entry) => entry.key);
    const currentIndex = keys.indexOf(key);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= keys.length) return;
    reorderReferenceEntry(key, keys[targetIndex]);
  }

  function removeReferenceEntry(entry) {
    if (entry?.kind === "inherited") {
      const inheritedIndex = inheritedReferenceUrls.findIndex((value) => toAbsoluteUrl(value) === entry.url);
      setInheritedReferenceUrls((current) => current.filter((value) => toAbsoluteUrl(value) !== entry.url));
      if (inheritedIndex >= 0) {
        setInheritedReferenceNames((current) => current.filter((_, index) => index !== inheritedIndex));
      }
      setMediaNotice("Đã bỏ ảnh tham chiếu #" + (orderedReferenceEntries.findIndex((item) => item.key === entry.key) + 1) + ".");
      return;
    }
    removeSelectedMedia(entry?.id);
  }

  function toggleMediaBulkSelection(id) {
    if (!id) return;
    setMediaBulkSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  }

  function toggleAllVisibleMedia() {
    if (!filteredMediaIds.length || mediaBulkDeleting) return;
    setMediaBulkSelectedIds((current) => {
      const currentIds = new Set(current);
      const shouldClear = filteredMediaIds.every((id) => currentIds.has(id));
      if (shouldClear) return current.filter((id) => !filteredMediaIds.includes(id));
      return Array.from(new Set([...current, ...filteredMediaIds]));
    });
  }

  async function deleteMediaImagesRequest(ids) {
    const response = await fetch("/api/batches/references", {
      method: "DELETE",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { error: raw.slice(0, 300) };
    }
    if (!response.ok) throw new Error(payload.error || payload.detail || "Không thể xoá ảnh local");
    return payload;
  }

  async function deleteMediaImageRequest(item) {
    const id = getMediaItemId(item);
    if (!id) throw new Error("Ảnh local không có mã hợp lệ");
    await deleteMediaImagesRequest([id]);
  }

  async function deleteMediaImage(item) {
    const label = getMediaItemName(item, mediaOriginalNames);
    if (!window.confirm("Xoá \"" + label + "\" khỏi thư viện ảnh trên máy?")) return;
    setMediaDeletingId(getMediaItemId(item));
    setMediaError("");
    try {
      await deleteMediaImageRequest(item);
      const id = getMediaItemId(item);
      setMediaImages((current) => current.filter((entry) => getMediaItemId(entry) !== id));
      setSelectedMediaIds((current) => current.filter((value) => value !== id));
      setMediaBulkSelectedIds((current) => current.filter((value) => value !== id));
      setMediaNotice("Đã xoá " + label + " khỏi thư viện ảnh trên máy.");
    } catch (deleteError) {
      setMediaError(deleteError?.message || "Không thể xoá ảnh local.");
    } finally {
      setMediaDeletingId("");
    }
  }

  async function deleteSelectedMediaImages() {
    const selectedIds = new Set(mediaBulkSelectedIds);
    const items = mediaImages.filter((item) => selectedIds.has(getMediaItemId(item)));
    if (!items.length || mediaBulkDeleting) return;
    if (!window.confirm("Xoá " + items.length + " file đã chọn khỏi thư viện ảnh trên máy?")) return;

    setMediaBulkDeleting(true);
    setMediaError("");
    setMediaNotice("Đang xoá " + items.length + " file đã chọn...");
    try {
      const ids = items.map(getMediaItemId).filter(Boolean);
      const payload = await deleteMediaImagesRequest(ids);
      const deletedIds = new Set(Array.isArray(payload.deleted_ids) ? payload.deleted_ids : ids);
      setMediaImages((current) => current.filter((item) => !deletedIds.has(getMediaItemId(item))));
      setSelectedMediaIds((current) => current.filter((id) => !deletedIds.has(id)));
      setMediaBulkSelectedIds((current) => current.filter((id) => !deletedIds.has(id)));
      setMediaNotice("Đã xoá " + deletedIds.size + " ảnh khỏi thư viện trên máy.");
    } catch (deleteError) {
      setMediaError(deleteError?.message || "Không thể xoá ảnh local.");
      setMediaNotice("");
    } finally {
      setMediaBulkDeleting(false);
    }
  }

  function handlePromptFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // A text file is one prompt. Normalize document markup before placing it
      // in the single-line composer.
      const rawValue = String(reader.result || "").replace(/^\uFEFF/, "");
      const promptBudget = promptBudgetForColorDescription(characterColorDescription);
      const wasTruncated = promptCharCount(rawValue) > promptBudget;
      const nextValue = getSinglePrompt(rawValue, promptBudget);
      promptTruncatedRef.current = wasTruncated;
      if (promptInputRef.current) promptInputRef.current.value = nextValue;
      setPromptText(nextValue);
      setNotice(
        "Đã nạp prompt từ " + file.name
        + (wasTruncated ? " · tổng prompt và mô tả màu vượt 12.000 ký tự nên phần dư đã tự động xoá" : "")
      );
      setError("");
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function handlePromptInput(event) {
    const rawValue = event.currentTarget.value;
    const promptBudget = promptBudgetForColorDescription(characterColorDescription);
    const nextValue = truncatePrompt(rawValue, promptBudget);
    if (nextValue !== rawValue) {
      event.currentTarget.value = nextValue;
      promptTruncatedRef.current = true;
      setNotice("Tổng prompt và mô tả màu vượt 12.000 ký tự; phần vượt đã tự động xoá.");
      setError("");
    }
    // The composer is intentionally uncontrolled while typing. Re-rendering
    // the entire StudioShell for every key made large prompts feel
    // sluggish; the counter/list is synced after a short idle window.
    if (promptSyncTimerRef.current) window.clearTimeout(promptSyncTimerRef.current);
    promptSyncTimerRef.current = window.setTimeout(() => {
      setPromptText(nextValue);
      promptSyncTimerRef.current = null;
    }, 120);
  }

  function handlePromptBlur(event) {
    const rawValue = event.currentTarget.value;
    const nextValue = getSinglePrompt(rawValue, promptBudgetForColorDescription(characterColorDescription));
    if (nextValue !== rawValue) {
      event.currentTarget.value = nextValue;
      setPromptText(nextValue);
      setNotice("Đã làm sạch ký tự định dạng và gộp prompt thành một dòng.");
      setError("");
    }
  }

  function clearPromptInput() {
    if (promptInputRef.current) promptInputRef.current.value = "";
    if (promptSyncTimerRef.current) window.clearTimeout(promptSyncTimerRef.current);
    promptSyncTimerRef.current = null;
    promptTruncatedRef.current = false;
    setPromptText("");
    setCharacterColorDescription("");
  }

  function handleCharacterColorInput(event) {
    const rawValue = event.currentTarget.value;
    const currentPrompt = promptInputRef.current?.value ?? promptText;
    const available = Math.min(800, promptBudgetForColorDescription(currentPrompt));
    const nextValue = truncatePrompt(rawValue, available);
    if (nextValue !== rawValue) {
      setNotice("Tổng prompt và mô tả màu vượt 12.000 ký tự; phần mô tả màu vượt đã tự động xoá.");
      setError("");
    }
    setCharacterColorDescription(nextValue);
  }

  async function submitBatch(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    const rawPrompt = promptInputRef.current?.value ?? promptText;
    const colorDescription = characterColorDescription.trim();
    const promptBudget = promptBudgetForColorDescription(colorDescription);
    const wasTruncated = promptTruncatedRef.current || promptCharCount(rawPrompt) > promptBudget;
    const submittedPrompt = getSinglePrompt(rawPrompt, promptBudget);
    if (!submittedPrompt) {
      setError("Hãy nhập prompt tạo video.");
      return;
    }
    const oversizedReference = combinedReferenceEntries.find((entry) => (
      entry.kind === "media" && Number(entry.size || 0) > MAX_REFERENCE_IMAGE_BYTES
    ));
    if (oversizedReference) {
      setError(
        "Ảnh tham chiếu \"" + (oversizedReference.label || "không tên") + "\" có kích thước "
        + formatReferenceImageSize(oversizedReference.size)
        + "; giới hạn là 25 MB. Hãy nén ảnh hoặc chọn ảnh khác."
      );
      return;
    }
    if (promptInputRef.current && promptInputRef.current.value !== submittedPrompt) {
      promptInputRef.current.value = submittedPrompt;
    }
    setPromptText(submittedPrompt);
    // Keep the API's existing array shape for compatibility, but always send
    // exactly one already-normalized, single-line item.
    const submittedPrompts = [submittedPrompt];
    setSubmitting(true);
    const shouldCreatePencilSketch = referenceImageMode === "sketch" && combinedReferences.length > 0;
    if (shouldCreatePencilSketch) {
      setNotice("Đang chờ PixVerse (MaiVideo) tạo ảnh chì đen trắng, tối đa 30 phút cho toàn bộ ảnh tham chiếu. Chỉ tạo video khi tất cả ảnh đã xử lý xong. Vui lòng giữ trang mở.");
    }
    try {
      const batchHeaders = mediaHeaders(true);
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: batchHeaders,
        body: JSON.stringify({
          prompts: submittedPrompts,
          references: combinedReferences,
          referenceImages: combinedReferences,
          referenceImageNames: combinedReferenceNames,
          provider: "gateway",
          model,
          duration,
          ratio,
          referenceImageMode,
          characterColorDescription: referenceImageMode === "sketch" ? colorDescription : "",
          // Keep the article/API naming available for older integrations.
          sketchCharacterRefs: shouldCreatePencilSketch,
          sketch_character_refs: shouldCreatePencilSketch
        })
      });
      const payload = await readJsonResponse(response, "Máy chủ trả về phản hồi không hợp lệ");
      if (!response.ok) throw new Error(payload.error || "Không thể gửi batch");
      const submittedReferences = Array.isArray(payload.config?.referenceImages)
        ? payload.config.referenceImages
        : Array.isArray(payload.referenceImages)
          ? payload.referenceImages
          : combinedReferences;
      const submittedReferenceNames = Array.isArray(payload.config?.referenceImageNames)
        ? payload.config.referenceImageNames
        : Array.isArray(payload.referenceImageNames)
          ? payload.referenceImageNames
          : combinedReferenceNames;
      const now = new Date().toISOString();
      const incomingJobs = (payload.jobs || []).map((job) => ({
        ...job,
        submittedAt: now,
        batchId: payload.batchId,
        provider: job.provider || "gateway",
        model: job.model || model,
        duration: Number(job.duration || duration),
        ratio: job.ratio || ratio,
        referenceImages: submittedReferences,
        referenceImageNames: submittedReferenceNames,
        referenceImageMode: payload.config?.referenceImageMode || referenceImageMode,
        characterColorDescription: payload.config?.characterColorDescription || ""
      }));
      setJobs((current) => [...incomingJobs, ...current]);
      setBatches((current) => [{
        id: payload.batchId,
        createdAt: now,
        total: payload.summary?.total || incomingJobs.length,
        accepted: payload.summary?.accepted || 0,
        failed: payload.summary?.failed || 0,
        provider: "gateway",
        model,
        duration,
        ratio,
        referenceImageMode: payload.config?.referenceImageMode || referenceImageMode,
        referenceCount: submittedReferences.length,
        referenceImageNames: submittedReferenceNames
      }, ...current].slice(0, 20));
      const accepted = payload.summary?.accepted || 0;
      setNotice(
        accepted + "/" + submittedPrompts.length + " prompt đã vào hàng đợi" +
        (payload.summary?.failed ? " · " + payload.summary.failed + " prompt cần kiểm tra" : "") +
        (shouldCreatePencilSketch ? " · đã tạo ảnh chì đen trắng cho " + submittedReferences.length + " ảnh tham chiếu" : "") +
        (shouldCreatePencilSketch && colorDescription ? " · đã thêm mô tả màu nhân vật" : "") +
        (wasTruncated ? " · phần vượt 12.000 ký tự đã tự động xoá" : "")
      );
      promptTruncatedRef.current = false;
      selectView("queue");
    } catch (submitError) {
      setError(submitError?.message || "Không thể gửi batch tới Dola Gateway.");
    } finally {
      setSubmitting(false);
    }
  }

  function clearInheritedReferences() {
    const count = inheritedReferenceUrls.length;
    setInheritedReferenceUrls([]);
    setInheritedReferenceNames([]);
    if (count) setNotice("Đã bỏ " + count + " ảnh tham chiếu kế thừa từ video gốc.");
  }

  async function loadJobIntoComposer(job, mode = "similar") {
    const sourceId = String(job?.id || "").trim();
    if (sourceId && loadingComposerJobIds.includes(sourceId)) return;
    if (sourceId) setLoadingComposerJobIds((current) => current.includes(sourceId) ? current : [...current, sourceId]);
    setError("");
    setNotice("");
    try {
      const rawPrompt = String(job?.prompt || "");
      // Remove the generated envelope in either historical field order, never
      // natural duration wording that belongs to the scene itself.
      const nextPrompt = getSinglePrompt(rawPrompt.replace(/Không tách thành nhiều video và không yêu cầu xác nhận/gi, ""));
      const requestedDuration = Number(job?.duration);
      const nextDuration = SUPPORTED_DURATIONS.includes(requestedDuration) ? requestedDuration : 15;
      const requestedRatio = String(job?.ratio || "").trim();
      const nextRatio = SUPPORTED_RATIOS.includes(requestedRatio) ? requestedRatio : "9:16";
      const requestedModel = String(job?.model || ENABLED_MODEL).trim();
      const referenceManifest = getJobReferenceManifest(job);
      const localReferences = await resolveLocalReferenceManifest(referenceManifest, "Tạo tương tự");
      const references = localReferences.urls;
      const referenceNames = localReferences.names;
      const hasExistingSketchReferences = isSketchReferenceJob(job) && references.length > 0;
      const notes = [];

      if (promptCharCount(rawPrompt) > MAX_PROMPT_CHARS) notes.push("prompt đã được cắt về 12.000 ký tự");
      if (requestedModel && !/2\.5/.test(requestedModel)) notes.push("model cũ đã chuyển sang Seedance 2.5");
      if (requestedDuration && !SUPPORTED_DURATIONS.includes(requestedDuration)) notes.push("thời lượng cũ đã chuyển sang 15s theo cấu hình hiện tại");
      if (requestedRatio && !SUPPORTED_RATIOS.includes(requestedRatio)) notes.push("tỷ lệ cũ không có trong Studio nên dùng 9:16");

      if (promptSyncTimerRef.current) window.clearTimeout(promptSyncTimerRef.current);
      promptSyncTimerRef.current = null;
      promptTruncatedRef.current = promptCharCount(rawPrompt) > MAX_PROMPT_CHARS;
      if (promptInputRef.current) promptInputRef.current.value = nextPrompt;
      setPromptText(nextPrompt);
      setModel(ENABLED_MODEL);
      setDuration(nextDuration);
      setRatio(nextRatio);
      // Stored task references already contain the exact images sent to
      // Seedance. Do not pencil them a second time when creating a similar
      // video; the user can opt in again explicitly.
      setReferenceImageMode("none");
      setCharacterColorDescription("");
      setSelectedMediaIds([]);
      pendingReferenceSelectionRef.current = references.map((url, index) => ({
        url,
        name: referenceNames[index] || referenceFilenameFromUrl(url, index)
      }));
      setInheritedReferenceUrls(references);
      setInheritedReferenceNames(referenceNames);
      setReferenceOrder([]);
      setReferenceDragKey("");
      setReferenceDragOverKey("");
      setMediaPanelOpen(false);
      setJobInfo(null);
      setError("");
      const actionLabel = mode === "edit" ? "Đã nạp task để chỉnh sửa" : "Đã nạp task để chỉnh sửa hoặc tạo video tương tự";
      if (hasExistingSketchReferences) notes.push("đã giữ lại ảnh chì đã tạo và sẽ dùng trực tiếp, không tạo ảnh chì lần nữa");
      const detail = notes.length ? " (" + notes.join("; ") + ")" : "";
      setNotice(actionLabel + detail + ". Task cũ không bị thay đổi.");
      selectView("batch");
    } catch (loadError) {
      setError(loadError?.message || "Không thể nạp task vào Studio.");
      setNotice("");
    } finally {
      if (sourceId) setLoadingComposerJobIds((current) => current.filter((id) => id !== sourceId));
    }
  }

  function showJobInfo(job) {
    const normalizedJob = job?.status === "completed" && job?.videoUrl
      ? { ...job, error: null, failureCode: null }
      : job;
    setJobInfo(normalizedJob);
    setError("");
  }

  async function retryJob(job) {
    const sourceId = String(job?.id || "").trim();
    if (!sourceId || job?.status !== "failed" || retryingJobIds.includes(sourceId)) return;

    if (isProviderRejectedJob(job)) {
      setError(providerRejectionGuidance(job));
      setNotice("");
      return;
    }

    const resumeAcceptedConversation = canPollAcceptedConversation(job);
    if (resumeAcceptedConversation) {
      setRetryingJobIds((current) => current.includes(sourceId) ? current : [...current, sourceId]);
      setError("");
      setNotice("Đang mở lại conversation Dola đã nhận để poll tiếp; prompt không gửi lại...");
      try {
        const response = await fetch("/api/jobs/" + encodeURIComponent(sourceId) + "/retry", {
          method: "POST",
          cache: "no-store",
          headers: {
            ...mediaHeaders(),
            ...(accountAdminKey.trim() ? { "X-Gateway-Admin-Key": accountAdminKey.trim() } : {})
          },
          signal: AbortSignal.timeout(30000)
        });
        const payload = await readResponsePayload(response);
        if (!response.ok) throw new Error(payload.error || payload.detail || "Không thể poll lại conversation Dola.");

        const resumed = payload.job || payload;
        if (!resumed || String(resumed.id || sourceId) !== sourceId || resumed.status === "failed") {
          throw new Error(resumed?.error || "Gateway chưa tiếp tục được conversation cũ.");
        }
        const now = new Date().toISOString();
        setJobs((current) => current.map((item) => String(item?.id || "") === sourceId
          ? {
              ...item,
              status: resumed.status || "processing",
              error: resumed.error || "Gateway đang poll tiếp conversation Dola đã nhận.",
              failureCode: resumed.failure_code || resumed.failureCode || null,
              account: resumed.account || item.account,
              videoUrl: resumed.video_url || resumed.videoUrl || null,
              submittedAt: now,
              finishedAt: null,
              retryCount: Number(item.retryCount || 0) + 1
            }
          : item));
        setSelectedJobIds((current) => current.filter((id) => id !== sourceId));
        if (queueFilter === "failed") setQueueFilter("all");
        setNotice("Đã tiếp tục poll conversation Dola đã nhận; prompt không gửi lại.");
      } catch (pollError) {
        setError(pollError?.message || "Không thể poll lại conversation Dola.");
        setNotice("");
      } finally {
        setRetryingJobIds((current) => current.filter((id) => id !== sourceId));
      }
      return;
    }

    const retryModel = ENABLED_MODEL;
    const rawRetryPrompt = String(job.prompt || "").trim();
    const normalizedRetryPrompt = getSinglePrompt(rawRetryPrompt);
    const durationValue = Number(job.duration);
    if (!SUPPORTED_DURATIONS.includes(durationValue)) {
      setError("Video " + (Number.isFinite(durationValue) ? durationValue + "s" : "này") + " dùng cấu hình cũ của Studio. Hãy đưa nội dung về ô nhập để tạo lại ở 5s, 10s hoặc 15s.");
      return;
    }
    const retryDuration = durationValue;
    const ratioValue = String(job.ratio || "9:16").trim();
    const retryRatio = ["9:16", "16:9", "1:1", "4:3", "3:4"].includes(ratioValue)
      ? ratioValue
      : "9:16";
    const retryManifest = getJobReferenceManifest(job);
    let retryReferences = retryManifest.map((item) => item.url).slice(0, 30);
    let retryReferenceNames = retryManifest.map((item) => item.name).slice(0, 30);
    const sketchReferenceJob = isSketchReferenceJob(job);
    // A running legacy Gateway cannot clean the historical field order. Use
    // the already-normalized batch path for that one case; canonical prompts
    // still use native retry so their logical task id is preserved.
    const requiresPromptRebuild = hasNonCanonicalGeneratedVideoEnvelope(rawRetryPrompt);
    setRetryingJobIds((current) => current.includes(sourceId) ? current : [...current, sourceId]);
    setError("");
    setNotice("Đang tạo lại video lỗi...");
    try {
      if (retryManifest.length) {
        const localReferences = await resolveLocalReferenceManifest(retryManifest, "Retry");
        retryReferences = localReferences.urls;
        retryReferenceNames = localReferences.names;
      }
      const retryReferenceOverride = retryManifest.length
        ? { reference_images: retryReferences, reference_image_names: retryReferenceNames }
        : null;
      const fallbackBody = {
        prompts: [normalizedRetryPrompt],
        references: retryReferences,
        referenceImages: retryReferences,
        referenceImageNames: retryReferenceNames,
        provider: "gateway",
        model: retryModel,
        duration: retryDuration,
        ratio: retryRatio,
        // The retry manifest already contains the exact images that were sent
        // on the failed attempt. In particular, a sketch-mode task already
        // contains the generated pencil images; do not generate another set.
        referenceImageMode: "none",
        retryOf: sourceId,
        retryCount: Number(job.retryCount || 0) + 1
      };
      let response;
      let payload;

      // Prefer the Gateway's native retry endpoint. It requeues the same
      // logical task server-side, including its reference URLs, so a refreshed
      // page cannot retry with stale or incomplete browser state. The 404
      // fallback keeps existing Gateway processes usable until they restart.
      if (!requiresPromptRebuild && !sourceId.startsWith("local_failed_")) {
        response = await fetch("/api/jobs/" + encodeURIComponent(sourceId) + "/retry", {
          method: "POST",
          cache: "no-store",
          headers: {
            ...mediaHeaders(),
            ...(retryReferenceOverride ? { "Content-Type": "application/json" } : {}),
            ...(accountAdminKey.trim() ? { "X-Gateway-Admin-Key": accountAdminKey.trim() } : {})
          },
          ...(retryReferenceOverride ? { body: JSON.stringify(retryReferenceOverride) } : {}),
          signal: AbortSignal.timeout(30000)
        });
        payload = await readResponsePayload(response);
      }
      if (!response || response.status === 404) {
        response = await fetch("/api/batches", {
          method: "POST",
          headers: mediaHeaders(true),
          cache: "no-store",
          body: JSON.stringify(fallbackBody),
          signal: AbortSignal.timeout(30000)
        });
        payload = await readResponsePayload(response);
      }
      if (!response.ok) {
        throw new Error(payload.error || payload.detail || "Không thể tạo lại video");
      }

      const recreated = payload.job || (Array.isArray(payload.jobs) ? payload.jobs[0] : payload);
      if (!recreated || recreated.status === "failed" || String(recreated.id || "").startsWith("local_failed_")) {
        throw new Error(recreated?.error || "Gateway chưa nhận được tác vụ tạo lại");
      }
      const now = new Date().toISOString();
      const recreatedId = String(recreated.id || "").trim();
      const nextRetryCount = Math.max(
        Number(job.retryCount || 0) + 1,
        Number(recreated.retry_count || recreated.retryCount || 0) || 0
      );
      const recreatedRetryOf = recreated.retry_of || recreated.retryOf || null;
      const nextJob = {
        ...recreated,
        id: recreatedId,
        status: recreated.status || "queued",
        submittedAt: now,
        batchId: payload.batchId || recreated.batchId || "retry_" + Date.now(),
        provider: recreated.provider || "gateway",
        model: recreated.model || retryModel,
        duration: Number(recreated.duration || retryDuration),
        ratio: recreated.ratio || retryRatio,
        referenceImageMode: recreated.reference_image_mode || recreated.referenceImageMode || (job.referenceImageMode === "sketch" ? "sketch" : "none"),
        videoUrl: recreated.video_url || recreated.videoUrl || null,
        error: recreated.error || null,
        failureCode: recreated.failure_code || recreated.failureCode || null,
        referenceImages: retryReferences,
        referenceImageNames: Array.isArray(recreated.reference_image_names)
          ? recreated.reference_image_names
          : Array.isArray(recreated.referenceImageNames)
            ? recreated.referenceImageNames
            : retryReferenceNames,
        retryOf: recreatedRetryOf || (recreatedId !== sourceId ? sourceId : job.retryOf || null),
        retryCount: nextRetryCount
      };
      if (!nextJob.id) throw new Error("Gateway chưa trả về mã tác vụ mới");
      setJobs((current) => {
        const sourceIndex = current.findIndex((item) => String(item?.id || "") === sourceId);
        const next = sourceIndex >= 0
          ? current.map((item, index) => index === sourceIndex ? { ...item, ...nextJob } : item)
          : [nextJob, ...current];
        return hideSupersededJobs(next);
      });
      setSelectedJobIds((current) => current.filter((id) => id !== sourceId));
      if (queueFilter === "failed") setQueueFilter("all");
      const retryPlacement = recreatedId === sourceId
        ? "trên chính job lỗi"
        : "bằng một task retry mới và đã ẩn task lỗi cũ";
      setNotice("Đã đưa lại video " + nextJob.duration + "s vào hàng đợi " + retryPlacement + ". Gateway sẽ tạo conversation mới cho lần thử này.");
    } catch (retryError) {
      setError(retryError?.message || "Không thể tạo lại video.");
      setNotice("");
    } finally {
      setRetryingJobIds((current) => current.filter((id) => id !== sourceId));
    }
  }

  function toggleJobSelection(id, checked) {
    const job = jobs.find((item) => String(item.id) === String(id));
    if (!job?.id) return;
    const normalizedId = String(job.id);
    setSelectedJobIds((current) => checked
      ? Array.from(new Set([...current, normalizedId]))
      : current.filter((value) => value !== normalizedId));
  }

  function toggleAllVisibleDeletableJobs(checked) {
    if (!visibleDeletableJobIds.length || jobsBulkDeleting || jobsCancelling) return;
    setSelectedJobIds((current) => {
      if (checked) return Array.from(new Set([...current, ...visibleDeletableJobIds]));
      const visible = new Set(visibleDeletableJobIds);
      return current.filter((id) => !visible.has(id));
    });
  }

  function toggleAllFilteredJobs() {
    if (!hasQueueDateFilter || !filteredJobIds.length || jobsBulkDeleting || jobsCancelling) return;
    const filteredIds = new Set(filteredJobIds);
    setSelectedJobIds((current) => {
      if (allFilteredJobsSelected) return current.filter((id) => !filteredIds.has(id));
      return Array.from(new Set([...current, ...filteredJobIds]));
    });
  }

  function applyQueueMonthRange(monthOffset) {
    const range = queueMonthRange(monthOffset);
    setQueueDateStart(range.start);
    setQueueDateEnd(range.end);
  }

  function toggleJobGroup(groupIds) {
    if (!groupIds.length || jobsBulkDeleting || jobsCancelling) return;
    const groupSet = new Set(groupIds);
    setSelectedJobIds((current) => {
      if (groupIds.every((id) => current.includes(id))) {
        return current.filter((id) => !groupSet.has(id));
      }
      return Array.from(new Set([...current, ...groupIds]));
    });
  }

  function toggleAllFailedJobs() {
    toggleJobGroup(failedJobIds);
  }

  function toggleAllCompletedJobs() {
    toggleJobGroup(completedJobIds);
  }

  function toggleAllCancelledJobs() {
    toggleJobGroup(cancelledJobIds);
  }

  async function postTaskIdsInChunks(path, ids, actionLabel) {
    const result = { deleted: [], cancelled: [], skipped: [], file_deleted: [], file_errors: [], errors: [] };
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    if (accountAdminKey.trim()) headers["X-Gateway-Admin-Key"] = accountAdminKey.trim();
    const chunkSize = 500;

    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize);
      setNotice(actionLabel + " " + Math.min(offset + chunk.length, ids.length) + "/" + ids.length + " mục...");
      try {
        const response = await fetch(path, {
          method: "POST",
          cache: "no-store",
          headers,
          body: JSON.stringify({ ids: chunk }),
          signal: AbortSignal.timeout(30000)
        });
        const raw = await response.text();
        let payload = {};
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          payload = { error: raw.slice(0, 300) };
        }
        if (!response.ok) {
          result.errors.push(payload.error || payload.detail || "Không thể tiếp tục yêu cầu");
          break;
        }
        for (const key of ["deleted", "cancelled", "skipped", "file_deleted", "file_errors"]) {
          if (Array.isArray(payload[key])) result[key].push(...payload[key]);
        }
      } catch (requestError) {
        result.errors.push(requestError?.message || "Mất kết nối khi " + actionLabel.toLowerCase());
        break;
      }
    }
    return result;
  }

  async function deleteSelectedJobs(idsOverride = null) {
    const candidateIds = Array.isArray(idsOverride) ? idsOverride : selectedJobIds;
    const selectedIds = Array.from(new Set(candidateIds.map((id) => String(id)))).filter((id) => {
      const job = jobs.find((item) => String(item.id) === id);
      return Boolean(job?.id);
    });
    if (!selectedIds.length || jobsBulkDeleting || jobsCancelling) return;
    const activeCount = selectedIds.filter((id) => {
      const job = jobs.find((item) => String(item.id) === id);
      return isActiveJobStatus(job?.status);
    }).length;
    const confirmMessage = activeCount
      ? "Huỷ và xoá " + selectedIds.length + " mục khỏi hàng đợi? "
        + activeCount + " task đang render sẽ bị dừng worker/poll cục bộ. "
        + "Nếu Dola đã nhận job, quá trình phía Dola và credit có thể không được hoàn lại."
      : "Xoá " + selectedIds.length + " mục khỏi hàng đợi và xoá file video đã tải?";
    if (!window.confirm(confirmMessage)) return;

    setJobsBulkDeleting(true);
    setError("");
    setNotice((activeCount ? "Đang huỷ và xoá " : "Đang xoá ") + selectedIds.length + " mục khỏi hàng đợi...");
    try {
      const payload = await postTaskIdsInChunks("/api/tasks/bulk-delete", selectedIds, "Đang xoá");
      const deletedIds = new Set(payload.deleted.map((id) => String(id)));
      const skipped = payload.skipped;
      const fileErrors = payload.file_errors;
      if (deletedIds.size) {
        setJobs((current) => current.filter((job) => !deletedIds.has(String(job.id))));
        setSelectedJobIds((current) => current.filter((id) => !deletedIds.has(id)));
        const filesDeleted = payload.file_deleted.length;
        setNotice((activeCount ? "Đã huỷ và xoá " : "Đã xoá ") + deletedIds.size + " mục"
          + (filesDeleted ? " và " + filesDeleted + " file video" : "") + ".");
      } else {
        setNotice("");
      }
      if (payload.errors.length) {
        setError((deletedIds.size ? "Đã xử lý " + deletedIds.size + " mục trước khi gặp lỗi: " : "") + payload.errors.join(" · "));
      } else if (skipped.length || fileErrors.length) {
        const skippedText = skipped.length ? skipped.length + " tác vụ không còn tồn tại hoặc chưa thể xoá" : "";
        const fileText = fileErrors.length ? fileErrors.length + " file không xoá được" : "";
        setError([skippedText, fileText].filter(Boolean).join(" · "));
      } else if (!deletedIds.size) {
        setError("Không có mục nào được xoá.");
      }
    } catch (deleteError) {
      setError(deleteError?.message || "Không thể xoá hàng đợi.");
      setNotice("");
    } finally {
      setJobsBulkDeleting(false);
    }
  }

  async function cancelSelectedJobs(idsOverride = null) {
    const candidateIds = Array.isArray(idsOverride) ? idsOverride : selectedJobIds;
    const selectedIds = Array.from(new Set(candidateIds.map((id) => String(id)))).filter((id) => {
      const job = jobs.find((item) => String(item.id) === id);
      return Boolean(job?.id && isActiveJobStatus(job.status));
    });
    if (!selectedIds.length || jobsBulkDeleting || jobsCancelling) return;
    if (!window.confirm(
      "Dừng tạo " + selectedIds.length + " task? Task sẽ giữ lại trong hàng đợi với trạng thái Đã huỷ; "
      + "nếu Dola đã nhận yêu cầu thì credit phía Dola có thể không được hoàn lại."
    )) return;

    setJobsCancelling(true);
    setError("");
    setNotice("Đang dừng " + selectedIds.length + " task; lịch sử sẽ được giữ lại...");
    try {
      const payload = await postTaskIdsInChunks("/api/tasks/cancel", selectedIds, "Đang dừng");
      const cancelledIds = new Set(payload.cancelled.map((id) => String(id)));
      const now = new Date().toISOString();
      if (cancelledIds.size) {
        setJobs((current) => current.map((job) => cancelledIds.has(String(job.id))
          ? {
              ...job,
              status: "cancelled",
              error: "Task đã bị huỷ bởi người dùng",
              failureCode: "CANCELLED",
              finishedAt: job.finishedAt || now,
              updatedAt: now
            }
          : job));
        setSelectedJobIds((current) => current.filter((id) => !cancelledIds.has(id)));
        setJobInfo((current) => current && cancelledIds.has(String(current.id)) ? null : current);
        setNotice("Đã dừng " + cancelledIds.size + " task. Lịch sử vẫn được giữ trong hàng đợi.");
      } else {
        setNotice("");
      }
      if (payload.errors.length) {
        setError((cancelledIds.size ? "Đã dừng " + cancelledIds.size + " task trước khi gặp lỗi: " : "") + payload.errors.join(" · "));
      } else if (payload.skipped.length) {
        setError(payload.skipped.length + " task không còn ở trạng thái đang tạo để dừng.");
      } else if (!cancelledIds.size) {
        setError("Không có task đang tạo để dừng.");
      }
    } catch (cancelError) {
      setError(cancelError?.message || "Không thể dừng task đang tạo.");
      setNotice("");
    } finally {
      setJobsCancelling(false);
    }
  }

  function copyGatewayCommand() {
    const command = "npm start";
    const writePromise = navigator.clipboard?.writeText(command);
    if (!writePromise) return;
    writePromise.then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }

  function downloadCompleted() {
    const completed = visibleJobs.filter((job) => job.status === "completed" && job.videoUrl);
    completed.forEach((job, index) => {
      window.setTimeout(() => downloadFile(job.videoUrl, "dola-" + (index + 1) + ".mp4"), index * 250);
    });
    if (completed.length) setNotice("Đang tải " + completed.length + " video đã hoàn tất.");
    else setError("Chưa có video hoàn tất để tải.");
  }

  function renderStatus(status) {
    const meta = getStatusMeta(status);
    const Icon = meta.icon;
    return (
      <span className={"status-badge status-" + meta.tone}>
        <Icon size={13} strokeWidth={2.4} />
        {meta.label}
      </span>
    );
  }

  function renderSidebar() {
    return (
      <aside className={"sidebar" + (mobileNavOpen ? " sidebar-open" : "")}>
        <div className="brand">
          <div className="brand-mark"><Sparkles size={18} strokeWidth={2.5} /></div>
          <div>
            <div className="brand-name">Dola Studio</div>
            <div className="brand-subtitle">Seedance workspace</div>
          </div>
          <button className="sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Đóng menu">
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-label">WORKSPACE</div>
        <nav className="nav-list">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={pathForView(item.id)}
                className={"nav-item" + (activeView === item.id ? " nav-item-active" : "")}
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  selectView(item.id);
                }}
              >
                <Icon size={18} strokeWidth={activeView === item.id ? 2.4 : 2} />
                <span>{item.label}</span>
                {item.id === "queue" && counts.active > 0 ? (
                  <span className="nav-count">{counts.active}</span>
                ) : null}
              </a>
            );
          })}
        </nav>

        <div className="sidebar-label sidebar-label-spaced">ECOSYSTEM</div>
        <div className="ecosystem-list">
          {services.slice(1).map((service) => (
            <a key={service.id} className="ecosystem-link" href={service.publicUrl} target="_blank" rel="noreferrer">
              <span className={"ecosystem-icon ecosystem-" + service.accent}>
                {service.id === "maivideo" ? <WandSparkles size={15} /> : null}
                {service.id === "htmlvideo" ? <Play size={14} fill="currentColor" /> : null}
                {service.id === "facebook" ? <span className="fb-letter">f</span> : null}
              </span>
              <span>{service.label}</span>
              <ExternalLink className="ecosystem-external" size={12} />
            </a>
          ))}
        </div>

        <div className="sidebar-spacer" />
        <div className="sidebar-connection">
          <div className="connection-head">
            <span className="connection-pulse" />
            <span>{serviceLoading ? "Đang kiểm tra..." : onlineServices + "/4 dịch vụ online"}</span>
            <Activity size={14} />
          </div>
          <div className="connection-bar"><span style={{ width: (onlineServices / 4) * 100 + "%" }} /></div>
          <div className="connection-copy">Các tunnel hiện tại vẫn chạy độc lập.</div>
        </div>
        <div className="sidebar-user">
          <div className="user-avatar">MD</div>
          <div className="user-copy"><strong>Mai D.</strong><span>Local operator</span></div>
          <MoreHorizontal size={17} className="muted-icon" />
        </div>
      </aside>
    );
  }

  function renderTopbar() {
    return (
      <header className="topbar">
        <div className="topbar-left">
          <button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Mở menu">
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{pageTitle}</strong>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="tunnel-pill"><span className="tunnel-dot" /> Tunnel ready</div>
          {!localMode ? <div className={"maivideo-auth-status" + (maivideoSession.authenticated ? " maivideo-auth-connected" : " maivideo-auth-disconnected")}>
            <span className="maivideo-auth-dot" />
            {maivideoSession.loading ? "Đang kiểm tra MaiVideo" : maivideoSession.authenticated ? (maivideoSession.user?.email || "Đã đăng nhập MaiVideo") : <a href={getMaiVideoLoginUrl()}>Đăng nhập MaiVideo</a>}
          </div> : null}
          {!localMode && maivideoSession.authenticated ? <button className="topbar-logout" type="button" onClick={logoutMaiVideo} disabled={maivideoLogoutSubmitting} aria-label="Đăng xuất MaiVideo"><LogOut size={14} /> {maivideoLogoutSubmitting ? "Đang đăng xuất..." : "Đăng xuất"}</button> : null}
          <button className="topbar-icon" aria-label="Thông báo"><Bell size={18} /></button>
          <div className="topbar-avatar">MD</div>
        </div>
      </header>
    );
  }

  function renderNotice() {
    if (!notice && !error) return null;
    return (
      <div className={"notice-banner" + (error ? " notice-error" : "")}>
        {error ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}
        <span>{error || notice}</span>
        <button onClick={() => { setNotice(""); setError(""); }} aria-label="Đóng thông báo"><X size={15} /></button>
      </div>
    );
  }

  function renderOverviewHero() {
    const serviceCount = services.length || SERVICE_FALLBACKS.length;
    const servicePercent = serviceCount ? Math.round((onlineServices / serviceCount) * 100) : 0;
    const connectionLabel = serviceLoading
      ? "Đang kiểm tra kết nối"
      : gateway?.status === "online"
        ? "Workspace đang hoạt động"
        : "Cần kiểm tra kết nối";

    return (
      <section className="overview-welcome-card">
        <div className="overview-welcome-copy">
          <div className="panel-kicker">WORKSPACE OVERVIEW</div>
          <h1>Chào mừng trở lại<span>.</span></h1>
          <p>Tóm tắt hoạt động của Dola Studio, hàng đợi render và các dịch vụ đang kết nối trong một nơi.</p>
          <div className="overview-welcome-actions">
            <button className="button button-primary" onClick={() => selectView("batch")}><Plus size={17} /> Tạo batch mới</button>
            <button className="button button-secondary" onClick={() => selectView("queue")}>Mở hàng đợi <ArrowUpRight size={16} /></button>
          </div>
        </div>
        <div className="overview-welcome-status">
          <div className="overview-status-heading"><span className="overview-status-dot" /> {connectionLabel}</div>
          <div className="overview-status-value"><strong>{serviceLoading ? "—" : onlineServices + "/" + serviceCount}</strong><span>dịch vụ online</span></div>
          <div className="overview-status-bar"><span style={{ width: servicePercent + "%" }} /></div>
          <small>{maivideoSession.user?.email ? "Đang dùng " + maivideoSession.user.email : "Phiên MaiVideo đang hoạt động"}</small>
        </div>
      </section>
    );
  }

  function renderOverviewStats() {
    const stats = [
      { label: "Tổng video", value: counts.total, note: batches.length ? batches.length + " batch gần đây" : "Chưa có hoạt động", icon: Layers3, accent: "blue" },
      { label: "Đang xử lý", value: counts.active, note: counts.queued ? counts.queued + " đang chờ" : "Không có việc đang chờ", icon: Activity, accent: "orange" },
      { label: "Đã hoàn tất", value: counts.completed, note: counts.total ? Math.round((counts.completed / counts.total) * 100) + "% tỷ lệ hoàn tất" : "Chưa có kết quả", icon: CheckCircle2, accent: "mint" },
      { label: "Cần xử lý", value: counts.failed, note: counts.failed ? "Kiểm tra trong hàng đợi" : "Không có lỗi", icon: CircleAlert, accent: "violet" }
    ];
    return (
      <div className="stats-grid overview-stats-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div className="stat-card" key={stat.label}>
              <div className={"stat-icon stat-" + stat.accent}><Icon size={18} /></div>
              <div className="stat-content"><span>{stat.label}</span><strong>{stat.value}</strong><small>{stat.note}</small></div>
              <ArrowUpRight size={15} className="stat-arrow" />
            </div>
          );
        })}
      </div>
    );
  }

  function renderOverviewActivity() {
    const recentJobs = jobs.slice(0, 5);
    return (
      <section className="panel overview-activity-panel">
        <div className="overview-panel-heading">
          <div><div className="panel-kicker">RECENT ACTIVITY</div><h2>Hoạt động gần đây</h2></div>
          <button className="text-button" onClick={() => selectView("queue")}>Xem tất cả <ArrowUpRight size={14} /></button>
        </div>
        {recentJobs.length ? (
          <div className="overview-activity-list">
            {recentJobs.map((job, index) => {
              const meta = getStatusMeta(job.status);
              const StatusIcon = meta.icon;
              return (
                <div className="overview-activity-row" key={job.id + "-overview-" + index}>
                  <div className={"overview-activity-mark overview-activity-mark-" + meta.tone}><StatusIcon size={15} /></div>
                  <div className="overview-activity-copy">
                    <strong title={job.prompt}>{truncate(job.prompt, 66)}</strong>
                    <span>{job.model?.replace("seedance-", "Seedance ") || "Seedance 2.0 Fast"} · {job.duration || duration}s · {formatDate(job.submittedAt)}</span>
                  </div>
                  {renderStatus(job.status)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overview-empty-state">
            <div className="overview-empty-icon"><Activity size={22} /></div>
            <h3>Chưa có hoạt động nào</h3>
            <p>Tạo batch đầu tiên để theo dõi tiến độ render ngay tại đây.</p>
            <button className="button button-primary" onClick={() => selectView("batch")}><Plus size={15} /> Tạo batch mới</button>
          </div>
        )}
      </section>
    );
  }

  function renderOverviewHealth() {
    const serviceStatusLabel = (status) => status === "online"
      ? "Online"
      : status === "degraded"
        ? "Degraded"
        : status === "unknown"
          ? "Đang kiểm tra"
          : "Offline";

    return (
      <section className="panel overview-health-panel">
        <div className="overview-panel-heading">
          <div><div className="panel-kicker">WORKSPACE HEALTH</div><h2>Sức khỏe workspace</h2></div>
          <button className="icon-button-small" onClick={loadServices} disabled={serviceLoading} aria-label="Kiểm tra lại dịch vụ"><RefreshCw size={14} className={serviceLoading ? "spin" : ""} /></button>
        </div>
        <div className="overview-health-summary">
          <div className="overview-health-score"><strong>{serviceLoading ? "—" : onlineServices + "/" + (services.length || SERVICE_FALLBACKS.length)}</strong><span>Dịch vụ online</span></div>
          <div className="overview-health-copy"><strong>{gateway?.status === "online" ? "Gateway sẵn sàng" : "Gateway cần kiểm tra"}</strong><span>{gateway?.latencyMs ? "Phản hồi " + gateway.latencyMs + "ms" : "Điều phối hàng đợi render"}</span></div>
        </div>
        <div className="overview-service-list">
          {services.map((service) => (
            <div className="overview-service-row" key={service.id}>
              <span className={"overview-service-icon overview-service-icon-" + service.accent}>
                {service.id === "gateway" ? <Sparkles size={14} /> : service.id === "maivideo" ? <WandSparkles size={14} /> : service.id === "htmlvideo" ? <Play size={13} fill="currentColor" /> : <span className="overview-fb-letter">f</span>}
              </span>
              <div><strong>{service.label}</strong><small>{(service.apiUrl || service.localUrl)?.replace(/^https?:\/\//, "") || "Service"}</small></div>
              <span className={"overview-service-state overview-state-" + service.status}><span />{serviceStatusLabel(service.status)}</span>
            </div>
          ))}
        </div>
        <button className="overview-health-link" onClick={() => selectView("services")}>Mở trang kết nối <ArrowUpRight size={14} /></button>
      </section>
    );
  }

  function renderComposer() {
    return (
      <form className="composer-layout" onSubmit={submitBatch}>
        <div className="panel prompt-panel">
          <div className="panel-heading">
            <div><div className="panel-kicker">01 · INPUT</div><h2>Prompt tạo video</h2></div>
            <label className="button button-secondary file-button">
              <Upload size={15} /> Nhập .txt
              <input type="file" accept=".txt,text/plain" onChange={handlePromptFile} />
            </label>
          </div>
          <textarea
            ref={promptInputRef}
            className="prompt-textarea"
            defaultValue={promptText}
            onInput={handlePromptInput}
            onBlur={handlePromptBlur}
            placeholder={"Nhập một prompt duy nhất trên một dòng... tối đa 12.000 ký tự."}
            spellCheck="false"
          />
          <div className="prompt-toolbar">
            <span title="Bao gồm prompt video và mô tả màu nhân vật"><span className="toolbar-dot" /> {singlePrompt ? "1 prompt duy nhất" : "0 prompt"} · {combinedComposerCharCount(promptText, characterColorDescription).toLocaleString("vi-VN")}/{MAX_PROMPT_CHARS.toLocaleString("vi-VN")} ký tự (gồm màu)</span>
            <button type="button" className="text-button" onClick={clearPromptInput} disabled={!promptText && !characterColorDescription}>Xóa tất cả <X size={13} /></button>
          </div>
          <div className="reference-block">
            <div className="subsection-heading"><div><ImagePlus size={16} /><strong>Ảnh tham chiếu <span>(tuỳ chọn)</span></strong></div><span className="subsection-hint">{combinedReferences.length}/{maxReferenceImages} ảnh</span></div>
            <div
              className={"media-dropzone media-dropzone-inline" + (mediaDragActive ? " media-dropzone-active" : "")}
              onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMediaDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMediaDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const nextTarget = event.relatedTarget;
                if (!nextTarget || !event.currentTarget.contains(nextTarget)) setMediaDragActive(false);
              }}
              onDrop={handleMediaDrop}
              onPaste={handleMediaPaste}
              tabIndex={0}
              aria-label="Kéo thả hoặc dán ảnh tham chiếu"
            >
              <input ref={mediaInlineFileInputRef} className="media-file-input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple onChange={handleMediaFileInput} />
              <div className="media-dropzone-icon"><Upload size={15} /></div>
              <div className="media-dropzone-copy">
                <strong>Kéo thả ảnh hoặc dán từ clipboard</strong>
                <span>Ảnh được lưu trên máy này và chọn làm ảnh tham chiếu.</span>
              </div>
              <div className="media-dropzone-actions">
                <button type="button" className="button button-secondary" onClick={() => mediaInlineFileInputRef.current?.click()} disabled={mediaUploading}>
                  {mediaUploading ? <LoaderCircle size={13} className="spin" /> : <ImagePlus size={13} />}
                  {mediaUploading ? "Đang thêm..." : "Upload"}
                </button>
                <button
                  type="button"
                  ref={mediaLibraryButtonRef}
                  aria-controls="media-modal"
                  aria-expanded={mediaPanelOpen}
                  className="button button-secondary reference-library-button"
                  onClick={() => { setMediaPanelOpen((current) => !current); setMediaError(""); }}
                >
                  <FolderOpen size={14} /> {mediaPanelOpen ? "Đóng thư viện" : "Chọn ảnh local"}
                </button>
              </div>
            </div>
            {!mediaPanelOpen && mediaError ? <div className="media-picker-message media-picker-error"><CircleAlert size={14} /> <span>{mediaError}</span></div> : null}
            {!mediaPanelOpen && mediaNotice ? <div className="media-picker-message media-picker-success"><CheckCircle2 size={14} /> <span>{mediaNotice}</span></div> : null}
            {orderedReferenceEntries.length ? (
              <>
                {orderedReferenceEntries.length > 1 ? <div className="selected-media-order-hint">Kéo ảnh để đổi thứ tự gửi, hoặc dùng nút ↑ ↓. STT trong prompt sẽ theo thứ tự này.</div> : null}
                <div className="selected-media-strip" aria-label="Ảnh tham chiếu theo thứ tự gửi">
                  {orderedReferenceEntries.map((entry, index) => {
                    const isFirst = index === 0;
                    const isLast = index === orderedReferenceEntries.length - 1;
                    return (
                      <div
                        className={"selected-media-chip" + (referenceDragKey === entry.key ? " selected-media-chip-dragging" : "") + (referenceDragOverKey === entry.key && referenceDragKey !== entry.key ? " selected-media-chip-drag-over" : "")}
                        key={entry.key}
                        draggable={orderedReferenceEntries.length > 1}
                        onDragStart={(event) => handleReferenceDragStart(event, entry.key)}
                        onDragOver={(event) => handleReferenceDragOver(event, entry.key)}
                        onDragLeave={() => setReferenceDragOverKey((current) => current === entry.key ? "" : current)}
                        onDrop={(event) => handleReferenceDrop(event, entry.key)}
                        onDragEnd={handleReferenceDragEnd}
                        title={"#" + (index + 1) + " · Kéo để đổi thứ tự ảnh tham chiếu"}
                      >
                        <span className="selected-media-index">#{index + 1}</span>
                        <span className="selected-media-drag-handle" aria-hidden="true"><GripVertical size={12} /></span>
                        <Image src={entry.previewUrl} alt={entry.label} width={24} height={24} unoptimized />
                        <span className="selected-media-name">{truncate(entry.label, 22)}</span>
                        <span className="selected-media-order-actions">
                          <button type="button" className="selected-media-order-button" onClick={() => moveReferenceEntry(entry.key, -1)} disabled={isFirst} aria-label={"Đưa ảnh #" + (index + 1) + " lên trước"} title="Đưa lên trước"><ArrowUp size={10} /></button>
                          <button type="button" className="selected-media-order-button" onClick={() => moveReferenceEntry(entry.key, 1)} disabled={isLast} aria-label={"Đưa ảnh #" + (index + 1) + " xuống sau"} title="Đưa xuống sau"><ArrowDown size={10} /></button>
                        </span>
                        <button type="button" className="selected-media-remove" onClick={() => removeReferenceEntry(entry)} aria-label={"Bỏ ảnh tham chiếu #" + (index + 1)} title="Bỏ ảnh"><X size={12} /></button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
            {inheritedReferenceUrls.length ? (
              <div className="inherited-reference-note">
                <Link2 size={13} />
                <span>Đã giữ {inheritedReferenceUrls.length} ảnh tham chiếu từ video gốc.</span>
                <button type="button" className="text-button" onClick={clearInheritedReferences}>Bỏ ảnh gốc</button>
              </div>
            ) : null}
            {mediaPanelOpen && typeof document !== "undefined" ? createPortal(
              <div
                className="media-modal-backdrop"
                role="presentation"
                onClick={(event) => {
                  if (event.target === event.currentTarget) setMediaPanelOpen(false);
                }}
              >
                <section
                  className="media-picker media-picker-modal"
                  role="dialog"
                  aria-modal="true"
                  id="media-modal"
                  aria-labelledby="media-modal-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="media-modal-header">
                    <div>
                      <div className="panel-kicker">ẢNH LOCAL · STORYDOLA</div>
                      <h3 id="media-modal-title">Thư viện ảnh trên máy</h3>
                      <span>Bấm thumbnail để chọn hoặc bỏ chọn ảnh làm tham chiếu.</span>
                    </div>
                    <div className="media-modal-header-actions">
                      <button
                        type="button"
                        className="button button-primary media-add-selected-button"
                        onClick={applySelectedMediaReferences}
                        disabled={!selectedMediaIds.length || mediaBulkDeleting}
                      >
                        <Check size={13} /> Thêm ảnh đã chọn
                      </button>
                      <span className="media-modal-reference-status"><Check size={12} /> {selectedMediaIds.length}/{maxReferenceImages} tham chiếu</span>
                      <button ref={mediaModalCloseRef} type="button" className="icon-button media-modal-close" onClick={() => setMediaPanelOpen(false)} aria-label="Đóng thư viện">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="media-picker-content">
                    <div
                      className={"media-dropzone" + (mediaDragActive ? " media-dropzone-active" : "")}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setMediaDragActive(true);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setMediaDragActive(true);
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const nextTarget = event.relatedTarget;
                        if (!nextTarget || !event.currentTarget.contains(nextTarget)) setMediaDragActive(false);
                      }}
                      onDrop={handleMediaDrop}
                      onPaste={handleMediaPaste}
                      tabIndex={0}
                    >
                      <input ref={mediaFileInputRef} className="media-file-input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple onChange={handleMediaFileInput} />
                      <div className="media-dropzone-icon"><Upload size={17} /></div>
                      <div className="media-dropzone-copy">
                        <strong>Kéo thả hoặc dán ảnh</strong>
                        <span>Ctrl/Cmd+V ảnh từ clipboard, hoặc chọn nhiều file từ máy.</span>
                      </div>
                      <button type="button" className="button button-secondary" onClick={() => mediaFileInputRef.current?.click()} disabled={mediaUploading}>
                        {mediaUploading ? <LoaderCircle size={13} className="spin" /> : <ImagePlus size={13} />}
                        {mediaUploading ? "Đang thêm..." : "Upload"}
                      </button>
                    </div>
                    <div className="media-picker-toolbar">
                      <label className="media-search-wrap"><Search size={14} /><input className="media-search" value={mediaSearch} onChange={(event) => setMediaSearch(event.target.value)} placeholder="Tìm theo tên ảnh..." /></label>
                      <button type="button" className="icon-button" onClick={loadMediaImages} disabled={mediaLoading} aria-label="Tải lại thư viện"><RefreshCw size={14} className={mediaLoading ? "spin" : ""} /></button>
                    </div>
                    <div className="media-bulk-toolbar">
                      <button
                        type="button"
                        className={"media-select-all-button" + (allVisibleMediaSelected ? " media-select-all-active" : "")}
                        onClick={toggleAllVisibleMedia}
                        disabled={!filteredMediaIds.length || mediaLoading || mediaBulkDeleting}
                        aria-pressed={allVisibleMediaSelected}
                      >
                        <span className={"media-bulk-check" + (someVisibleMediaSelected ? " media-bulk-check-partial" : "")}>{allVisibleMediaSelected ? <Check size={12} /> : someVisibleMediaSelected ? <Minus size={12} /> : null}</span>
                        {allVisibleMediaSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                      </button>
                      <span className="media-bulk-summary">{mediaBulkSelectedIds.length ? mediaBulkSelectedIds.length + " file đã chọn" : "Checkbox dùng riêng để chọn file xoá hàng loạt"}</span>
                      {mediaBulkSelectedIds.length ? <button type="button" className="media-clear-selection" onClick={() => setMediaBulkSelectedIds([])} disabled={mediaBulkDeleting}>Bỏ chọn</button> : null}
                      <button type="button" className="media-bulk-delete" onClick={deleteSelectedMediaImages} disabled={!mediaBulkSelectedIds.length || mediaBulkDeleting}>
                        {mediaBulkDeleting ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}
                        {mediaBulkDeleting ? "Đang xoá..." : "Xoá đã chọn"}
                      </button>
                    </div>
                    {mediaError ? <div className="media-picker-message media-picker-error"><CircleAlert size={14} /> <span>{mediaError}</span></div> : null}
                    {mediaNotice ? <div className="media-picker-message media-picker-success"><CheckCircle2 size={14} /> <span>{mediaNotice}</span></div> : null}
                    {mediaLoading ? (
                      <div className="media-empty"><LoaderCircle size={20} className="spin" /><span>Đang đọc thư viện ảnh local...</span></div>
                    ) : filteredMediaImages.length ? (
                      <div className="media-picker-grid">
                        {filteredMediaImages.map((item) => {
                          const id = getMediaItemId(item);
                          const selected = selectedMediaIds.includes(id);
                          const selectedReferenceIndex = orderedReferenceEntries.findIndex((entry) => entry.kind === "media" && entry.id === id);
                          const bulkSelected = mediaBulkSelectedIds.includes(id);
                          return (
                            <div className={"media-item-shell" + (selected ? " media-item-shell-selected" : "") + (bulkSelected ? " media-item-shell-bulk-selected" : "")} key={id}>
                              <div className={"media-item" + (selected ? " media-item-selected" : "")}>
                                <button
                                  type="button"
                                  className="media-thumb-button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    toggleMediaImage(item);
                                  }}
                                  aria-label={(selected ? "Bỏ chọn " : "Chọn ") + getMediaItemName(item, mediaOriginalNames) + " làm ảnh tham chiếu"}
                                >
                                  <Image
                                    className="media-thumb"
                                    src={item.previewUrl}
                                    alt={getMediaItemName(item, mediaOriginalNames)}
                                    width={120}
                                    height={76}
                                    unoptimized
                                    loading="lazy"
                                  />
                                </button>
                                {selected ? <span className="media-reference-badge"><Check size={11} /> {selectedReferenceIndex >= 0 ? "#" + (selectedReferenceIndex + 1) + " · " : ""}Đã chọn</span> : null}
                                <div className="media-item-copy">
                                  <strong>{truncate(getMediaItemName(item, mediaOriginalNames), 30)}</strong>
                                  <small>{item.width && item.height ? item.width + " × " + item.height : getMediaItemName(item, mediaOriginalNames)}</small>
                                </div>
                              </div>
                              <label className={"media-bulk-check media-item-bulk-check" + (bulkSelected ? " media-bulk-check-selected" : "")}>
                                <input type="checkbox" checked={bulkSelected} onChange={() => toggleMediaBulkSelection(id)} disabled={mediaBulkDeleting} aria-label={"Chọn " + getMediaItemName(item, mediaOriginalNames) + " để xoá"} />
                                <span aria-hidden="true">{bulkSelected ? <Check size={12} /> : null}</span>
                              </label>
                              <button type="button" className="media-remove" onClick={(event) => { event.preventDefault(); event.stopPropagation(); deleteMediaImage(item); }} disabled={mediaDeletingId === id || mediaBulkDeleting} aria-label={"Xoá " + getMediaItemName(item, mediaOriginalNames)}>{mediaDeletingId === id ? <LoaderCircle size={12} className="spin" /> : <X size={12} />}</button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="media-empty"><ImagePlus size={21} /><strong>{mediaImages.length ? "Không tìm thấy ảnh phù hợp" : "Thư viện local chưa có ảnh"}</strong><span>{mediaImages.length ? "Thử từ khoá khác hoặc xoá bộ lọc." : "Kéo thả hoặc dán ảnh ở phía trên để lưu ảnh trên máy."}</span></div>
                    )}
                  </div>
                </section>
              </div>,
              document.body
            ) : null}
          </div>
        </div>

        <div className="panel options-panel">
          <div className="panel-heading"><div><div className="panel-kicker">02 · CONFIGURE</div><h2>Cấu hình render</h2></div><Settings2 size={18} className="heading-icon" /></div>
          <div className="option-group">
            <label className="option-label">Nguồn render</label>
          <div className="provider-options">
              <div className="provider-option provider-selected provider-static" role="status" aria-label="Nguồn render Dola Gateway">
                <span className="provider-radio"><span /></span>
                <span className="provider-copy"><strong>Dola Gateway · cổng {gatewayPort}</strong><small>Chat Pro · SeedancePro · thời lượng {duration}s</small></span>
              </div>
            </div>
          </div>
          <div className="option-group">
            <label className="option-label">Model</label>
            <div className="model-options">
              {[
                { value: ENABLED_MODEL, title: "Seedance 2.5", note: "Chat Pro · yêu cầu model trong prompt" }
              ].map((option) => (
                <button type="button" key={option.value} className={"model-option" + (model === option.value ? " model-selected" : "")} onClick={() => setModel(option.value)} aria-pressed={model === option.value} data-model={option.value}>
                  <span className="model-radio"><span /></span><span className="model-copy"><strong>{option.title}</strong><small>{option.note}</small></span>
                </button>
              ))}
            </div>
          </div>
          <div className="option-group">
            <label className="option-label">Thời lượng</label>
            <div className="segmented-control">
              {SUPPORTED_DURATIONS.map((value) => {
                return <button type="button" key={value} className={duration === value ? "segment-selected" : ""} onClick={() => setDuration(value)} aria-pressed={duration === value} data-duration={value}>{value}s{value === 30 ? <span className="recommended-dot" /> : null}</button>;
              })}
            </div>
          </div>
          <div className="option-group">
            <label className="option-label">Tỷ lệ khung hình</label>
            <div className="ratio-options">
              {SUPPORTED_RATIOS.map((value) => <button type="button" key={value} className={"ratio-option" + (ratio === value ? " ratio-selected" : "")} onClick={() => setRatio(value)}><span className={"ratio-shape ratio-shape-" + value.replace(":", "-")} />{value}</button>)}
            </div>
          </div>
          <div className="option-group reference-mode-group">
            <label className="option-label">Xử lý ảnh tham chiếu</label>
            <div className="reference-mode-options" role="group" aria-label="Xử lý ảnh tham chiếu">
              <button
                type="button"
                className={"reference-mode-option" + (referenceImageMode === "sketch" ? " reference-mode-selected" : "")}
                onClick={() => setReferenceImageMode("sketch")}
                aria-pressed={referenceImageMode === "sketch"}
                data-reference-image-mode="sketch"
              >
                <span className="model-radio"><span /></span>
                <span className="model-copy"><strong>Tạo ảnh chì đen trắng</strong><small>Nhân vật thành nét chì; sản phẩm và bối cảnh giữ màu</small></span>
              </button>
              <button
                type="button"
                className={"reference-mode-option" + (referenceImageMode === "none" ? " reference-mode-selected" : "")}
                onClick={() => setReferenceImageMode("none")}
                aria-pressed={referenceImageMode === "none"}
                data-reference-image-mode="none"
              >
                <span className="model-radio"><span /></span>
                <span className="model-copy"><strong>Không tạo</strong><small>Dùng ảnh tham chiếu gốc như hiện tại</small></span>
              </button>
            </div>
            <label className="character-color-field" htmlFor="character-color-description">
              <span>Màu nhân vật gốc <em>(tuỳ chọn)</em></span>
              <input
                id="character-color-description"
                type="text"
                value={characterColorDescription}
                onChange={handleCharacterColorInput}
                placeholder="Ví dụ: da sáng ấm, tóc đen, mắt nâu, áo trắng viền xanh..."
                disabled={referenceImageMode !== "sketch"}
                maxLength={800}
              />
              <small>Ảnh chì chỉ làm guide hình dáng; mô tả này giúp Seedance tô lại màu trong video.</small>
            </label>
            <div className="inline-note"><WandSparkles size={13} />{combinedReferences.length ? "PixVerse (MaiVideo) xử lý từng ảnh; mỗi ảnh dùng 1 lượt quota." : "Chưa có ảnh tham chiếu; lựa chọn sẽ áp dụng khi thêm ảnh."}</div>
          </div>
          <div className="submit-zone">
            <div className="submit-summary"><span><ListChecks size={15} /> {singlePrompt ? 1 : 0} video sẽ được gửi</span></div>
            <button className="button button-submit" type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle size={17} className="spin" /> : <Zap size={17} fill="currentColor" />}
              {submitting ? "Đang gửi..." : "Gửi vào hàng đợi"}
              {!submitting ? <ArrowUpRight size={16} /> : null}
            </button>
          </div>
        </div>
      </form>
    );
  }

  function renderJobInfoModal() {
    if (!jobInfo || typeof document === "undefined") return null;
    const loadingInComposer = loadingComposerJobIds.includes(String(jobInfo.id || ""));

    const metadata = jobInfo.videoMetadata && typeof jobInfo.videoMetadata === "object" && !Array.isArray(jobInfo.videoMetadata)
      ? jobInfo.videoMetadata
      : {};
    const timings = jobInfo.timings && typeof jobInfo.timings === "object" && !Array.isArray(jobInfo.timings)
      ? jobInfo.timings
      : {};
    const references = getJobReferenceUrls(jobInfo);
    const referencePreviewUrls = references.map((reference) => toAbsoluteUrl(reference)).filter(Boolean);
    const outputVideoUrl = getJobVideoPreviewUrl(jobInfo.videoUrl);
    const outputPosterUrl = [
      metadata.poster_url,
      metadata.posterUrl,
      metadata.thumbnail_url,
      metadata.thumbnailUrl,
      metadata.preview_image,
      metadata.previewImage
    ].map((value) => String(value || "").trim()).find((value) => value && (/^https?:\/\//i.test(value) || value.startsWith("/"))) || "";
    const modelLabel = String(jobInfo.model || ENABLED_MODEL).replace(/^seedance-/i, "Seedance ");
    const outputDuration = Number(metadata.duration);
    const outputWidth = Number(metadata.width);
    const outputHeight = Number(metadata.height);
    const outputDurationLabel = Number.isFinite(outputDuration) ? outputDuration.toFixed(1) + "s" : "—";
    const resolutionLabel = Number.isFinite(outputWidth) && Number.isFinite(outputHeight)
      ? outputWidth + " × " + outputHeight
      : "—";
    const watermarkLabel = metadata.watermark_removed === true
      ? "Đã xoá watermark khi tải"
      : metadata.watermark_free === true
        ? "Bản gốc · không watermark"
        : metadata.watermark_free === false
          ? "Chưa xác nhận watermark"
          : "—";
    const timingLabels = {
      current_stage: "Bước xử lý gần nhất",
      queue_wait_ms: "Chờ trong hàng đợi",
      reference_download_ms: "Tải ảnh tham chiếu",
      generation_and_poll_ms: "Gửi và chờ Dola",
      poll_window_ms: "Cửa sổ poll gần nhất",
      worker_total_ms: "Tổng thời gian worker",
      poll_window_count: "Số lần poll"
    };
    const timingEntries = Object.entries(timings);

    return createPortal(
      <div
        className="job-info-backdrop"
        role="presentation"
        onClick={(event) => {
          if (event.target === event.currentTarget) setJobInfo(null);
        }}
      >
        <section
          className="job-info-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="job-info-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="job-info-header">
            <div className="job-info-heading-copy">
              <div className="panel-kicker">VIDEO GENERATION</div>
              <h3 id="job-info-title">Thông tin tạo video</h3>
              <span title={jobInfo.id}>{jobInfo.id || "—"}</span>
            </div>
            <button type="button" className="icon-button job-info-close" onClick={() => setJobInfo(null)} aria-label="Đóng thông tin tạo video">
              <X size={16} />
            </button>
          </div>

          <div className="job-info-content">
            <div className="job-info-status-row">
              {renderStatus(jobInfo.status)}
              <span>{isActiveJobStatus(jobInfo.status)
                ? "Đóng cửa sổ này không dừng task; task vẫn tiếp tục trong profile hiện tại."
                : jobInfo.error ? "Task kết thúc với lỗi; xem chi tiết bên dưới." : "Thông tin được lưu từ Dola Gateway."}</span>
            </div>

            <div className="job-info-grid">
              <div><span>Model</span><strong>{modelLabel}</strong></div>
              <div><span>Profile tạo video</span><strong>{jobInfo.account || "Đang phân profile"}</strong></div>
              <div><span>Thời lượng yêu cầu</span><strong>{jobInfo.duration ? jobInfo.duration + "s" : "—"}</strong></div>
              <div><span>Tỷ lệ khung hình</span><strong>{jobInfo.ratio || "—"}</strong></div>
              <div><span>Nhà cung cấp</span><strong>{jobInfo.provider || "gateway"}</strong></div>
              <div><span>Gửi lúc</span><strong>{formatDate(jobInfo.submittedAt)}</strong></div>
              <div><span>Bắt đầu render</span><strong>{formatDate(jobInfo.startedAt)}</strong></div>
              <div><span>Kết thúc</span><strong>{formatDate(jobInfo.finishedAt)}</strong></div>
              <div><span>Số lần tạo lại</span><strong>{Number(jobInfo.retryCount || 0)}</strong></div>
            </div>

            <div className="job-info-block">
              <div className="panel-kicker">TASK ID</div>
              <code className="job-info-code">{jobInfo.id || "—"}</code>
            </div>

            <div className="job-info-block">
              <div className="panel-kicker">FULL PROMPT · {promptCharCount(jobInfo.prompt).toLocaleString("vi-VN")} KÝ TỰ</div>
              <pre className="job-info-prompt">{jobInfo.prompt || "—"}</pre>
            </div>

            {references.length ? (
              <div className="job-info-block">
                <div className="panel-kicker">REFERENCE IMAGE PREVIEW · {references.length}</div>
                <div className="job-info-reference-preview-grid">
                  {referencePreviewUrls.map((reference, index) => (
                    <a
                      key={reference + "-preview-" + index}
                      className="job-info-reference-preview"
                      href={reference}
                      target="_blank"
                      rel="noreferrer"
                      title={"Mở ảnh tham chiếu " + (index + 1)}
                    >
                      <Image
                        src={reference}
                        alt={"Ảnh tham chiếu " + (index + 1)}
                        width={180}
                        height={180}
                        loading="lazy"
                        unoptimized
                      />
                      <span>Ảnh {index + 1}</span>
                    </a>
                  ))}
                </div>
                <div className="panel-kicker job-info-reference-source-label">REFERENCE URLS</div>
                <div className="job-info-reference-list">
                  {references.map((reference, index) => (
                    <a key={reference + "-" + index} href={reference} target="_blank" rel="noreferrer" title={reference}>
                      <Link2 size={11} /> <span>{truncate(reference, 110)}</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {(jobInfo.videoUrl || Object.keys(metadata).length) ? (
              <div className="job-info-block">
                <div className="panel-kicker">OUTPUT</div>
                <div className="job-info-grid job-info-output-grid">
                  <div><span>Thời lượng file</span><strong>{outputDurationLabel}</strong></div>
                  <div><span>Kích thước</span><strong>{resolutionLabel}</strong></div>
                  <div><span>Watermark</span><strong>{watermarkLabel}</strong></div>
                </div>
                {jobInfo.videoUrl ? (
                  <>
                    <div className="job-info-video-preview">
                      <video
                        className="job-info-video"
                        controls
                        preload="metadata"
                        playsInline
                        poster={outputPosterUrl || undefined}
                        src={outputVideoUrl}
                        style={Number.isFinite(outputWidth) && Number.isFinite(outputHeight) && outputHeight > 0
                          ? { aspectRatio: outputWidth + " / " + outputHeight }
                          : undefined}
                      >
                        Trình duyệt không hỗ trợ phát video này.
                      </video>
                    </div>
                    <a className="job-info-output-link" href={toAbsoluteUrl(jobInfo.videoUrl)} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} /> Mở video kết quả ở tab mới
                    </a>
                  </>
                ) : <span className="job-info-muted">Dola chưa trả về file video.</span>}
                {metadata.duration_mismatch ? (
                  <div className="job-info-warning" role="note">
                    <CircleAlert size={14} />
                    <span>{metadata.duration_warning || "Thời lượng file khác thời lượng yêu cầu; video đã được tải để tự kiểm tra."}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {timingEntries.length ? (
              <div className="job-info-block">
                <div className="panel-kicker">TIMINGS</div>
                <div className="job-info-grid">
                  {timingEntries.map(([key, value]) => {
                    const numericValue = Number(value);
                    const stageLabels = { uploading_references: "Đang tải ảnh tham chiếu trên profile đã mở", selecting_model: "Đang chọn model trên profile đã mở", selecting_ratio: "Đang chọn tỷ lệ trên profile đã mở", selecting_duration: "Đang chọn thời lượng trên profile đã mở", typing_prompt: "Đang nhập prompt trên profile đã mở", prompt_filled: "Đã nhập và kiểm tra prompt trên profile đã mở", waiting_submission_slot: "Profile đã mở, proxy đã sẵn sàng; đang chờ lượt gửi tới Dola", submitting_prompt: "Đang gửi prompt tới Dola", before_composer: "Đang mở ô nhập trong profile", after_video_entry: "Đã mở chế độ video trong profile", after_new_chat: "Đã mở chat mới trong profile" };
                    const displayValue = key === "current_stage" ? (stageLabels[value] || String(value)) : key.endsWith("_count")
                      ? (Number.isFinite(numericValue) ? numericValue + " lần" : String(value))
                      : formatTiming(value);
                    return <div key={key}><span>{timingLabels[key] || key.replace(/_/g, " ")}</span><strong>{displayValue}</strong></div>;
                  })}
                </div>
              </div>
            ) : null}

            {jobInfo.error ? (
              <div className="job-info-error">
                <CircleAlert size={14} />
                <span>{jobInfo.failureCode ? "[" + jobInfo.failureCode + "] " : ""}{jobInfo.error}{isProviderRejectedJob(jobInfo) ? " " + providerRejectionGuidance(jobInfo) : ""}</span>
              </div>
            ) : null}
          </div>

          <div className="job-info-footer">
            {isActiveJobStatus(jobInfo.status) ? (
              <button type="button" className="button button-secondary" onClick={() => cancelSelectedJobs([jobInfo.id])} disabled={jobsCancelling || jobsBulkDeleting}>
                <PowerOff size={14} /> {jobsCancelling ? "Đang dừng..." : "Dừng tạo"}
              </button>
            ) : null}
            <button type="button" className="button button-primary" onClick={() => loadJobIntoComposer(jobInfo, "similar")} disabled={loadingInComposer} title="Nạp prompt, cấu hình và ảnh tham chiếu vào Studio để chỉnh sửa hoặc tạo video tương tự">
              <Zap size={14} /> {loadingInComposer ? "Đang kiểm tra ảnh..." : "Tạo tương tự"}
            </button>
          </div>
        </section>
      </div>,
      document.body
    );
  }

  function renderJobActions(job) {
    const jobId = String(job?.id || "");
    const retrying = retryingJobIds.includes(jobId);
    const loadingInComposer = loadingComposerJobIds.includes(jobId);
    const providerRejected = isProviderRejectedJob(job);
    const pollAcceptedConversation = canPollAcceptedConversation(job);
    return (
      <div className="row-actions">
        {isActiveJobStatus(job.status) ? (
          <button type="button" className="row-link row-cancel" onClick={() => cancelSelectedJobs([job.id])} disabled={jobsBulkDeleting || jobsCancelling} title="Dừng worker/poll nhưng giữ task trong hàng đợi">
            <PowerOff size={13} /> {jobsCancelling ? "Đang dừng" : "Dừng tạo"}
          </button>
        ) : null}
        {job.status === "failed" ? (
        <button type="button" className="row-link row-retry" onClick={() => providerRejected ? loadJobIntoComposer(job, "edit") : retryJob(job)} disabled={retrying || loadingInComposer} aria-label={providerRejected ? "Sửa và thử lại" : pollAcceptedConversation ? retrying ? "Đang poll lại" : "Poll lại conversation" : retrying ? "Đang tạo lại" : "Tạo lại"} title={providerRejected ? "Mở lại để sửa prompt hoặc thay/bỏ ảnh tham chiếu" : pollAcceptedConversation ? "Tiếp tục poll conversation Dola đã nhận; không gửi lại prompt" : "Đưa chính job lỗi trở lại hàng đợi"}>
            {providerRejected ? <Settings2 size={13} /> : <RotateCcw size={13} className={retrying ? "spin" : ""} />}{providerRejected ? loadingInComposer ? "Đang nạp..." : "Sửa & thử lại" : pollAcceptedConversation ? retrying ? "Đang poll..." : "Poll lại" : null}
        </button>
        ) : null}
        {job.videoUrl && job.status === "completed" ? (
          <>
            <a className="row-link" href={job.videoUrl} target="_blank" rel="noreferrer" title="Mở video kết quả"><ExternalLink size={13} /> Mở</a>
            <button type="button" className="icon-button-small" onClick={() => downloadFile(job.videoUrl, job.id + ".mp4")} aria-label="Tải video" title="Tải video"><Download size={15} /></button>
          </>
        ) : null}
        <button type="button" className="row-link row-similar" onClick={() => loadJobIntoComposer(job, "similar")} disabled={loadingInComposer} title="Nạp prompt, cấu hình và ảnh tham chiếu vào Studio để chỉnh sửa hoặc tạo video tương tự">
          <Zap size={13} /> {loadingInComposer ? "Đang kiểm tra..." : "Tương tự"}
        </button>
        <button type="button" className="icon-button-small" onClick={() => showJobInfo(job)} aria-label="Xem thông tin tạo video" title="Xem thông tin tạo video">
          <Info size={15} />
        </button>
        <button type="button" className="icon-button-small row-delete" onClick={() => deleteSelectedJobs([job.id])} disabled={jobsBulkDeleting || jobsCancelling} aria-label={"Xoá job " + jobId} title="Xoá job khỏi hàng đợi">
          <Trash2 size={15} />
        </button>
      </div>
    );
  }

  function renderQueue() {
    const pageStart = filteredJobs.length
      ? (activeQueuePage - 1) * QUEUE_PAGE_SIZE + 1
      : 0;
    const pageEnd = Math.min(activeQueuePage * QUEUE_PAGE_SIZE, filteredJobs.length);
    const currentOwnerCount = queueOwners.find((owner) => owner.ownerId === queueCurrentOwnerId)?.count || 0;
    const currentOwnerLabel = queueOwners.find((owner) => owner.ownerId === queueCurrentOwnerId)?.label
      || String(maivideoSession.user?.email || "Tôi (admin)");
    const allOwnerCount = queueOwners.reduce((sum, owner) => sum + (Number(owner.count) || 0), 0);
    const selectedOwnerLabel = queueOwnerFilter === "me"
      ? "video của bạn"
      : queueOwnerFilter === "all"
        ? "video của tất cả user"
        : queueOwners.find((owner) => owner.ownerId === queueOwnerFilter)?.label || "user đã chọn";
    return (
      <section className="queue-section">
        <div className="section-toolbar">
          <div><div className="panel-kicker">RENDER MONITOR</div><h1>Hàng đợi render</h1><p>{queueScope === "admin" ? "Quyền admin · đang xem " + selectedOwnerLabel + "." : "Phạm vi cá nhân · chỉ hiển thị video bạn đã tạo."}</p></div>
          <div className="toolbar-actions">{selectedJobIds.length ? <span className="queue-selection-label">{selectedJobIds.length} đã chọn</span> : null}{failedJobIds.length ? <button className="button button-secondary" onClick={toggleAllFailedJobs} disabled={jobsBulkDeleting || jobsCancelling}><CircleAlert size={15} />{allFailedJobsSelected ? "Bỏ chọn job lỗi" : "Chọn job lỗi"} ({failedJobIds.length})</button> : null}{cancelledJobIds.length ? <button className="button button-secondary" onClick={toggleAllCancelledJobs} disabled={jobsBulkDeleting || jobsCancelling}><PowerOff size={15} />{allCancelledJobsSelected ? "Bỏ chọn đã huỷ" : "Chọn đã huỷ"} ({cancelledJobIds.length})</button> : null}{completedJobIds.length ? <button className="button button-secondary" onClick={toggleAllCompletedJobs} disabled={jobsBulkDeleting || jobsCancelling}><CheckCircle2 size={15} />{allCompletedJobsSelected ? "Bỏ chọn hoàn tất" : "Chọn hoàn tất"} ({completedJobIds.length})</button> : null}<button className="button button-secondary" onClick={downloadCompleted}><ArrowDownToLine size={15} /> Tải video hoàn tất</button>{selectedActiveJobCount ? <button className="button button-secondary" onClick={() => cancelSelectedJobs()} disabled={jobsBulkDeleting || jobsCancelling}><PowerOff size={15} />{jobsCancelling ? "Đang dừng..." : "Dừng tạo"}</button> : null}<button className="button button-danger" onClick={deleteSelectedJobs} disabled={!selectedJobIds.length || jobsBulkDeleting || jobsCancelling}><Trash2 size={15} />{jobsBulkDeleting ? "Đang xử lý..." : selectedActiveJobCount ? "Huỷ & xoá đã chọn" : "Xoá đã chọn"}</button><button className="button button-primary" onClick={() => selectView("batch")}><Plus size={16} /> Batch mới</button></div>
        </div>
        {queueSyncError ? <div className="notice-banner notice-error"><CircleAlert size={15} /><span>{queueSyncError}</span></div> : null}
        <div className="queue-summary-row">
          <div className="queue-summary"><span className="summary-dot dot-all" /><strong>{queueDataReady ? counts.total : "—"}</strong><span>tổng</span></div>
          <div className="queue-summary"><span className="summary-dot dot-processing" /><strong>{queueDataReady ? counts.active : "—"}</strong><span>đang chạy</span></div>
          <div className="queue-summary"><span className="summary-dot dot-complete" /><strong>{queueDataReady ? counts.completed : "—"}</strong><span>hoàn tất</span></div>
          <div className="queue-summary"><span className="summary-dot dot-failed" /><strong>{queueDataReady ? counts.failed : "—"}</strong><span>cần xử lý</span></div>
          {!queueDataReady ? <span className="queue-stats-loading" role="status" style={{ color: "#8c98aa", fontSize: 10 }}>Đang đồng bộ số liệu mới nhất…</span> : null}
        </div>
        <div className="panel queue-panel">
          <div className="queue-filterbar">
            <div className="filter-tabs" role="group" aria-label="Lọc trạng thái video">
              {[["all", "Tất cả"], ["processing", "Đang chạy"], ["completed", "Hoàn tất"], ["cancelled", "Đã huỷ"], ["failed", "Lỗi"]].map(([value, label]) => <button key={value} type="button" aria-pressed={queueFilter === value} className={queueFilter === value ? "filter-active" : ""} onClick={() => setQueueFilter(value)}>{label}{value === "all" ? <span>{counts.total}</span> : value === "processing" ? <span>{counts.active}</span> : value === "completed" ? <span>{counts.completed}</span> : value === "cancelled" ? <span>{counts.cancelled}</span> : <span>{counts.failed}</span>}</button>)}
            </div>
            <div className="queue-filter-controls">
              {queueScope === "admin" ? <label className="queue-owner-filter"><UsersRound size={14} /><span>User</span><select value={queueOwnerFilter} onChange={(event) => { setQueueLoadedOwnerSelection(""); setQueueSyncError(""); setQueueOwnerFilter(event.target.value); setQueuePage(1); setSelectedJobIds([]); }} aria-label="Lọc video theo user tạo"><option value="me">{currentOwnerLabel} · {currentOwnerCount}</option><option value="all">Tất cả user · {allOwnerCount}</option>{queueOwners.filter((owner) => owner.ownerId !== queueCurrentOwnerId).map((owner) => <option key={owner.ownerId} value={owner.ownerId}>{owner.label} · {owner.count}</option>)}</select></label> : null}
              <div className="queue-search"><Search size={15} /><input value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Tìm theo prompt hoặc mã..." /></div>
              <label className="queue-date-filter"><CalendarDays size={14} /><span>Từ</span><input type="date" value={queueDateStart} max={queueDateEnd || undefined} onChange={(event) => setQueueDateStart(event.target.value)} aria-label="Ngày bắt đầu lọc job" /></label>
              <label className="queue-date-filter"><CalendarDays size={14} /><span>Đến</span><input type="date" value={queueDateEnd} min={queueDateStart || undefined} onChange={(event) => setQueueDateEnd(event.target.value)} aria-label="Ngày kết thúc lọc job" /></label>
              <div className="queue-date-presets">
                <button type="button" className={queueDateStart === previousQueueMonth.start && queueDateEnd === previousQueueMonth.end ? "queue-date-preset-active" : ""} onClick={() => applyQueueMonthRange(-1)}>Tháng trước</button>
                <button type="button" className={queueDateStart === currentQueueMonth.start && queueDateEnd === currentQueueMonth.end ? "queue-date-preset-active" : ""} onClick={() => applyQueueMonthRange(0)}>Tháng này</button>
              </div>
              {hasQueueDateFilter ? <button type="button" className="button button-secondary queue-date-clear" onClick={() => { setQueueDateStart(""); setQueueDateEnd(""); }} title="Xoá bộ lọc ngày"><X size={13} /> Xoá ngày</button> : null}
              {hasQueueDateFilter && filteredJobIds.length ? <button type="button" className="button button-secondary queue-date-select" onClick={toggleAllFilteredJobs} disabled={jobsBulkDeleting || jobsCancelling}><ListChecks size={14} />{allFilteredJobsSelected ? "Bỏ chọn kết quả" : "Chọn hết " + filteredJobIds.length + " kết quả"}</button> : null}
            </div>
          </div>
          {filteredJobs.length ? (
            <>
              <div className="table-wrap">
                <table className="queue-table">
                  <thead><tr><th className="queue-check-cell"><input className="queue-checkbox" type="checkbox" checked={allVisibleDeletableJobsSelected} onChange={(event) => toggleAllVisibleDeletableJobs(event.target.checked)} disabled={!visibleDeletableJobIds.length || jobsBulkDeleting || jobsCancelling} aria-label="Chọn các mục để dừng hoặc xoá" /></th><th>#</th><th>Prompt</th><th>Profile tạo video</th><th>Cấu hình</th><th>Gửi lúc</th><th>Trạng thái</th><th /></tr></thead>
                  <tbody>
                    {pagedFilteredJobs.map((job, index) => (
                      <tr key={job.id + "-" + index}>
                        <td className="queue-check-cell"><input className="queue-checkbox" type="checkbox" checked={selectedJobIds.includes(String(job.id))} onChange={(event) => toggleJobSelection(job.id, event.target.checked)} disabled={jobsBulkDeleting || jobsCancelling} aria-label={isActiveJobStatus(job.status) ? "Chọn task đang render để dừng hoặc xoá" : "Chọn tác vụ " + job.id} /></td>
                        <td><span className="row-index">{String(pageStart + index).padStart(2, "0")}</span></td>
                        <td><div className="prompt-cell"><span className="prompt-mark"><Sparkles size={13} /></span><span title={job.prompt}>{truncate(job.prompt, 74)}</span><small>{job.id}</small></div></td>
                        <td>
                          {job.account ? (
                            <div className="queue-profile-cell">
                              <div className="queue-profile-name" title={job.account}><UsersRound size={13} /><span>{truncate(job.account, 24)}</span></div>
                              <button type="button" className="row-link queue-profile-open" onClick={() => openAccountProfile(job.account)} disabled={accountProfileActionName === job.account} title="Mở profile Chromium đã tạo task để kiểm tra">
                                <ExternalLink size={12} /> {accountProfileActionName === job.account ? "Đang mở" : "Mở"}
                              </button>
                            </div>
                          ) : <span className="queue-profile-pending">Chưa gán profile</span>}
                        </td>
                        <td><div className="config-cell"><strong>{job.model?.replace("seedance-", "Seedance ") || "Seedance 2.0 Fast"}</strong><span>{job.duration || duration}s · {job.ratio || ratio}</span>{job.videoMetadata?.duration ? <small className="actual-output">File: {Number(job.videoMetadata.duration).toFixed(1)}s · {job.videoMetadata.width}×{job.videoMetadata.height}</small> : null}{job.videoMetadata?.duration_mismatch ? <small className="actual-output duration-mismatch-output">Lệch thời lượng · đã tải để kiểm tra</small> : null}{job.videoMetadata?.watermark_removed === true ? <small className="actual-output watermark-removed-output">Đã xoá watermark khi tải</small> : job.videoMetadata?.watermark_free === true ? <small className="actual-output watermark-free-output">Bản gốc · không watermark</small> : job.videoMetadata?.watermark_free === false ? <small className="actual-output watermark-fallback-output">Chưa xác nhận watermark</small> : null}</div></td>
                        <td><span className="time-cell">{formatDate(job.submittedAt)}</span></td>
                        <td><div>{renderStatus(job.status)}{job.error ? <small className="row-error">{job.failureCode ? "[" + job.failureCode + "] " : ""}{truncate(job.error, 46)}</small> : null}{job.status === "failed" && Number(job.retryCount || 0) > 0 ? <small className="row-retry-count">Đã tạo lại {Number(job.retryCount)} lần</small> : null}</div></td>
                        <td>{renderJobActions(job)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="queue-pagination" aria-label="Phân trang hàng đợi render">
                <span>Hiển thị {pageStart}–{pageEnd}/{filteredJobs.length} video · {QUEUE_PAGE_SIZE}/trang</span>
                <div className="queue-pagination-controls">
                  <button type="button" className="button button-secondary" onClick={() => setQueuePage((current) => Math.max(1, current - 1))} disabled={activeQueuePage <= 1}>Trước</button>
                  <strong>Trang {activeQueuePage}/{queuePageCount}</strong>
                  <button type="button" className="button button-secondary" onClick={() => setQueuePage((current) => Math.min(queuePageCount, current + 1))} disabled={activeQueuePage >= queuePageCount}>Sau</button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-queue"><div className="empty-icon"><FolderOpen size={25} /></div><h3>{hasQueueDateFilter || queueSearch.trim() || queueFilter !== "all" ? "Không có job phù hợp" : "Hàng đợi đang trống"}</h3><p>{hasQueueDateFilter || queueSearch.trim() || queueFilter !== "all" ? "Không tìm thấy job theo bộ lọc hiện tại." : "Gửi batch đầu tiên để các prompt xuất hiện ở đây."}</p>{hasQueueDateFilter || queueSearch.trim() || queueFilter !== "all" ? <button type="button" className="button button-secondary" onClick={() => { setQueueDateStart(""); setQueueDateEnd(""); setQueueSearch(""); setQueueFilter("all"); }}>Xoá bộ lọc</button> : <button className="button button-primary" onClick={() => selectView("batch")}><Plus size={16} /> Tạo batch</button>}</div>
          )}
        </div>
        {jobInfo ? renderJobInfoModal() : null}
      </section>
    );
  }

  function renderServices() {
    return (
      <section className="services-section">
        <div className="section-toolbar">
          <div><div className="panel-kicker">DỊCH VỤ KẾT NỐI</div><h1>Kết nối dịch vụ</h1><p>Kiểm tra trạng thái API và các dịch vụ đang được kết nối.</p></div>
          <button className="button button-secondary" onClick={loadServices} disabled={serviceLoading}><RefreshCw size={15} className={serviceLoading ? "spin" : ""} /> Kiểm tra lại</button>
        </div>
        <div className="service-grid">
          {services.map((service) => (
            <div className={"service-card service-card-" + service.accent} key={service.id}>
              <div className="service-card-top"><div className={"service-logo service-logo-" + service.accent}>{service.id === "gateway" ? <Sparkles size={19} /> : service.id === "maivideo" ? <WandSparkles size={19} /> : service.id === "htmlvideo" ? <Play size={17} fill="currentColor" /> : <span className="fb-logo">f</span>}</div><div className={"service-state state-" + service.status}><span />{service.status === "online" ? "Online" : service.status === "degraded" ? "Degraded" : service.status === "unknown" ? "Đang kiểm tra" : "Offline"}</div></div>
              <h3>{service.label}</h3><p>{service.description}</p>
              <div className="service-meta"><span><Server size={13} /> {service.apiUrl || service.localUrl || "Service"}</span>{service.latencyMs ? <span>{service.latencyMs}ms</span> : null}</div>
              {service.id === "gateway" && service.meta?.accounts ? <div className="service-statline"><span><strong>{service.meta.accounts}</strong> tài khoản</span><span><strong>{service.meta.pendingTasks || 0}</strong> pending</span></div> : null}
              {service.id === "gateway" ? (
                <button type="button" className="service-open" onClick={() => selectView("accounts")}>Quản lý tài khoản <ArrowUpRight size={15} /></button>
              ) : (
                <a className="service-open" href={service.publicUrl} target="_blank" rel="noreferrer">Mở {service.label} <ArrowUpRight size={15} /></a>
              )}
            </div>
          ))}
        </div>
        <div className="tunnel-card">
          <div className="tunnel-card-icon"><Cloud size={20} /></div>
          <div className="tunnel-card-copy"><div className="panel-kicker">CLOUDFLARE TUNNEL</div><h3>Thêm một hostname cho Dola Studio</h3><p>Origin bên dưới là đích nội bộ của tunnel. Request MaiVideo từ Dola dùng API production tại <code>https://maivideo.top</code>. Giữ các tunnel hiện tại cho <code>maivideo.top</code>, <code>html.maivideo.top</code> và <code>fb.maivideo.top</code>; route hostname mới về cổng 3007.</p></div>
          <div className="tunnel-command"><div><span>Origin</span><strong>http://127.0.0.1:3007</strong></div><button onClick={copyGatewayCommand}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
        </div>
      </section>
    );
  }

  function renderProxyManagement() {
    const allProxiesSelected = proxies.length > 0
      && proxies.every((proxy) => proxySelectedIds.includes(proxy.id));
    const selectedProxyForBulk = proxies.find((proxy) => proxy.id === proxyBulkAssignId);
    const selectedEnabledProxyCount = proxySelectedIds.filter((id) => proxies.some((proxy) => proxy.id === id && proxy.enabled)).length;
    const availableProxyfbCount = proxies.filter((proxy) => proxy.enabled && proxy.source === "proxyfb").length;
    const selectedProxyfbIds = proxySelectedIds.filter((id) => proxies.some((proxy) => proxy.id === id && proxy.source === "proxyfb"));
    const selectedProxyfbCount = selectedProxyfbIds.length;
    const availableProxyCount = proxies.filter((proxy) => proxy.enabled).length;
    const distributeProxyCount = proxySelectedIds.length
      ? selectedEnabledProxyCount
      : (availableProxyfbCount || availableProxyCount);
    const distributeAccountCount = selectedAccountNames.length || accounts.length;

    return (
      <section className="proxy-management-page">
        <div className="section-toolbar">
          <div><div className="panel-kicker">PROXY MANAGEMENT</div><h1>Quản lý proxy</h1><p>Quản lý endpoint, kiểm tra IP và chia đều proxy cho các profile Seedance. Proxy đang lỗi và được bật sẽ tự kiểm tra lại mỗi 2 phút khi trang này mở.</p></div>
          <button className="button button-secondary" onClick={() => loadProxies()} disabled={proxyLoading || proxyDistributing || proxyfbBulkRotating}><RefreshCw size={15} className={proxyLoading ? "spin" : ""} /> Làm mới</button>
        </div>

        {accountNotice ? <div className="account-banner account-banner-success"><CheckCircle2 size={16} /><span>{accountNotice}</span><button onClick={() => setAccountNotice("")} aria-label="Đóng thông báo"><X size={14} /></button></div> : null}
        {accountError ? <div className="account-banner account-banner-error"><CircleAlert size={16} /><span>{accountError}</span><button onClick={() => setAccountError("")} aria-label="Đóng thông báo"><X size={14} /></button></div> : null}

        <div className="account-access panel">
          <div className="account-access-copy"><div className="account-access-title"><KeyRound size={16} /><strong>Quyền quản trị Gateway</strong></div><p>Nếu Gateway được khởi động với <code>DOLA_ADMIN_KEY</code>, nhập cùng key ở đây để thao tác quản trị proxy. Key chỉ lưu trong phiên tab này.</p></div>
          <div className="account-key-form"><input type="password" value={accountAdminKey} onChange={(event) => setAccountAdminKey(event.target.value)} placeholder="Admin key Gateway (nếu được bật)" autoComplete="off" /><button className="button button-secondary" type="button" onClick={saveAccountAdminKey}><ShieldCheck size={15} /> Kiểm tra & lưu</button></div>
        </div>

        <div className="proxy-management panel">
          <div className="panel-heading">
            <div><div className="panel-kicker">PROXY POOL</div><h2>Quản lý rotating proxy</h2></div>
            <span className="account-count-pill">{Number(proxySummary.total || proxies.length)} proxy</span>
          </div>
          <p className="panel-help">Proxy endpoint cũ vẫn hỗ trợ ở dưới. Với ProxyFB API, chỉ cần key + <code>location_id</code>; Gateway dùng <code>next_change</code> làm mốc sớm nhất được phép đổi IP và <code>timeout</code> để đổi trước khi lease hết hạn. Proxy khỏe chỉ tự đổi khi timeout gần hết (mặc định còn 15 giây); <code>next_change = 0</code> nghĩa là API cho phép đổi ngay, không tự kích hoạt đổi. Proxy lỗi sẽ được đổi ngay khi API cho phép; key VIP không timeout không bị xoay theo chu kỳ cố định. Sau khi đổi IP, mỗi proxy được kiểm tra qua <code>proxyfb.com/check.php</code> ở mốc 60s, rồi poll lại mỗi 10s đến tối đa 120s (60/70/80/90/100/110/120) trước khi mở profile/render. Khi mở profile hoặc render, hệ thống dùng endpoint mới nhất đã được kiểm tra sẵn. Nếu ProxyFB chưa cấp được IP mới, Gateway sẽ không dùng lại endpoint cũ. Tài liệu: <a href="https://proxyfb.com/APIDocument.html" target="_blank" rel="noreferrer">ProxyFB API</a>.</p>
          <div className="proxyfb-form">
            <div className="proxyfb-form-heading"><div><strong>ProxyFB API · IPv4 xoay</strong><small>Key không hiển thị lại sau khi lưu. Profile đang chạy giữ endpoint hiện tại; đổi IP sẽ áp dụng ở lần mở lại.</small></div><span className="proxy-mode-badge proxy-mode-badge-api">API</span></div>
            <form className="proxy-form-row proxyfb-single-form" onSubmit={submitProxyfb}>
              <label>API key<input type="password" value={proxyfbApiKey} onChange={(event) => setProxyfbApiKey(event.target.value)} placeholder="Nhập key ProxyFB" autoComplete="off" /></label>
              <label>Location ID<input value={proxyfbLocationId} onChange={(event) => setProxyfbLocationId(event.target.value)} placeholder="Ví dụ: 1" inputMode="numeric" /></label>
              <label>Tên profile<input value={proxyfbName} onChange={(event) => setProxyfbName(event.target.value)} maxLength={80} placeholder="ProxyFB JP" /></label>
              <div className="proxyfb-submit-cell"><button className="button button-submit" type="submit" disabled={proxyfbSubmitting || proxyLoading || proxyDistributing || proxyfbBulkRotating}>{proxyfbSubmitting ? "Đang lấy IP..." : "Thêm / cập nhật 1 key"}</button></div>
            </form>
            <form className="proxyfb-bulk-form" onSubmit={submitProxyfbBulk}>
              <div className="proxyfb-bulk-heading"><strong>Thêm key hàng loạt</strong><small>Mỗi dòng <code>API_KEY</code> hoặc <code>API_KEY|LOCATION_ID</code>; nếu chỉ có key thì dùng Location ID ở trên. Tối đa 50 key.</small></div>
              <textarea className="bulk-account-input proxy-bulk-input" value={proxyfbBulkText} onChange={(event) => setProxyfbBulkText(event.target.value)} placeholder={"key_01\nkey_02|1\n# ghi chú"} spellCheck="false" rows={3} />
              <div className="bulk-account-meta"><span><span className="toolbar-dot" /> {proxyfbBulkKeys.length} key sẵn sàng</span><button className="button button-secondary" type="submit" disabled={proxyfbBulkSubmitting || proxyLoading || proxyDistributing || proxyfbBulkRotating || !proxyfbBulkKeys.length}>{proxyfbBulkSubmitting ? "Đang nhập..." : "Nhập ProxyFB hàng loạt"}</button></div>
            </form>
          </div>
          <form className="proxy-bulk-form" onSubmit={submitBulkProxies}>
            <div className="proxy-form-row">
              <label>Protocol<select value={proxyProtocol} onChange={(event) => setProxyProtocol(event.target.value)}><option value="HTTP">HTTP</option><option value="HTTPS">HTTPS</option><option value="SOCKS5">SOCKS5</option></select></label>
              <label>Loại proxy<select value={proxyMode} onChange={(event) => setProxyMode(event.target.value)}><option value="rotating">Rotating</option><option value="static">Static</option></select></label>
              <label>Tên tiền tố<input value={proxyNamePrefix} onChange={(event) => setProxyNamePrefix(event.target.value)} maxLength={40} placeholder="JP rotating" /></label>
            </div>
            <textarea className="bulk-account-input proxy-bulk-input" value={proxyText} onChange={(event) => setProxyText(event.target.value)} placeholder={"proxy01.example:8000:user:password\nproxy02.example:8000:user:password\n# hoặc http://user:password@host:port"} spellCheck="false" rows={4} />
            <div className="bulk-account-meta"><span><span className="toolbar-dot" /> {bulkProxies.proxies.length} dòng sẵn sàng nhập</span><span>{bulkProxies.errors.length ? bulkProxies.errors.length + " dòng lỗi" : "Tối đa 1000 dòng"}</span></div>
            {bulkProxies.errors.length ? <div className="bulk-account-errors" role="status">{bulkProxies.errors.slice(0, 3).map((errorMessage) => <span key={errorMessage}><CircleAlert size={12} /> {errorMessage}</span>)}</div> : null}
            <div className="proxy-form-actions"><button className="button button-submit" type="submit" disabled={proxySubmitting || proxyLoading || proxyDistributing || proxyfbBulkRotating || !bulkProxies.proxies.length}><Upload size={15} />{proxySubmitting ? "Đang nhập..." : "Thêm / cập nhật hàng loạt"}</button><button className="button button-secondary" type="button" onClick={() => loadProxies()} disabled={proxyLoading || proxyDistributing || proxyfbBulkRotating}><RefreshCw size={14} className={proxyLoading ? "spin" : ""} /> Làm mới</button></div>
          </form>
          <div className="proxy-bulk-toolbar">
            <label className="account-select-toggle"><input className="account-checkbox" type="checkbox" checked={allProxiesSelected} onChange={(event) => setProxySelectedIds(event.target.checked ? proxies.map((proxy) => proxy.id) : [])} disabled={!proxies.length || proxyLoading || proxyTesting || proxyDeleting || proxyDistributing || proxyfbBulkRotating} /><span>Chọn tất cả proxy</span></label>
            <span className="account-selection-count">{proxySelectedIds.length ? proxySelectedIds.length + " đã chọn" : "Chưa chọn proxy"}</span>
            <button type="button" className="mini-action mini-action-relogin proxy-distribute-action" onClick={() => rotateSelectedProxyfb(false)} disabled={!selectedProxyfbCount || proxyfbBulkRotating || proxyTesting || proxyDeleting || proxyDistributing || proxyLoading}>{proxyfbBulkRotating ? "Đang đổi IP..." : "Đổi IP " + selectedProxyfbCount + " đã chọn"}</button>
            <button type="button" className="mini-action" onClick={() => rotateSelectedProxyfb(true)} disabled={!availableProxyfbCount || proxyfbBulkRotating || proxyTesting || proxyDeleting || proxyDistributing || proxyLoading}>Đổi IP tất cả ({availableProxyfbCount})</button>
            <button type="button" className="mini-action mini-action-relogin proxy-distribute-action" onClick={distributeProxiesEvenly} disabled={!distributeAccountCount || !distributeProxyCount || proxyDistributing || proxyAssigning || proxyLoading || proxyTesting || proxyDeleting || proxyfbBulkRotating}>{proxyDistributing ? "Đang chia đều..." : "Chia đều " + distributeProxyCount + " proxy / " + distributeAccountCount + " profile"}</button>
            <button type="button" className="mini-action" onClick={() => testSelectedProxies(false)} disabled={!proxySelectedIds.length || proxyTesting || proxyDeleting || proxyDistributing || proxyfbBulkRotating}>{proxyTesting ? "Đang kiểm tra..." : "Kiểm tra đã chọn"}</button>
            <button type="button" className="mini-action" onClick={() => testSelectedProxies(true)} disabled={!proxies.length || proxyTesting || proxyDeleting || proxyDistributing || proxyfbBulkRotating}>Kiểm tra tất cả</button>
            <button type="button" className="mini-action mini-action-danger" onClick={deleteSelectedProxies} disabled={!proxySelectedIds.length || proxyDeleting || proxyTesting || proxyDistributing || proxyfbBulkRotating}>{proxyDeleting ? "Đang xóa..." : "Xóa đã chọn"}</button>
          </div>
          {proxies.length ? <div className="proxy-table-wrap"><table className="proxy-table"><thead><tr><th>Chọn</th><th>Proxy</th><th>Nguồn</th><th>Trạng thái</th><th>Đã gán</th><th /></tr></thead><tbody>{proxies.map((proxy) => {
            const statusTone = proxy.status === "healthy" ? "completed" : proxy.status === "error" ? "failed" : "unknown";
            const isProxyfb = proxy.source === "proxyfb";
            const leaseExpiry = Number(proxy.proxy_timeout_at || 0);
            const nextChangeAt = Number(proxy.proxy_next_change_at || 0);
            const isRenaming = proxyRenameId === proxy.id;
            return <tr key={proxy.id}>
              <td><input className="account-checkbox" type="checkbox" checked={proxySelectedIds.includes(proxy.id)} onChange={(event) => setProxySelectedIds((current) => event.target.checked ? Array.from(new Set([...current, proxy.id])) : current.filter((id) => id !== proxy.id))} disabled={proxyDistributing || proxyRenameSubmitting || proxyfbBulkRotating} aria-label={"Chọn proxy " + proxy.name} /></td>
              <td>
                {isRenaming ? <form className="proxy-name-form" onSubmit={(event) => { event.preventDefault(); renameProxy(proxy); }}>
                  <input className="proxy-name-input" value={proxyRenameValue} onChange={(event) => setProxyRenameValue(event.target.value)} maxLength={80} autoFocus disabled={proxyRenameSubmitting} aria-label={"Tên mới cho " + proxy.name} />
                  <div className="proxy-name-actions"><button type="submit" className="mini-action mini-action-relogin" disabled={proxyRenameSubmitting || !proxyRenameValue.trim()}>{proxyRenameSubmitting ? "Đang lưu..." : "Lưu"}</button><button type="button" className="mini-action" onClick={cancelProxyRename} disabled={proxyRenameSubmitting}>Hủy</button></div>
                </form> : <div className="proxy-name-display"><strong>{proxy.name}</strong><button type="button" className="mini-action proxy-rename-action" onClick={() => startProxyRename(proxy)} disabled={proxyRenameSubmitting || proxyDistributing || proxyTesting || proxyDeleting || proxyfbRotatingId === proxy.id || proxyfbBulkRotating}>Đổi tên</button></div>}
                <small>{proxy.protocol.toUpperCase()} · {proxy.host}:{proxy.port}{proxy.username ? " · " + proxy.username : ""}</small>
              </td>
              <td><span className={"proxy-mode-badge" + (isProxyfb ? " proxy-mode-badge-api" : "")}>{isProxyfb ? "ProxyFB API" : (proxy.mode === "rotating" ? "Rotating" : "Static")}</span><small className={isProxyfb ? "proxy-source-note" : ""}>{isProxyfb ? "Location " + (proxy.location_id || "—") : proxy.mode}</small>{isProxyfb ? <><small className="proxy-expiry-note" title={leaseExpiry ? "Hết lease lúc " + formatProviderCreditDateTime(leaseExpiry) : "ProxyFB không cung cấp timeout cho key VIP"}>{leaseExpiry ? "Timeout còn: " + formatProxyCountdown(leaseExpiry, proxyClock, "Lease đã hết hạn") : "Timeout: Không giới hạn (VIP)"}</small><small className="proxy-next-change-note" title={nextChangeAt > proxyClock / 1000 ? "Được phép đổi từ " + formatProviderCreditDateTime(nextChangeAt) : "API đã cho phép đổi IP"}>Next change: {formatProxyCountdown(nextChangeAt, proxyClock, "Được phép đổi ngay")}</small></> : null}</td>
              <td><span className={"account-status account-status-" + statusTone}><span />{proxy.status === "healthy" ? "Hoạt động" : proxy.status === "error" ? "Lỗi" : "Chưa kiểm tra"}</span>{proxy.last_error ? <small className="account-status-note">{truncate(proxy.last_error, 52)}</small> : null}</td>
              <td><strong>{proxy.assigned_profiles || 0}</strong><small className="quota-note">profile</small></td>
              <td><div className="account-actions">{isProxyfb ? <button type="button" className="mini-action" onClick={() => rotateProxyfb(proxy)} disabled={proxyfbRotatingId === proxy.id || proxyTesting || proxyDeleting || proxyDistributing || proxyRenameSubmitting || proxyfbBulkRotating}>{proxyfbRotatingId === proxy.id ? "Đang đổi IP..." : "Đổi IP"}</button> : null}<button type="button" className="mini-action" onClick={() => testSelectedProxiesForOne(proxy.id)} disabled={proxyTesting || proxyDeleting || proxyfbRotatingId === proxy.id || proxyDistributing || proxyRenameSubmitting || proxyfbBulkRotating}>Kiểm tra</button><button type="button" className="mini-action mini-action-danger" onClick={() => deleteOneProxy(proxy.id, proxy.name)} disabled={proxyTesting || proxyDeleting || proxyfbRotatingId === proxy.id || proxyDistributing || proxyRenameSubmitting || proxyfbBulkRotating}>Xóa</button></div></td>
            </tr>;
          })}</tbody></table></div> : <div className="account-empty"><div className="empty-icon"><Network size={22} /></div><h3>Chưa có proxy quản lý</h3><p>Nhập rotating proxy ở khung trên để gán cho từng profile.</p></div>}
          <div className="proxy-assign-toolbar"><strong>Gán proxy cho profile đã chọn</strong><select value={proxyBulkAssignId} onChange={(event) => setProxyBulkAssignId(event.target.value)} disabled={!selectedAccountNames.length || proxyAssigning || proxyDistributing}><option value="">Proxy mặc định / bỏ gán</option>{proxies.filter((proxy) => proxy.enabled).map((proxy) => <option value={proxy.id} key={proxy.id}>{proxy.name} · {proxy.source === "proxyfb" ? "ProxyFB API" : proxy.mode}</option>)}</select><button type="button" className="mini-action mini-action-relogin" onClick={() => assignProxyToAccounts(selectedAccountNames, proxyBulkAssignId)} disabled={!selectedAccountNames.length || proxyAssigning || proxyDistributing}>{proxyAssigning ? "Đang gán..." : "Gán cho " + (selectedAccountNames.length || "profile")}</button><small>{selectedProxyForBulk ? selectedProxyForBulk.host + ":" + selectedProxyForBulk.port : "Profile không chọn proxy sẽ dùng DOLA_PROXY mặc định."}</small><small className="proxy-distribute-note">Chọn profile ở tab Tài khoản Seedance nếu muốn gán thủ công; “Chia đều” gán theo thứ tự vòng tròn: proxy 1 → profile 1, proxy 2 → profile 2, rồi lặp lại.</small></div>
        </div>
      </section>
    );
  }

  function renderAccounts() {
    const loggedInAccounts = accounts.filter((account) => account.login_ok === 1).length;
    const inactiveAccounts = accounts.length - loggedInAccounts;
    const readyAccounts = accounts.filter((account) => {
      if (typeof account.dispatch_eligible === "boolean") return account.dispatch_eligible;
      return Boolean(account.scheduling)
        && !account.cooling
        && !account.rate_limited
        && Number(account.used_today || 0) < Number(account.limit || 10)
        && account.login_ok !== false
        && account.login_ok !== 0
        && account.login_ok !== "0"
        && !account.busy;
    }).length;
    const riskControlAccounts = accounts.filter((account) => (
      account.cooldown_reason === "risk_control"
    )).length;
    const rateLimitedAccounts = accounts.filter((account) => Boolean(account.rate_limited)).length;
    const lowCreditAccounts = accounts.filter((account) => {
      const balance = account.credit_balance == null ? null : Number(account.credit_balance);
      return balance !== null && Number.isFinite(balance) && balance < 2;
    }).length;
    const filteredAccounts = accounts.filter((account) => accountActivityFilter === "all"
      || (accountActivityFilter === "active" ? account.login_ok === 1 : account.login_ok !== 1));
    const remainingTasks = accounts.reduce((total, account) => total + Number(account.remaining || 0), 0);
    const accountStatus = (account) => {
      const job = accountJobs[account.name];
      if (job?.kind === "profile-sync" && (job.status === "queued" || job.status === "running")) {
        return { label: <>Đang đồng bộ session <button type="button" className="mini-action" disabled={accountProfileActionName === account.name} onClick={() => pauseProfileSync(account.name)}>{accountProfileActionName === account.name ? "Đang dừng..." : "Tạm dừng"}</button></>, tone: "processing" };
      }
      if (job?.kind === "profile-sync" && job.status === "paused") {
        return { label: "Đã tạm dừng đồng bộ", tone: "warning" };
      }
      if (job?.kind === "profile-sync" && job.status === "failed") {
        return { label: "Chưa nhận session Dola", tone: "failed" };
      }
      if (job?.status === "queued") {
        const wait = Number(job.wait_seconds || 0);
        return { label: wait > 0 ? "Chờ " + wait + "s" : "Đang chờ lượt", tone: "queued" };
      }
      if (job?.status === "running") return { label: <>Đang đăng nhập <button type="button" className="mini-action" disabled={accountProfileActionName === account.name} onClick={() => pauseProfileSync(account.name, "login")}>{accountProfileActionName === account.name ? "Đang dừng..." : "Tạm dừng"}</button></>, tone: "processing" };
      if (job?.status === "paused") return { label: "Đã tạm dừng đăng nhập", tone: "queued" };
      if (job?.status === "failed") return { label: "Đăng nhập lỗi", tone: "failed" };
      if (account.cooldown_reason === "risk_control") {
        return {
          label: account.cooling ? "Tạm nghỉ risk-control" : "Chờ kiểm tra risk-control",
          tone: "queued",
        };
      }
      if (account.cooling && account.cooldown_reason === "provider_busy") {
        return { label: "Tạm nghỉ · Dola quá tải", tone: "queued" };
      }
      if (account.rate_limited) {
        return { label: "Tạm dừng · Dola rate-limit", tone: "queued" };
      }
      if (Number(account.used_today || 0) >= Number(account.limit || 10)) {
        return { label: "Hết lượt nội bộ hôm nay", tone: "queued" };
      }
      if (account.login_ok === false || account.login_ok === 0 || account.login_ok === "0") {
        return { label: "Hết phiên", tone: "failed" };
      }
      if (account.scheduling === false) {
        return { label: "Điều phối thủ công đã tắt", tone: "unknown" };
      }
      if (account.busy) {
        return { label: "Đang xử lý job khác", tone: "processing" };
      }
      if (account.login_ok === 1) return { label: "Đang hoạt động", tone: "completed" };
      return { label: "Chưa xác minh", tone: "unknown" };
    };
    const deletableAccounts = accounts.filter((account) => {
      const jobStatus = accountJobs[account.name]?.status;
      return jobStatus !== "queued" && jobStatus !== "running" && !openProfiles[account.name];
    });
    const deletableNames = filteredAccounts.filter((account) => deletableAccounts.includes(account)).map((account) => account.name);
    const allDeletableSelected = deletableNames.length > 0
      && deletableNames.every((name) => selectedAccountNames.includes(name));

    return (
      <section className="accounts-section">
        <div className="section-toolbar">
          <div><div className="panel-kicker">SEEDANCE ACCOUNT POOL</div><h1>Tài khoản Seedance</h1><p>Đăng nhập Google một lần, Gateway lưu session và thông tin đăng nhập mã hoá theo từng profile để tái sử dụng.</p></div>
          <div className="toolbar-actions"><button className="button button-secondary" type="button" onClick={() => selectView("proxies")}><Network size={15} /> Quản lý proxy</button><button className="button button-secondary" type="button" onClick={loadAccounts} disabled={accountsLoading}><RefreshCw size={15} className={accountsLoading ? "spin" : ""} /> Làm mới</button></div>
        </div>

        {accountNotice ? <div className="account-banner account-banner-success"><CheckCircle2 size={16} /><span>{accountNotice}</span><button onClick={() => setAccountNotice("")} aria-label="Đóng thông báo"><X size={14} /></button></div> : null}
        {accountError ? <div className="account-banner account-banner-error"><CircleAlert size={16} /><span>{accountError}</span><button onClick={() => setAccountError("")} aria-label="Đóng thông báo"><X size={14} /></button></div> : null}
        <div className="account-access panel">
          <div className="account-access-copy"><div className="account-access-title"><KeyRound size={16} /><strong>Quyền quản trị Gateway</strong></div><p>Nếu Gateway được khởi động với <code>DOLA_ADMIN_KEY</code>, nhập cùng key ở đây để thao tác quản trị tài khoản. Key chỉ lưu trong phiên tab này.</p></div>
          <div className="account-key-form"><input type="password" value={accountAdminKey} onChange={(event) => setAccountAdminKey(event.target.value)} placeholder="Admin key Gateway (nếu được bật)" autoComplete="off" /><button className="button button-secondary" type="button" onClick={saveAccountAdminKey}><ShieldCheck size={15} /> Kiểm tra & lưu</button></div>
        </div>

        <div className="account-summary-grid">
          <div className="account-summary-card"><div className="stat-icon stat-blue"><UsersRound size={17} /></div><div><span>Tài khoản trong pool</span><strong>{accounts.length}</strong></div></div>
          <div className="account-summary-card" title="Các profile chưa bị chặn cứng và có thể được bộ điều phối chọn; cache credit cũ không tự tắt điều phối."><div className="stat-icon stat-mint"><CheckCircle2 size={17} /></div><div><span>Profile có thể được chọn</span><strong>{readyAccounts}</strong></div></div>
          <div className="account-summary-card"><div className="stat-icon stat-violet"><ShieldCheck size={17} /></div><div><span>Risk-control</span><strong>{riskControlAccounts}</strong></div></div>
          <div className="account-summary-card"><div className="stat-icon stat-orange"><Clock3 size={17} /></div><div><span>Rate-limit</span><strong>{rateLimitedAccounts}</strong></div></div>
          <div className="account-summary-card" title="Số dư thấp không khóa profile; Dola quyết định theo chế độ và chi phí của yêu cầu."><div className="stat-icon stat-orange"><CircleAlert size={17} /></div><div><span>Số dư thấp · vẫn thử</span><strong>{lowCreditAccounts}</strong></div></div>
          <div className="account-summary-card"><div className="stat-icon stat-blue"><Gauge size={17} /></div><div><span>Lượt nội bộ còn lại · toàn pool</span><strong>{remainingTasks}</strong></div></div>
        </div>

        <form className="panel manual-profile-form" onSubmit={createManualProfile}>
          <div className="manual-profile-copy">
            <div className="panel-heading"><div><div className="panel-kicker">MANUAL SIGN-IN</div><h2>Tạo profile đăng nhập thủ công</h2></div><UserPlus size={18} className="heading-icon" /></div>
            <p>Tạo một hồ sơ Chromium riêng rồi tự đăng nhập Google và Dola trong cửa sổ vừa mở. Sau khi đóng profile, Gateway sẽ kiểm tra session; profile chỉ nhận render khi session hợp lệ.</p>
          </div>
          <div className="manual-profile-actions">
            <label className="account-field"><span>Tên profile <small>· tùy chọn</small></span><input value={manualProfileName} onChange={(event) => setManualProfileName(event.target.value)} placeholder="Tự tạo tên nếu để trống" maxLength={32} pattern="[A-Za-z0-9_-]{1,32}" title="Dùng 1–32 ký tự chữ, số, gạch ngang hoặc gạch dưới" autoComplete="off" /></label>
            <button className="button button-submit account-submit" type="submit" disabled={manualProfileSubmitting || accountSubmitting}>{manualProfileSubmitting ? <><LoaderCircle size={15} className="spin" /> Đang tạo profile...</> : <><UserPlus size={15} /> Tạo profile & đăng nhập thủ công <ArrowUpRight size={15} /></>}</button>
          </div>
        </form>

        <div className="account-layout">
          <form className="panel account-form" onSubmit={submitBulkAccounts}>
            <div className="panel-heading"><div><div className="panel-kicker">BULK LOGIN</div><h2>Đăng nhập hàng loạt</h2></div><Layers3 size={18} className="heading-icon" /></div>
            <textarea className="bulk-account-input" value={bulkAccountText} onChange={(event) => setBulkAccountText(event.target.value)} spellCheck="false" rows={9} />
            <div className="bulk-account-meta"><span><span className="toolbar-dot" /> {bulkAccounts.accounts.length} dòng sẵn sàng gửi</span>{bulkAccounts.errors.length ? <span>{bulkAccounts.errors.length} dòng lỗi</span> : null}</div>
            {bulkAccounts.errors.length ? <div className="bulk-account-errors" role="status">{bulkAccounts.errors.slice(0, 4).map((message) => <span key={message}><CircleAlert size={12} /> {message}</span>)}{bulkAccounts.errors.length > 4 ? <small>… và {bulkAccounts.errors.length - 4} dòng khác</small> : null}</div> : null}
            <button className="button button-submit account-submit" type="submit" disabled={accountSubmitting}><Layers3 size={16} />{accountSubmitting ? "Đang khởi tạo..." : "Bắt đầu đăng nhập hàng loạt"}<ArrowUpRight size={15} /></button>
          </form>

          <div className="panel account-list-panel">
            <div className="panel-heading"><div><div className="panel-kicker">CONNECTED ACCOUNTS</div><h2>Danh sách tài khoản</h2></div><span className="account-count-pill">{filteredAccounts.length === accounts.length ? accounts.length : filteredAccounts.length + "/" + accounts.length} tài khoản</span></div>
            <p className="panel-help">Đăng nhập thành công sẽ tự bật “Điều phối”. Mở profile Chromium để kiểm tra session trực tiếp; sau khi đóng profile, Gateway tự xác minh lại session Dola. Khi đang mở, tài khoản tạm thời không nhận render. Proxy được cố định lúc Chromium khởi động; nếu proxy vào Google nhưng Dola timeout, profile vẫn giữ mở và thông báo sẽ ghi rõ lỗi điều hướng. Chọn “Chọn risk-control” để lọc các profile đang Tạm nghỉ risk-control, sau đó dùng “Login Dola” để truy cập dola.com bằng Gmail trong đúng profile. Với tài khoản hết phiên, “Đăng nhập lại đã chọn” ưu tiên credential mã hoá; “Login Dola” dùng session Gmail hiện có và giữ nguyên profile. “Lượt nội bộ” không phải số credit Dola: chỉ ghi nhận sau khi Dola trả video, Gateway tải và kiểm tra file hợp lệ. Nếu conversation còn đang tạo, Gateway tự mở poll tiếp và không gửi trùng. Nếu Dola đã nhận conversation nhưng render thất bại, credit do Dola quyết định và Gateway không thể hoàn tiền.</p>
            <div className="account-activity-filter" role="group" aria-label="Lọc theo trạng thái session Dola">
              <span>Lọc session Dola:</span>
              <button type="button" aria-pressed={accountActivityFilter === "all"} className={accountActivityFilter === "all" ? "activity-filter-active" : ""} onClick={() => setAccountActivityFilter("all")}>Tất cả ({accounts.length})</button>
              <button type="button" aria-pressed={accountActivityFilter === "active"} className={accountActivityFilter === "active" ? "activity-filter-active" : ""} onClick={() => setAccountActivityFilter("active")}>Session đã xác minh ({loggedInAccounts})</button>
              <button type="button" aria-pressed={accountActivityFilter === "inactive"} className={accountActivityFilter === "inactive" ? "activity-filter-active" : ""} onClick={() => setAccountActivityFilter("inactive")}>Chưa xác minh / hết phiên ({inactiveAccounts})</button>
            </div>
            <div className="account-bulk-toolbar account-bulk-toolbar-sticky" aria-label="Thao tác tài khoản đã chọn">
              <label className="account-select-toggle"><input className="account-checkbox" type="checkbox" checked={allDeletableSelected} onChange={(event) => toggleAllAccountSelection(deletableNames, event.target.checked)} disabled={!deletableNames.length || accountsLoading || accountsBulkDeleting || accountsBulkScheduling} /><span>Chọn tất cả có thể thao tác</span></label>
              <button type="button" className="mini-action mini-action-relogin account-select-unauthenticated" onClick={selectUnauthenticatedAccounts} disabled={!reloginEligibleAccounts.length || accountsLoading || accountsBulkDeleting || accountsBulkScheduling || accountSubmitting}><UserPlus size={13} /> Chọn chưa đăng nhập</button>
              <button type="button" className="mini-action mini-action-relogin account-select-risk-control" onClick={selectRiskControlAccounts} disabled={!riskControlEligibleAccounts.length || accountsLoading || accountsBulkDeleting || accountsBulkScheduling || accountsBulkSessionRelogin || accountSubmitting}><ShieldCheck size={13} /> Chọn risk-control ({riskControlEligibleAccounts.length})</button>
              <span className="account-selection-count">{selectedAccountNames.length ? selectedAccountNames.length + " đã chọn" : "Chưa chọn tài khoản"}</span>
              <button type="button" className="mini-action mini-action-relogin account-bulk-relogin" onClick={startBulkRelogin} disabled={!selectedReloginAccounts.length || accountsLoading || accountsBulkDeleting || accountsBulkScheduling || accountSubmitting}><UserPlus size={13} />{selectedReloginAccounts.length ? "Đăng nhập lại " + selectedReloginAccounts.length + " đã chọn" : "Đăng nhập lại đã chọn"}</button>
              <button type="button" className="mini-action mini-action-relogin account-bulk-session-relogin" onClick={startBulkSessionRelogin} disabled={!selectedSessionReloginAccounts.length || accountsLoading || accountsBulkDeleting || accountsBulkScheduling || accountsBulkSessionRelogin || accountSubmitting}><UserPlus size={13} />{accountsBulkSessionRelogin ? "Đang xếp..." : "Login Dola"}</button>
              <button type="button" className="mini-action account-bulk-schedule-on" onClick={enableSelectedAccountScheduling} disabled={!selectedAccountNames.length || accountsLoading || accountsBulkDeleting || accountsBulkScheduling}><Play size={13} />{accountsBulkScheduling ? "Đang cập nhật..." : "Bật điều phối"}</button>
              <button type="button" className="mini-action account-bulk-schedule-off" onClick={disableSelectedAccountScheduling} disabled={!selectedAccountNames.length || accountsLoading || accountsBulkDeleting || accountsBulkScheduling}><PowerOff size={13} />{accountsBulkScheduling ? "Đang cập nhật..." : "Tắt điều phối"}</button>
              <button type="button" className="mini-action mini-action-danger account-bulk-delete" onClick={deleteSelectedAccounts} disabled={!selectedAccountNames.length || accountsLoading || accountsBulkDeleting || accountsBulkScheduling}><Trash2 size={13} />{accountsBulkDeleting ? "Đang xoá..." : "Xoá đã chọn"}</button>
            </div>
            {accountsLoading && !accounts.length ? <div className="account-empty"><LoaderCircle size={20} className="spin" /><span>Đang đọc danh sách từ Gateway...</span></div> : filteredAccounts.length ? (
              <div className="account-table-wrap"><table className="account-table"><thead><tr><th className="account-select-column">Chọn</th><th>Tài khoản</th><th>Trạng thái</th><th>Lượt nội bộ hôm nay</th><th>Proxy</th><th>Điều phối</th><th /></tr></thead><tbody>{filteredAccounts.map((account) => {
                const meta = accountStatus(account);
                const job = accountJobs[account.name];
                const loginBusy = job?.status === "queued" || job?.status === "running";
                const verifying = accountVerifyingName === account.name;
                const profileOpen = Boolean(openProfiles[account.name]);
                const profileActionBusy = accountProfileActionName === account.name;
                const sessionReloginBusy = accountSessionReloginName === account.name;
                const accountLocked = loginBusy || accountsLoading || accountsBulkDeleting || accountsBulkScheduling || accountsBulkSessionRelogin || proxyDistributing || verifying || profileActionBusy || sessionReloginBusy || profileOpen || account.busy;
                const sessionReloginAllowed = account.login_ok !== 1 || account.cooldown_reason === "risk_control";
                const temporarilyPaused = Boolean(account.cooling || account.rate_limited);
                const automaticPauseReason = accountAutomaticPauseReason(account);
                const effectivelyScheduled = accountEffectivelyScheduled(account);
                const hardPaused = accountCannotBeManuallyEnabled(account);
                const scheduleTitle = temporarilyPaused
                  ? "Điều phối tạm dừng do " + (account.cooling
                    ? (account.cooldown_reason === "provider_busy" ? "Dola quá tải" : "risk-control")
                    : "rate-limit") + "; bật lại chỉ sau khi tự kiểm tra thành công."
                  : hardPaused
                    ? automaticPauseReason + ". Điều phối sẽ tự khôi phục khi trạng thái được gỡ."
                    : account.credit_stale
                      ? "Cache credit cũ không tự tắt điều phối; profile vẫn có thể được chọn."
                      : "Bật/tắt điều phối thủ công";
                return (
                  <tr key={account.name}>
                    <td className="account-select-column"><input className="account-checkbox" type="checkbox" checked={selectedAccountNames.includes(account.name)} onChange={(event) => toggleAccountSelection(account.name, event.target.checked)} disabled={accountLocked} aria-label={"Chọn tài khoản " + (account.email || account.name)} /></td>
                    <td><div className="account-identity"><span className="account-avatar"><UsersRound size={14} /></span><div><strong>{account.email || account.name}</strong><small>{account.google_email ? "Gmail trong profile: " + account.google_email : account.email ? "Chưa đọc được identity Gmail trong profile" : "Chưa có email"}</small><small>{account.credentials_saved ? "Đã lưu thông tin đăng nhập mã hoá" : account.email ? "Chỉ có session trình duyệt đã lưu" : "Chưa có email"}</small>{job?.status === "failed" && job.error ? <em>{truncate(job.error, 54)}</em> : null}</div></div></td>
                    <td><span className={"account-status account-status-" + meta.tone}><span />{meta.label}</span>{account.rate_limited ? <small className="account-status-note account-rate-limit-note">Hết rate limit: {formatProviderCreditDateTime(account.rate_limited_until)}</small> : account.cooling && account.cooldown_reason === "provider_busy" ? <small className="account-status-note">Tự thử lại: {formatProviderCreditDateTime(account.cooldown_until)}</small> : null}</td>
                    <td><strong className="quota-number">{account.used_today || 0}/{account.limit || 10}</strong><small className="quota-note" title={creditBalanceDetails(account)}>{creditBalanceSummary(account)}</small></td>
                    <td><select className="account-proxy-select" value={account.proxy_id || ""} onChange={(event) => setAccountProxy(account.name, event.target.value)} disabled={proxyAssigning || loginBusy} aria-label={"Chọn proxy cho " + (account.email || account.name)}><option value="">Mặc định</option>{proxies.filter((proxy) => proxy.enabled).map((proxy) => <option value={proxy.id} key={proxy.id}>{proxy.name} · {proxy.source === "proxyfb" ? "ProxyFB API" : proxy.mode}</option>)}</select><small className="account-proxy-note">{account.proxy_id ? account.proxy_status : "DOLA_PROXY"}</small></td>
                    <td><label className="switch-control" title={scheduleTitle}><input type="checkbox" checked={effectivelyScheduled} disabled={accountLocked || hardPaused} onChange={(event) => setAccountScheduling(account.name, event.target.checked)} aria-label={"Điều phối " + (account.email || account.name) + (automaticPauseReason ? "; tạm dừng: " + automaticPauseReason : "")} /><span /></label></td>
                    <td><div className="account-actions">{sessionReloginAllowed ? <button type="button" className="mini-action mini-action-relogin" onClick={() => reloginAccountWithGmail(account.name)} disabled={accountLocked} title="Mở đúng profile, vào dola.com và đăng nhập bằng Gmail đang có">{sessionReloginBusy ? "Đang xếp..." : "Login Dola"}</button> : null}<button type="button" className="mini-action" onClick={() => verifyAccount(account.name)} disabled={accountLocked}>{verifying ? "Đang kiểm tra..." : "Kiểm tra"}</button><button type="button" className="mini-action mini-action-profile" onClick={() => profileOpen ? closeAccountProfile(account.name) : openAccountProfile(account.name)} disabled={loginBusy || accountsBulkDeleting || accountsBulkScheduling || accountsBulkSessionRelogin || verifying || profileActionBusy || sessionReloginBusy}>{profileActionBusy ? (profileOpen ? "Đang đóng..." : "Đang mở...") : profileOpen ? "Đóng profile" : "Mở profile"}</button><button type="button" className="mini-action mini-action-danger" onClick={() => deleteAccount(account.name, account.email || account.name)} disabled={accountLocked}>Xóa</button></div></td>
                  </tr>
                );
              })}</tbody></table></div>
            ) : accounts.length ? <div className="account-empty"><div className="empty-icon"><UsersRound size={23} /></div><h3>Không có tài khoản phù hợp</h3><p>Không có tài khoản nào trong nhóm trạng thái đang lọc.</p></div> : <div className="account-empty"><div className="empty-icon"><UsersRound size={23} /></div><h3>Chưa có tài khoản nào</h3><p>Nhập danh sách email Google ở khung bên trái để Gateway tạo các session đầu tiên.</p></div>}
          </div>
        </div>

        <div className="account-help-card"><div className="account-help-icon"><ShieldCheck size={19} /></div><div><strong>Luồng đăng nhập hoạt động như thế nào?</strong><p>Next.js chỉ gửi thông tin đến Gateway nội bộ. Gateway mở trình duyệt riêng, đăng nhập vào Dola bằng Google, lưu session và mã hoá thông tin đăng nhập theo profile trên máy Gateway. Với profile hết phiên, “Đăng nhập lại” dùng secret đã lưu để tạo session mới; nút “Login Dola” mở đúng profile cũ, truy cập dola.com và chọn Gmail đang đăng nhập mà không thay profile. Gmail còn đăng nhập chưa có nghĩa là Dola đã có session.</p></div><a href={gateway?.localUrl || `http://127.0.0.1:${gatewayPort}`} target="_blank" rel="noreferrer" className="button button-secondary">Mở Gateway local <ExternalLink size={14} /></a></div>
      </section>
    );
  }

  function renderSettings() {
    return (
      <section className="settings-section">
        <div className="section-toolbar"><div><div className="panel-kicker">WORKSPACE CONFIG</div><h1>Cài đặt vận hành</h1><p>Cấu hình cổng riêng để các project chạy cạnh nhau mà không tranh chấp.</p></div></div>
        <div className="settings-grid">
          <div className="panel settings-panel"><div className="panel-heading"><div><div className="panel-kicker">PORT MAP</div><h2>Bản đồ cổng đề xuất</h2></div><Link2 size={18} className="heading-icon" /></div>
            <div className="port-list">
              {[["StoryAI + Dola Studio", "3021", "Workspace dùng chung một giao diện", "blue"], ["Dola Gateway", gatewayPort, "API tạo Seedance", "blue"], ["MaiVideo frontend proxy", "3005", "Cổng Dola gọi; chuyển tiếp backend :8000", "mint"], ["MaiVideo backend", "8000", "API voice và media", "mint"], ["HTMLVideo", "3000", "Pipeline render HTML", "violet"], ["FB Publisher", "4242", "Meta publishing", "orange"]].map(([name, port, note, accent]) => <div className="port-row" key={name}><span className={"port-dot port-dot-" + accent} /><div><strong>{name}</strong><small>{note}</small></div><code>:{port}</code></div>)}
            </div>
          </div>
          <div className="panel settings-panel"><div className="panel-heading"><div><div className="panel-kicker">GATEWAY START</div><h2>Khởi động Dola Gateway</h2></div><TerminalIcon /></div>
            <p className="settings-copy">Dùng npm start để mở StoryAI và Dola trên cùng giao diện; Dola Gateway chạy riêng ở cổng {gatewayPort} để xử lý tác vụ.</p>
            <div className="code-block"><code>npm start</code><button onClick={copyGatewayCommand}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
            <div className="settings-note"><Info size={15} /><span>API Gateway nội bộ có thể dùng <code>DOLA_GATEWAY_API_KEY</code>. Quản lý profile và API key cá nhân cần <code>DOLA_GATEWAY_ADMIN_KEY</code> ở Studio khớp với <code>DOLA_ADMIN_KEY</code> của Gateway.</span></div>
            <div className="settings-note"><ShieldCheck size={15} /><span>Render dùng profile Chromium ẩn/minimized mặc định với <code>DOLA_HIDE_RENDER_WINDOWS=1</code>. Cửa sổ đăng nhập Google vẫn hiện để xử lý CAPTCHA/2FA.</span></div>
          </div>
          <UserApiKeysPanel />
          <div className="panel settings-panel full-settings"><div className="panel-heading"><div><div className="panel-kicker">PUBLIC ROUTING</div><h2>Hostname cho tunnel</h2></div><ExternalLink size={18} className="heading-icon" /></div>
            <div className="route-table"><div className="route-row route-head"><span>Hostname</span><span>Origin</span><span>Vai trò</span></div>{[["seedance.maivideo.top", "127.0.0.1:3007", "Dashboard"], ["maivideo.top", "127.0.0.1:3005", "MaiVideo"], ["html.maivideo.top", "127.0.0.1:3000", "HTMLVideo"], ["fb.maivideo.top", "127.0.0.1:4242", "Facebook Publisher"]].map(([host, origin, role]) => <div className="route-row" key={host}><strong>{host}</strong><code>{origin}</code><span>{role}</span></div>)}</div>
          </div>
        </div>
      </section>
    );
  }

  function switchAuthMode(nextMode) {
    setAuthMode(nextMode === "register" ? "register" : "login");
    setMediaError("");
    setMediaNotice("");
    setMediaLoginPassword("");
    setAuthPasswordConfirm("");
  }

  function renderAuthGate() {
    const isRegister = authMode === "register";
    return (
      <main className="auth-shell">
        <section className="auth-brand-panel">
          <div className="auth-brand"><span className="brand-mark"><Sparkles size={19} /></span><strong>DOLA STUDIO</strong></div>
          <div className="auth-intro">
            <div className="eyebrow">DOLA STUDIO · SEEDANCE</div>
            <h1>{isRegister ? "Bắt đầu tạo video hàng loạt." : "Đăng nhập vào workspace."}</h1>
            <p>Gửi prompt Seedance hàng loạt, theo dõi hàng đợi và quản lý media trong một workspace dùng chung tài khoản MaiVideo.</p>
            <div className="auth-points">
              <span><ShieldCheck size={16} /> Phiên được xác thực bởi MaiVideo</span>
              <span><Layers3 size={16} /> Dola Gateway tạo video qua chat Pro · 15s</span>
              <span><CheckCircle2 size={16} /> Mỗi tài khoản một workspace</span>
            </div>
          </div>
          <div className="auth-brand-foot">Dola Studio · MaiVideo workspace</div>
        </section>
        <section className="auth-form-panel">
          <div className="auth-card">
            <div className="auth-card-head">
              <div className="auth-card-kicker">{isRegister ? "CREATE ACCOUNT" : "WELCOME BACK"}</div>
              <h2>{isRegister ? "Tạo tài khoản MaiVideo" : "Chào mừng trở lại"}</h2>
              <p>{isRegister ? "Đăng ký bằng tài khoản MaiVideo để sử dụng Dola Studio." : "Đăng nhập bằng tài khoản MaiVideo để tiếp tục vào workspace Dola."}</p>
            </div>
            <div className="auth-tabs" role="tablist" aria-label="Xác thực tài khoản">
              <button type="button" role="tab" aria-selected={isRegister} className={"auth-tab" + (isRegister ? " active" : "")} onClick={() => switchAuthMode("register")}>Đăng kí</button>
              <button type="button" role="tab" aria-selected={!isRegister} className={"auth-tab" + (!isRegister ? " active" : "")} onClick={() => switchAuthMode("login")}>Đăng nhập</button>
            </div>
            <form className="auth-form" onSubmit={loginMaiVideo} noValidate>
              {isRegister ? <div className="auth-referral">Tài khoản mới được tạo trực tiếp trên hệ thống MaiVideo.</div> : null}
              <label className="field"><span>Email</span><input type="email" value={mediaLoginEmail} onChange={(event) => setMediaLoginEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
              <label className="field"><span>Mật khẩu</span><input type="password" value={mediaLoginPassword} onChange={(event) => setMediaLoginPassword(event.target.value)} placeholder={isRegister ? "Tối thiểu 8 ký tự" : "Mật khẩu MaiVideo"} autoComplete={isRegister ? "new-password" : "current-password"} minLength={8} required /></label>
              {isRegister ? (
                <label className="field"><span>Nhập lại mật khẩu</span><input type="password" value={authPasswordConfirm} onChange={(event) => setAuthPasswordConfirm(event.target.value)} placeholder="Nhập lại mật khẩu" autoComplete="new-password" minLength={8} required /></label>
              ) : (
                <label className="auth-remember"><input type="checkbox" checked={authRemember} onChange={(event) => setAuthRemember(event.target.checked)} /><span>Ghi nhớ đăng nhập</span></label>
              )}
              {mediaError || maivideoSession.error ? <div className="auth-message auth-message-error"><CircleAlert size={14} /><span>{mediaError || maivideoSession.error}</span></div> : null}
              {mediaNotice ? <div className="auth-message auth-message-success"><CheckCircle2 size={14} /><span>{mediaNotice}</span></div> : null}
              <button className="button button-primary auth-submit" type="submit" disabled={mediaLoginSubmitting}>
                {mediaLoginSubmitting ? <LoaderCircle size={14} className="spin" /> : null}
                {mediaLoginSubmitting ? "Đang xử lý..." : isRegister ? "Tạo tài khoản" : "Đăng nhập"} <ArrowUpRight size={14} />
              </button>
            </form>
            <div className="auth-switch">{isRegister ? "Đã có tài khoản?" : "Chưa có tài khoản?"} <button type="button" onClick={() => switchAuthMode(isRegister ? "login" : "register")}>{isRegister ? "Đăng nhập" : "Đăng kí ngay"}</button></div>
            <div className="auth-note">Form này xác thực trực tiếp với MaiVideo. Render mặc định vẫn dùng Dola Gateway và các profile đã cấu hình.</div>
          </div>
        </section>
      </main>
    );
  }

  function TerminalIcon() {
    return <span className="heading-icon terminal-glyph">⌘</span>;
  }

  function renderOverview() {
    return (
      <section className="overview-section">
        {renderOverviewHero()}
        {renderOverviewStats()}
        <div className="overview-dashboard-grid">
          {renderOverviewActivity()}
          {renderOverviewHealth()}
        </div>
      </section>
    );
  }

  if (!localMode && maivideoSession.loading && !maivideoSession.authenticated) {
    return (
      <div className="auth-gate-shell auth-gate-loading">
        <div className="auth-gate-card"><LoaderCircle size={24} className="spin" /><strong>Đang kiểm tra phiên MaiVideo...</strong><span>Chuẩn bị workspace Dola Studio</span></div>
      </div>
    );
  }

  if (!localMode && !maivideoSession.authenticated) return renderAuthGate();

  return (
    <div className={embedded ? "app-shell app-shell-embedded" : "app-shell"}>
      {!embedded ? renderSidebar() : null}
      <div className={embedded ? "main-shell main-shell-embedded" : "main-shell"}>
        {!embedded ? renderTopbar() : null}
        <main className={embedded ? "page-content page-content-embedded" : "page-content"}>
          {renderNotice()}
          {gateway && !serviceLoading && gateway.status !== "online" && activeView !== "services" ? <div className="gateway-alert"><div className="gateway-alert-icon"><CircleAlert size={17} /></div><div><strong>Dola Gateway chưa kết nối</strong><span>Kiểm tra npm start và kết nối Gateway ở cổng {gatewayPort} để gửi video thật.</span></div><button onClick={() => selectView("services")}>Kiểm tra kết nối <ArrowUpRight size={14} /></button></div> : null}
          {activeView === "overview" ? renderOverview() : null}
          {activeView === "batch" ? <><div className="page-intro"><div><div className="panel-kicker">BATCH STUDIO</div><h1>Tạo video hàng loạt</h1></div><div className="intro-badge"><Zap size={15} fill="currentColor" /> {sourceLabel} · {duration}s</div></div>{renderComposer()}</> : null}
          {activeView === "queue" ? renderQueue() : null}
          {activeView === "services" ? renderServices() : null}
          {activeView === "accounts" ? renderAccounts() : null}
          {activeView === "proxies" ? renderProxyManagement() : null}
          {activeView === "settings" ? renderSettings() : null}
        </main>
      </div>
    </div>
  );
}
