import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { dataPath } from "./data-directory";
import type { CreateVideoAssetImage, CreateVideoSourceBrief } from "./motion-video";

export const createVideoRoot = dataPath("motion-video");
export const maxCreateVideoImages = 12;
export const maxCreateVideoImageBytes = 40 * 1024 * 1024;

export const createVideoOwnerFolder = (owner: string) =>
  createHash("sha256").update(owner).digest("hex");

export const isValidCreateVideoUuid = (id: string) =>
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id);

export function createVideoJobDir(owner: string, jobId: string) {
  return path.join(createVideoRoot, createVideoOwnerFolder(owner), "jobs", jobId);
}

function isPrivateOrReservedIp(ip: string): boolean {
  const ver = net.isIP(ip);
  if (ver === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (ver === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80")) return true;
    if (lower.startsWith("::ffff:")) {
      return isPrivateOrReservedIp(lower.slice(7));
    }
    return false;
  }
  return true;
}

export async function assertSafePublicHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("URL không hợp lệ. Hãy nhập địa chỉ bắt đầu bằng https:// hoặc http://.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Chỉ hỗ trợ liên kết bài viết công khai qua giao thức HTTP/HTTPS.");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Không cho phép truy cập địa chỉ nội bộ (localhost / mạng LAN).");
  }
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error("Không cho phép truy cập địa chỉ IP nội bộ.");
    }
    return parsed;
  }
  const records = await lookup(hostname, { all: true }).catch(() => []);
  if (!records.length || records.some((r) => isPrivateOrReservedIp(r.address))) {
    throw new Error("Không thể xác minh máy chủ công khai cho đường dẫn này.");
  }
  return parsed;
}

function findBrowserCandidates() {
  const paths = process.env.PATH?.split(path.delimiter).filter(Boolean) || [];
  const names = process.platform === "win32"
    ? ["chrome.exe", "msedge.exe"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "microsoft-edge"];
  const onPath = paths.flatMap((dir) => names.map((n) => path.join(dir, n)));
  const system = process.platform === "darwin"
    ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
    : process.platform === "win32"
      ? [
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
        process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
      ].filter((v): v is string => Boolean(v))
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  let bundled = "";
  try {
    bundled = chromium.executablePath();
  } catch {
    // Fallback to system Chrome/Edge
  }
  return [process.env.STORYAI_BROWSER_PATH?.trim() || "", bundled, ...system, ...onPath].filter(Boolean);
}

export async function resolveCreateVideoBrowser(): Promise<string | undefined> {
  for (const candidate of findBrowserCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try next
    }
  }
  return undefined;
}

export async function saveUploadedCreateImage(
  imagesDir: string,
  index: number,
  originalName: string,
  customLabel: string,
  bytes: Buffer,
): Promise<CreateVideoAssetImage> {
  if (!bytes.byteLength || bytes.byteLength > maxCreateVideoImageBytes) {
    throw new Error(`Ảnh "${originalName}" vượt quá giới hạn 40MB hoặc rỗng.`);
  }
  await mkdir(imagesDir, { recursive: true, mode: 0o700 });
  const id = `img_${String(index).padStart(2, "0")}`;
  const outPath = path.join(imagesDir, `${id}.png`);
  const normalized = await sharp(bytes, { limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 8 })
    .toBuffer({ resolveWithObject: true });
  await writeFile(outPath, normalized.data, { mode: 0o600 });

  const fallbackLabel = path.basename(originalName, path.extname(originalName))
    .replace(/[_-]+/gu, " ")
    .trim()
    .slice(0, 64);

  return {
    id,
    filename: `${id}.png`,
    width: normalized.info.width,
    height: normalized.info.height,
    label: customLabel.trim().slice(0, 64) || fallbackLabel || `Ảnh minh hoạ #${index}`,
    source: "uploaded",
  };
}

