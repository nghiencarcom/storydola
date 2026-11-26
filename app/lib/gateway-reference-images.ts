import sharp from "sharp";

export const GATEWAY_REFERENCE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const GATEWAY_REFERENCE_IMAGES_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
// seedance.maivideo.top sits behind a Next.js proxy with a 10 MiB request body limit.
// Keep inline base64 reference payloads safely below that cap to leave room for prompt & JSON overhead.
export const GATEWAY_INLINE_REQUEST_MAX_ENCODED_BYTES = 8 * 1024 * 1024;
export const DEFAULT_PROVIDER_REQUEST_MAX_ENCODED_BYTES = 4 * 1024 * 1024;
export const DEFAULT_PER_IMAGE_MAX_ENCODED_BYTES = 480 * 1024;
// Google Flow uploads each reference image into a live browser project via Playwright;
// keeping both per-image bytes/dimensions and total batch payload compact prevents upload/attach timeouts.
export const FLOW_INLINE_REQUEST_MAX_ENCODED_BYTES = 1_536 * 1024;
export const FLOW_PER_IMAGE_MAX_ENCODED_BYTES = 200 * 1024;

const MAX_INPUT_PIXELS = 100_000_000;
const COMPRESSION_TIERS = [
  { maxDimension: 1536, quality: 82 },
  { maxDimension: 1280, quality: 78 },
  { maxDimension: 1024, quality: 75 },
  { maxDimension: 896, quality: 68 },
  { maxDimension: 768, quality: 62 },
  { maxDimension: 640, quality: 56 },
  { maxDimension: 512, quality: 50 },
] as const;

type ParsedReferenceImage =
  | { kind: "url"; url: string }
  | { kind: "data"; originalDataUrl: string; mimeType: string; bytes: Buffer };

type InspectedDataImage = {
  kind: "data";
  originalDataUrl: string;
  mimeType: string;
  bytes: Buffer;
  width?: number;
  height?: number;
  orientation?: number;
};

type InspectedReferenceImage = { kind: "url"; url: string } | InspectedDataImage;

function parseGatewayReferenceImages(images: string[], provider: string): ParsedReferenceImage[] {
  let totalDecodedBytes = 0;
  return images.map((image, index) => {
    const trimmed = image.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return { kind: "url", url: trimmed };
    }
    const match = trimmed.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i);
    const mimeType = match?.[1]?.toLowerCase();
    const encoded = match?.[2];
    if (!mimeType || !encoded || encoded.length % 4 !== 0) {
      throw new Error(`${provider}: ảnh tham chiếu ${index + 1} không phải Data URI PNG/JPEG/WebP hợp lệ.`);
    }
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const decodedBytes = Math.floor((encoded.length * 3) / 4) - padding;
    if (decodedBytes <= 0 || decodedBytes > GATEWAY_REFERENCE_IMAGE_MAX_BYTES) {
      throw new Error(`${provider}: mỗi ảnh tham chiếu không được vượt quá 25 MiB.`);
    }
    totalDecodedBytes += decodedBytes;
    if (totalDecodedBytes > GATEWAY_REFERENCE_IMAGES_TOTAL_MAX_BYTES) {
      throw new Error(`${provider}: tổng dung lượng ảnh tham chiếu không được vượt quá 100 MiB.`);
    }
    return {
      kind: "data",
      originalDataUrl: trimmed,
      mimeType,
      bytes: Buffer.from(encoded, "base64"),
    };
  });
}

export function validateGatewayReferenceImageDataUrls(images: string[], provider: string) {
  parseGatewayReferenceImages(images, provider);
}

