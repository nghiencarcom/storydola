import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { gatewayEndpoint } from "@/lib/config";
import { createPencilSketches, MaiVideoImageGenerationError } from "@/lib/maivideo-image-generation";
import {
  ensureSketchColorRestoration,
  SKETCH_COLOR_RESTORATION_MARKER,
  normalizeCharacterColorDescription,
  stripGeneratedVideoEnvelope
} from "@/lib/seedance-prompt";
import { resolveTaskAccess, taskAccessErrorResponse, taskOwnerHeaders } from "@/lib/task-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DURATIONS = new Set([5, 10, 15]);
const ALLOWED_RATIOS = new Set(["9:16", "16:9", "1:1", "4:3", "3:4"]);
const ALLOWED_MODELS = new Set(["seedance-2.0", "seedance-2.5"]);
const FALLBACK_SUBMIT_CONCURRENCY = 3;
const MAX_PROMPT_CHARS = 12000;
const SINGLE_VIDEO_INSTRUCTION = "Không tách thành nhiều video và không yêu cầu xác nhận";
const REFERENCE_IMAGE_MODES = new Set(["sketch", "none"]);

function inputCount(input) {
  if (Array.isArray(input)) return input.length;
  if (typeof input === "string") return input.split(/\r?\n/).filter((value) => value.trim()).length;
  return 0;
}

function truncatePrompt(value) {
  return Array.from(String(value ?? "")).slice(0, MAX_PROMPT_CHARS).join("");
}


function normalizeVideoPrompt(value, { preserveSketchColors = false, characterColorDescription = "" } = {}) {
  const rawPrompt = stripGeneratedVideoEnvelope(
    String(value ?? "").replace(/Không tách thành nhiều video và không yêu cầu xác nhận/gi, "")
  );
  if (preserveSketchColors || rawPrompt.toLowerCase().includes(SKETCH_COLOR_RESTORATION_MARKER.toLowerCase())) {
    return ensureSketchColorRestoration(rawPrompt, characterColorDescription, MAX_PROMPT_CHARS);
  }
  return truncatePrompt(rawPrompt);
}

function normalizePrompts(input, options) {
  const value = Array.isArray(input)
    ? input.map((item) => String(item ?? "")).join("\n")
    : typeof input === "string"
      ? input
      : "";
  // The Studio sends one prompt. Trim the same way as the UI and silently
  // remove anything beyond Dola's web-composer limit at the API boundary.
  const prompt = normalizeVideoPrompt(value, options);
  return prompt ? [prompt] : [];
}

function normalizeReferenceManifest(referenceInput, nameInput) {
  const values = Array.isArray(referenceInput)
    ? referenceInput
    : typeof referenceInput === "string"
      ? referenceInput.split(/\r?\n/)
      : [];
  const names = Array.isArray(nameInput) ? nameInput : [];
  const seen = new Set();
  const manifest = [];
  values.forEach((value, index) => {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    manifest.push({
      url,
      name: String(names[index] || "").trim()
    });
  });
  return manifest.slice(0, 30);
}

function normalizeReferenceImageMode(body) {
  if (body?.sketchCharacterRefs === true || body?.sketch_character_refs === true
    || body?.createPencilSketch === true || body?.create_pencil_sketch === true) {
    return "sketch";
  }
  const raw = String(
    body?.referenceImageMode
      ?? body?.reference_image_mode
      ?? body?.sketchMode
      ?? body?.sketch_mode
      ?? "none"
  ).trim().toLowerCase();
  if (["sketch", "create", "create_sketch", "pencil", "pencil_sketch"].includes(raw)) {
    return "sketch";
  }
  return REFERENCE_IMAGE_MODES.has(raw) ? raw : "none";
}

function errorMessage(payload, status) {
  if (payload && typeof payload === "object") {
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.error === "string") return payload.error;
    if (typeof payload.message === "string") return payload.message;
  }
  return "Gateway trả về HTTP " + status;
}

function isGatewayTimeout(error) {
  return error?.name === "TimeoutError"
    || error?.code === 23
    || error?.cause?.code === 23;
}