function stripHtmlToReadableText(html: string): {
  title: string;
  description: string;
  paragraphs: string[];
  headings: string[];
  themeColor?: string;
} {
  const titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/iu)
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
  const descMatch = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/iu);
  const colorMatch = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/iu);

  const decodeEntities = (str: string) =>
    str
      .replace(/&nbsp;/giu, " ")
      .replace(/&amp;/giu, "&")
      .replace(/&quot;/giu, '"')
      .replace(/&#39;|&apos;/giu, "'")
      .replace(/&lt;/giu, "<")
      .replace(/&gt;/giu, ">")
      .replace(/\s+/gu, " ")
      .trim();

  const cleaned = html
    .replace(/<(?:script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/(?:script|style|noscript|svg|nav|footer|header|aside|form)>/giu, " ");

  const headings: string[] = [];
  for (const m of cleaned.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/giu)) {
    const t = decodeEntities(m[1].replace(/<[^>]+>/gu, " "));
    if (t.length >= 6 && t.length <= 160 && !headings.includes(t)) {
      headings.push(t);
    }
    if (headings.length >= 40) break;
  }

  const paragraphs: string[] = [];
  for (const m of cleaned.matchAll(/<(?:p|li|blockquote)[^>]*>([\s\S]*?)<\/(?:p|li|blockquote)>/giu)) {
    const t = decodeEntities(m[1].replace(/<[^>]+>/gu, " "));
    if (t.length >= 35 && !paragraphs.includes(t)) {
      paragraphs.push(t);
    }
    if (paragraphs.length >= 220) break;
  }

  return {
    title: decodeEntities((titleMatch?.[1] || "").replace(/<[^>]+>/gu, " ")),
    description: decodeEntities(descMatch?.[1] || ""),
    paragraphs,
    headings,
    themeColor: colorMatch?.[1]?.trim(),
  };
}