async function inspectReferenceImages(parsed: ParsedReferenceImage[], provider: string): Promise<InspectedReferenceImage[]> {
  return Promise.all(parsed.map(async (item, index) => {
    if (item.kind === "url") return item;
    try {
      const meta = await sharp(item.bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      return {
        ...item,
        width: meta.width,
        height: meta.height,
        orientation: meta.orientation,
      };
    } catch {
      throw new Error(`${provider}: ảnh tham chiếu ${index + 1} không thể đọc hoặc giải mã.`);
    }
  }));
}

async function compressDataImageAtTier(
  item: InspectedDataImage,
  maxDimension: number,
  quality: number,
): Promise<string> {
  const compressed = await sharp(item.bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(maxDimension, maxDimension, { fit: "inside", withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer();
  const candidate = `data:image/webp;base64,${compressed.toString("base64")}`;
  const alreadyFitsDimension = Boolean(
    item.mimeType !== "image/png"
    && (!item.orientation || item.orientation === 1)
    && item.width && item.height
    && item.width <= maxDimension
    && item.height <= maxDimension,
  );
  if (alreadyFitsDimension && item.originalDataUrl.length < candidate.length) {
    return item.originalDataUrl;
  }
  return candidate;
}

export async function prepareGatewayReferenceImageDataUrls(
  images: string[],
  provider: string,
  maxEncodedBytes?: number,
): Promise<string[]> {
  if (!images.length) return [];
  const parsed = parseGatewayReferenceImages(images, provider);
  if (parsed.every((item) => item.kind === "url")) {
    return parsed.map((item) => item.url);
  }

  const inspected = await inspectReferenceImages(parsed, provider);
  const isFlow = /^flow\b/i.test(provider.trim());
  const dataCount = inspected.filter((item) => item.kind === "data").length;
  const totalBudget = maxEncodedBytes ?? (isFlow ? FLOW_INLINE_REQUEST_MAX_ENCODED_BYTES : DEFAULT_PROVIDER_REQUEST_MAX_ENCODED_BYTES);
  const perImageBudget = maxEncodedBytes !== undefined
    ? maxEncodedBytes
    : isFlow
      ? FLOW_PER_IMAGE_MAX_ENCODED_BYTES
      : DEFAULT_PER_IMAGE_MAX_ENCODED_BYTES;
  const initialMaxDimension = isFlow
    ? (dataCount >= 3 ? 1024 : 1280)
    : (dataCount >= 4 ? 1280 : 1536);
  const tiers = COMPRESSION_TIERS.filter((tier) => tier.maxDimension <= initialMaxDimension);

  const selectedTierIndex = new Array<number>(inspected.length).fill(0);
  const encoded = await Promise.all(inspected.map(async (item, index) => {
    if (item.kind === "url") return item.url;
    let current = "";
    for (let tierIdx = 0; tierIdx < tiers.length; tierIdx += 1) {
      const { maxDimension, quality } = tiers[tierIdx];
      current = await compressDataImageAtTier(item, maxDimension, quality);
      selectedTierIndex[index] = tierIdx;
      if (current.length <= perImageBudget) break;
    }
    return current;
  }));

  let totalEncodedBytes = encoded.reduce((sum, value) => sum + value.length, 0);
  if (totalEncodedBytes <= totalBudget) {
    return encoded;
  }

  for (let minTierIdx = 1; minTierIdx < tiers.length; minTierIdx += 1) {
    const { maxDimension, quality } = tiers[minTierIdx];
    await Promise.all(inspected.map(async (item, index) => {
      if (item.kind === "url" || selectedTierIndex[index] >= minTierIdx) return;
      encoded[index] = await compressDataImageAtTier(item, maxDimension, quality);
      selectedTierIndex[index] = minTierIdx;
    }));
    totalEncodedBytes = encoded.reduce((sum, value) => sum + value.length, 0);
    if (totalEncodedBytes <= totalBudget) {
      return encoded;
    }
  }

  throw new Error(`${provider}: tổng dung lượng ảnh tham chiếu sau khi nén vẫn vượt giới hạn 10 MB của cổng gửi. Hãy giảm bớt số ảnh tham chiếu rồi thử lại.`);
}
