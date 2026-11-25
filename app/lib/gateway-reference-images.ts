import sharp from "sharp";

export const GATEWAY_REFERENCE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const GATEWAY_REFERENCE_IMAGES_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
// seedance.maivideo.top sits behind a Next.js proxy with a 10 MiB request body limit.
// Keep inline base64 reference payloads safely below that cap to leave room for prompt & JSON overhead.
export const GATEWAY_INLINE_REQUEST_MAX_ENCODED_BYTES = 8 * 1024 * 1024;

const SMALL_COMPRESSED_IMAGE_BYTES = 250 * 1024;
const COMPRESSION_TIERS = [
  { maxDimension: 1920, quality: 86 },
  { maxDimension: 1536, quality: 80 },
  { maxDimension: 1280, quality: 74 },
  { maxDimension: 1024, quality: 68 },
  { maxDimension: 768, quality: 60 },
] as const;

type ParsedReferenceImage =
  | { kind: "url"; url: string }
  | { kind: "data"; originalDataUrl: string; mimeType: string; bytes: Buffer };

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

async function compressDataImageToWebp(bytes: Buffer, maxDimension: number, quality: number) {
  const compressed = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(maxDimension, maxDimension, { fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
  return `data:image/webp;base64,${compressed.toString("base64")}`;
}

export async function prepareGatewayReferenceImageDataUrls(
  images: string[],
  provider: string,
  maxEncodedBytes = GATEWAY_INLINE_REQUEST_MAX_ENCODED_BYTES,
): Promise<string[]> {
  if (!images.length) return [];
  const parsed = parseGatewayReferenceImages(images, provider);
  if (parsed.every((item) => item.kind === "url")) {
    return parsed.map((item) => item.url);
  }

  for (let tierIndex = 0; tierIndex < COMPRESSION_TIERS.length; tierIndex += 1) {
    const { maxDimension, quality } = COMPRESSION_TIERS[tierIndex];
    const encoded = await Promise.all(parsed.map(async (item) => {
      if (item.kind === "url") return item.url;
      if (tierIndex === 0 && item.mimeType !== "image/png" && item.bytes.length <= SMALL_COMPRESSED_IMAGE_BYTES) {
        return item.originalDataUrl;
      }
      try {
        const candidate = await compressDataImageToWebp(item.bytes, maxDimension, quality);
        return candidate.length < item.originalDataUrl.length ? candidate : item.originalDataUrl;
      } catch {
        return item.originalDataUrl;
      }
    }));
    const totalEncodedBytes = encoded.reduce((sum, value) => sum + value.length, 0);
    if (totalEncodedBytes <= maxEncodedBytes) {
      return encoded;
    }
  }

  throw new Error(`${provider}: tổng dung lượng ảnh tham chiếu sau khi nén vẫn vượt giới hạn 10 MB của cổng gửi. Hãy giảm bớt số ảnh tham chiếu rồi thử lại.`);
}
