import { withProviderSubmissionCheckpoint } from "./provider-submission-checkpoint";
import type { MediaGenerationSettings } from "./project-types";
import { generateMaiVideoProfileImage } from "./media-provider";
import { makeActivity, now, readDataForUser, updateDataForUser } from "./server-store";

// Share one request per user/project/location even when many scene workers need it.
const runtime = globalThis as typeof globalThis & { __locationReferenceTasks?: Map<string, Promise<void>> };
const tasks = runtime.__locationReferenceTasks ||= new Map<string, Promise<void>>();

export function ensureLocationReference(userId: string, slug: string, locationId: string, providerAuthToken = "", mediaGeneration?: Partial<MediaGenerationSettings>) {
  const key = `${userId}:${slug}:${locationId}`;
  const active = tasks.get(key);
  if (active) return active;
  const task = generate(userId, slug, locationId, providerAuthToken, mediaGeneration).finally(() => tasks.delete(key));
  tasks.set(key, task);
  return task;
}

async function generate(userId: string, slug: string, locationId: string, providerAuthToken: string, mediaGeneration?: Partial<MediaGenerationSettings>) {
  const data = await readDataForUser(userId);
  const project = data.projects.find(p => p.slug === slug);
  const location = project?.locations?.find(p => p.id === locationId);
  if (!project || !location) throw new Error("LOCATION_NOT_FOUND");
  if (location.referenceImagePath) return;
  const settings = location.imageGeneration?.jobId && location.imageGeneration.mediaGeneration
    ? location.imageGeneration.mediaGeneration : { ...project.mediaGeneration, ...mediaGeneration };
  await updateDataForUser(userId, data => {
    const target = data.projects.find(p => p.slug === slug)?.locations?.find(p => p.id === locationId);
    if (target) target.imageGeneration = { status: "running", jobId: target.imageGeneration?.jobId, mediaGeneration: settings, updatedAt: now() };
  });
  try {
    const image = await withProviderSubmissionCheckpoint(async () => {}, () => generateMaiVideoProfileImage({
      userId, projectSlug: slug, profileKind: "locations", profileId: locationId,
      prompt: location.imagePrompt || location.description,
      mediaGeneration: settings, providerAuthToken,
      contentGenre: project.contentGenre, secondaryGenres: project.secondaryGenres,
      storySetting: project.storySetting, settingNotes: project.settingNotes,
      visualStyle: project.visualStyle, imageStyle: project.imageStyle,
      existingJobId: location.imageGeneration?.jobId,
      onJobCreated: async jobId => {
        await updateDataForUser(userId, data => {
          const target = data.projects.find(p => p.slug === slug)?.locations?.find(p => p.id === locationId);
          if (target) target.imageGeneration = { status: "running", jobId, mediaGeneration: settings, updatedAt: now() };
        });
      },
    }));
    if (!image.localPath) throw new Error("Provider không trả về file ảnh bối cảnh.");
    await updateDataForUser(userId, data => {
      const target = data.projects.find(p => p.slug === slug)?.locations?.find(p => p.id === locationId);
      if (!target || target.referenceImagePath) return;
      target.referenceImagePath = image.localPath!;
      target.referenceImageName = `${target.name}-ai.png`;
      target.referenceImageMimeType = "image/png";
      target.imageGeneration = { status: "ready", updatedAt: now() };
      target.updatedAt = now();
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    await updateDataForUser(userId, data => {
      const target = data.projects.find(p => p.slug === slug)?.locations?.find(p => p.id === locationId);
      if (target && !target.referenceImagePath) target.imageGeneration = { status: "failed", jobId: target.imageGeneration?.jobId, mediaGeneration: settings, error, updatedAt: now() };
      data.activities.unshift(makeActivity({ projectSlug: slug, kind: "project", title: "Không tạo được ảnh bối cảnh", detail: `${location.name}: ${error}`, status: "error" }));
    });
    throw cause;
  }
}
