import { AsyncLocalStorage } from "node:async_hooks";

const shared = globalThis as typeof globalThis & { __providerSubmissionScope?: AsyncLocalStorage<() => Promise<void>> };
const scope = shared.__providerSubmissionScope ||= new AsyncLocalStorage<() => Promise<void>>();

export function withProviderSubmissionCheckpoint<T>(checkpoint: () => Promise<void>, work: () => Promise<T>) {
  return scope.run(checkpoint, work);
}

export async function checkpointProviderSubmission() {
  await scope.getStore()?.();
}

export function canSafelyResumeUnsubmittedJob(job: {
  submissionTracked?: boolean; providerRequestStartedAt?: string;
  maiVideoJobId?: string; seedanceTaskId?: string; higgsfieldJobId?: string;
}) {
  return job.submissionTracked === true && !job.providerRequestStartedAt
    && !job.maiVideoJobId && !job.seedanceTaskId && !job.higgsfieldJobId;
}
