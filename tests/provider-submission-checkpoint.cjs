const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
const context = { exports: {}, require };
vm.createContext(context);
vm.runInContext(ts.transpile(fs.readFileSync('app/lib/provider-submission-checkpoint.ts','utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), context);
const { withProviderSubmissionCheckpoint, checkpointProviderSubmission, canSafelyResumeUnsubmittedJob: safe } = context.exports;
(async () => {
  assert(safe({ submissionTracked: true }));
  assert(!safe({})); // Legacy jobs are ambiguous, never automatically resubmit.
  assert(!safe({ submissionTracked: true, providerRequestStartedAt: 'now' }));
  for (const field of ['maiVideoJobId','seedanceTaskId','higgsfieldJobId']) assert(!safe({ submissionTracked: true, [field]: 'task' }));
  const counts = [0,0];
  await Promise.all(counts.map((_, i) => withProviderSubmissionCheckpoint(async () => { counts[i]++; }, async () => { await Promise.resolve(); await checkpointProviderSubmission(); })));
  assert.deepEqual(counts, [1,1]);
  await checkpointProviderSubmission();
  await assert.rejects(withProviderSubmissionCheckpoint(async () => { throw new Error('cannot persist'); }, checkpointProviderSubmission));
  console.log('Passed: safe waiting recovery, legacy/started-job protection, task ID protection, concurrent context isolation, fail-closed checkpoint.');
})().catch(e => { console.error(e); process.exitCode = 1; });
