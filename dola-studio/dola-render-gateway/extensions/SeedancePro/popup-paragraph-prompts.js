(() => {
    'use strict';

    const TEXTAREA_ID = 'textarea-quick-prompts';
    const ADD_BUTTON_ID = 'btn-add-bulk-prompts';
    const COUNT_ID = 'paragraph-prompt-count';
    const STORAGE_KEY = 'ctb_saved_prompts';

    /**
     * Smart Parser:
     * - If blank lines exist, splits by blank lines.
     * - Otherwise, splits by every single line break.
     */
    function parseParagraphs(value) {
        const normalized = String(value ?? '')
            .replace(/\r\n?/g, '\n')
            .trim();

        if (!normalized) return [];

        if (/\n[^\S\n]*\n/.test(normalized)) {
            return normalized
                .split(/\n(?:[^\S\n]*\n)+/)
                .map(paragraph => paragraph.trim())
                .filter(Boolean);
        }

        return normalized
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
    }

    function createCountUi(textarea) {
        textarea.placeholder = '✍️ Dán kịch bản tại đây (Mỗi dòng hoặc mỗi đoạn là 1 cảnh riêng biệt, hoặc nạp file .txt, .csv)...';

        const meta = document.createElement('div');
        meta.className = 'paragraph-prompt-meta';
        meta.setAttribute('aria-live', 'polite');
        meta.innerHTML = `
            <span class='paragraph-prompt-hint'>💡 1 dòng / 1 đoạn = 1 phân cảnh độc lập</span>
            <span class='paragraph-prompt-count'>Đã nhận diện: <strong id='${COUNT_ID}'>0</strong> cảnh</span>
        `;
        textarea.insertAdjacentElement('afterend', meta);

        return meta.querySelector(`#${COUNT_ID}`);
    }

    function initializeParagraphPrompts() {
        const textarea = document.getElementById(TEXTAREA_ID);
        const addButton = document.getElementById(ADD_BUTTON_ID);

        if (!textarea) return;

        const count = document.getElementById(COUNT_ID) || createCountUi(textarea);

        if (!count) return;

        const updateCount = () => {
            count.textContent = String(parseParagraphs(textarea.value).length);
        };

        const showStorageError = error => {
            addButton.disabled = false;
            window.alert(`Không thể thêm phân cảnh: ${error?.message || String(error)}`);
        };

        const appendParagraphs = paragraphs => {
            addButton.disabled = true;

            chrome.storage.local.get([STORAGE_KEY], result => {
                const readError = chrome.runtime.lastError;
                if (readError) {
                    showStorageError(readError);
                    return;
                }

                const saved = Array.isArray(result?.[STORAGE_KEY])
                    ? result[STORAGE_KEY]
                    : [];
                const additions = paragraphs.map((text, index) => ({
                    title: `Cảnh #${saved.length + index + 1}`,
                    text,
                    done: false
                }));
                const updated = [...saved, ...additions];

                chrome.storage.local.set({[STORAGE_KEY]: updated}, () => {
                    const writeError = chrome.runtime.lastError;
                    if (writeError) {
                        showStorageError(writeError);
                        return;
                    }

                    textarea.value = '';
                    addButton.disabled = false;
                    updateCount();

                    // Reload so the protected popup's private prompt array is
                    // rehydrated from the just-saved list before other actions.
                    const reloadEvent = new CustomEvent('ctb:prompts-saved', {
                        cancelable: true,
                        detail: {added: additions.length, total: updated.length}
                    });
                    if (document.dispatchEvent(reloadEvent)) window.location.reload();
                });
            });
        };

        textarea.addEventListener('input', updateCount);
        textarea.addEventListener('change', updateCount);
        textarea.addEventListener('paste', () => setTimeout(updateCount, 20));

        updateCount();

        // Direct capture click handler to guarantee multi-prompt insertion if button present
        if (addButton) {
            addButton.addEventListener('click', (event) => {
                const paragraphs = parseParagraphs(textarea.value);
                if (paragraphs.length > 0) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    appendParagraphs(paragraphs);
                }
            }, true);
        }
    }

    window.CTBParagraphPrompts = Object.freeze({
        parseParagraphs
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeParagraphPrompts, {once: true});
    } else {
        initializeParagraphPrompts();
    }
})();
