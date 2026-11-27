import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { dataPath } from "../../../../../lib/data-directory";
import { normalizeEntityName } from "../../../../../lib/entity-name";
import { readMaiVideoAuthCookie } from "../../../../../lib/maivideo-auth-shared";
import { isFlowImageModel, isMuseImageModel, resolveMediaGenerationSettings } from "../../../../../lib/media-generation-settings";
import { generateMaiVideoThumbnailImage } from "../../../../../lib/media-provider";
import type { MediaGenerationSettings, StoryProject, ThumbnailImageAsset, VideoPublishingSet } from "../../../../../lib/project-types";
import { readProjectScenes } from "../../../../../lib/scene-store";
import { makeActivity, now, readData, readProjectForMedia, updateData } from "../../../../../lib/server-store";
import { renderThumbnailOverlay } from "../../../../../lib/thumbnail-overlay";

export const runtime = "nodejs";

function safeSegment(value: string, fallback: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || fallback;
}

function resolvePublishingSet(project: StoryProject, scope: string): VideoPublishingSet | undefined {
  return scope === "series"
    ? project.publishingPackage?.series
    : project.publishingPackage?.episodes?.[scope];
}

function safeThumbnailRoot(projectSlug: string) {
  return dataPath("media", safeSegment(projectSlug, "project"), "thumbnails");
}

function thumbnailUrl(slug: string, scope: string, index: number, variant: "final" | "base" = "final") {
  return `/api/projects/${encodeURIComponent(slug)}/publishing-package/thumbnail?scope=${encodeURIComponent(scope)}&index=${index}&variant=${variant}`;
}

async function computeCharacterImportanceScores(
  project: StoryProject,
  scope: string,
  scenes: Array<Record<string, unknown> & { id: string; chunkId: string }>,
): Promise<Record<string, number>> {
  const scores: Record<string, number> = {};
  const scopedScenes = scope === "series" ? scenes : scenes.filter((scene) => scene.chunkId === scope);

  for (const scene of scopedScenes) {
    const rawIds = scene.characterIds ?? scene.character_ids;
    if (Array.isArray(rawIds)) {
      for (const id of rawIds) {
        const cleanId = String(id || "").trim();
        if (cleanId) scores[cleanId] = (scores[cleanId] || 0) + 2;
      }
    }
    const rawDialogue = scene.dialogueSegments ?? scene.dialogue_segments;
    if (Array.isArray(rawDialogue)) {
      for (const seg of rawDialogue) {
        if (seg && typeof seg === "object" && !Array.isArray(seg)) {
          const speakerId = String((seg as Record<string, unknown>).speakerCharacterId || (seg as Record<string, unknown>).speaker_character_id || "").trim();
          if (speakerId) scores[speakerId] = (scores[speakerId] || 0) + 1;
        }
      }
    }
  }

  const headlineText = ` ${normalizeEntityName(`${project.title || ""} ${project.dramaPlan?.logline || ""}`)} `;
  for (const character of project.characters || []) {
    const normalizedName = normalizeEntityName(character.name);
    if (normalizedName && headlineText.includes(` ${normalizedName} `)) {
      scores[character.id] = (scores[character.id] || 0) + 3;
    }
  }
  return scores;
}

