import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";

const bulkDownloadUrl = "https://maivideo.top/tools/bulk-download";
const inputPlaceholder = "Dán danh sách liên kết video tại đây (mỗi dòng một link)...";

function browserCandidates() {
  const paths = process.env.PATH?.split(path.delimiter).filter(Boolean) || [];
  const executableNames = process.platform === "win32"
    ? ["chrome.exe", "msedge.exe"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "microsoft-edge"];
  const onPath = paths.flatMap((directory) => executableNames.map((name) => path.join(directory, name)));
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
        process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
      ].filter((candidate): candidate is string => Boolean(candidate))
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  let bundled = "";
  try { bundled = chromium.executablePath(); } catch { /* A locally installed browser may still be available. */ }
  return [bundled, ...system, ...onPath];
}

async function browserExecutable() {
  const configured = process.env.STORYAI_BROWSER_PATH?.trim();
  if (configured) {
    try {
      await access(configured, constants.X_OK);
      return configured;
    } catch {
      throw new Error("STORYAI_BROWSER_PATH không trỏ tới Chrome hoặc Chromium có thể chạy được.");
    }
  }
  for (const candidate of browserCandidates()) {
    if (!candidate) continue;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next standard browser location. */ }
  }
  throw new Error("Không tìm thấy Chrome/Chromium để mở MaiVideo. Cài trình duyệt hoặc cấu hình STORYAI_BROWSER_PATH.");
}

export async function downloadFromMaiVideo(sourceUrl: string, work: string) {
  const executablePath = await browserExecutable();
  let browser: Browser | undefined;
  let stage = "launch";
  try {
    browser = await chromium.launch({ headless: true, executablePath, args: ["--disable-dev-shm-usage"] });
    const context = await browser.newContext({ acceptDownloads: true });
    context.setDefaultTimeout(30_000);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(90_000);
    stage = "open MaiVideo";
    await page.goto(bulkDownloadUrl, { waitUntil: "domcontentloaded" });
    stage = "submit Douyin URL";
    await page.getByPlaceholder(inputPlaceholder).fill(sourceUrl);
    await page.getByRole("button", { name: "Bắt đầu tải hàng loạt", exact: true }).click();

    // Keep waiting for the site's job result without imposing source-duration or file-size limits.
    stage = "wait for MaiVideo result";
    await page.waitForFunction(() => {
      const visible = (element: Element) => {
        const node = element as HTMLElement;
        return Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
      };
      const ready = Array.from(document.querySelectorAll("a")).some((anchor) =>
        anchor.textContent?.trim() === "Tải file" && visible(anchor));
      if (ready) return true;
      const text = document.body?.innerText || "";
      return /(?:tải thất bại|không thể tải video|link không hợp lệ|không hỗ trợ link|download failed|unsupported link)/iu.test(text);
    }, undefined, { timeout: 0 });

    stage = "read MaiVideo result link";
    const downloadLink = page.getByRole("link", { name: "Tải file", exact: true }).first();
    if (!(await downloadLink.count())) throw new Error("MaiVideo không tải được link video này.");
    const href = await downloadLink.getAttribute("href");
    if (!href) throw new Error("MaiVideo chưa tạo liên kết file tải.");
    const resultUrl = new URL(href, bulkDownloadUrl);
    if (resultUrl.protocol !== "https:" || resultUrl.hostname !== "maivideo.top" || resultUrl.port
      || resultUrl.username || resultUrl.password) throw new Error("MaiVideo trả về liên kết file không hợp lệ.");
    stage = "download video in MaiVideo browser session";
    const downloadStarted = page.waitForEvent("download", { timeout: 0 });
    await downloadLink.click();
    const download = await downloadStarted;
    const failure = await download.failure();
    if (failure) throw new Error("MaiVideo không hoàn tất tải tệp video.");
    const file = path.join(work, "source.mp4");
    await download.saveAs(file);
    if (!(await stat(file).catch(() => undefined))?.size) throw new Error("MaiVideo trả về tệp video rỗng.");
    await context.close();
    return file;
  } catch (error) {
    if (error instanceof Error && /^(?:Không tìm thấy Chrome|STORYAI_BROWSER_PATH)/u.test(error.message)) throw error;
    console.error("[video-remake] MaiVideo failed at", stage, error instanceof Error ? error.name : "error");
    throw new Error("MaiVideo chưa hoàn tất tải video từ link này.");
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
