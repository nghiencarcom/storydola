const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "storyai-remake-"));
const source = path.join(root, "reference.mp4");
const requests = [];
function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../app/lib", name + ".ts"), "utf8");
  const context = {
    exports: {}, require: (name) => dependencies[name] ?? require(name),
    process, Buffer, File, FormData, URL, AbortSignal,
    fetch: async (url, options) => {
      const pathname = new URL(url).pathname;
      requests.push({ pathname, ...options });
      if (pathname === "/output.mp4") return new Response(fs.readFileSync(sourceVideo));
      if (pathname.endsWith("/image/upload")) return new Response('{"ErrCode":0,"Resp":{"img_id":1234567890123456789}}');
      if (pathname.endsWith("/media/upload")) return new Response('{"ErrCode":0,"Resp":{"media_id":1234567890123456790}}');
      if (pathname.endsWith("/fusion/generate")) return new Response('{"ErrCode":0,"Resp":{"video_id":1234567890123456791}}');
      if (pathname.endsWith("/result/1234567890123456791")) return new Response('{"ErrCode":0,"Resp":{"status":1,"url":"https://mock.test/output.mp4"}}');
      throw new Error("Unexpected path: " + pathname);
    },
  };
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  vm.runInNewContext(outputText, context);
  return context.exports;
}

const sourceVideo = source;
(async () => {
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=180x320:r=24:d=7",
    "-f", "lavfi", "-i", "color=c=blue:s=180x320:r=24:d=9", "-f", "lavfi", "-i", "sine=d=16",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a:0",
    "-c:v", "libx264", "-c:a", "aac", source]);
  const { salesVideoCreativeTemplates, salesVideoModelOptions } = load("sales-video-templates");
  const { createCreativeSalesVideo } = load("sales-video-creative", {
    "./pixverse-sales-video": load("pixverse-sales-video"),
    "./sales-video-storage": { salesVideoPath: (user, id) => path.join(root, user, id, "video.mp4") },
    "./media-generation-settings": { videoDurationOptions: () => [5, 10, 15] },
    "./media-provider": { generateSalesVideoSegment: () => { throw new Error("Unexpected provider"); } },
  });
  const template = salesVideoCreativeTemplates.find((template) => template.id === "ad-remake");
  assert.deepEqual(Array.from(salesVideoModelOptions(template)), ["pixverse-omni"]);
  const input = {
    id: "remake", userId: "test", template, images: ["data:image/webp;base64,YQ=="],
    video: new File([fs.readFileSync(source)], "source.mp4"), model: "pixverse-omni",
    seconds: 10, sourceStart: 4, ratio: "9:16", pixverseKey: "test", providerAuthToken: "test",
    prompt: "", signal: new AbortController().signal,
  };
  await createCreativeSalesVideo(input);
  const fusion = requests.find((request) => request.pathname.endsWith("/fusion/generate")).body;
  assert.match(fusion, /"img_id":1234567890123456789/);
  assert.match(fusion, /"video_media_id":1234567890123456790/);
  assert.match(fusion, /"duration":0/);
  assert.match(fusion, /Keep the original cuts at approximately 3\.00 seconds/);
  const result = path.join(root, "test", "remake", "video.mp4");
  const metadata = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", result]));
  assert(Math.abs(Number(metadata.format.duration) - 10) < 0.1);
  assert(metadata.streams.some((stream) => stream.codec_type === "audio"));
  assert.deepEqual(fs.readdirSync(path.dirname(result)), ["video.mp4"]);
  const requestCount = requests.length;
  await assert.rejects(createCreativeSalesVideo({ ...input, id: "short", sourceStart: 9 }), /ngắn hơn/);
  assert.equal(requests.length, requestCount);
  console.log("Passed PixVerse remake range, resource IDs, audio, cleanup and invalid duration.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fs.rmSync(root, { recursive: true, force: true }));