async function submitOne({ prompt, index, model, ratio, duration, references, referenceImageNames, referenceImageMode, ownerId }) {
  const payload = {
    model,
    prompt,
    duration,
    reference_images: references,
    reference_image_names: referenceImageNames,
    reference_image_mode: referenceImageMode
  };
  if (ratio) payload.ratio = ratio;

  try {
    const response = await fetch(gatewayEndpoint("/v1/videos/generations"), {
      method: "POST",
      headers: { ...taskOwnerHeaders(ownerId), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(25000)
    });
    const raw = await response.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw new Error(errorMessage(data, response.status));
    }
    if (!data?.id) {
      throw new Error("Gateway chưa trả về mã tác vụ");
    }
    return {
      index,
      id: String(data.id),
      status: data.status || "queued",
      model: data.model || model,
      duration: Number(data.duration || duration),
      prompt: data.prompt || prompt,
      referenceImageMode: data.reference_image_mode || referenceImageMode,
      provider: "gateway",
      videoUrl: data.video_url || data.videoUrl || null,
      error: null
    };
  } catch (error) {
    return {
      index,
      id: "local_failed_" + crypto.randomUUID().slice(0, 8),
      status: "failed",
      model,
      duration,
      prompt,
      provider: "gateway",
      videoUrl: null,
      error: error?.message || "Không thể gửi tác vụ tới Dola Gateway"
    };
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  const referenceImageMode = normalizeReferenceImageMode(body);
  const referenceManifest = normalizeReferenceManifest(
    body?.referenceImages ?? body?.references,
    body?.referenceImageNames ?? body?.reference_image_names
  );
  const references = referenceManifest.map((item) => item.url);
  const referenceImageNames = referenceManifest.map((item) => item.name);
  const preserveSketchColors = referenceImageMode === "sketch" && references.length > 0;
  const characterColorDescription = normalizeCharacterColorDescription(body?.characterColorDescription);
  const prompts = normalizePrompts(body?.prompts, {
    preserveSketchColors,
    characterColorDescription
  });
  if (!prompts.length) {
    return NextResponse.json({ error: "Hãy nhập ít nhất một prompt" }, { status: 422 });
  }

  const requestedProvider = String(body?.provider || "gateway").toLowerCase();
  // Batch Studio is intentionally backed by the Dola account pool. Keep the
  // provider server-controlled so an old client or a stale browser bundle
  // cannot silently send a batch to the MaiVideo renderer.
  if (requestedProvider !== "gateway") {
    return NextResponse.json(
      { error: "Tạo hàng loạt chỉ sử dụng Dola Gateway đã cấu hình cho workspace." },
      { status: 422 }
    );
  }
  const provider = "gateway";
  const model = String(body?.model || "seedance-2.5").toLowerCase();
  const duration = Number(body?.duration || 15);
  const ratio = body?.ratio ? String(body.ratio) : "9:16";
  if (inputCount(body?.referenceImages ?? body?.references) > 30) {
    return NextResponse.json({ error: "Mỗi batch tối đa 30 ảnh tham chiếu" }, { status: 422 });
  }
  if (!ALLOWED_MODELS.has(model)) {
    return NextResponse.json({ error: "Chỉ hỗ trợ Seedance 2.0 hoặc Seedance 2.5" }, { status: 422 });
  }
  if (!ALLOWED_DURATIONS.has(duration)) {
    return NextResponse.json({ error: "Thời lượng chỉ hỗ trợ 5s, 10s hoặc 15s" }, { status: 422 });
  }
  if (!ALLOWED_RATIOS.has(ratio)) {
    return NextResponse.json({ error: "Tỷ lệ khung hình không hợp lệ" }, { status: 422 });
  }

  const access = await resolveTaskAccess(request);
  if (!access.ok) return taskAccessErrorResponse(NextResponse, access);

  let generationReferences = references;
  if (referenceImageMode === "sketch" && references.length) {
    try {
      generationReferences = await createPencilSketches({
        referenceUrls: references,
        request,
        sessionId: access.user?.session_id
      });
    } catch (error) {
      const status = error instanceof MaiVideoImageGenerationError
        ? Math.min(Math.max(Number(error.status) || 502, 400), 599)
        : 502;
      return NextResponse.json(
        {
          error: error?.message || "Không thể tạo ảnh chì đen trắng cho ảnh tham chiếu.",
          code: error?.code || "MAIVIDEO_IMAGE_GENERATION_FAILED",
          referenceImageMode
        },
        { status }
      );
    }
  }

  const startedAt = new Date().toISOString();
  const batchId = "batch_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  console.info(
    "[Dola batches] Gateway",
    JSON.stringify({
      batchId,
      prompts: prompts.length,
      model,
      duration,
      ratio,
      referenceImageMode,
      referenceCount: generationReferences.length
    })
  );
  let jobs;
  let gatewayBatchId = batchId;
  let nativeBatch = false;
  try {
    const bulkResponse = await fetch(gatewayEndpoint("/v1/videos/batches"), {
      method: "POST",
      headers: {
        ...taskOwnerHeaders(access.ownerId, request),
        "Content-Type": "application/json",
        "X-Dola-Batch-Id": batchId
      },
      body: JSON.stringify({
        prompts,
        model,
        duration,
        ratio,
        reference_images: generationReferences,
        reference_image_names: referenceImageNames.slice(0, generationReferences.length),
        reference_image_mode: referenceImageMode
      }),
      cache: "no-store",
      // A batch admission request should be quick; rendering continues in the
      // Gateway after the response is returned.
      signal: AbortSignal.timeout(30000)
    });
    if (bulkResponse.status === 404 || bulkResponse.status === 405) {
      // Compatibility with a Gateway process that predates the native batch
      // endpoint. Do not use this fallback for network timeouts: the request
      // may already have been admitted and retrying could duplicate tasks.
      jobs = await mapWithConcurrency(
        prompts,
        FALLBACK_SUBMIT_CONCURRENCY,
        (prompt, index) => submitOne({
          prompt,
          index,
          model,
          ratio,
          duration,
          references: generationReferences,
          referenceImageNames: referenceImageNames.slice(0, generationReferences.length),
          referenceImageMode,
          ownerId: access.ownerId
        })
      );
    } else {
      // Keep body consumption inside the same timeout boundary as fetch(). A
      // Gateway can send headers and then stall while the response body is
      // being read; letting this throw outside the catch produces Next's
      // opaque "failed to pipe response" error.
      const raw = await bulkResponse.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { error: raw.slice(0, 300) };
      }
      if (!bulkResponse.ok) {
        return NextResponse.json(
          { error: errorMessage(data, bulkResponse.status) },
          { status: bulkResponse.status }
        );
      }
      const nativeJobs = Array.isArray(data.jobs) ? data.jobs : [];
      if (!nativeJobs.length) {
        return NextResponse.json(
          { error: "Gateway chưa trả về tác vụ nào trong batch" },
          { status: 502 }
        );
      }
      gatewayBatchId = String(data.batch_id || data.batchId || batchId);
      nativeBatch = true;
      jobs = nativeJobs.map((job, index) => ({
        index,
        id: String(job.id || ""),
        status: job.status || "queued",
        model: job.model || model,
        duration: Number(job.duration || duration),
        prompt: job.prompt || prompts[index],
        referenceImageMode: job.reference_image_mode || job.referenceImageMode || referenceImageMode,
        provider: "gateway",
        videoUrl: job.video_url || job.videoUrl || null,
        error: job.error || null
      }));
    }
  } catch (error) {
    // A timeout is deliberately not retried because the Gateway may have
    // admitted the batch just before the connection was lost. Return a
    // structured response so the UI can inspect/reconcile the batch instead
    // of making Next try to pipe an uncaught aborted stream.
    const timedOut = isGatewayTimeout(error);
    console.error(
      `[Dola batches] Gateway batch ${batchId} failed after admission request:`,
      error?.stack || error?.message || error
    );
    return NextResponse.json(
      {
        batchId,
        acceptedUnknown: timedOut,
        retryable: timedOut,
        code: timedOut ? "GATEWAY_BATCH_TIMEOUT" : "GATEWAY_BATCH_REQUEST_FAILED",
        error: timedOut
          ? "Gateway không phản hồi kịp thời khi nhận batch; batch có thể đã được tiếp nhận, hãy kiểm tra trạng thái trước khi gửi lại."
          : error?.message || "Không thể kết nối Dola Gateway"
      },
      { status: timedOut ? 504 : 502 }
    );
  }
  const accepted = jobs.filter((job) => job.status !== "failed").length;

  return NextResponse.json({
    batchId: gatewayBatchId,
    submittedAt: startedAt,
    config: {
      provider,
      model,
      duration,
      ratio,
      referenceCount: generationReferences.length,
      sourceReferenceCount: references.length,
      referenceImageMode,
      characterColorDescription: preserveSketchColors ? characterColorDescription : "",
      referenceImages: generationReferences,
      referenceImageNames: referenceImageNames.slice(0, generationReferences.length),
      admission: nativeBatch ? "atomic" : "per_prompt"
    },
    summary: { total: jobs.length, accepted, failed: jobs.length - accepted },
    jobs
  });
}