export async function harvestArticleUrlForCreateVideo(
  rawUrl: string,
  imagesDir: string,
): Promise<{
  brief: CreateVideoSourceBrief;
  articleBody: string;
  capturedImages: CreateVideoAssetImage[];
}> {
  const safeUrl = await assertSafePublicHttpUrl(rawUrl);
  await mkdir(imagesDir, { recursive: true, mode: 0o700 });

  const capturedImages: CreateVideoAssetImage[] = [];
  const executablePath = await resolveCreateVideoBrowser();

  if (executablePath) {
    let browser;
    try {
      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      });
      await context.route("**/*", async (route) => {
        try {
          const reqUrl = new URL(route.request().url());
          if (reqUrl.protocol !== "http:" && reqUrl.protocol !== "https:") {
            await route.abort();
            return;
          }
          const host = reqUrl.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
          if (host === "localhost" || host.endsWith(".local") || (net.isIP(host) && isPrivateOrReservedIp(host))) {
            await route.abort();
            return;
          }
          await route.continue();
        } catch {
          await route.abort();
        }
      });

      const page = await context.newPage();
      await page.goto(safeUrl.toString(), { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.waitForTimeout(1_100);

      await page.evaluate(() => {
        const selectors = [
          "[id*='cookie' i]",
          "[class*='cookie-banner' i]",
          "[class*='consent-banner' i]",
          "[aria-label*='cookie' i]",
        ];
        for (const sel of selectors) {
          document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
            if (el.offsetHeight > 0 && el.offsetHeight < 420) el.style.display = "none";
          });
        }
      }).catch(() => undefined);

      const heroRaw = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1440, height: 900 } });
      const heroNorm = await sharp(heroRaw).png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });
      await writeFile(path.join(imagesDir, "img_hero.png"), heroNorm.data, { mode: 0o600 });
      capturedImages.push({
        id: "img_hero",
        filename: "img_hero.png",
        width: heroNorm.info.width,
        height: heroNorm.info.height,
        label: `Giao diện đầu trang (${safeUrl.hostname})`,
        source: "captured_hero",
      });

      const pageHeight = await page.evaluate(() =>
        Math.min(2500, Math.max(900, document.documentElement.scrollHeight || document.body.scrollHeight || 900)),
      ).catch(() => 1800);
      await page.setViewportSize({ width: 1440, height: pageHeight });
      await page.waitForTimeout(350);
      const scrollRaw = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1440, height: pageHeight } });
      const scrollNorm = await sharp(scrollRaw).png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });
      await writeFile(path.join(imagesDir, "img_scroll.png"), scrollNorm.data, { mode: 0o600 });
      capturedImages.push({
        id: "img_scroll",
        filename: "img_scroll.png",
        width: scrollNorm.info.width,
        height: scrollNorm.info.height,
        label: `Trang bài viết cuộn dọc (${safeUrl.hostname})`,
        source: "captured_scroll",
      });

      const extracted = await page.evaluate(() => {
        const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content || "";
        const title = (ogTitle || document.title || "").trim();
        const desc = (
          document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ||
          document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content ||
          ""
        ).trim();
        const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content?.trim();

        const root = document.querySelector("article") || document.querySelector("main") || document.body;
        const headings = Array.from(root.querySelectorAll("h1, h2, h3"))
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter((t) => t.length >= 6 && t.length <= 160)
          .slice(0, 40);

        const paragraphs = Array.from(root.querySelectorAll("p, li, blockquote"))
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .filter((t) => t.length >= 35)
          .slice(0, 220);

        return { title, desc, themeColor, headings, paragraphs };
      });

      await browser.close().catch(() => undefined);
      browser = undefined;

      const combinedText = [
        extracted.desc,
        ...extracted.headings.map((h) => `## ${h}`),
        ...extracted.paragraphs,
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 120_000);

      if (combinedText.trim().length >= 40 || extracted.title) {
        return {
          brief: {
            sourceTitle: extracted.title || safeUrl.hostname,
            sourceDomain: safeUrl.hostname,
            sourceUrl: safeUrl.toString(),
            extractedSummary: (extracted.desc || extracted.paragraphs[0] || extracted.title).slice(0, 420),
            keyBullets: (extracted.headings.length ? extracted.headings : extracted.paragraphs.slice(0, 8)).slice(0, 10),
            themeColor: extracted.themeColor,
          },
          articleBody: combinedText || extracted.title,
          capturedImages,
        };
      }
    } catch {
      if (browser) await browser.close().catch(() => undefined);
    }
  }

  const res = await fetch(safeUrl.toString(), {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(18_000),
  }).catch((cause) => {
    throw new Error(`Không tải được nội dung từ ${safeUrl.hostname}: ${cause instanceof Error ? cause.message : "Lỗi kết nối"}`);
  });

  if (!res.ok) {
    throw new Error(`Trang đích trả về mã lỗi HTTP ${res.status}. Hãy thử dán trực tiếp nội dung bài viết.`);
  }

  const html = (await res.text()).slice(0, 900_000);
  const parsed = stripHtmlToReadableText(html);
  const body = [
    parsed.description,
    ...parsed.headings.map((h) => `## ${h}`),
    ...parsed.paragraphs,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 120_000);

  if (!parsed.title && body.length < 30) {
    throw new Error("Trang web chặn đọc tự động hoặc không có văn bản. Hãy chuyển sang tab 'Nhập Nội dung' để dán bài viết.");
  }

  return {
    brief: {
      sourceTitle: parsed.title || safeUrl.hostname,
      sourceDomain: safeUrl.hostname,
      sourceUrl: safeUrl.toString(),
      extractedSummary: (parsed.description || parsed.paragraphs[0] || parsed.title).slice(0, 420),
      keyBullets: (parsed.headings.length ? parsed.headings : parsed.paragraphs.slice(0, 8)).slice(0, 10),
      themeColor: parsed.themeColor,
    },
    articleBody: body || parsed.title,
    capturedImages,
  };
}
