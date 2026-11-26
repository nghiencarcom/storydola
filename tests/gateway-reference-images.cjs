const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const sharp = require("sharp");

function loadModule(name, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "app", "lib", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    Buffer,
    Promise,
    require: (id) => imports[id] ?? require(id),
  });
  return exports;
}

const {
  FLOW_INLINE_REQUEST_MAX_ENCODED_BYTES,
  FLOW_PER_IMAGE_MAX_ENCODED_BYTES,
  GATEWAY_INLINE_REQUEST_MAX_ENCODED_BYTES,
  prepareGatewayReferenceImageDataUrls,
  validateGatewayReferenceImageDataUrls,
} = loadModule("gateway-reference-images");

(async () => {
  assert.deepEqual(Array.from(await prepareGatewayReferenceImageDataUrls([], "Muse.ai")), []);

  // Pass through public URLs untouched.
  const urls = ["https://example.com/a.png"];
  assert.deepEqual(Array.from(await prepareGatewayReferenceImageDataUrls(urls, "Muse.ai")), urls);

  // Reject invalid data URIs.
  assert.throws(
    () => validateGatewayReferenceImageDataUrls(["data:text/plain;base64,SGVsbG8="], "Muse.ai"),
    /Muse\.ai: ảnh tham chiếu 1/,
  );

  // Compress large 2K PNGs into WebP well below the encoded payload budget.
  const width = 2400;
  const height = 1350;
  const rawPixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < rawPixels.length; i += 3) {
    rawPixels[i] = (i * 13) & 255;
    rawPixels[i + 1] = (i * 29) & 255;
    rawPixels[i + 2] = (i * 53) & 255;
  }
  const largePng = await sharp(rawPixels, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const largePngDataUrl = `data:image/png;base64,${largePng.toString("base64")}`;
  assert.ok(largePngDataUrl.length > 10 * 1024 * 1024, "Test fixture PNG should exceed 10 MiB as base64");

  const prepared = await prepareGatewayReferenceImageDataUrls([largePngDataUrl, largePngDataUrl], "Muse.ai");
  assert.equal(prepared.length, 2);
  for (const item of prepared) {
    assert.ok(item.startsWith("data:image/webp;base64,"), "Compressed reference should be WebP Data URI");
  }
  const totalBytes = prepared.reduce((sum, item) => sum + item.length, 0);
  assert.ok(totalBytes <= GATEWAY_INLINE_REQUEST_MAX_ENCODED_BYTES, `Total encoded bytes ${totalBytes} should stay within budget`);

  // Multi-image Google Flow batch (5+ high-res references) must compress every image <= 1024px & compact bytes.
  const oversizedJpeg = await sharp({
    create: { width: 2400, height: 2400, channels: 3, background: { r: 220, g: 185, b: 120 } },
  }).jpeg({ quality: 50 }).toBuffer();
  const oversizedJpegDataUrl = `data:image/jpeg;base64,${oversizedJpeg.toString("base64")}`;
  assert.ok(oversizedJpeg.length < 250 * 1024, "Fixture JPEG has small byte size despite 2400x2400 dimensions");

  const flowBatch = await prepareGatewayReferenceImageDataUrls([
    largePngDataUrl,
    largePngDataUrl,
    largePngDataUrl,
    largePngDataUrl,
    oversizedJpegDataUrl,
  ], "Flow");
  assert.equal(flowBatch.length, 5);
  const flowTotalBytes = flowBatch.reduce((sum, item) => sum + item.length, 0);
  assert.ok(flowTotalBytes <= FLOW_INLINE_REQUEST_MAX_ENCODED_BYTES, `Flow 5-image batch ${flowTotalBytes} must stay within ${FLOW_INLINE_REQUEST_MAX_ENCODED_BYTES}`);
  for (const item of flowBatch) {
    assert.ok(item.length <= FLOW_PER_IMAGE_MAX_ENCODED_BYTES, `Each Flow image (${item.length}) must fit per-image budget (${FLOW_PER_IMAGE_MAX_ENCODED_BYTES})`);
    const encoded = item.split(",")[1];
    const meta = await sharp(Buffer.from(encoded, "base64")).metadata();
    assert.ok(meta.width <= 1024 && meta.height <= 1024, `Flow multi-image dimensions (${meta.width}x${meta.height}) must be <= 1024px`);
  }

  // Adaptive compression should shrink further when budget is tight.
  const tightPrepared = await prepareGatewayReferenceImageDataUrls([largePngDataUrl], "Muse.ai", 300 * 1024);
  assert.ok(tightPrepared[0].length <= 300 * 1024, `Tight budget output ${tightPrepared[0].length} should fit 300 KiB`);

  // Fail clearly if even maximum compression cannot fit the budget.
  await assert.rejects(
    () => prepareGatewayReferenceImageDataUrls([largePngDataUrl], "Muse.ai", 100),
    /vượt giới hạn 10 MB/,
  );

  console.log("Passed gateway reference image validation, Flow multi-image compression, and budget tests.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
