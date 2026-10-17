(function () {
    'use strict';

    const confirmationCopy = {
        'btn-clear-session': {
            title: 'Làm mới phiên làm việc?',
            description: 'Thao tác này sẽ làm mới trạng thái tài khoản trên tab hiện tại.',
            confirmLabel: 'Làm mới phiên'
        },
        'btn-clear-prompts': {
            title: 'Xóa toàn bộ kịch bản?',
            description: 'Mọi phân cảnh và trạng thái tiến độ đã lưu sẽ bị xóa sạch.',
            confirmLabel: 'Đồng ý xóa'
        },
        'btn-clear-images': {
            title: 'Xóa toàn bộ ảnh mẫu?',
            description: 'Mọi ảnh trong hàng đợi Img2Vid sẽ bị xóa sạch.',
            confirmLabel: 'Đồng ý xóa'
        },
        'btn-reset-progress': {
            title: 'Đặt lại tiến độ kịch bản?',
            description: 'Tất cả các phân cảnh đã hoàn thành sẽ chuyển về trạng thái đang chờ.',
            confirmLabel: 'Đặt lại tiến độ'
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (typeof globalThis !== 'undefined' && globalThis.__SR_SECURITY_SHIELD__) {
            globalThis.__SR_SECURITY_SHIELD__.mountProtectedLinks();
        }
        syncTabAccessibility();
        installTabStateObserver();
        installLicenseStateObserver();
        installRuntimeCopyPolish();
        installConfirmationDialog();
        installInteractiveFileDropzone();
        installPresetChips();
        installPromptItemActions();
    });

    function installPresetChips() {
        const textarea = document.getElementById('textarea-quick-prompts');
        const chips = document.querySelectorAll('.preset-chip');
        if (!textarea || !chips.length) return;

        chips.forEach(chip => {
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                const style = chip.dataset.style || '';
                if (!style) return;
                const current = textarea.value.trim();
                if (!current) {
                    textarea.value = style;
                } else {
                    textarea.value = current + ', ' + style;
                }
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.focus();
            });
        });
    }

    function installInteractiveFileDropzone() {
        const fileInput = document.getElementById('file-upload-prompts');
        const triggerBtn = document.getElementById('btn-trigger-upload-prompts');
        const container = document.getElementById('prompts-container');
        if (!fileInput || fileInput.__sr_promptUploadBound) return;
        fileInput.__sr_promptUploadBound = true;

        if (triggerBtn) {
            let openingPicker = false;
            triggerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (openingPicker) return;
                openingPicker = true;
                try {
                    fileInput.value = '';
                    fileInput.click();
                } finally {
                    setTimeout(() => { openingPicker = false; }, 1000);
                }
            });
        }

        if (container) {
            container.addEventListener('click', (event) => {
                const emptyState = event.target.closest('.empty-state, #prompts-empty-dropzone');
                if (emptyState) {
                    event.preventDefault();
                    fileInput.click();
                }
            });
        }

        fileInput.addEventListener('change', (event) => {
            const files = event.target.files;
            if (!files || !files.length) return;

            const file = files[0];
            const reader = new FileReader();

            reader.onload = (e) => {
                const textContent = e.target.result || '';
                let paragraphs = [];

                if (window.CTBParagraphPrompts && typeof window.CTBParagraphPrompts.parseParagraphs === 'function') {
                    paragraphs = window.CTBParagraphPrompts.parseParagraphs(textContent);
                } else {
                    paragraphs = String(textContent)
                        .replace(/\r\n?/g, '\n')
                        .split(/\n+/)
                        .map(p => p.trim())
                        .filter(Boolean);
                }

                if (!paragraphs.length) {
                    alert('No prompts found in the selected file.');
                    fileInput.value = '';
                    return;
                }

                const STORAGE_KEY = 'ctb_saved_prompts';
                chrome.storage.local.get([STORAGE_KEY], (result) => {
                    const saved = Array.isArray(result?.[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
                    const additions = paragraphs.map((text, index) => ({
                        title: `Prompt #${saved.length + index + 1}`,
                        text,
                        done: false
                    }));
                    const updated = [...saved, ...additions];

                    chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
                        fileInput.value = '';
                        window.location.reload();
                    });
                });
            };

            reader.readAsText(file);
        });
    }

    function disableStudioFeature() {
        const studioTab = document.getElementById('tab-generator');
        const studioView = document.getElementById('view-generator');
        const promptsTab = document.getElementById('tab-prompts');
        if (!studioTab || !studioView || !promptsTab) return;

        studioTab.hidden = true;
        studioTab.tabIndex = -1;
        studioTab.setAttribute('aria-hidden', 'true');
        studioTab.setAttribute('aria-selected', 'false');
        studioView.hidden = true;
        studioView.classList.add('hidden');
        studioView.setAttribute('aria-hidden', 'true');

        const redirectFromStudio = () => {
            const hasVisibleActiveTab = document.querySelector('.nav-btn.active:not([hidden])');
            if (studioTab.classList.contains('active') || !hasVisibleActiveTab) promptsTab.click();
        };

        redirectFromStudio();
        const observer = new MutationObserver(redirectFromStudio);
        observer.observe(studioTab, { attributes: true, attributeFilter: ['class'] });
        observer.observe(studioView, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    function syncTabAccessibility() {
        document.querySelectorAll('.nav-btn').forEach((button) => {
            if (button.hidden) {
                button.setAttribute('aria-selected', 'false');
                button.tabIndex = -1;
                const hiddenPanelId = button.getAttribute('aria-controls');
                const hiddenPanel = hiddenPanelId ? document.getElementById(hiddenPanelId) : null;
                if (hiddenPanel) hiddenPanel.setAttribute('aria-hidden', 'true');
                return;
            }
            const isActive = button.classList.contains('active');
            button.setAttribute('aria-selected', String(isActive));
            button.tabIndex = isActive ? 0 : -1;

            const panelId = button.getAttribute('aria-controls');
            const panel = panelId ? document.getElementById(panelId) : null;
            if (panel) panel.setAttribute('aria-hidden', String(!isActive));
        });
    }

    function installTabStateObserver() {
        const tabs = document.querySelector('.nav-tabs');
        if (!tabs) return;

        tabs.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const buttons = Array.from(tabs.querySelectorAll('.nav-btn:not([hidden])'));
            const currentIndex = buttons.indexOf(document.activeElement);
            if (currentIndex < 0) return;

            event.preventDefault();
            let nextIndex = currentIndex;
            if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
            if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = buttons.length - 1;
            buttons[nextIndex].focus();
            buttons[nextIndex].click();
        });

        new MutationObserver(syncTabAccessibility).observe(tabs, {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true
        });
    }

    function installLicenseStateObserver() {
        const lock = document.getElementById('view-license-lock');
        const main = document.getElementById('main-unlocked-ui');

        const forceUnlock = () => {
            if (lock && lock.style.display !== 'none') {
                lock.style.setProperty('display', 'none', 'important');
            }
            if (main && main.style.display !== 'flex') {
                main.style.setProperty('display', 'flex', 'important');
            }
            document.body.classList.remove('license-locked');
        };

        if (lock && main) {
            const observer = new MutationObserver(forceUnlock);
            observer.observe(lock, { attributes: true, attributeFilter: ['style', 'class'] });
            observer.observe(main, { attributes: true, attributeFilter: ['style', 'class'] });
        }
        forceUnlock();
    }

    function installRuntimeCopyPolish() {
        const accountBadge = document.getElementById('header-active-account');
        const copyButton = document.getElementById('btn-copy-machine-id');
        const fetchButton = document.getElementById('btn-fetch');
        const licenseInfo = document.getElementById('settings-license-info');
        const activationStatus = document.getElementById('activation-error');
        const prompts = document.getElementById('prompts-container');
        const profiles = document.getElementById('profiles-container');

        const polishAccount = () => {
            if (!accountBadge) return;
            const current = accountBadge.textContent.trim();
            if (/default/i.test(current)) {
                accountBadge.textContent = '🟢 Mặc định';
            } else if (current && !current.startsWith('🟢') && !current.startsWith('🔴')) {
                accountBadge.textContent = '🟢 ' + current;
            }
        };

        const polishCopyButton = () => {
            if (!copyButton) return;
            const current = copyButton.textContent.trim();
            let next = current;
            if (/copied/i.test(current)) next = '📋 Đã sao chép';
            else if (/copy/i.test(current)) next = '📋 Sao chép mã';
            if (next !== current) copyButton.textContent = next;
        };

        const polishFetchButton = () => {
            if (!fetchButton) return;
            const label = fetchButton.querySelector('span');
            if (!label || label.querySelector('strong')) return;
            const current = label.textContent.trim();
            if (/fetching|downloading/i.test(current)) {
                label.className = 'button-copy';
                label.innerHTML = '<strong>Đang tải video…</strong><small>Bóc tách luồng master 1080P</small>';
            } else if (/download/i.test(current)) {
                label.className = 'button-copy';
                label.innerHTML = '<strong>Tải Video 1080P</strong><small>Lưu video gốc chất lượng cao nhất</small>';
            }
        };

        const polishLicenseInfo = () => {
            if (!licenseInfo) return;
            const current = licenseInfo.textContent.trim();
            if (!current) return;
            if (/sonicvoice|0908\s*449\s*168/i.test(current)) return;
            if (/lifetime|activated|active|vip/i.test(current)) {
                licenseInfo.textContent = 'Chính chủ Sonicvoice.pro · Hỗ trợ Zalo 0908 449 168';
            }
        };

        const polishActivationStatus = () => {
            if (!activationStatus) return;
            const current = activationStatus.textContent.trim();
            let next = current;
            let success = false;
            if (/please enter a vip license key/i.test(current)) next = 'Vui lòng nhập mã bản quyền.';
            if (/license activated successfully/i.test(current)) {
                next = 'Kích hoạt thành công. Đang mở Studio…';
                success = true;
            }
            if (/invalid vip key/i.test(current)) next = 'Mã không hợp lệ cho thiết bị này.';
            if (next !== current) activationStatus.textContent = next;
            activationStatus.classList.toggle('success', success || /activated|thành công/i.test(next));
            activationStatus.style.removeProperty('color');
        };

        const polishDynamicCards = (root) => {
            if (!root) return;
            const setButtonText = (button, text) => {
                if (button.textContent !== text) button.textContent = text;
            };
            root.querySelectorAll('.btn-prompt-paste').forEach((button) => {
                setButtonText(button, 'Dán');
                button.setAttribute('aria-label', 'Dán phân cảnh vào ô chat Dola');
                button.setAttribute('title', 'Dán phân cảnh vào ô chat Dola');
            });
            root.querySelectorAll('.btn-mini-tab').forEach((button) => {
                setButtonText(button, 'Mở Tab');
                button.setAttribute('aria-label', 'Mở tài khoản');
            });
            root.querySelectorAll('.btn-mini-newtab').forEach((button) => {
                setButtonText(button, 'Tab Mới');
                button.setAttribute('aria-label', 'Mở tài khoản trong tab mới');
            });
            root.querySelectorAll('.btn-mini-switch').forEach((button) => {
                setButtonText(button, 'Kích Hoạt');
                button.setAttribute('aria-label', 'Chuyển sang tài khoản này');
            });
            root.querySelectorAll('.btn-prompt-del').forEach((button) => {
                setButtonText(button, '×');
                button.setAttribute('aria-label', 'Xóa phân cảnh');
                button.setAttribute('title', 'Xóa phân cảnh');
            });
            root.querySelectorAll('.btn-toggle-done').forEach((button) => {
                const isDone = Boolean(button.closest('.prompt-done'));
                setButtonText(button, isDone ? '✓' : '○');
                button.setAttribute('aria-label', isDone ? 'Đã xong' : 'Đang chờ');
                button.setAttribute('title', isDone ? 'Bấm để chuyển về đang chờ' : 'Bấm để đánh dấu đã xong');
            });

            // Polish empty states:
            root.querySelectorAll('.empty-state, #prompts-empty-dropzone').forEach(el => {
                if (/no prompts loaded|click here to select|paste prompts above/i.test(el.textContent)) {
                    el.textContent = '📁 Chưa có phân cảnh nào. Hãy bấm vào đây để nạp file (.txt, .csv) hoặc dán kịch bản ở trên.';
                } else if (/no saved accounts yet/i.test(el.textContent)) {
                    el.textContent = '👥 Chưa có tài khoản nào được lưu. Đăng nhập Dola rồi bấm "💾 Lưu Tab Đang Mở" nhé!';
                }
            });
        };

        const observe = (element, callback, options) => {
            if (!element) return;
            callback();
            new MutationObserver(callback).observe(element, options || {
                childList: true,
                characterData: true,
                subtree: true
            });
        };

        observe(accountBadge, polishAccount);
        observe(copyButton, polishCopyButton);
        observe(fetchButton, polishFetchButton);
        observe(licenseInfo, polishLicenseInfo);
        observe(activationStatus, polishActivationStatus);
        observe(prompts, () => polishDynamicCards(prompts));
        observe(profiles, () => polishDynamicCards(profiles));
    }

    function installConfirmationDialog() {
        const dialog = document.getElementById('confirm-dialog');
        const title = document.getElementById('confirm-dialog-title');
        const description = document.getElementById('confirm-dialog-description');
        const cancelButton = document.getElementById('confirm-dialog-cancel');
        const acceptButton = document.getElementById('confirm-dialog-accept');
        if (!dialog || typeof dialog.showModal !== 'function' || !title || !description || !cancelButton || !acceptButton) return;

        const nativeConfirm = window.confirm.bind(window);
        let pendingTarget = null;
        let confirmedTarget = null;
        let bypassNextNativeConfirm = false;

        window.confirm = (message) => {
            if (bypassNextNativeConfirm) {
                bypassNextNativeConfirm = false;
                return true;
            }
            return nativeConfirm(message);
        };

        document.addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (!button) return;
            if (button === confirmedTarget) {
                confirmedTarget = null;
                return;
            }

            const copy = confirmationCopy[button.id];
            if (!copy) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            pendingTarget = button;
            title.textContent = copy.title;
            description.textContent = copy.description;
            acceptButton.textContent = copy.confirmLabel;
            dialog.showModal();
            cancelButton.focus();
        }, true);

        const closeDialog = () => {
            pendingTarget = null;
            if (dialog.open) dialog.close();
        };

        cancelButton.addEventListener('click', closeDialog);
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeDialog();
        });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) closeDialog();
        });

        acceptButton.addEventListener('click', () => {
            const target = pendingTarget;
            if (!target) return closeDialog();

            pendingTarget = null;
            dialog.close();
            confirmedTarget = target;
            bypassNextNativeConfirm = true;
            target.click();
            window.setTimeout(() => {
                confirmedTarget = null;
                bypassNextNativeConfirm = false;
            }, 0);
        });
    }

    function installPromptItemActions() {
        const container = document.getElementById('prompts-container');
        if (!container) return;

        container.addEventListener('click', (event) => {
            const pasteBtn = event.target.closest('.btn-prompt-paste');
            if (pasteBtn) {
                event.preventDefault();
                event.stopPropagation();

                const item = pasteBtn.closest('.prompt-item');
                const textEl = item ? item.querySelector('.prompt-text') : null;
                const text = textEl ? textEl.textContent.trim() : '';
                if (!text) return;

                chrome.tabs.query({ url: ['*://*.dola.com/*', '*://dola.com/*'] }, (tabs) => {
                    const dolaTabs = (tabs || []).filter(t => (t.url || '').toLowerCase().includes('/chat') && !t.url.includes('.js') && !t.url.includes('worker'));
                    const targetTabs = dolaTabs.length > 0 ? dolaTabs : (tabs || []).filter(t => !t.url.includes('.js'));
                    targetTabs.sort((a, b) => {
                        if (a.active !== b.active) return b.active ? -1 : 1;
                        return (b.lastAccessed || 0) - (a.lastAccessed || 0);
                    });
                    const targetTab = targetTabs[0];
                    if (targetTab && targetTab.id) {
                        const selDuration = document.getElementById('sel-prompt-duration');
                        const selAspect = document.getElementById('sel-aspect-ratio');
                        const rawDur = selDuration?.value || '15s';
                        const config = {
                            mode: 'single',
                            duration: rawDur === '30s' ? '15s' : rawDur,
                            aspectRatio: selAspect?.value || '16:9'
                        };
                        chrome.tabs.sendMessage(targetTab.id, {
                            action: 'paste_specific_prompt',
                            text: text,
                            config: config,
                            autoSubmit: true
                        }, () => {
                            if (chrome.runtime.lastError) {
                                if (chrome.scripting && chrome.scripting.executeScript) {
                                    chrome.scripting.executeScript({
                                        target: { tabId: tabs[0].id },
                                        func: (t) => {
                                            const el = document.querySelector('textarea, div[contenteditable=true], [role=textbox], input[type=text]');
                                            if (!el) return;
                                            el.focus();
                                            if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
                                                el.innerHTML = '';
                                                try {
                                                    document.execCommand('selectAll', false, null);
                                                    document.execCommand('insertText', false, t);
                                                } catch (e) {}
                                                if (!el.textContent || !el.textContent.trim()) {
                                                    el.innerText = t;
                                                    el.textContent = t;
                                                }
                                                el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: t }));
                                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                                el.dispatchEvent(new Event('change', { bubbles: true }));
                                            } else {
                                                const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                                                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                                                if (setter) setter.call(el, t); else el.value = t;
                                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                                el.dispatchEvent(new Event('change', { bubbles: true }));
                                            }
                                        },
                                        args: [text]
                                    }).catch(() => {});
                                }
                            }
                        });
                    }
                });
            }
        });
    }

    function updateHeroBtnSubtitle() {
        const heroSubtitle = document.getElementById('hero-btn-subtitle');
        if (!heroSubtitle) return;
        heroSubtitle.textContent = 'Tối đa 2 video / chat · 1 Profile Chrome = 1 Acc Dola';
    }

    function initializeGeneratorControls() {
        const radSingle = document.getElementById('radio-mode-single');
        const inputPrefix = document.getElementById('input-prompt-prefix');
        const selModel = document.getElementById('sel-model-version');
        const selAspect = document.getElementById('sel-aspect-ratio');
        const selDuration = document.getElementById('sel-prompt-duration');
        const chkDirect = document.getElementById('chk-direct-create');

        if (!inputPrefix || !selAspect) return;

        const syncModeToDolaTabs = (mode) => {
            if (typeof chrome === 'undefined' || !chrome.tabs) return;
            const selDuration = document.getElementById('sel-prompt-duration');
            const selAspect = document.getElementById('sel-aspect-ratio');
            let duration = selDuration?.value || '15s';
            if (duration === '30s') duration = '15s';
            const aspectRatio = selAspect?.value || '16:9';

            chrome.tabs.query({}, (tabs) => {
                if (!tabs || !tabs.length) return;
                const dolaTabs = tabs.filter(t => {
                    const u = (t.url || '').toLowerCase();
                    return (u.includes('dola.com') || u.includes('doubao.com')) && !u.includes('.js');
                });
                dolaTabs.forEach((tab) => {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'SET_DOLA_GENERATION_MODE',
                            mode: mode || 'pro',
                            duration,
                            aspectRatio
                        }, () => {
                            if (chrome.runtime.lastError) {}
                        });
                    }
                });
            });
        };

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['sr_prompt_prefix', 'sr_model_version', 'sr_aspect_ratio', 'sr_prompt_duration', 'sr_direct_create'], (res) => {
                if (radSingle) radSingle.checked = true;
                updateHeroBtnSubtitle();

                if (res?.sr_prompt_prefix !== undefined && inputPrefix) {
                    inputPrefix.value = res.sr_prompt_prefix;
                }
                if (selModel) {
                    selModel.value = res?.sr_model_version || '2.5';
                }
                if (res?.sr_aspect_ratio && selAspect) {
                    selAspect.value = res.sr_aspect_ratio;
                }
                if (selDuration) {
                    const dur = res?.sr_prompt_duration || '15s';
                    selDuration.value = dur === '30s' ? '15s' : dur;
                }
                if (res?.sr_direct_create !== undefined && chkDirect) {
                    chkDirect.checked = Boolean(res.sr_direct_create);
                }
                // Migrate away from legacy Credit mode storage.
                chrome.storage.local.set({ sr_gen_mode: 'single', sr_prompt_duration: selDuration ? selDuration.value : '15s' });
            });
        }

        const saveParams = () => {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
            let duration = selDuration ? selDuration.value : '15s';
            if (duration === '30s') duration = '15s';
            chrome.storage.local.set({
                sr_gen_mode: 'single',
                sr_prompt_prefix: inputPrefix ? inputPrefix.value : 'tạo video: ',
                sr_model_version: selModel ? selModel.value : '2.5',
                sr_aspect_ratio: selAspect ? selAspect.value : '16:9',
                sr_prompt_duration: duration,
                sr_direct_create: chkDirect ? chkDirect.checked : true
            });
        };

        if (radSingle) {
            radSingle.checked = true;
            radSingle.addEventListener('change', () => {
                radSingle.checked = true;
                saveParams();
                syncModeToDolaTabs('pro');
            });
        }
        if (inputPrefix) inputPrefix.addEventListener('input', saveParams);
        if (selModel) {
            selModel.addEventListener('change', () => {
                saveParams();
                if (selModel.value === '2.5') {
                    syncModeToDolaTabs('pro');
                } else if (selModel.value === '2.0') {
                    syncModeToDolaTabs('nhanh');
                }
            });
        }
        if (selAspect) {
            selAspect.addEventListener('change', () => {
                saveParams();
                syncModeToDolaTabs('pro');
                if (typeof window.showGlobalToast === 'function') {
                    window.showGlobalToast(`📐 Đã đồng bộ tỉ lệ ${selAspect.value} sang Dola!`);
                }
            });
        }
        if (selDuration) {
            selDuration.addEventListener('change', () => {
                if (selDuration.value === '30s') selDuration.value = '15s';
                saveParams();
            });
        }
        if (chkDirect) chkDirect.addEventListener('change', saveParams);

        // Kiểm tra xem hôm nay tài khoản đã đạt giới hạn hằng ngày chưa
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['sr_daily_limit_date'], (res) => {
                const today = new Date().toDateString();
                const limitBanner = document.getElementById('daily-limit-warning-banner');
                if (limitBanner) {
                    limitBanner.style.display = res?.sr_daily_limit_date === today ? 'block' : 'none';
                }
            });
        }

        // 3. Scan & Display GPM / Dola Tabs Status with live Ping & F5 Warning
        function showDolaF5Warning(show, tabId = null) {
            const container = document.getElementById('dola-f5-warning-container');
            const btnF5 = document.getElementById('btn-f5-dola-tabs');
            if (!container) return;
            container.style.display = show ? 'block' : 'none';

            if (btnF5 && !btnF5.__sr_bound) {
                btnF5.__sr_bound = true;
                btnF5.addEventListener('click', () => {
                    chrome.tabs.query({ url: ['*://*.dola.com/*', '*://dola.com/*'] }, (tabs) => {
                        const chatTabs = (tabs || []).filter((t) => !(t.url || '').includes('.js'));
                        if (chatTabs.length > 0) {
                            chatTabs.forEach(t => chrome.tabs.reload(t.id));
                            btnF5.textContent = '🔄 Đang tải lại tab Dola...';
                            setTimeout(() => {
                                btnF5.textContent = '🔄 F5 Tab Dola Ngay';
                                updateGpmBadge();
                            }, 2500);
                        }
                    });
                });
            }
        }

        function updateGpmBadge() {
            if (typeof chrome === 'undefined' || !chrome.tabs) return;
            chrome.tabs.query({ url: ['*://*.dola.com/*', '*://dola.com/*'] }, (tabs) => {
                const badge = document.getElementById('gpm-active-tabs-badge');
                const txt = document.getElementById('gpm-tabs-text');
                if (!badge || !txt) return;

                const chatTabs = (tabs || []).filter((t) => {
                    const u = (t.url || '').toLowerCase();
                    return u.includes('/chat') && !u.includes('.js') && !u.includes('worker');
                });
                const activeTabs = chatTabs.length > 0 ? chatTabs : (tabs || []).filter((t) => !(t.url || '').includes('.js'));

                if (activeTabs.length === 0) {
                    badge.className = 'gpm-tab-indicator warning';
                    txt.textContent = '⚠️ Chưa mở Tab Dola nào';
                    showDolaF5Warning(false);
                    return;
                }

                // Gửi ping kiểm tra xem content script có đang phản hồi không
                const targetTab = activeTabs[0];
                chrome.tabs.sendMessage(targetTab.id, { action: 'ping' }, (res) => {
                    if (chrome.runtime.lastError || !res?.pong) {
                        badge.className = 'gpm-tab-indicator warning';
                        txt.textContent = '⚠️ Tab Dola chưa F5! Bấm để tải lại';
                        showDolaF5Warning(true, targetTab.id);
                    } else {
                        badge.className = 'gpm-tab-indicator';
                        let profileHint = '';
                        for (const t of activeTabs) {
                            const m = (t.title || '').match(/GPM\s*\|\s*([^·\s|@]+@[^·\s|]+|[^·\s|]+)/i);
                            if (m && m[1]) {
                                profileHint = ` (${m[1].split('@')[0]})`;
                                break;
                            }
                        }
                        txt.textContent = `🟢 ${activeTabs.length} Tab Dola sẵn sàng${profileHint}`;
                        showDolaF5Warning(false);
                    }
                });
            });
        }

        updateGpmBadge();
        setInterval(updateGpmBadge, 3500);

        // 4. Listen for real-time progress from content script
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((msg) => {
                if (!msg) return;
                const btnHitCreate = document.getElementById('btn-hit-create-video');
                const heroSubtitle = document.getElementById('hero-btn-subtitle');
                if (msg.action === 'BATCH_PROGRESS' && btnHitCreate) {
                    const label = btnHitCreate.querySelector('strong');
                    if (label) {
                        label.textContent = `⚡ Đang chạy: ${msg.current}/${msg.total} cảnh`;
                    }
                    if (heroSubtitle) {
                        heroSubtitle.textContent = `Phiên chat: ${msg.chatCount || 0}/2 prompt · Đang render...`;
                    }
                }
                if (msg.action === 'NOTIFY_HUMAN_ARTIFACT' && heroSubtitle) {
                    heroSubtitle.textContent = '✨ Đã phát hiện Human Artifact video!';
                }
                if (msg.action === 'DAILY_LIMIT_EXCEEDED') {
                    const limitBanner = document.getElementById('daily-limit-warning-banner');
                    if (limitBanner) limitBanner.style.display = 'block';
                    if (btnHitCreate) {
                        btnHitCreate.disabled = false;
                        btnHitCreate.__sr_busy = false;
                        const label = btnHitCreate.querySelector('strong');
                        if (label) label.textContent = '⚡ BẮN SANG DOLA (CHẠY TỰ ĐỘNG)';
                    }
                    if (heroSubtitle) {
                        heroSubtitle.textContent = 'Đã dừng: hết hạn mức tạo video hôm nay';
                    }
                    if (typeof window.showGlobalToast === 'function') {
                        window.showGlobalToast('Đã dừng: Dola báo hết hạn mức tạo video hôm nay.');
                    }
                }
                if (msg.action === 'CONTENT_POLICY_BLOCKED') {
                    const name = msg.imageName ? ` «${msg.imageName}»` : '';
                    const tip = `Ảnh${name} bị Dola chặn — cần ĐỔI ẢNH rồi bắn lại.`;
                    if (typeof window.showGlobalToast === 'function') {
                        window.showGlobalToast(tip);
                    }
                    const imgStatus = document.querySelector('#image-queue-status, .image-queue-status, #img2vid-pair-meta');
                    // Studio Ảnh status line được setStatus cập nhật qua fire batch; toast là đủ.
                    void imgStatus;
                }
            });
        }
    }

    function initializeHitCreateVideoButton() {
        const btnHitCreate = document.getElementById('btn-hit-create-video');
        if (!btnHitCreate || btnHitCreate.__sr_bound) return;
        btnHitCreate.__sr_bound = true;

        btnHitCreate.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (typeof chrome === 'undefined' || !chrome.tabs) return;
            if (btnHitCreate.disabled || btnHitCreate.__sr_busy) return;

            const STORAGE_KEY = 'ctb_saved_prompts';
            const textarea = document.getElementById('textarea-quick-prompts');
            const immediateText = textarea ? textarea.value.trim() : '';

            // 1. Collect Config Options (Pro only)
            const inputPrefix = document.getElementById('input-prompt-prefix');
            const selAspect = document.getElementById('sel-aspect-ratio');
            const selDuration = document.getElementById('sel-prompt-duration');
            const selModel = document.getElementById('sel-model-version');
            const chkDirect = document.getElementById('chk-direct-create');
            const heroSubtitle = document.getElementById('hero-btn-subtitle');

            const model = selModel ? selModel.value : '2.5';
            const prefix = inputPrefix ? inputPrefix.value : 'tạo video: ';
            const aspectRatio = selAspect ? selAspect.value : '16:9';
            let duration = selDuration?.value || '15s';
            if (duration === '30s') duration = '15s';
            const directCreate = chkDirect ? chkDirect.checked : true;

            const config = {
                prefix,
                aspectRatio,
                duration,
                directCreate,
                model,
                mode: 'single',
                isUnlimited: true
            };

            // 2. Fetch Prompts (from textarea or saved queue)
            chrome.storage.local.get([STORAGE_KEY], (res) => {
                const saved = Array.isArray(res?.[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
                let promptList = [];

                if (immediateText) {
                    if (window.CTBParagraphPrompts && typeof window.CTBParagraphPrompts.parseParagraphs === 'function') {
                        promptList = window.CTBParagraphPrompts.parseParagraphs(immediateText);
                    } else {
                        promptList = immediateText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    }
                }

                if (promptList.length === 0) {
                    const uncompleted = saved.filter(p => !p.done);
                    if (uncompleted.length > 0) {
                        promptList = uncompleted.map(p => p.text);
                    } else if (saved.length > 0) {
                        promptList = saved.map(p => p.text);
                    }
                }

                if (promptList.length === 0) {
                    const label = btnHitCreate.querySelector('strong');
                    if (label) {
                        const orig = label.textContent;
                        label.textContent = '⚠️ Hãy nhập hoặc nạp kịch bản!';
                        setTimeout(() => { label.textContent = orig; }, 2500);
                    }
                    return;
                }

                // 3. Query all active Dola tabs
                chrome.tabs.query({ url: ['*://*.dola.com/*', '*://dola.com/*', '*://*.doubao.com/*', '*://doubao.com/*'] }, (tabs) => {
                    const chatTabs = (tabs || []).filter((t) => {
                        const u = (t.url || '').toLowerCase();
                        return u.includes('/chat') && !u.includes('.js') && !u.includes('worker');
                    });
                    const activeTabs = chatTabs.length > 0 ? chatTabs : (tabs || []).filter((t) => !(t.url || '').includes('.js'));

                    // Lọc tab duy nhất theo id tránh trùng lặp
                    const uniqueTabs = [];
                    const seenIds = new Set();
                    for (const t of activeTabs) {
                        if (t && t.id && !seenIds.has(t.id)) {
                            seenIds.add(t.id);
                            uniqueTabs.push(t);
                        }
                    }

                    // Sắp xếp tab: Tab đang active hoặc tab được truy cập gần đây nhất luôn đứng đầu tiên (primaryTab)
                    // Đảm bảo tạo video LUÔN CHẠY TRÊN TAB/CHAT HIỆN TẠI mà người dùng đang mở, không nhảy về chat cũ!
                    uniqueTabs.sort((a, b) => {
                        if (a.active !== b.active) return b.active ? -1 : 1;
                        return (b.lastAccessed || 0) - (a.lastAccessed || 0);
                    });

                    if (uniqueTabs.length === 0) {
                        const label = btnHitCreate.querySelector('strong');
                        if (label) {
                            const orig = label.textContent;
                            label.textContent = '❌ Chưa mở Tab Dola Chat nào!';
                            setTimeout(() => { label.textContent = orig; }, 2500);
                        }
                        if (typeof window.showGlobalToast === 'function') {
                            window.showGlobalToast('❌ Chưa mở Tab Dola Chat nào!');
                        }
                        return;
                    }

                    // 4. Ping TẤT CẢ tab — chỉ bắn vào tab đã F5 / content sẵn sàng
                    const label = btnHitCreate.querySelector('strong');
                    const pingTab = (tabId) => new Promise((resolve) => {
                        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (resp) => {
                            if (chrome.runtime.lastError || !resp?.pong) resolve(null);
                            else resolve(tabId);
                        });
                    });

                    Promise.all(uniqueTabs.map((t) => pingTab(t.id))).then((pingResults) => {
                        const readyIds = new Set(pingResults.filter(Boolean));
                        const readyTabs = uniqueTabs.filter((t) => readyIds.has(t.id));
                        const skipped = uniqueTabs.length - readyTabs.length;

                        if (readyTabs.length === 0) {
                            const container = document.getElementById('dola-f5-warning-container');
                            if (container) container.style.display = 'block';
                            if (label) {
                                label.textContent = '⚠️ Tab Dola chưa nhận extension! Bấm nút F5 đỏ ở trên nhé.';
                            }
                            if (typeof window.showGlobalToast === 'function') {
                                window.showGlobalToast('⚠️ Không tab Dola nào sẵn sàng — F5 từng tab rồi thử lại.');
                            }
                            return;
                        }

                        if (skipped > 0 && typeof window.showGlobalToast === 'function') {
                            window.showGlobalToast(`⚠️ Bỏ qua ${skipped} tab chưa F5 — chỉ bắn ${readyTabs.length} tab sẵn sàng`);
                        }

                        btnHitCreate.disabled = true;
                        btnHitCreate.__sr_busy = true;

                        const primaryTab = readyTabs[0];
                        try {
                            if (primaryTab.windowId) {
                                chrome.windows.update(primaryTab.windowId, { focused: true });
                            }
                            chrome.tabs.update(primaryTab.id, { active: true });
                        } catch (e) {}

                        if (typeof window.showGlobalToast === 'function') {
                            window.showGlobalToast(`🚀 Đã bắn ${promptList.length} cảnh sang ${readyTabs.length} Tab Dola!`);
                        }

                        // Pro: cụm ≤2 prompt/tab · round-robin giữa các nick
                        const tabBuckets = Array.from({ length: readyTabs.length }, () => []);
                        for (let i = 0; i < promptList.length; i += 2) {
                            const chunk = promptList.slice(i, i + 2);
                            tabBuckets[Math.floor(i / 2) % readyTabs.length].push(...chunk);
                        }

                        let tabDispatches = 0;
                        readyTabs.forEach((tab, tabIdx) => {
                            const tabPrompts = tabBuckets[tabIdx];
                            if (!tabPrompts || tabPrompts.length === 0) return;
                            tabDispatches++;

                            chrome.tabs.sendMessage(tab.id, {
                                action: 'execute_batch_prompt_session',
                                prompts: tabPrompts,
                                config
                            }, (resp) => {
                                if (chrome.runtime.lastError) {
                                    console.warn(`[Seedance Studio Pro] Send to Tab ${tab.id} error:`, chrome.runtime.lastError);
                                    if (typeof window.showGlobalToast === 'function') {
                                        window.showGlobalToast('⚠️ Lỗi gửi Tab Dola: ' + (chrome.runtime.lastError.message || 'chưa sẵn sàng'));
                                    }
                                } else if (resp && resp.success === false) {
                                    if (typeof window.showGlobalToast === 'function') {
                                        window.showGlobalToast('⚠️ Dola: ' + (resp.reason || resp.error || 'Chưa thể tạo'));
                                    }
                                }
                            });
                        });

                        if (label) {
                            if (readyTabs.length === 1 && promptList.length > 2) {
                                label.textContent = `⚡ 1 Nick (${promptList.length} cảnh): Cứ 30s New Chat gửi tiếp!`;
                            } else {
                                label.textContent = `⚡ Đang chạy ${promptList.length} cảnh trên ${tabDispatches} Tab (≤2 video/chat)...`;
                            }
                        }

                        if (heroSubtitle) {
                            if (readyTabs.length === 1 && promptList.length > 2) {
                                heroSubtitle.textContent = `Chế độ Pro: Cứ 30s tạo Chat mới đẩy 2 cảnh`;
                            } else {
                                heroSubtitle.textContent = `Đang chạy trên ${tabDispatches} tab Dola · ≤2 prompt/chat · Tải 1080P không logo`;
                            }
                        }

                        setTimeout(() => {
                            btnHitCreate.disabled = false;
                            btnHitCreate.__sr_busy = false;
                            if (label) label.textContent = '⚡ BẮN SANG DOLA (CHẠY TỰ ĐỘNG)';
                            if (heroSubtitle) {
                                heroSubtitle.textContent = 'Tối đa 2 video / chat · 1 Profile Chrome = 1 Acc Dola';
                            }
                        }, 5000);

                        if (saved.length > 0) {
                            saved.forEach(p => { p.done = true; });
                            chrome.storage.local.set({ [STORAGE_KEY]: saved });
                        }
                    });
                });
            });
        });
    }

    function initializeStopAutomationButton() {
        const btnStop = document.getElementById('btn-stop-automation');
        if (!btnStop || btnStop.__sr_bound) return;
        btnStop.__sr_bound = true;

        btnStop.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof chrome === 'undefined' || !chrome.tabs) return;

            // 1. Gửi tín hiệu abort_batch_session tới toàn bộ các Tab Dola đang mở
            chrome.tabs.query({}, (tabs) => {
                const dolaTabs = (tabs || []).filter(t => {
                    const u = (t.url || '').toLowerCase();
                    return (u.includes('dola.com') || u.includes('doubao.com')) && !u.includes('.js');
                });
                dolaTabs.forEach(tab => {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, { action: 'abort_batch_session' }, () => {
                            if (chrome.runtime.lastError) {}
                        });
                    }
                });
            });

            // 2. Mở khóa lại nút Start Bắn sang Dola
            const btnHitCreate = document.getElementById('btn-hit-create-video');
            if (btnHitCreate) {
                btnHitCreate.disabled = false;
                btnHitCreate.__sr_busy = false;
                const label = btnHitCreate.querySelector('strong');
                if (label) label.textContent = '⚡ BẮN SANG DOLA (CHẠY TỰ ĐỘNG)';
            }

            if (typeof window.showGlobalToast === 'function') {
                window.showGlobalToast('🛑 Đã gửi lệnh DỪNG (STOP) tới toàn bộ các Tab Dola!');
            }
        });
    }

    function initializeSettingsControls() {
        const selDuration = document.getElementById('sel-duration');
        const chkAutoRotate = document.getElementById('chk-autorotate');
        const chkAutoNext = document.getElementById('chk-autonext');
        const chkAutoDownload = document.getElementById('chk-auto-dl') || document.getElementById('chk-autodownload');

        if (!selDuration) return;

        // 1. Load saved settings from chrome.storage.local
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['durationOverride', 'autoRotate', 'autoNext', 'autoDownload'], (res) => {
                const storedDuration = String(res?.durationOverride || '15');
                const dur = ['5', '10', '15', '30'].includes(storedDuration) ? storedDuration : '15';
                selDuration.value = dur;
                if (chkAutoRotate && res?.autoRotate !== undefined) chkAutoRotate.checked = Boolean(res.autoRotate);
                if (chkAutoNext && res?.autoNext !== undefined) chkAutoNext.checked = Boolean(res.autoNext);
                if (chkAutoDownload) {
                    chkAutoDownload.checked = res?.autoDownload !== false;
                }
            });
        }

        // 2. Listen to duration dropdown changes
        selDuration.addEventListener('change', () => {
            const val = selDuration.value;
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ durationOverride: val }, () => {
                    console.log('[StudioRelay Settings] Saved durationOverride:', val);
                    chrome.tabs.query({ url: ['*://*.dola.com/*', '*://dola.com/*'] }, (tabs) => {
                        tabs.forEach((tab) => {
                            if (tab.id) {
                                chrome.tabs.sendMessage(tab.id, { action: 'set_duration', duration: val }).catch(() => {});
                            }
                        });
                    });
                });
            }
        });

        // 3. Listen to checkbox toggles
        if (chkAutoRotate) {
            chkAutoRotate.addEventListener('change', () => {
                chrome.storage.local.set({ autoRotate: chkAutoRotate.checked });
            });
        }
        if (chkAutoNext) {
            chkAutoNext.addEventListener('change', () => {
                chrome.storage.local.set({ autoNext: chkAutoNext.checked });
            });
        }
        if (chkAutoDownload) {
            chkAutoDownload.addEventListener('change', () => {
                chrome.storage.local.set({ autoDownload: chkAutoDownload.checked }, () => {
                    if (typeof window.showGlobalToast === 'function') {
                        window.showGlobalToast(
                            chkAutoDownload.checked
                                ? 'Đã bật tự tải video về máy.'
                                : 'Đã tắt tự tải — video vẫn vào panel để tải ZIP / tải tay.'
                        );
                    }
                });
            });
        }
    }

    // Da nick da go — 1 Chrome profile = 1 acc Dola.

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initializeGeneratorControls();
            initializeHitCreateVideoButton();
            initializeStopAutomationButton();
            initializeSettingsControls();
        }, { once: true });
    } else {
        initializeGeneratorControls();
        initializeHitCreateVideoButton();
        initializeStopAutomationButton();
        initializeSettingsControls();
    }
})();
