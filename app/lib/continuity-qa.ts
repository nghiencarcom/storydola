import type { ContinuityQaIssue, ContinuityQaReport, SceneAiCheckStatus, StoryProject } from "./project-types";
import { readProjectScenes } from "./scene-store";

type SceneRecord = Record<string, unknown>;

function recordValue(value: unknown): SceneRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SceneRecord : {};
}

function textValue(scene: SceneRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = scene[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberValue(scene: SceneRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(scene[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function tokens(value: string) {
  const stopWords = new Set([
    "the", "and", "that", "this", "with", "from", "into", "then", "they", "there", "were", "have", "been",
    "một", "và", "của", "trong", "với", "được", "những", "đến", "người", "sau", "này", "đó", "rồi", "khi",
    "scene", "continuity", "narrator", "bối", "cảnh", "tiếp",
  ]);
  return new Set(
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu)?.filter((token) => !stopWords.has(token)) || [],
  );
}

function sharedTokenCount(left: string, right: string) {
  const rightTokens = tokens(right);
  let shared = 0;
  for (const token of tokens(left)) if (rightTokens.has(token)) shared += 1;
  return shared;
}

function issue(issues: ContinuityQaIssue[], value: ContinuityQaIssue) {
  if (issues.length < 120) issues.push(value);
}

export async function buildContinuityQaReport(project: StoryProject): Promise<ContinuityQaReport> {
  const scenes = await readProjectScenes(project);
  const issues: ContinuityQaIssue[] = [];
  const checks: Record<string, SceneAiCheckStatus> = {};
  const expected = Math.max(0, Number(project.totalScenes) || 0);
  const targetDuration = Math.min(15, Math.max(1, Number(project.sceneDurationSec) || 15));

  if (scenes.length === expected) checks.scene_count = "pass";
  else {
    checks.scene_count = scenes.length < expected ? "warning" : "fail";
    issue(issues, {
      code: "scene_count",
      severity: scenes.length < expected ? "warning" : "fail",
      message: `Project có ${scenes.length}/${expected} cảnh; cần hoàn tất output trước khi xuất bản.`,
    });
  }

  const ids = new Set<string>();
  let orderOkay = true;
  let timingOkay = true;
  let fieldsOkay = true;
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = recordValue(scenes[index]);
    const id = String(scene.id || `S${String(index + 1).padStart(3, "0")}`);
    const sceneNumber = Number(id.replace(/\D/g, ""));
    if (ids.has(id)) {
      orderOkay = false;
      issue(issues, { code: "duplicate_scene_id", severity: "fail", sceneId: id, message: `${id} bị trùng trong nhiều chunk.` });
    }
    ids.add(id);
    if (sceneNumber !== index + 1) {
      orderOkay = false;
      issue(issues, { code: "scene_order", severity: "fail", sceneId: id, message: `Thứ tự cảnh ${id} không khớp vị trí ${index + 1}; có thể làm sai nối timeline.` });
    }

    const start = numberValue(scene, "start_sec", "startSec");
    const end = numberValue(scene, "end_sec", "endSec");
    const duration = start !== undefined && end !== undefined ? end - start : undefined;
    if (duration === undefined || duration <= 0 || duration > targetDuration + 0.25) {
      timingOkay = false;
      issue(issues, { code: "timing", severity: "fail", sceneId: id, message: `${id} có thời lượng không hợp lệ hoặc vượt ${targetDuration}s.` });
    }
    const expectedStart = index * targetDuration;
    if (start !== undefined && Math.abs(start - expectedStart) > 0.6) {
      timingOkay = false;
      issue(issues, { code: "timeline_gap", severity: "warning", sceneId: id, message: `${id} bắt đầu ở ${start.toFixed(1)}s thay vì khoảng ${expectedStart.toFixed(1)}s; renderer sẽ chuẩn hóa lại timeline.` });
    }

    const continuityIn = textValue(scene, "continuity_in", "continuityIn");
    const continuityOut = textValue(scene, "continuity_out", "continuityOut");
    if (!continuityIn || !continuityOut) {
      fieldsOkay = false;
      issue(issues, { code: "continuity_fields", severity: "fail", sceneId: id, message: `${id} thiếu continuity_in hoặc continuity_out.` });
    }
  }

  for (let index = 0; index < scenes.length - 1; index += 1) {
    const current = recordValue(scenes[index]);
    const next = recordValue(scenes[index + 1]);
    const currentId = String(current.id || `S${String(index + 1).padStart(3, "0")}`);
    const nextId = String(next.id || `S${String(index + 2).padStart(3, "0")}`);
    const out = textValue(current, "continuity_out", "continuityOut");
    const incoming = textValue(next, "continuity_in", "continuityIn");
    if (!out || !incoming) continue;
    // A lexical mismatch inside one chunk is often a valid story beat. Keep
    // the strict signal for chunk boundaries, where the hand-off context is
    // the part that must remain connected across provider calls.
    if (current.chunkId !== next.chunkId && sharedTokenCount(out, incoming) === 0) {
      issue(issues, {
        code: current.chunkId !== next.chunkId ? "chunk_boundary_context" : "continuity_overlap",
        severity: "warning",
        sceneId: currentId,
        nextSceneId: nextId,
        message: `${currentId} → ${nextId} không có từ khóa continuity chung; cần xem lại chuyển cảnh bằng mắt/nghe voice.`,
      });
    }
  }

  checks.scene_order = orderOkay ? "pass" : "fail";
  checks.timing = timingOkay ? "pass" : "fail";
  checks.continuity_fields = fieldsOkay ? "pass" : "fail";
  checks.boundaries = !issues.some((item) => item.code === "chunk_boundary_context") ? "pass" : "warning";
  const failures = issues.filter((item) => item.severity === "fail").length;
  const warnings = issues.filter((item) => item.severity === "warning").length;
  const score = Math.max(0, 100 - failures * 18 - warnings * 2);
  return {
    status: failures > 0 ? "needs_changes" : "passed",
    score,
    sceneCount: scenes.length,
    expectedSceneCount: expected,
    issueCount: issues.length,
    checks,
    issues,
    createdAt: new Date().toISOString(),
  };
}
