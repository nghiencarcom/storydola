(() => {
    'use strict';

    const INSTALL_FLAG = '__studioRelayImageAttachmentMainV2Installed';
    const REQUEST_EVENT = 'studio-relay:image-attach-request:v2';
    const RESPONSE_EVENT = 'studio-relay:image-attach-response:v2';
    const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
    const MAX_REQUEST_CHARS = 36 * 1024 * 1024;
    const JOB_CACHE_MS = 60 * 1000;
    const ACTIVATION_POLL_MS = 80;
    const ACTIVATION_INPUT_TIMEOUT_MS = 1800;
    const ACTIVATION_CONTROL_SELECTOR = 'button, [role=button], [role=menuitem], [role=option], label, li';
    const COMPOSER_SELECTOR = 'textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], input[type="text"]';
    const SUPPORTED_MIME_TYPES = new Set([
        'image/avif',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp'
    ]);
    const SUPPORTED_HOSTS = ['dola.com', 'seaart.ai'];

    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    const jobs = new Map();
    document.addEventListener(REQUEST_EVENT, handleRequest, true);

    function handleRequest(event) {
        let request;
        try {
            request = parseRequest(event.detail);
        } catch (error) {
            const requestId = safeRequestIdFromDetail(event.detail);
            if (requestId) respond(requestId, failure(error));
            return;
        }

        let job = jobs.get(request.requestId);
        if (!job) {
            const promise = Promise.resolve()
                .then(() => commitAttachment(request))
                .catch(error => failure(error));
            job = {createdAt: Date.now(), promise};
            jobs.set(request.requestId, job);
            window.setTimeout(() => {
                if (jobs.get(request.requestId) === job) jobs.delete(request.requestId);
            }, JOB_CACHE_MS);
        }

        job.promise.then(result => respond(request.requestId, result));
    }

    function parseRequest(detail) {
        if (typeof detail !== 'string' || !detail || detail.length > MAX_REQUEST_CHARS) {
            throw new Error('The MAIN-world image request is missing or too large.');
        }

        const request = JSON.parse(detail);
        if (request?.v !== 2 || !isSafeId(request.requestId)) {
            throw new Error('The MAIN-world image request is invalid.');
        }
        if (!isSupportedPage()) throw new Error('This page is not a supported Dola target.');
        if (!request.image || typeof request.image.dataUrl !== 'string') {
            throw new Error('The MAIN-world image payload is missing.');
        }
        return request;
    }

    async function commitAttachment(request) {
        const file = dataUrlToFile(request.image);
        const composerTarget = findComposerTarget();
        const composerSurface = findComposerSurface(composerTarget) || composerTarget;
        if (request.image?.replaceExisting) {
            // A persistent Dola profile can retain the previous task's image
            // chips. Clear those chips before assigning the first image of a
            // new task; later images in the same task intentionally append.
            await clearExistingComposerAttachments(composerSurface, composerTarget);
        }
        const input = findBestImageInput(composerSurface, composerTarget);

        if (input) {
            assignFileOnce(input, file);
            return {
                success: true,
                committed: true,
                method: 'main-existing-file-input',
                fileName: file.name,
                fileSize: file.size
            };
        }

        if (!composerTarget || !composerSurface) {
            throw new Error('Dola did not expose an active composer.');
        }

        const activatedInput = await silentlyActivateAndAssign(file, composerSurface, composerTarget);
        return {
            success: true,
            committed: true,
            method: 'main-silent-plus-file-input',
            fileName: file.name,
            fileSize: file.size,
            inputAccept: activatedInput.getAttribute('accept') || ''
        };
    }

    async function clearExistingComposerAttachments(surface, target) {
        if (!(surface instanceof Element) && !(target instanceof Element)) return 0;
        const scope = (surface instanceof Element && surface) || target;
        const scopeRect = scope.getBoundingClientRect();
        const REMOVE_WORDS = /remove|delete|discard|clear|close|xóa|xoá|gỡ|loại bỏ|移除|删除|取消/i;
        const IMAGE_WORDS = /image|photo|picture|attachment|file|upload|preview|reference|ảnh|hình|tệp|đính kèm|图片|照片|附件/i;
        const IMAGE_SELECTOR = [
            'img',
            '[style*="blob:"]',
            '[style*="data:image"]',
            '[class*="attachment" i]',
            '[class*="preview" i]',
            '[data-testid*="attachment" i]',
            '[data-testid*="preview" i]',
            '[data-testid*="upload" i]'
        ].join(', ');
        const nearScope = (element) => {
            const rect = element.getBoundingClientRect();
            return rect.right >= scopeRect.left - 100 && rect.left <= scopeRect.right + 100 &&
                rect.bottom >= scopeRect.top - 260 && rect.top <= scopeRect.bottom + 280;
        };
        const hasImageContext = (element) => {
            let node = element.parentElement || element.getRootNode?.().host || null;
            for (let depth = 0; node && depth < 8; depth += 1) {
                if (IMAGE_WORDS.test(controlIdentity(node))) return true;
                try {
                    if (node.querySelector(IMAGE_SELECTOR)) return true;
                } catch {}
                if (node === scope) break;
                node = node.parentElement || node.getRootNode?.().host || null;
            }
            return false;
        };

        // React can keep the previous FileList even after its visible chip was
        // removed. Clear only file inputs belonging to this composer and emit
        // the same events Dola handles for a user change; never touch avatar,
        // profile, logo, or cover upload controls.
        const isComposerFileInput = (element) => {
            if (!(element instanceof HTMLInputElement) || element.type !== 'file') return false;
            const identity = controlIdentity(element);
            const accept = String(element.getAttribute('accept') || '').toLowerCase();
            if (/avatar|profile|logo|cover/.test(identity)) return false;
            if (!/image|photo|picture|reference|attachment|upload|file/.test(accept + ' ' + identity)) return false;
            if (scope.contains(element)) return true;
            let node = element.parentElement || element.getRootNode?.().host || null;
            for (let depth = 0; node && depth < 12; depth += 1) {
                if (node === scope || scope.contains(node)) return true;
                node = node.parentElement || node.getRootNode?.().host || null;
            }
            return false;
        };
        for (const input of queryAllDeep('input[type="file"]')) {
            if (!isComposerFileInput(input)) continue;
            try {
                const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
                if (descriptor?.set) descriptor.set.call(input, new DataTransfer().files);
                else input.value = '';
                input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
                input.dispatchEvent(new Event('change', {bubbles: true, composed: true}));
            } catch {}
        }
        const candidates = () => queryAllDeep('button, [role="button"], [aria-label], [title]')
            .filter(isVisible)
            .filter(element => !element.closest?.('#studio-relay-page-overlays'))
            .filter(element => scope.contains(element) || nearScope(element))
            .filter(element => {
                const identity = controlIdentity(element);
                return REMOVE_WORDS.test(identity) &&
                    (IMAGE_WORDS.test(identity) || hasImageContext(element));
            });

        let removed = 0;
        const attempted = new Set();
        for (let pass = 0; pass < 40; pass += 1) {
            const visibleCandidates = candidates();
            const candidate = visibleCandidates.find(element => !attempted.has(element));
            if (!candidate) break;
            attempted.add(candidate);
            try {
                candidate.focus?.({preventScroll: true});
                candidate.click();
                removed += 1;
            } catch {}
            await delay(120);
        }
        return removed;
    }

    function assignFileOnce(input, file) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        if (transfer.files.length !== 1) throw new Error('The page FileList could not be prepared.');

        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
        if (descriptor?.set) descriptor.set.call(input, transfer.files);
        else input.files = transfer.files;

        input.dispatchEvent(new Event('change', {bubbles: true, composed: true}));
    }

    async function silentlyActivateAndAssign(file, surface, target) {
        const beforeInputs = new Set(queryAllDeep('input[type="file"]'));
        const beforeControls = new Set(queryAllDeep(ACTIVATION_CONTROL_SELECTOR));
        const guard = installSilentFileChooserGuard();
        const plusControl = findComposerAddControl(surface, target);

        if (!plusControl) {
            guard.restore();
            // Không có nút + — thử drop thẳng vào composer.
            if (assignViaComposerDrop(file, surface, target)) {
                await delay(220);
                return { getAttribute: () => 'drop-fallback' };
            }
            throw new Error('Dola plus/add attachment control was not found in the active composer.');
        }

        try {
            activateControlOnce(plusControl);

            let input = await waitForActivatedImageInput(
                beforeInputs,
                surface,
                target,
                guard,
                900
            );
            if (!input) {
                const uploadControls = findUploadMenuControls(beforeControls, plusControl, surface);
                if (!uploadControls.length) {
                    // Thử drop trước khi fail cứng.
                    guard.restore();
                    if (assignViaComposerDrop(file, surface, target)) {
                        await delay(220);
                        return { getAttribute: () => 'drop-fallback' };
                    }
                    throw new Error('Dola opened the plus workflow but exposed no safe image/file upload control.');
                }
                for (const uploadControl of uploadControls) {
                    activateControlOnce(uploadControl);
                    input = await waitForActivatedImageInput(
                        beforeInputs,
                        surface,
                        target,
                        guard,
                        ACTIVATION_INPUT_TIMEOUT_MS
                    );
                    if (input) break;
                }
            }

            if (!input) {
                input = findAnyNewFileInput(beforeInputs, surface, target);
            }

            if (!input) {
                guard.restore();
                if (assignViaComposerDrop(file, surface, target)) {
                    await delay(220);
                    return { getAttribute: () => 'drop-fallback' };
                }
                throw new Error('Dola did not mount or expose its real file input after silent plus activation.');
            }

            assignFileOnce(input, file);
            await delay(180);
            return input;
        } finally {
            try { guard.restore(); } catch (e) {}
        }
    }

    /** Kéo-thả File vào composer — chỉ 1 lần (không paste kèm, tránh đính đôi). */
    function assignViaComposerDrop(file, surface, target) {
        try {
            const dropTarget = (surface instanceof Element && surface) || (target instanceof Element && target);
            if (!(dropTarget instanceof Element)) return false;
            const transfer = new DataTransfer();
            transfer.items.add(file);
            if (!transfer.files.length) return false;

            const rect = dropTarget.getBoundingClientRect();
            const clientX = Math.round(rect.left + Math.max(1, rect.width / 2));
            const clientY = Math.round(rect.top + Math.max(1, rect.height / 2));
            const base = {
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window,
                clientX,
                clientY,
                dataTransfer: transfer
            };

            dropTarget.dispatchEvent(new DragEvent('dragenter', base));
            dropTarget.dispatchEvent(new DragEvent('dragover', base));
            dropTarget.dispatchEvent(new DragEvent('drop', base));
            return true;
        } catch (e) {
            return false;
        }
    }

    function findAnyNewFileInput(beforeInputs, surface, target) {
        const candidates = queryAllDeep('input[type="file"]')
            .filter((input) => !input.disabled && !beforeInputs.has(input))
            .map((input, index) => ({
                input,
                index,
                score: scoreActivatedImageInput(input, beforeInputs, null, surface, target)
            }))
            .filter((candidate) => candidate.score >= 20)
            .sort((left, right) => (right.score - left.score) || (right.index - left.index));
        return candidates[0]?.input || null;
    }

    function activateControlOnce(element) {
        if (!(element instanceof Element)) {
            throw new Error('Dola upload activation control is invalid.');
        }

        const rect = element.getBoundingClientRect();
        const clientX = Math.round(rect.left + Math.max(1, rect.width / 2));
        const clientY = Math.round(rect.top + Math.max(1, rect.height / 2));
        try { element.focus({preventScroll: true}); } catch {}

        const shared = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX,
            clientY,
            button: 0
        };
        if (typeof PointerEvent === 'function') {
            element.dispatchEvent(new PointerEvent('pointerdown', {
                ...shared,
                buttons: 1,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
            }));
        }
        element.dispatchEvent(new MouseEvent('mousedown', {...shared, buttons: 1}));
        if (typeof PointerEvent === 'function') {
            element.dispatchEvent(new PointerEvent('pointerup', {
                ...shared,
                buttons: 0,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
            }));
        }
        element.dispatchEvent(new MouseEvent('mouseup', {...shared, buttons: 0}));

        if (typeof element.click === 'function') element.click();
        else element.dispatchEvent(new MouseEvent('click', {...shared, buttons: 0, detail: 1}));
    }
    function installSilentFileChooserGuard() {
        let capturedInput = null;
        const hiddenNodes = new Map();
        const inputPrototype = HTMLInputElement.prototype;
        const originalShowPicker = inputPrototype.showPicker;
        let showPickerPatched = false;

        const rememberAndHide = element => {
            if (!(element instanceof Element) || hiddenNodes.has(element)) return;
            const identity = controlIdentity(element);
            const role = String(element.getAttribute('role') || '').toLowerCase();
            const className = String(element.className || '').toLowerCase();
            const likelyOverlay = /menu|listbox|dialog/.test(role) ||
                /popover|dropdown|floating|portal|menu/.test(className) ||
                /upload|attach|choose.*file|select.*file|photo|gallery/.test(identity);
            if (!likelyOverlay) return;

            hiddenNodes.set(element, {
                opacity: element.style.getPropertyValue('opacity'),
                opacityPriority: element.style.getPropertyPriority('opacity'),
                pointerEvents: element.style.getPropertyValue('pointer-events'),
                pointerPriority: element.style.getPropertyPriority('pointer-events')
            });
            element.style.setProperty('opacity', '0', 'important');
            element.style.setProperty('pointer-events', 'none', 'important');
        };

        const inspectAddedNode = node => {
            if (!(node instanceof Element)) return;
            rememberAndHide(node);
            try {
                node.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [class*="popover" i], [class*="dropdown" i], [class*="floating" i], [class*="portal" i]')
                    .forEach(rememberAndHide);
            } catch {}
        };

        const observer = new MutationObserver(records => {
            records.forEach(record => {
                if (record.type === 'attributes') inspectAddedNode(record.target);
                else record.addedNodes.forEach(inspectAddedNode);
            });
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'aria-hidden', 'data-state', 'open']
        });

        const interceptFileClick = event => {
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
            const input = path.find(node => node instanceof HTMLInputElement && node.type === 'file');
            if (!input || event.isTrusted) return;
            capturedInput = input;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        document.addEventListener('click', interceptFileClick, true);

        if (typeof originalShowPicker === 'function') {
            try {
                inputPrototype.showPicker = function studioRelaySilentShowPicker() {
                    if (this instanceof HTMLInputElement && this.type === 'file') {
                        capturedInput = this;
                        return undefined;
                    }
                    return originalShowPicker.call(this);
                };
                showPickerPatched = true;
            } catch {}
        }

        return {
            getCapturedInput() {
                return capturedInput;
            },
            restore() {
                observer.disconnect();
                document.removeEventListener('click', interceptFileClick, true);
                if (showPickerPatched) {
                    try { inputPrototype.showPicker = originalShowPicker; } catch {}
                }
                hiddenNodes.forEach((previous, element) => {
                    if (!(element instanceof Element)) return;
                    if (previous.opacity) {
                        element.style.setProperty('opacity', previous.opacity, previous.opacityPriority);
                    } else {
                        element.style.removeProperty('opacity');
                    }
                    if (previous.pointerEvents) {
                        element.style.setProperty('pointer-events', previous.pointerEvents, previous.pointerPriority);
                    } else {
                        element.style.removeProperty('pointer-events');
                    }
                });
                hiddenNodes.clear();
            }
        };
    }

    function findComposerAddControl(surface, target) {
        const surfaceRect = surface.getBoundingClientRect();
        const candidates = queryAllDeep('button, [role="button"], label[for]')
            .filter(element => !element.closest?.('#studio-relay-page-overlays'))
            .filter(isVisible)
            .map((element, index) => ({
                element,
                index,
                score: scoreComposerAddControl(element, surface, target, surfaceRect)
            }))
            .filter(candidate => candidate.score >= 190)
            .sort((left, right) => (right.score - left.score) || (right.index - left.index));
        return candidates[0]?.element || null;
    }

    function semanticIdentity(element) {
        return [
            element.id,
            element.getAttribute?.('name'),
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('title'),
            element.getAttribute?.('data-testid'),
            element.getAttribute?.('data-tooltip-content'),
            String(element.innerText || element.textContent || '')
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function isDolaPlusIconButton(element) {
        const text = String(element.textContent || '').replace(/\s+/g, '').trim();
        if (text === '+' || text === '＋') return true;
        const path = element.querySelector?.('path');
        const d = String(path?.getAttribute('d') || '');
        return /M12[\d.]*\s+2\./.test(d) && /H20[\d.]*|H21/.test(d);
    }

    function scoreComposerAddControl(element, surface, target, surfaceRect) {
        const identity = semanticIdentity(element);
        const text = String(element.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (element.id === 'flow-end-msg-send') return -1000;
        if (/\bcreate\s*(?:images?|videos?)\b|\bgenerate\b|\bsend\b|\bsubmit\b|\bdownload\b|\bmodel\b|\bstyle\b|\btemplate\b|\bratio\b|\btranslate\b|\bavatar\b|\bprofile\b|\bfast\b|\bmore\b|\bwriting\b|\bhomework\b/.test(identity)) {
            return -1000;
        }

        const rect = element.getBoundingClientRect();
        const linked = surface.contains(element) || element.contains(target) ||
            rectanglesOverlap(rect, surfaceRect, 48);
        if (!linked) return -1000;

        let score = 0;
        if (text === '+' || text === '＋') score += 360;
        if (isDolaPlusIconButton(element)) score += 380;
        if (/\bplus\b|(?:^|\s)add(?:\s|$)|add\s*(?:attachment|file|image|photo)|attach|upload/.test(identity)) score += 300;
        if (surface.contains(element)) score += 150;
        if (rect.width <= 72 && rect.height <= 72) score += 50;
        if (rect.left <= surfaceRect.left + 56) score += 140;
        const leftOffset = Math.max(0, rect.left - surfaceRect.left);
        score += Math.max(0, 180 - Math.min(180, leftOffset));
        if (rect.bottom >= surfaceRect.top + surfaceRect.height * 0.45) score += 35;
        return score;
    }

    function findUploadMenuControls(beforeControls, plusControl, surface) {
        const plusRect = plusControl.getBoundingClientRect();
        const candidates = queryAllDeep(ACTIVATION_CONTROL_SELECTOR)
            .filter(element => element !== plusControl)
            .filter(element => !element.closest?.('#studio-relay-page-overlays'))
            .filter(hasLayoutBox)
            .map((element, index) => ({
                element,
                index,
                score: scoreUploadMenuControl(element, beforeControls, plusRect, surface)
            }))
            .filter(candidate => candidate.score >= 140)
            .sort((left, right) => (right.score - left.score) || (right.index - left.index));

        const list = candidates.map((c) => c.element);
        // Dedup by nearest clickable parent
        const seen = new Set();
        return list.filter((el) => {
            const key = el;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, 5);
    }

    function findUploadMenuControl(beforeControls, plusControl, surface) {
        return findUploadMenuControls(beforeControls, plusControl, surface)[0] || null;
    }

    function scoreUploadMenuControl(element, beforeControls, plusRect, surface) {
        const identity = semanticIdentity(element);
        // EN + VI + CN — Dola hay hiện menu không phải tiếng Anh.
        const uploadLike = /upload|attach|image|photo|picture|file|gallery|computer|device|local|from\s*device|choose\s*file|select\s*file|tải\s*lên|tai\s*len|ảnh|anh|hình|hinh|tệp|tep|thư\s*viện|thu\s*vien|máy\s*tính|may\s*tinh|thiết\s*bị|thiet\s*bi|上传|图片|相片|相册|本地|文件|从电脑|添加图片|添加文件|附件/.test(identity);
        const rejectLike = /\bcreate\s*videos?\b|\bcreate\s*images?\b|\bgenerate\b|\bcamera\b|\baudio\b|\bavatar\b|\bprofile\b|\blogo\b|\bcover\b|\bsend\b|\bsubmit\b|tạo\s*video|tao\s*video|tạo\s*ảnh|tao\s*anh|创建视频|创建图片|拍照|拍摄/.test(identity);
        if (rejectLike) return -1000;

        const inOverlay = Boolean(
            element.closest?.('[role="menu"], [role="listbox"], [role="dialog"], [class*="popover" i], [class*="dropdown" i], [class*="floating" i], [class*="portal" i], [class*="menu" i]')
        );
        const isFresh = !beforeControls.has(element);
        const hasFileChild = Boolean(element.querySelector?.('input[type="file"]'));
        const looksIconOnly = !String(element.innerText || '').trim() && Boolean(element.querySelector?.('svg, img, path'));

        if (!uploadLike && !hasFileChild && !(isFresh && inOverlay)) return -1000;

        let score = 0;
        if (isFresh) score += 220;
        if (uploadLike) score += 240;
        if (/upload|attach|choose\s*file|select\s*file|tải\s*lên|tai\s*len|上传|添加文件|添加图片/.test(identity)) score += 80;
        if (/image|photo|picture|ảnh|anh|hình|图片|相片|相册/.test(identity)) score += 120;
        if (element.matches('label[for]')) score += 80;
        if (hasFileChild) score += 280;
        if (inOverlay) score += 90;
        if (isFresh && inOverlay && looksIconOnly) score += 60;
        if (!surface.contains(element)) score += 30;

        const rect = element.getBoundingClientRect();
        const distance = Math.hypot(rect.left - plusRect.left, rect.top - plusRect.top);
        if (distance <= 480) score += 70;
        if (distance <= 220) score += 40;
        return score;
    }

    async function waitForActivatedImageInput(beforeInputs, surface, target, guard, timeoutMs) {
        const deadline = Date.now() + Math.max(ACTIVATION_POLL_MS, Number(timeoutMs) || 0);
        while (Date.now() < deadline) {
            const captured = guard.getCapturedInput();
            const input = findActivatedImageInput(beforeInputs, captured, surface, target);
            if (input) return input;
            await delay(ACTIVATION_POLL_MS);
        }
        return null;
    }

    function findActivatedImageInput(beforeInputs, capturedInput, surface, target) {
        const candidates = queryAllDeep('input[type="file"]')
            .filter(input => !input.disabled)
            .map((input, index) => ({
                input,
                index,
                score: scoreActivatedImageInput(input, beforeInputs, capturedInput, surface, target)
            }))
            .filter(candidate => candidate.score >= 140)
            .sort((left, right) => (right.score - left.score) || (right.index - left.index));
        return candidates[0]?.input || null;
    }

    function scoreActivatedImageInput(input, beforeInputs, capturedInput, surface, target) {
        const accept = String(input.getAttribute('accept') || '').toLowerCase();
        const identity = controlIdentity(input);
        const explicitImage = /image\//.test(accept) || /\.(?:avif|gif|jpe?g|png|webp)/.test(accept);
        const imageIdentity = /image|photo|picture|attachment|upload|file/.test(identity);
        const profileIdentity = /avatar|profile|logo|cover/.test(identity);
        const linked = isInputLinked(input, surface, target);

        if (/video\//.test(accept) && !/image\//.test(accept)) return -1000;
        if (/audio\//.test(accept) && !/image\//.test(accept)) return -1000;
        if (profileIdentity) return -1000;

        let score = 0;
        if (input === capturedInput) score += 1000;
        if (!beforeInputs.has(input)) score += 360;
        if (explicitImage) score += 220;
        if (imageIdentity) score += 120;
        if (linked) score += 160;
        if (!accept || accept.includes('*/*')) score += 20;
        return score;
    }

    function controlIdentity(element) {
        return [
            element.id,
            element.getAttribute?.('name'),
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('title'),
            element.getAttribute?.('data-testid'),
            element.getAttribute?.('data-tooltip-content'),
            element.getAttribute?.('data-state'),
            String(element.className || ''),
            String(element.textContent || '')
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function rectanglesOverlap(left, right, margin) {
        return left.right >= right.left - margin &&
            left.left <= right.right + margin &&
            left.bottom >= right.top - margin &&
            left.top <= right.bottom + margin;
    }

    function hasLayoutBox(element) {
        if (!(element instanceof Element)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function delay(milliseconds) {
        return new Promise(resolve => window.setTimeout(resolve, milliseconds));
    }
    function findBestImageInput(surface, target) {
        const candidates = queryAllDeep('input[type="file"]')
            .filter(input => !input.disabled)
            .map((input, index) => ({input, index, score: scoreImageInput(input, surface, target)}))
            .filter(candidate => candidate.score >= 120)
            .sort((left, right) => (right.score - left.score) || (right.index - left.index));
        return candidates[0]?.input || null;
    }

    function scoreImageInput(input, surface, target) {
        const accept = String(input.getAttribute('accept') || '').toLowerCase();
        const identity = [
            input.id,
            input.name,
            input.className,
            input.getAttribute('aria-label'),
            input.getAttribute('title'),
            input.getAttribute('data-testid')
        ].filter(Boolean).join(' ').toLowerCase();
        const explicitImage = /image\//.test(accept) || /\.(?:avif|gif|jpe?g|png|webp)/.test(accept);
        const imageIdentity = /image|photo|picture|reference|attachment|upload/.test(identity);
        const profileIdentity = /avatar|profile|logo|cover/.test(identity);
        const linked = isInputLinked(input, surface, target);

        if (/video\//.test(accept) && !/image\//.test(accept)) return -1000;
        if (/audio\//.test(accept) && !/image\//.test(accept)) return -1000;
        if (profileIdentity) return -1000;
        if (!explicitImage && !imageIdentity && !linked) return -1000;

        let score = 0;
        if (explicitImage) score += 180;
        if (imageIdentity) score += 70;
        if (linked) score += 110;
        if (!accept || accept.includes('*/*')) score -= 25;
        if (input.multiple) score += 5;
        return score;
    }

    function isInputLinked(input, surface, target) {
        if (surface?.contains?.(input) || input.form?.contains?.(target)) return true;
        const inputId = String(input.id || '').trim();
        if (inputId && surface) {
            try {
                if (Array.from(surface.querySelectorAll('label[for]')).some(label => label.htmlFor === inputId)) {
                    return true;
                }
            } catch {}
        }

        let current = input.parentElement || input.getRootNode?.().host || null;
        for (let depth = 0; current && depth < 8; depth += 1) {
            if (target && current.contains?.(target)) return true;
            current = current.parentElement || current.getRootNode?.().host || null;
        }
        return false;
    }

    function findComposerTarget() {
        const candidates = queryAllDeep(COMPOSER_SELECTOR)
            .filter(element => !element.closest?.('#studio-relay-page-overlays'))
            .filter(isVisible)
            .map((element, index) => ({element, index, score: scoreComposer(element)}))
            .sort((left, right) => (right.score - left.score) || (right.index - left.index));
        return candidates[0]?.element || null;
    }

    function scoreComposer(element) {
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
        const named = target.closest?.('.guidance-input-surface, [class*="guidance-input-surface"], [class*="input-content-container"]');
        if (named instanceof Element) return named;
        let current = target;
        let best = target;
        for (let depth = 0; current && depth < 14; depth += 1) {
            const rect = current.getBoundingClientRect();
            const hasEditor = current.matches?.(COMPOSER_SELECTOR) || Boolean(current.querySelector?.(COMPOSER_SELECTOR));
            if (hasEditor && rect.width >= 240 && rect.height >= 24 && rect.height <= 600) best = current;
            if (rect.height > 600) break;
            current = current.parentElement || current.getRootNode?.().host || null;
        }
        return best;
    }

    function queryAllDeep(selector) {
        const results = [];
        const roots = [document];
        while (roots.length) {
            const root = roots.shift();
            let elements = [];
            try { elements = Array.from(root.querySelectorAll(selector)); } catch {}
            results.push(...elements);
            let descendants = [];
            try { descendants = root.querySelectorAll('*'); } catch {}
            descendants.forEach(element => {
                if (element.shadowRoot) roots.push(element.shadowRoot);
            });
        }
        return Array.from(new Set(results));
    }

    function dataUrlToFile(payload) {
        const dataUrl = String(payload.dataUrl || '');
        const commaIndex = dataUrl.indexOf(',');
        if (commaIndex < 0) throw new Error('The image payload is not a valid data URL.');

        const header = dataUrl.slice(0, commaIndex);
        const encoded = dataUrl.slice(commaIndex + 1);
        const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?$/i.exec(header);
        const mimeType = String(payload.type || match?.[1] || '').toLowerCase();
        if (!match?.[2] || !SUPPORTED_MIME_TYPES.has(mimeType)) {
            throw new Error('The image payload type is not supported.');
        }
        if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) {
            throw new Error('The image is larger than 25 MB.');
        }

        let binary;
        try { binary = atob(encoded); } catch { throw new Error('The image payload could not be decoded.'); }
        if (!binary.length || binary.length > MAX_IMAGE_BYTES) {
            throw new Error('The image is empty or larger than 25 MB.');
        }

        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return new File([bytes], sanitizeFileName(payload.name, mimeType), {
            type: mimeType,
            lastModified: Number(payload.lastModified) || Date.now()
        });
    }

    function sanitizeFileName(value, mimeType) {
        const extensions = {
            'image/avif': 'avif',
            'image/gif': 'gif',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp'
        };
        const extension = extensions[mimeType] || 'png';
        const leaf = String(value || '')
            .split(/[\\/]/)
            .pop()
            .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
            .trim();
        if (!leaf) return `studio-relay-image.${extension}`;
        if (/\.[a-z0-9]{2,5}$/i.test(leaf)) return leaf.slice(0, 180);
        return `${leaf.slice(0, 170)}.${extension}`;
    }

    function safeRequestIdFromDetail(detail) {
        if (typeof detail !== 'string' || detail.length > MAX_REQUEST_CHARS) return '';
        try {
            const parsed = JSON.parse(detail);
            return isSafeId(parsed?.requestId) ? parsed.requestId : '';
        } catch {
            return '';
        }
    }

    function isSafeId(value) {
        return typeof value === 'string' && /^[a-zA-Z0-9_-]{12,160}$/.test(value);
    }

    function isSupportedPage() {
        if (!['http:', 'https:'].includes(location.protocol)) return false;
        return SUPPORTED_HOSTS.some(host => location.hostname === host || location.hostname.endsWith(`.${host}`));
    }

    function isVisible(element) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function failure(error) {
        return {success: false, committed: false, error: error?.message || String(error)};
    }

    function respond(requestId, result) {
        const detail = JSON.stringify({v: 2, requestId, ...result});
        document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {detail}));
    }
})();
