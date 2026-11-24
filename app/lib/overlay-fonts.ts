import path from "node:path";
import { existsSync } from "node:fs";
import sharp from "sharp";

export const overlayTextFontFile = path.join(process.cwd(), "assets", "fonts", "NotoSans-Bold.ttf");
export const overlayEmojiFontFile = path.join(process.cwd(), "assets", "fonts", "NotoColorEmoji.ttf");
let ready: Promise<void> | undefined;

/** Register bundled fonts with Pango, without installing fonts on the host. */
export function ensureOverlayFonts() {
  // Sharp/Pango initializes Fontconfig on its first text render. A bundled
  // config also works on hosts without /etc/fonts/fonts.conf (notably macOS).
  if (!process.env.FONTCONFIG_FILE || !existsSync(process.env.FONTCONFIG_FILE)) {
    process.env.FONTCONFIG_FILE = path.join(process.cwd(), "assets", "fonts", "fonts.conf");
  }
  if (!ready) {
    ready = (async () => {
      await sharp({ text: { text: "🔥", font: "Noto Color Emoji 32", fontfile: overlayEmojiFontFile, rgba: true } }).png().toBuffer();
      await sharp({ text: { text: "Tiếng Việt", font: "Noto Sans Bold 32", fontfile: overlayTextFontFile, rgba: true } }).png().toBuffer();
    })().catch((error) => { ready = undefined; throw error; });
  }
  return ready;
}