function asMediaSettingsRecord(value: unknown): Partial<MediaGenerationSettings> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<MediaGenerationSettings>
    : {};
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const { searchParams } = new URL(request.url);
  const scope = String(searchParams.get("scope") || "series").trim() || "series";
  const index = Number(searchParams.get("index"));
  const variant = searchParams.get("variant") === "base" ? "base" : "final";
  const download = searchParams.get("download") === "1";

  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ message: "Chỉ số thumbnail không hợp lệ." }, { status: 400 });
  }

  const project = await readProjectForMedia(slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });

  const set = resolvePublishingSet(project, scope);
  const thumbnail = set?.thumbnails?.[index];
  const targetRelativePath = variant === "base"
    ? (thumbnail?.image?.baseLocalPath || thumbnail?.image?.localPath)
    : thumbnail?.image?.localPath;
  if (!targetRelativePath) {
    return NextResponse.json({ message: "Chưa có ảnh thumbnail cho mục này." }, { status: 404 });
  }

  const root = safeThumbnailRoot(project.slug);
  const resolvedPath = path.resolve(process.cwd(), targetRelativePath);
  if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
    return NextResponse.json({ message: "Ảnh thumbnail không thuộc project này." }, { status: 403 });
  }

  try {
    const bytes = await readFile(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
    const downloadExt = ext === ".jpg" || ext === ".jpeg" ? ".jpg" : ext === ".webp" ? ".webp" : ".png";
    const safeSlug = safeSegment(project.slug, "project");
    const safeScope = safeSegment(scope, "series");
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(download
          ? {
              "Content-Disposition": `attachment; filename="${safeSlug}-${safeScope}-thumbnail-${index + 1}${variant === "base" ? "-clean" : ""}${downloadExt}"`,
            }
          : {}),
      },
    });
  } catch {
    return NextResponse.json({ message: "Không đọc được file ảnh thumbnail." }, { status: 404 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await request.json().catch(() => ({})) as {
    scope?: unknown;
    index?: unknown;
    includeOverlayText?: unknown;
    referenceCharacterIds?: unknown;
    mediaGeneration?: Partial<MediaGenerationSettings>;
  };

  const scope = typeof body.scope === "string" && body.scope.trim() ? body.scope.trim() : "series";
  const index = Number(body.index);
  const includeOverlayText = body.includeOverlayText !== false;
  const explicitReferenceCharacterIds = Array.isArray(body.referenceCharacterIds)
    ? [...new Set(body.referenceCharacterIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : undefined;
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ message: "Chỉ số prompt thumbnail không hợp lệ." }, { status: 400 });
  }

  const data = await readData();
  const project = data.projects.find((item) => item.slug === slug);
  if (!project) return NextResponse.json({ message: "Không tìm thấy project." }, { status: 404 });

  const set = resolvePublishingSet(project, scope);
  const thumbnail = set?.thumbnails?.[index];
  if (!set || !thumbnail) {
    return NextResponse.json({ message: "Không tìm thấy prompt thumbnail cho phạm vi đã chọn." }, { status: 404 });
  }
  if (!thumbnail.prompt?.trim()) {
    return NextResponse.json({ message: "Prompt thumbnail đang trống." }, { status: 400 });
  }

  const projectScenes = await readProjectScenes(project).catch(() => []);
  const sceneWithSettings = projectScenes.find((scene) => {
    const raw = scene.mediaGeneration || scene.media_generation;
    return raw && typeof raw === "object" && !Array.isArray(raw);
  });
  const sceneFallbackMediaGen = asMediaSettingsRecord(sceneWithSettings?.mediaGeneration || sceneWithSettings?.media_generation);
  const mediaGeneration = resolveMediaGenerationSettings({
    ...sceneFallbackMediaGen,
    ...project.mediaGeneration,
    ...asMediaSettingsRecord(body.mediaGeneration),
  });
  const needsGatewaySession = isMuseImageModel(mediaGeneration.imageModel) || isFlowImageModel(mediaGeneration.imageModel);
  const providerAuthToken = needsGatewaySession ? readMaiVideoAuthCookie(request.headers.get("cookie")) : "";
  if (needsGatewaySession && !providerAuthToken) {
    return NextResponse.json({
      code: "PROVIDER_SESSION_REQUIRED",
      message: "Hãy đăng nhập MaiVideo để dùng API ảnh Muse.ai hoặc Flow.",
    }, { status: 401 });
  }
  const userId = request.headers.get("x-storyai-user-id")?.trim() || undefined;
  const effectiveReferenceCharacterIds = explicitReferenceCharacterIds !== undefined
    ? explicitReferenceCharacterIds
    : mediaGeneration.imageUseCharacterReferences === false
      ? []
      : undefined;

  try {
    const characterImportanceScores = await computeCharacterImportanceScores(project, scope, projectScenes);
    const baseMedia = await generateMaiVideoThumbnailImage({
      projectSlug: slug,
      scope,
      index,
      concept: thumbnail.concept,
      prompt: thumbnail.prompt,
      layoutNote: thumbnail.layoutNote,
      aspectRatio: project.aspectRatio || "16:9",
      mediaGeneration,
      characters: project.characters || [],
      locations: project.locations || [],
      referenceCharacterIds: effectiveReferenceCharacterIds,
      characterImportanceScores,
      contentGenre: project.contentGenre,
      secondaryGenres: project.secondaryGenres,
      storySetting: project.storySetting,
      settingNotes: project.settingNotes,
      visualStyle: project.visualStyle,
      imageStyle: project.imageStyle,
      userId,
      providerAuthToken,
    });

    if (!baseMedia.localPath) {
      throw new Error("Provider không trả về file ảnh thumbnail.");
    }

    const baseAbsPath = path.resolve(process.cwd(), baseMedia.localPath);
    const shouldCompositeOverlay = includeOverlayText && Boolean(thumbnail.overlayText?.trim());
    let finalLocalPath = baseMedia.localPath;

    if (shouldCompositeOverlay) {
      const outputProvider = isMuseImageModel(mediaGeneration.imageModel)
        ? "muse"
        : isFlowImageModel(mediaGeneration.imageModel)
          ? "flow"
          : "maivideo";
      const finalAbsPath = path.join(
        safeThumbnailRoot(slug),
        `${safeSegment(scope, "series")}-thumb-${index + 1}-${outputProvider}-final.png`,
      );
      await renderThumbnailOverlay({
        baseImagePath: baseAbsPath,
        outputPath: finalAbsPath,
        overlayText: thumbnail.overlayText,
        layoutNote: thumbnail.layoutNote,
        prompt: thumbnail.prompt,
      });
      finalLocalPath = path.relative(process.cwd(), finalAbsPath).split(path.sep).join("/");
    }

    const imageAsset: ThumbnailImageAsset = {
      localPath: finalLocalPath,
      baseLocalPath: baseMedia.localPath,
      withOverlay: shouldCompositeOverlay,
      provider: baseMedia.provider,
      model: baseMedia.model || mediaGeneration.imageModel,
      quality: baseMedia.quality || mediaGeneration.imageQuality,
      aspectRatio: project.aspectRatio || "16:9",
      ...(baseMedia.referenceCharacterIds?.length ? { referenceCharacterIds: baseMedia.referenceCharacterIds } : {}),
      ...(baseMedia.referenceLocationId ? { referenceLocationId: baseMedia.referenceLocationId } : {}),
      generatedAt: now(),
    };

    const result = await updateData((workspace) => {
      const current = workspace.projects.find((item) => item.slug === slug);
      if (!current) throw new Error("PROJECT_NOT_FOUND");
      const targetSet = resolvePublishingSet(current, scope);
      const targetThumb = targetSet?.thumbnails?.[index];
      if (!targetSet || !targetThumb) throw new Error("THUMBNAIL_NOT_FOUND");
      targetThumb.image = imageAsset;
      targetSet.updatedAt = imageAsset.generatedAt;
      current.mediaGeneration = resolveMediaGenerationSettings({
        ...current.mediaGeneration,
        imageModel: mediaGeneration.imageModel,
        imageQuality: mediaGeneration.imageQuality,
        imageDetailLevel: mediaGeneration.imageDetailLevel,
        imageUseCharacterReferences: mediaGeneration.imageUseCharacterReferences,
        seedanceAccountId: mediaGeneration.seedanceAccountId,
      });
      current.updatedAt = imageAsset.generatedAt;
      workspace.activities.unshift(makeActivity({
        projectSlug: slug,
        kind: "project",
        title: "Đã tạo ảnh thumbnail",
        detail: `${scope === "series" ? "Video toàn dự án" : scope} · concept #${index + 1} · ${imageAsset.aspectRatio}${imageAsset.withOverlay ? ` · overlay "${thumbnail.overlayText}"` : ""}`,
        status: "success",
      }));
      return { project: current, thumbnail: targetThumb };
    });

    return NextResponse.json({
      ok: true,
      project: result.project,
      thumbnail: result.thumbnail,
      imageUrl: thumbnailUrl(slug, scope, index, "final"),
      baseImageUrl: thumbnailUrl(slug, scope, index, "base"),
    });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "Không thể tạo ảnh thumbnail.";
    const needsApiKey = code === "MAIVIDEO_IMAGE_API_KEY_REQUIRED"
      || code === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"
      || code === "SEEDANCE_ACCOUNT_REQUIRED"
      || code === "SEEDANCE_ACCOUNT_NOT_FOUND"
      || code === "SEEDANCE_ENCRYPTION_KEY_REQUIRED";
    const message = code === "MAIVIDEO_IMAGE_API_KEY_REQUIRED"
      ? "Hãy thêm API key tạo ảnh MaiVideo trong Cài đặt."
      : code === "MAIVIDEO_CREDENTIALS_ENCRYPTION_KEY_REQUIRED"
        ? "Máy chủ chưa cấu hình khóa mã hóa API key MaiVideo."
        : code === "SEEDANCE_ACCOUNT_REQUIRED"
          ? "Chưa kết nối API key Seedance / MaiVideo. Hãy thêm tài khoản trong Cài đặt."
          : code;
    return NextResponse.json({ code, message }, { status: needsApiKey ? 503 : 502 });
  }
}
