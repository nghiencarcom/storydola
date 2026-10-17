(function () {
    'use strict';

    const PROFILE_STORAGE_KEY = 'multi_profiles';
    const QUEUE_STORAGE_KEY = 'bulk_account_queue';
    const USAGE_STORAGE_KEY = 'bulk_account_tab_usage';
    const TABS_PER_ACCOUNT = 1;
    const input = document.getElementById('input-bulk-account-count');
    const button = document.getElementById('btn-open-multiple-accounts');
    const status = document.getElementById('bulk-account-open-status');
    const profilesContainer = document.getElementById('profiles-container');

    if (!input || !button || !status) {
        return;
    }

    function setStatus(message, type) {
        status.textContent = message;
        status.dataset.state = type || 'info';
    }

    function getStored(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, result => {
                const error = chrome.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }
                resolve(result || {});
            });
        });
    }

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, response => {
                const error = chrome.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }
                resolve(response || {});
            });
        });
    }

    function normalizedQueue(profiles, storedQueue) {
        const names = Object.keys(profiles || {});
        const valid = new Set(names);
        const seen = new Set();
        const existing = Array.isArray(storedQueue)
            ? storedQueue.filter(name => {
                if (typeof name !== 'string' || !valid.has(name) || seen.has(name)) {
                    return false;
                }
                seen.add(name);
                return true;
            })
            : [];
        return [...names.filter(name => !seen.has(name)), ...existing];
    }

    function profileNameForCard(card, names) {
        if (card.dataset && card.dataset.name && names.includes(card.dataset.name)) {
            return card.dataset.name;
        }
        const label = card.querySelector('.profile-name-text');
        const text = label ? label.textContent.trim() : card.textContent.trim();
        return [...names]
            .sort((left, right) => right.length - left.length)
            .find(name => text.includes(name));
    }

    function applyVisualOrder(profiles, queue) {
        if (!profilesContainer) {
            return;
        }

        const positions = new Map(queue.map((name, index) => [name, index]));
        const names = Object.keys(profiles);
        profilesContainer.querySelectorAll('.profile-card').forEach((card, fallbackIndex) => {
            const name = profileNameForCard(card, names);
            card.style.order = String(positions.has(name) ? positions.get(name) : queue.length + fallbackIndex);
        });
    }

    async function refreshAccountState(preserveStatus) {
        try {
            const stored = await getStored([PROFILE_STORAGE_KEY, QUEUE_STORAGE_KEY]);
            const profiles = stored[PROFILE_STORAGE_KEY] || {};
            const queue = normalizedQueue(profiles, stored[QUEUE_STORAGE_KEY]);
            const usable = queue.filter(name => {
                const profile = profiles[name];
                return profile && Array.isArray(profile.cookies) && profile.cookies.length > 0;
            }).length;

            const maxTabs = usable * TABS_PER_ACCOUNT;
            input.max = String(Math.max(maxTabs, 1));
            if (!preserveStatus) {
                setStatus(usable + ' nick sẵn sàng · Nhập số tab = số nick khác nhau (1 tab/nick)', usable ? 'ready' : 'warning');
            }
            applyVisualOrder(profiles, queue);
        } catch (error) {
            setStatus(error.message, 'error');
        }
    }

    async function openRequestedAccounts() {
        const count = Number(input.value);
        if (!Number.isInteger(count) || count < 1) {
            setStatus('Vui lòng nhập số nguyên lớn hơn 0.', 'error');
            input.focus();
            return;
        }

        button.disabled = true;
        input.disabled = true;
        setStatus('Đang mở các tab độc lập…', 'working');

        try {
            const response = await sendMessage({
                action: 'open_multiple_accounts',
                count
            });

            const openedCount = Array.isArray(response.opened) ? response.opened.length : 0;
            const totalTabsOpened = response.totalTabsOpened || openedCount;
            const failedList = Array.isArray(response.failed) ? response.failed : [];
            const failNames = failedList.map(f => f.profileName).filter(Boolean);
            const failHint = failNames.length
                ? ' · Lỗi: ' + failNames.join(', ')
                : '';

            if (!response.success) {
                const suffix = totalTabsOpened ? ' (' + totalTabsOpened + ' tab đã mở)' : '';
                setStatus((response.error || 'Không thể mở tab tài khoản.') + suffix + failHint, 'error');
                return;
            }

            const names = (response.opened || []).map(o => o.profileName).filter(Boolean);
            const nameHint = names.length ? ': ' + names.join(', ') : '';
            setStatus(
                'Đã mở ' + openedCount + ' nick khác nhau (' + totalTabsOpened + ' tab)' + nameHint + failHint,
                failHint ? 'working' : 'success'
            );
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            button.disabled = false;
            input.disabled = false;
            refreshAccountState(true);
        }
    }

    button.addEventListener('click', openRequestedAccounts);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            openRequestedAccounts();
        }
    });

    if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (
                areaName === 'local' &&
                (changes[PROFILE_STORAGE_KEY] || changes[QUEUE_STORAGE_KEY] || changes[USAGE_STORAGE_KEY])
            ) {
                refreshAccountState(status.dataset.state === 'working' || status.dataset.state === 'success' || status.dataset.state === 'error');
            }
        });
    }

    if (profilesContainer && typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(() => {
            refreshAccountState(status.dataset.state === 'working' || status.dataset.state === 'success' || status.dataset.state === 'error');
        });
        observer.observe(profilesContainer, { childList: true, subtree: true });
    }

    refreshAccountState();
})();
