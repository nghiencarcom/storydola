# Extension ready investigation — 2026-09-12

## Confirmed observations

- `ahung3605-532a5bad`: debugger had attached but the page had no ready marker.
- `aupeoradio-df403512`: the runtime manifest reported 1.3.1, but the running worker did not contain the newly added `publishReady` function. A version number alone did not invalidate this profile's old worker.
- Changing the background entry point to `background-1.3.1.js` (which imports the single `service-worker.js` implementation) loaded the new function. Initial navigation and reload both passed the Python ready check on this profile.
- Readiness only proves that the extension enabled interception. It does not prove the provider accepts a 30-second generation.

## Changes

- Publish readiness from the debugger after successful Fetch.enable, also on subsequent tab updates.
- Restore content-script readiness after DOM changes and retry lost runtime callbacks with a bounded watchdog.
- Use a versioned background entry point to refresh persistent-profile worker registrations without deleting cookies or login profiles.
- Reject restored conversation IDs before submission; start capture only at dispatch and require a fresh chat.
- Explicit user retry no longer mislabels every provider rejection as a portrait-policy rejection.
- Fetch this server's own public media URL through its validated local media route, retaining the original stored URL and query. Other origins are not redirected to localhost.

## Original task retries, not substitute prompts

| Task | New conversation | Evidence |
| --- | --- | --- |
| video_1f668084d7cd490a9766f1610b9b01e0 | 38417837563909393 | 4,023 prompt characters verified; seedance_v2.5/30s, rewritten=False; provider responded with 4–15-second limit |
| video_681bb8eab9304a9081717a82bac5954b | 38417525839676945 | 7,434 formatted prompt characters verified; seedance_v2.5/30s, rewritten=False; provider returned generic content rejection |
| video_a67485f4e0d54b3691a4063f75d3f25a | 38417947591753233 | After fixing image download and a failed ratio-selection attempt on another profile, biondotawnya submitted 6,755 formatted characters and 4 reference images; seedance_v2.5/30s, rewritten=False; provider returned generic content rejection |

The old conversations were inspected before retrying and returned zero videos. Generic rejection text does not identify its underlying policy or prove a copyright issue.

## Invalid earlier diagnostic result

The substitute test task `video_483d9330eb254437a36750699d933449` had incorrectly reused conversation `38417837563269137` belonging to `video_cd2a214d33c14d9ea825576202053278`. Both downloaded files have SHA-256 `8ec6ea0076f28bc6a1db787af8656f03e2a14aa06160f1284cb8ba1311498f48`. The test task was corrected to OUTPUT_MISMATCH; original media files and the legitimate task were preserved.

## Verification

- 69 Python unit tests passed (pre-existing unclosed-SQLite ResourceWarnings remain).
- 2 JavaScript readiness tests passed.
- JavaScript syntax checks and git diff whitespace validation passed.
- Development runtime is `npm run dev`, UI 3107 and gateway 8200. A temporary HTTP compatibility forward maps 3007 to the dev UI, without running a production build.
