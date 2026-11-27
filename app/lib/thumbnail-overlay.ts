import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { ensureOverlayFonts, overlayTextFontFile } from "./overlay-fonts";

export type ThumbnailOverlayPlacement = "top-left" | "top-right" | "left" | "right" | "bottom";

function normalizeLayoutText(value?: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePango(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

export function resolveThumbnailOverlayPlacement(layoutNote?: string, prompt?: string): ThumbnailOverlayPlacement {
  const candidates = [normalizeLayoutText(layoutNote), normalizeLayoutText(prompt)].filter(Boolean);
  for (const text of candidates) {
    if (/(?:phia )?tren(?: ben)? trai|upper[- ]left|top[- ]left/.test(text)) return "top-left";
    if (/(?:phia )?tren(?: ben)? phai|upper[- ]right|top[- ]right/.test(text)) return "top-right";
    if (/ben trai|nua trai|on the left|left side|empty.*left|space on the left/.test(text)) return "left";
    if (/ben phai|nua phai|on the right|right side|empty.*right|space on the right/.test(text)) return "right";
    if (/phia duoi|ben duoi|bottom/.test(text)) return "bottom";
  }
  return "right";
}

export function shouldUseRedOverlayBadge(layoutNote?: string): boolean {
  const normalized = normalizeLayoutText(layoutNote);
  return /mang nen do|de do|nen do|khung do|red badge|red box|red banner/.test(normalized);
}

export function splitThumbnailOverlayLines(text: string): string[] {
  const words = String(text || "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.toLocaleUpperCase("vi-VN"));
  if (!words.length) return [];
  if (words.length === 1) return [words[0]];
  const joined = words.join(" ");
  if (words.length === 2 && joined.length <= 11) return [joined];
  let bestSplit = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const leftLen = words.slice(0, i).join(" ").length;
    const rightLen = words.slice(i).join(" ").length;
    const diff = Math.abs(leftLen - rightLen);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestSplit = i;
    }
  }
  return [words.slice(0, bestSplit).join(" "), words.slice(bestSplit).join(" ")];
}

function buildLineMarkup(words: string[], highlightFinalWord: boolean, finalLine: boolean, forceColor?: string) {
  if (forceColor) {
    return `<span foreground="${forceColor}">${escapePango(words.join(" "))}</span>`;
  }
  if (!highlightFinalWord) {
    return `<span foreground="#FFFFFF">${escapePango(words.join(" "))}</span>`;
  }
  if (words.length === 1) {
    const color = finalLine ? "#FFE135" : "#FFFFFF";
    return `<span foreground="${color}">${escapePango(words[0])}</span>`;
  }
  const head = words.slice(0, -1).join(" ");
  const tail = words[words.length - 1];
  return `<span foreground="#FFFFFF">${escapePango(head)} </span><span foreground="#FFE135">${escapePango(tail)}</span>`;
}

function scrimSvg(width: number, height: number, placement: ThumbnailOverlayPlacement) {
  if (placement === "top-left" || placement === "left") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#05070e" stop-opacity="0.72"/>
        <stop offset="55%" stop-color="#05070e" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="#05070e" stop-opacity="0"/>
      </linearGradient></defs>
      <rect x="0" y="0" width="${Math.round(width * 0.65)}" height="${height}" fill="url(#g)"/>
    </svg>`;
  }
  if (placement === "top-right" || placement === "right") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs><linearGradient id="g" x1="100%" y1="0%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#05070e" stop-opacity="0.72"/>
        <stop offset="55%" stop-color="#05070e" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="#05070e" stop-opacity="0"/>
      </linearGradient></defs>
      <rect x="${Math.round(width * 0.35)}" y="0" width="${Math.round(width * 0.65)}" height="${height}" fill="url(#g)"/>
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#05070e" stop-opacity="0.78"/>
      <stop offset="65%" stop-color="#05070e" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#05070e" stop-opacity="0"/>
    </linearGradient></defs>
    <rect x="0" y="${Math.round(height * 0.48)}" width="${width}" height="${Math.round(height * 0.52)}" fill="url(#g)"/>
  </svg>`;
}

export async function renderThumbnailOverlay(input: {
  baseImagePath: string;
  outputPath: string;
  overlayText: string;
  layoutNote?: string;
  prompt?: string;
}) {
  const lines = splitThumbnailOverlayLines(input.overlayText);
  if (!lines.length) {
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    await sharp(input.baseImagePath).png().toFile(input.outputPath);
    return input.outputPath;
  }

  await ensureOverlayFonts();
  const meta = await sharp(input.baseImagePath).metadata();
  const width = meta.width || 1280;
  const height = meta.height || 720;
  const placement = resolveThumbnailOverlayPlacement(input.layoutNote, input.prompt);
  const useRedBadge = shouldUseRedOverlayBadge(input.layoutNote);

  const marginX = Math.round(width * 0.055);
  const marginY = Math.round(height * 0.08);
  const maxZoneWidth = placement === "bottom"
    ? Math.round(width * 0.84)
    : Math.round(width * 0.44);
  const baseFontSize = Math.max(42, Math.min(138, Math.round(height * (lines.length === 1 ? 0.145 : 0.125))));
  const totalWords = lines.join(" ").split(/\s+/u).filter(Boolean).length;

  const renderedLines: Array<{
    fg: Buffer;
    outline: Buffer;
    width: number;
    height: number;
  }> = [];

  for (const [index, line] of lines.entries()) {
    const words = line.split(/\s+/u).filter(Boolean);
    const isFinalLine = index === lines.length - 1;
    const highlightWord = totalWords === 1 || isFinalLine;
    const fgMarkup = buildLineMarkup(words, highlightWord, isFinalLine);
    const outlineMarkup = buildLineMarkup(words, false, isFinalLine, "#0B0F1A");

    const fgRaw = await sharp({
      text: {
        text: fgMarkup,
        font: `Noto Sans Bold ${baseFontSize}`,
        fontfile: overlayTextFontFile,
        rgba: true,
      },
    }).png().toBuffer({ resolveWithObject: true });

    const outlineRaw = await sharp({
      text: {
        text: outlineMarkup,
        font: `Noto Sans Bold ${baseFontSize}`,
        fontfile: overlayTextFontFile,
        rgba: true,
      },
    }).png().toBuffer({ resolveWithObject: true });

    if (fgRaw.info.width > maxZoneWidth) {
      const targetWidth = Math.max(100, maxZoneWidth);
      const fgScaled = await sharp(fgRaw.data).resize({ width: targetWidth }).png().toBuffer({ resolveWithObject: true });
      const outlineScaled = await sharp(outlineRaw.data).resize({ width: targetWidth, height: fgScaled.info.height }).png().toBuffer({ resolveWithObject: true });
      renderedLines.push({ fg: fgScaled.data, outline: outlineScaled.data, width: fgScaled.info.width, height: fgScaled.info.height });
    } else {
      renderedLines.push({ fg: fgRaw.data, outline: outlineRaw.data, width: fgRaw.info.width, height: fgRaw.info.height });
    }
  }

  const lineGap = Math.round(baseFontSize * 0.14);
  const blockWidth = Math.max(...renderedLines.map((line) => line.width));
  const blockHeight = renderedLines.reduce((sum, line) => sum + line.height, 0) + lineGap * (renderedLines.length - 1);
  const badgePadX = useRedBadge ? Math.round(baseFontSize * 0.34) : 0;
  const badgePadY = useRedBadge ? Math.round(baseFontSize * 0.24) : 0;

  let blockLeft: number;
  if (placement === "top-left" || placement === "left") {
    blockLeft = marginX + badgePadX;
  } else if (placement === "top-right" || placement === "right") {
    blockLeft = Math.max(marginX + badgePadX, width - marginX - blockWidth - badgePadX);
  } else {
    blockLeft = Math.round((width - blockWidth) / 2);
  }

  let blockTop: number;
  if (placement === "top-left" || placement === "top-right") {
    blockTop = marginY + badgePadY;
  } else if (placement === "bottom") {
    blockTop = Math.max(marginY + badgePadY, height - marginY - blockHeight - badgePadY);
  } else {
    blockTop = Math.round((height - blockHeight) / 2);
  }

  const composites: OverlayOptions[] = [
    { input: Buffer.from(scrimSvg(width, height, placement)), left: 0, top: 0 },
  ];

  if (useRedBadge) {
    const boxX = Math.max(0, blockLeft - badgePadX);
    const boxY = Math.max(0, blockTop - badgePadY);
    const boxW = Math.min(width - boxX, blockWidth + badgePadX * 2);
    const boxH = Math.min(height - boxY, blockHeight + badgePadY * 2);
    const radius = Math.round(baseFontSize * 0.24);
    const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${boxX + 4}" y="${boxY + 6}" width="${boxW}" height="${boxH}" rx="${radius}" fill="#05070e" fill-opacity="0.55"/>
      <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${radius}" fill="#D92121" fill-opacity="0.94" stroke="#ffffff" stroke-opacity="0.24" stroke-width="2"/>
    </svg>`;
    composites.push({ input: Buffer.from(badgeSvg), left: 0, top: 0 });
  }

  const outlinePx = Math.max(4, Math.round(baseFontSize * 0.085));
  const diagPx = Math.max(3, Math.round(outlinePx * 0.72));
  const outlineOffsets: Array<[number, number]> = [
    [-outlinePx, 0],
    [outlinePx, 0],
    [0, -outlinePx],
    [0, outlinePx],
    [-diagPx, -diagPx],
    [diagPx, -diagPx],
    [-diagPx, diagPx],
    [diagPx, diagPx],
  ];

  let cursorY = blockTop;
  for (const line of renderedLines) {
    const lineLeft = placement === "bottom"
      ? Math.round(blockLeft + (blockWidth - line.width) / 2)
      : placement === "right" || placement === "top-right"
        ? Math.round(blockLeft + (blockWidth - line.width))
        : blockLeft;

    const shadowBuf = await sharp(line.outline)
      .blur(Math.max(3, Math.round(baseFontSize * 0.08)))
      .toBuffer();
    composites.push({
      input: shadowBuf,
      left: Math.max(0, Math.min(width - 1, lineLeft + 4)),
      top: Math.max(0, Math.min(height - 1, cursorY + 6)),
    });

    for (const [dx, dy] of outlineOffsets) {
      composites.push({
        input: line.outline,
        left: Math.max(0, Math.min(width - 1, lineLeft + dx)),
        top: Math.max(0, Math.min(height - 1, cursorY + dy)),
      });
    }

    composites.push({
      input: line.fg,
      left: Math.max(0, Math.min(width - 1, lineLeft)),
      top: Math.max(0, Math.min(height - 1, cursorY)),
    });

    cursorY += line.height + lineGap;
  }

  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await sharp(input.baseImagePath)
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toFile(input.outputPath);
  return input.outputPath;
}
