(() => {
    'use strict';

    const INSTALL_FLAG = '__studioRelayVerifiedImageUploaderInstalled';
    const UPLOAD_ACTION = 'studioRelayUploadImage';
    const GET_DRAGGED_IMAGE_ACTION = 'studioRelayGetDraggedImagePayload';
    const MANUAL_DRAG_RECORD_TYPE = 'application/x-studio-relay-image-id';

    const MANUAL_ATTACHMENT_ACTION = 'studioRelayManualImageAttached';
    const MANUAL_ATTACHMENT_FAILURE_ACTION = 'studioRelayManualImageFailed';




    const VERIFY_TIMEOUT_MS = 8000;
    const MAIN_REQUEST_EVENT = 'studio-relay:image-attach-request:v2';
    const MAIN_RESPONSE_EVENT = 'studio-relay:image-attach-response:v2';
    const MAIN_RESPONSE_TIMEOUT_MS = 5000;
    // The gateway dispatches this event from Playwright's page world. Keeping
    // the request handler here means the worker can use the same verified
    // uploader as the extension UI without waiting for a native file chooser
    // or relying on an isolated-world input locator.
    const WORKER_REQUEST_EVENT = 'studio-relay:worker-image-attach-request:v1';
    const WORKER_RESPONSE_EVENT = 'studio-relay:worker-image-attach-response:v1';
    const WORKER_REQUEST_MAX_CHARS = 36 * 1024 * 1024;

    const NATIVE_DROP_GRACE_MS = 6000;
    const OPERATION_DEDUP_MS = 60 * 1000;

    const VERIFY_POLL_MS = 200;
    const COMPOSER_SELECTOR = 'textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], input[type="text"]';
    const ATTACHMENT_EVIDENCE_SELECTOR = [
        'img',
        '[style*="blob:"]',
        '[style*="data:image"]',
        '[style*="background-image"]',
        '[class*="attachment" i]',
        '[class*="preview" i]',
        '[data-testid*="attachment" i]',
        '[data-testid*="preview" i]',
        '[data-testid*="upload" i]',
        '[aria-label*="remove image" i]',
        '[aria-label*="remove attachment" i]'
    ].join(', ');
    const SUPPORTED_MIME_TYPES = new Set([
        'image/avif',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp'
    ]);

    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    let manualDropQueue = Promise.resolve();
    const recentOperations = new Map();
    const pendingWorkerRequests = new Map();

    const pendingMainRequests = new Map();
    document.addEventListener(MAIN_RESPONSE_EVENT, handleMainWorldResponse, true);
    document.addEventListener(WORKER_REQUEST_EVENT, handleWorkerAttachmentRequest, true);

    document.addEventListener('dragover', allowStudioRelayDrag, true);
    document.addEventListener('drop', observeManualImageDrop, true);

    let cachedPendingDrag = null;
    function cachePendingGalleryDrag(pending) {
        if (!pending || !pending.recordId) {
            cachedPendingDrag = null;
            return;
        }
        if (Date.now() - Number(pending.startedAt || 0) > 20000) {
            cachedPendingDrag = null;
            return;
        }
        cachedPendingDrag = {
            recordId: String(pending.recordId),
            operationId: String(pending.operationId || createOperationId())
        };
    }
    function refreshPendingGalleryDrag() {
        try {
            chrome.storage.local.get(['sr_pending_gallery_drag'], (res) => {
                cachePendingGalleryDrag(res?.sr_pending_gallery_drag);
            });
        } catch (e) {}
    }
    refreshPendingGalleryDrag();
    document.addEventListener('dragenter', (event) => {
        refreshPendingGalleryDrag();
        allowStudioRelayDrag(event);
    }, true);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.sr_pending_gallery_drag) {
            cachePendingGalleryDrag(changes.sr_pending_gallery_drag.newValue);
        }
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.action === 'studioRelayPendingGalleryDrag') {
            cachePendingGalleryDrag(message.pending);
            sendResponse({ success: true });
            return false;
        }
        if (message?.action !== UPLOAD_ACTION) return undefined;

        handleUpload(message.image, createOperationId())
            .then(result => sendResponse({success: true, ...result}))
            .catch(error => sendResponse({
                success: false,
                error: error?.message || String(error)
            }));

        return true;
    });

    // Expose for Img2Vid batch (content.js) — attach image without popup hop.
    globalThis.__seedanceAttachImagePayload = function (imagePayload) {
        return handleUpload(imagePayload, createOperationId());
    };

    function allowStudioRelayDrag(event) {
        if (!event.isTrusted) return;
        const types = Array.from(event.dataTransfer?.types || []).map((type) => String(type).toLowerCase());
        const hasFiles = types.includes('files');
        if (!isStudioRelayTransfer(event.dataTransfer) && !cachedPendingDrag && !hasFiles) return;
        event.preventDefault();
        try { event.dataTransfer.dropEffect = 'copy'; } catch {}
    }

    function isStudioRelayTransfer(transfer) {
        if (!transfer) return false;
        return Array.from(transfer.types || [])
            .some(type => String(type).toLowerCase() === MANUAL_DRAG_RECORD_TYPE);
    }

    function observeManualImageDrop(event) {
        if (!event.isTrusted) return;
        const drag = extractStudioRelayDrag(event.dataTransfer);
        if (drag) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!claimOperation(drag.operationId)) return;
            manualDropQueue = manualDropQueue
                .then(() => handleStudioRelayTokenDrop(drag))
                .catch(() => undefined);
            return;
        }

        if (cachedPendingDrag) {
            event.preventDefault();
            event.stopImmediatePropagation();
            const pending = cachedPendingDrag;
            if (!claimOperation(pending.operationId)) return;
            manualDropQueue = manualDropQueue
                .then(() => handleStudioRelayTokenDrop(pending))
                .catch(() => undefined);
            return;
        }

        // Ordinary File Explorer/Downloads drops remain entirely native and are
        // observed only for attachment evidence; StudioRelay never replays them.
        const files = Array.from(event.dataTransfer?.files || []).filter(isSupportedImageFile);
        if (files.length !== 1) return;
        const file = files[0];
        const eventTarget = event.target instanceof Element ? event.target : null;
        const activeTarget = findComposerUploadTarget();
        const surface = findComposerSurface(activeTarget) || findComposerSurface(eventTarget);
        if (!surface) {
            reportManualAttachmentFailure('', file, new Error('No active Dola composer was found.'));
            return;
        }

        const before = captureAttachmentState(surface, file);
        manualDropQueue = manualDropQueue
            .then(() => verifyManualImageDrop(surface, file, before))
            .catch(() => undefined);
    }

    function extractStudioRelayDrag(transfer) {
        if (!transfer) return null;
        let value = '';
        try { value = transfer.getData(MANUAL_DRAG_RECORD_TYPE) || ''; } catch {}
        if (!value) return null;

        try {
            const parsed = JSON.parse(value);
            const recordId = String(parsed?.recordId || '').trim();
            const operationId = normalizeOperationId(parsed?.operationId);
            if (parsed?.v !== 3 || !recordId || recordId.length > 220 || !operationId) return null;
            return {recordId, operationId};
        } catch {
            return null;
        }
    }

    function claimOperation(operationId) {
        const now = Date.now();
        for (const [id, claimedAt] of recentOperations) {
            if (now - claimedAt >= OPERATION_DEDUP_MS) recentOperations.delete(id);
        }
        if (recentOperations.has(operationId)) return false;
        recentOperations.set(operationId, now);
        return true;
    }

    async function handleStudioRelayTokenDrop(drag) {
        let image = null;
        try {
            const response = await requestRuntimeMessage({
                action: GET_DRAGGED_IMAGE_ACTION,
                imageId: drag.recordId,
                operationId: drag.operationId
            });
            if (!response?.success || !response.image) {
                throw new Error(response?.error || 'The dragged image could not be read from the gallery.');
            }

            image = response.image;
            const result = await handleUpload(image, drag.operationId);
            reportManualAttachment(drag.recordId, image, result.method, result.evidence);
        } catch (error) {
            reportManualAttachmentFailure(drag.recordId, image || {}, error);
            throw error;
        }
    }
    function normalizeOperationId(value) {
        const operationId = String(value || '').trim();
        return /^[a-zA-Z0-9_-]{12,160}$/.test(operationId) ? operationId : '';
    }
    async function verifyManualImageDrop(surface, file, before) {
        const verification = await waitForAttachmentEvidence(surface, file, before, NATIVE_DROP_GRACE_MS);
        if (verification.verified) {
            reportManualAttachment('', file, 'trusted-native-file-drop', verification.reason);
            return;
        }

        // Dola already received the one original trusted File. StudioRelay never
        // retries or redispatches it, because that would reintroduce duplicates.
        reportManualAttachmentFailure('', file, new Error(
            'Dola did not expose an attachment preview after the trusted native File drop. No retry was sent.'
        ));
    }
    function reportManualAttachment(recordId, file, method, evidence) {
        try {
            chrome.runtime.sendMessage({
                action: MANUAL_ATTACHMENT_ACTION,
                image: {
                    id: String(recordId || ''),
                    name: String(file?.name || ''),
                    type: String(file?.type || ''),
                    size: Number(file?.size) || 0,
                    lastModified: Number(file?.lastModified) || 0,
                    verified: true,
                    method,
                    evidence
                }
            }, () => {
                try { void chrome.runtime.lastError; } catch {}
            });
        } catch {}
    }

    function reportManualAttachmentFailure(recordId, file, error) {
        try {
            chrome.runtime.sendMessage({
                action: MANUAL_ATTACHMENT_FAILURE_ACTION,
                image: {
                    id: String(recordId || ''),
                    name: String(file?.name || ''),
                    type: String(file?.type || ''),
                    size: Number(file?.size) || 0,
                    lastModified: Number(file?.lastModified) || 0,
                    error: error?.message || String(error)
                }
            }, () => {
                try { void chrome.runtime.lastError; } catch {}
            });
        } catch {}
    }

    function requestRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(message, response => {
                    const runtimeError = chrome.runtime.lastError;
                    if (runtimeError) reject(new Error(runtimeError.message));
                    else resolve(response);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    function handleWorkerAttachmentRequest(event) {
        if (typeof event.detail !== 'string' || event.detail.length > WORKER_REQUEST_MAX_CHARS) return;

        let request;
        try { request = JSON.parse(event.detail); } catch { return; }
        const requestId = normalizeOperationId(request?.requestId);
        if (request?.v !== 1 || !requestId || !request?.image) return;

        // The Gateway can use a short redispatch when a content script is
        // still hydrating. One request ID must represent one upload operation;
        // otherwise two listeners can assign the same image twice.
        const existing = pendingWorkerRequests.get(requestId);
        if (existing) return;

        const operation = handleUpload(request.image, requestId);
        pendingWorkerRequests.set(requestId, operation);
        operation
            .then(result => respondToWorker(requestId, {success: true, ...result}))
            .catch(error => respondToWorker(requestId, {
                success: false,
                verified: false,
                error: error?.message || String(error)
            }))
            .finally(() => {
                if (pendingWorkerRequests.get(requestId) === operation) {
                    pendingWorkerRequests.delete(requestId);
                }
            });
    }

    function respondToWorker(requestId, result) {
        try {
            document.dispatchEvent(new CustomEvent(WORKER_RESPONSE_EVENT, {
                detail: JSON.stringify({v: 2, requestId, ...result})
            }));
        } catch {}
    }

    function handleMainWorldResponse(event) {
        if (typeof event.detail !== 'string') return;

        let response;
        try { response = JSON.parse(event.detail); } catch { return; }
        if (response?.v !== 2 || !normalizeOperationId(response.requestId)) return;

        const pending = pendingMainRequests.get(response.requestId);
        if (!pending) return;
        pendingMainRequests.delete(response.requestId);
        window.clearTimeout(pending.timer);

        if (response.success === true && response.committed === true) {
            pending.resolve(response);
        } else {
            pending.reject(new Error(response.error || 'Dola MAIN-world attachment was not committed.'));
        }
    }

    function requestMainWorldAttachment(payload, operationId) {
        const requestId = normalizeOperationId(operationId) || createOperationId();
        if (pendingMainRequests.has(requestId)) {
            return Promise.reject(new Error('This image operation is already pending.'));
        }

        const detail = JSON.stringify({
            v: 2,
            requestId,
            image: {
                name: String(payload?.name || ''),
                type: String(payload?.type || ''),
                size: Number(payload?.size) || 0,
                lastModified: Number(payload?.lastModified) || Date.now(),
                replaceExisting: Boolean(payload?.replaceExisting),
                dataUrl: String(payload?.dataUrl || '')
            }
        });
        if (detail.length > 36 * 1024 * 1024) {
            return Promise.reject(new Error('The image request is larger than the supported bridge limit.'));
        }

        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                pendingMainRequests.delete(requestId);
                reject(new Error('The Dola MAIN-world bridge did not respond. Reload the Dola tab and retry.'));
            }, MAIN_RESPONSE_TIMEOUT_MS);

            pendingMainRequests.set(requestId, {resolve, reject, timer});
            try {
                document.dispatchEvent(new CustomEvent(MAIN_REQUEST_EVENT, {detail}));
            } catch (error) {
                pendingMainRequests.delete(requestId);
                window.clearTimeout(timer);
                reject(error);
            }
        });
    }

    function createOperationId() {
        if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
        return 'operation-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
    }
    function isSupportedImageFile(file) {
        if (!file || typeof file.name !== 'string' || !Number.isFinite(Number(file.size))) return false;
        const mimeType = String(file.type || '').toLowerCase();
        return SUPPORTED_MIME_TYPES.has(mimeType) || (
            !mimeType && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(file.name || '')
        );
    }
    async function handleUpload(payload, operationId) {
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const target = findComposerUploadTarget();
            const surface = findComposerSurface(target);
            if (!target || !surface) {
                lastError = new Error('No active Dola composer was found. The image remains queued.');
            } else {
                // The first image deliberately replaces any stale draft
                // attachments. Do not use those old chips as the verification
                // baseline; otherwise reusing the same image can look like a
                // failed upload even after the old set was removed.
                // ``replaceExisting`` is a cleanup request, not proof that the
                // composer is empty. Capture the real current baseline; using
                // a forced zero baseline made stale chips look like a newly
                // uploaded image and allowed every retry to append another
                // reference. The MAIN-world commit performs the cleanup before
                // assigning the new File, and the post-commit evidence below
                // compares against this actual pre-operation state.
                const before = captureAttachmentState(surface, payload);
                try {
                    // The MAIN-world cache is keyed by operationId, so a
                    // verification retry can safely reuse the same browser
                    // upload without assigning the file twice.
                    const committed = await requestMainWorldAttachment(payload, operationId);
                    const verification = await waitForAttachmentEvidence(
                        surface, payload, before, VERIFY_TIMEOUT_MS
                    );
                    if (verification.verified) {
                        return buildVerifiedResult(payload, null, committed.method, verification);
                    }
                    lastError = new Error(
                        'Dola did not render an attachment after the MAIN-world ' +
                        committed.method + ' operation.'
                    );
                } catch (error) {
                    lastError = error;
                }
            }

            if (attempt < 2) {
                // A Pro-mode/image upload can replace the composer node. Give
                // React a short render turn, then resolve the target again.
                await delay(attempt === 0 ? 250 : 500);
            }
        }
        throw lastError || new Error('Dola image attachment could not be verified.');
    }

    function buildVerifiedResult(file, input, method, verification) {
        return {
            fileName: file.name,
            inputAccept: input?.getAttribute('accept') || '',
            inputMultiple: Boolean(input?.multiple),
            method,
            verified: true,
            evidence: verification.reason
        };
    }

    function findComposerUploadTarget() {
        const candidates = queryAllDeep(COMPOSER_SELECTOR)
            .filter(element => !element.closest?.('#studio-relay-page-overlays'))
            .filter(isVisible)
            .map((element, index) => ({
                element,
                index,
                score: scoreComposerTarget(element)
            }))
            .sort((left, right) => (right.score - left.score) || (right.index - left.index));

        return candidates[0]?.element || null;
    }

    function scoreComposerTarget(element) {
        const rect = element.getBoundingClientRect();
        const identity = [
            element.getAttribute('placeholder'),
            element.getAttribute('aria-label'),
            element.getAttribute('data-placeholder'),
            element.getAttribute('data-slate-placeholder'),
            element.getAttribute('data-testid')
        ].filter(Boolean).join(' ').toLowerCase();
        let score = 1;
        if (/describe|prompt|image|video|message|action|create/.test(identity)) score += 100;
        if (element.matches('[contenteditable]:not([contenteditable="false"]), [role="textbox"]')) score += 18;
        if (rect.bottom >= window.innerHeight * 0.45) score += 28;
        if (rect.width >= Math.min(320, window.innerWidth * 0.3)) score += 12;
        return score;
    }

    function findComposerSurface(target) {
        if (!(target instanceof Element)) return null;
        let current = target;
        let best = target;

        for (let depth = 0; current && depth < 10; depth += 1) {
            if (current instanceof Element) {
                const rect = current.getBoundingClientRect();
                const hasEditor = current.matches(COMPOSER_SELECTOR) || Boolean(current.querySelector(COMPOSER_SELECTOR));
                if (hasEditor && rect.width >= 240 && rect.height >= 24 && rect.height <= 520) {
                    best = current;
                }
                if (rect.height > 520) break;
            }
            current = current.parentElement || current.getRootNode?.().host || null;
        }

        return best;
    }

    function captureAttachmentState(surface, file) {
        const surfaceRect = surface.getBoundingClientRect();
        const elements = queryAllDeep(ATTACHMENT_EVIDENCE_SELECTOR)
            .filter(element => !element.closest?.('#studio-relay-page-overlays'))
            .filter(hasVisualBox)
            .filter(element => surface.contains(element) || isNearComposerEvidence(element, surfaceRect));
        const signatures = new Set(elements.map(attachmentSignature));
        const fileName = String(file.name || '').trim().toLowerCase();
        const evidenceText = [
            String(surface.textContent || ''),
            ...elements.map(element => String(element.parentElement?.textContent || element.textContent || ''))
        ].join(' ').toLowerCase();

        return {
            count: elements.length,
            signatures,
            hasFileName: Boolean(fileName && evidenceText.includes(fileName))
        };
    }

    function isNearComposerEvidence(element, surfaceRect) {
        const rect = element.getBoundingClientRect();
        const horizontalOverlap = rect.right >= surfaceRect.left - 80 && rect.left <= surfaceRect.right + 80;
        const verticalOverlap = rect.bottom >= surfaceRect.top - 180 && rect.top <= surfaceRect.bottom + 260;
        return horizontalOverlap && verticalOverlap;
    }

    async function waitForAttachmentEvidence(surface, file, before, timeoutMs = VERIFY_TIMEOUT_MS) {
        const duration = Math.max(VERIFY_POLL_MS, Number(timeoutMs) || VERIFY_TIMEOUT_MS);
        const deadline = Date.now() + duration;
        let activeSurface = surface;

        while (Date.now() < deadline) {
            await delay(VERIFY_POLL_MS);
            if (!activeSurface.isConnected) {
                activeSurface = findComposerSurface(findComposerUploadTarget());
                if (!activeSurface) continue;
            }

            const after = captureAttachmentState(activeSurface, file);
            if (!before.hasFileName && after.hasFileName) {
                return {verified: true, reason: 'filename-visible'};
            }
            if (after.count > before.count) {
                return {verified: true, reason: 'attachment-control-added'};
            }
            for (const signature of after.signatures) {
                if (!before.signatures.has(signature)) {
                    return {verified: true, reason: 'attachment-preview-changed'};
                }
            }
        }

        return {verified: false, reason: 'no-attachment-evidence'};
    }

    function attachmentSignature(element) {
        const source = element instanceof HTMLImageElement
            ? (element.currentSrc || element.getAttribute('src') || '')
            : '';
        return [
            element.tagName.toLowerCase(),
            source,
            element.getAttribute('style') || '',
            element.getAttribute('class') || '',
            element.getAttribute('data-testid') || '',
            element.getAttribute('aria-label') || '',
            String(element.textContent || '').trim().slice(0, 120)
        ].join('|');
    }

    function hasVisualBox(element) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    }

    function isVisible(element) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function queryAllDeep(selector) {
        const results = [];
        const roots = [document];

        while (roots.length) {
            const root = roots.shift();
            let elements = [];
            try {
                elements = Array.from(root.querySelectorAll(selector));
            } catch {
                elements = [];
            }
            results.push(...elements);

            let descendants = [];
            try {
                descendants = root.querySelectorAll('*');
            } catch {
                descendants = [];
            }
            descendants.forEach(element => {
                if (element.shadowRoot) roots.push(element.shadowRoot);
            });
        }

        return Array.from(new Set(results));
    }

    function delay(milliseconds) {
        return new Promise(resolve => window.setTimeout(resolve, milliseconds));
    }
})();
