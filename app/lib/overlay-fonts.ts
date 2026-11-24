import path from "node:path";
import sharp from "sharp";

export const overlayTextFontFile = path.join(process.cwd(), "assets", "fonts", "NotoSans-Bold.ttf");
export const overlayEmojiFontFile = path.join(process.cwd(), "assets", "fonts", "NotoColorEmoji.ttf");
let ready: Promise<void> | undefined;

/** Register bundled fonts with Pango, without installing fonts on the host. */
export function ensureOverlayFonts() {
  if (!ready) {
    ready = (async () => {
      await sharp({ text: { text: "🔥", font: "Noto Color Emoji 32", fontfile: overlayEmojiFontFile, rgba: true } }).png().toBuffer();
      await sharp({ text: { text: "Tiếng Việt", font: "Noto Sans Bold 32", fontfile: overlayTextFontFile, rgba: true } }).png().toBuffer();
    })().catch((error) => { ready = undefined; throw error; });
  }
  return ready;
}
