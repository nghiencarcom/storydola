(function () {
    'use strict';

    const ACTION_OPEN_MULTIPLE = 'open_multiple_accounts';
    const ACTIONS_THAT_USE_ACCOUNT = new Set([
        'open_account_in_new_tab',
        'switch_profile'
    ]);
    const PROFILE_STORAGE_KEY = 'multi_profiles';
    const QUEUE_STORAGE_KEY = 'bulk_account_queue';
    const USAGE_STORAGE_KEY = 'bulk_account_tab_usage';
    const DOLA_CHAT_URL = 'https://www.dola.com/chat';
    const TABS_PER_ACCOUNT = 1;

    let queueOperation = Promise.resolve();
    let bulkOpenInProgress = false;

    function runInQueue(task) {
        const operation = queueOperation.then(task, task);
        queueOperation = operation.catch(() => undefined);
        return operation;
    }

    function storageGet(keys) {
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

    function storageSet(values) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(values, () => {
                const error = chrome.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }
                resolve();
            });
        });
    }

    function tabsCreate(options) {
        return new Promise((resolve, reject) => {
            chrome.tabs.create(options, tab => {
                const error = chrome.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }
                if (!tab || !Number.isInteger(tab.id)) {
                    reject(new Error('Chrome did not return a valid tab.'));
                    return;
                }
                resolve(tab);
            });
        });
    }

    function tabsUpdate(tabId, options) {
        return new Promise((resolve, reject) => {
            chrome.tabs.update(tabId, options, tab => {
                const error = chrome.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }
                resolve(tab);
            });
        });
    }

    function tabsRemove(tabId) {
        return new Promise(resolve => {
            chrome.tabs.remove(tabId, () => {
                void chrome.runtime.lastError;
                resolve();
            });
        });
    }

    function normalizeQueue(profiles, storedQueue) {
        const profileNames = Object.keys(profiles || {});
        const validNames = new Set(profileNames);
        const seen = new Set();
        const existing = Array.isArray(storedQueue)
            ? storedQueue.filter(name => {
                if (typeof name !== 'string' || !validNames.has(name) || seen.has(name)) {
                    return false;
                }
                seen.add(name);
                return true;
            })
            : [];

        const newNames = profileNames.filter(name => !seen.has(name));
        return [...newNames, ...existing];
    }

    function moveNamesToBottom(queue, usedNames) {
        const used = new Set(usedNames);
        return [
            ...queue.filter(name => !used.has(name)),
            ...queue.filter(name => used.has(name))
        ];
    }

    function usableProfile(profile) {
        return Boolean(profile && Array.isArray(profile.cookies) && profile.cookies.length > 0);
    }

    async function openIsolatedAccount(profileName, profile, tabCount = 1) {
        const isolatedProfile = profile.name
            ? profile
            : Object.assign({}, profile, { name: profileName });

        const applyRule = self.applyTabSessionRule || globalThis.applyTabSessionRule;
        const setCookies = self.setDolaCookies || globalThis.setDolaCookies;
        const assertClean = self.assertNoPendingCleanLogin || globalThis.assertNoPendingCleanLogin;

        if (typeof applyRule !== 'function' || typeof setCookies !== 'function') {
            throw new Error('Cookie isolation helpers chưa sẵn sàng trong service worker.');
        }

        if (typeof assertClean === 'function') {
            const blockMsg = await assertClean('mở nick đã lưu');
            if (blockMsg) throw new Error(blockMsg);
        }

        // Giống StudioRelay 1.7: DNR trước → setCookies (KHÔNG clear jar) → navigate.
        // Clear jar khi đang có tab khác sẽ làm nick kia logout / F5.
        const openedTabIds = [];
        for (let i = 0; i < tabCount; i++) {
            const tab = await tabsCreate({ url: 'about:blank', active: false });
            try {
                await applyRule(tab.id, isolatedProfile);
                await setCookies(isolatedProfile.cookies);
                await tabsUpdate(tab.id, { url: DOLA_CHAT_URL, active: false });
                // Nghỉ ngắn cho DNR + cookie kịp trước nick tiếp theo.
                await new Promise((r) => setTimeout(r, 800));
                openedTabIds.push(tab.id);
            } catch (error) {
                await tabsRemove(tab.id);
                if (openedTabIds.length === 0) throw error;
            }
        }

        return {
            profileName,
            tabId: openedTabIds[0],
            tabIds: openedTabIds
        };
    }

    async function openMultipleAccounts(rawCount) {
        const inputNum = Number(rawCount);
        if (!Number.isInteger(inputNum) || inputNum < 1) {
            return {
                success: false,
                error: 'Enter a whole number greater than zero.',
                opened: [],
                failed: []
            };
        }

        const stored = await storageGet([PROFILE_STORAGE_KEY, QUEUE_STORAGE_KEY, USAGE_STORAGE_KEY]);
        const profiles = stored[PROFILE_STORAGE_KEY] || {};
        const queue = normalizeQueue(profiles, stored[QUEUE_STORAGE_KEY]);
        const usableCount = queue.filter(name => usableProfile(profiles[name])).length;
        const maxTabsAvailable = usableCount * TABS_PER_ACCOUNT;

        if (usableCount === 0) {
            return {
                success: false,
                error: 'No usable accounts available.',
                opened: [],
                failed: [],
                available: 0
            };
        }

        if (inputNum > maxTabsAvailable) {
            return {
                success: false,
                error: 'Only ' + usableCount + ' usable account(s) available (max ' + maxTabsAvailable + ' tabs).',
                opened: [],
                failed: [],
                available: usableCount
            };
        }

        // Mỗi lần bấm "Mở Tab Song Song" chia nick mới từ đầu (1 tab/nick).
        const usageMap = {};

        const opened = [];
        const failed = [];
        let remainingTabs = inputNum;
        let currentQueue = [...queue];
        const fullyExhaustedNames = [];
        let loopSafety = 0;
        const maxLoops = currentQueue.length * 2 + 5;

        while (remainingTabs > 0 && loopSafety < maxLoops) {
            loopSafety++;
            let openedInThisPass = 0;

            for (const profileName of currentQueue) {
                if (remainingTabs <= 0) {
                    break;
                }

                if (fullyExhaustedNames.includes(profileName)) {
                    continue;
                }

                const profile = profiles[profileName];
                if (!usableProfile(profile)) {
                    continue;
                }

                const usedSoFar = Number(usageMap[profileName]) || 0;
                const availableForThisProfile = Math.max(0, TABS_PER_ACCOUNT - usedSoFar);

                if (availableForThisProfile <= 0) {
                    if (!fullyExhaustedNames.includes(profileName)) {
                        fullyExhaustedNames.push(profileName);
                    }
                    delete usageMap[profileName];
                    continue;
                }

                // Luôn mở 1 tab/lần rồi xoay nick — tránh 2 tab cùng 1 nick khi user nhập 2.
                const tabsToOpenForProfile = 1;

                try {
                    const accountResult = await openIsolatedAccount(profileName, profile, tabsToOpenForProfile);
                    opened.push(accountResult);
                    const actuallyOpened = accountResult.tabIds ? accountResult.tabIds.length : tabsToOpenForProfile;
                    remainingTabs -= actuallyOpened;
                    openedInThisPass += actuallyOpened;

                    const newUsedCount = usedSoFar + actuallyOpened;
                    if (newUsedCount >= TABS_PER_ACCOUNT) {
                        if (!fullyExhaustedNames.includes(profileName)) {
                            fullyExhaustedNames.push(profileName);
                        }
                        delete usageMap[profileName];
                    } else {
                        usageMap[profileName] = newUsedCount;
                    }
                } catch (error) {
                    failed.push({
                        profileName,
                        error: error && error.message ? error.message : String(error)
                    });
                }
            }

            if (fullyExhaustedNames.length > 0) {
                currentQueue = moveNamesToBottom(currentQueue, fullyExhaustedNames);
                fullyExhaustedNames.length = 0;
            }

            if (openedInThisPass === 0) {
                break;
            }
        }

        const updates = {
            [QUEUE_STORAGE_KEY]: currentQueue,
            [USAGE_STORAGE_KEY]: usageMap
        };

        const openedNames = opened.map(item => item.profileName);
        if (openedNames.length > 0) {
            updates.active_profile_name = openedNames[openedNames.length - 1];
        }

        await storageSet(updates);

        const totalTabsOpened = opened.reduce((total, item) => total + (Array.isArray(item.tabIds) ? item.tabIds.length : 1), 0);

        return {
            success: totalTabsOpened === inputNum,
            requested: inputNum,
            opened,
            failed,
            available: usableCount,
            totalTabsOpened,
            queue: currentQueue,
            error: totalTabsOpened === inputNum
                ? null
                : 'Opened ' + totalTabsOpened + ' of ' + inputNum + ' tab(s).'
        };
    }

    async function markAccountUsed(profileName) {
        if (typeof profileName !== 'string' || !profileName) {
            return;
        }

        const stored = await storageGet([PROFILE_STORAGE_KEY, QUEUE_STORAGE_KEY, USAGE_STORAGE_KEY]);
        const profiles = stored[PROFILE_STORAGE_KEY] || {};
        if (
            !Object.prototype.hasOwnProperty.call(profiles, profileName) ||
            !usableProfile(profiles[profileName])
        ) {
            return;
        }

        const queue = normalizeQueue(profiles, stored[QUEUE_STORAGE_KEY]);
        const usageMap = Object.assign({}, stored[USAGE_STORAGE_KEY]);
        const currentUsage = (Number(usageMap[profileName]) || 0) + 1;

        let nextQueue = queue;
        if (currentUsage >= TABS_PER_ACCOUNT) {
            delete usageMap[profileName];
            nextQueue = moveNamesToBottom(queue, [profileName]);
        } else {
            usageMap[profileName] = currentUsage;
        }

        await storageSet({
            [QUEUE_STORAGE_KEY]: nextQueue,
            [USAGE_STORAGE_KEY]: usageMap
        });
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!request || typeof request.action !== 'string') {
            return undefined;
        }

        if (request.action === ACTION_OPEN_MULTIPLE) {
            if (bulkOpenInProgress) {
                sendResponse({
                    success: false,
                    error: 'An account batch is already opening.',
                    opened: [],
                    failed: []
                });
                return undefined;
            }

            bulkOpenInProgress = true;
            runInQueue(() => openMultipleAccounts(request.count))
                .then(result => {
                    bulkOpenInProgress = false;
                    sendResponse(result);
                    if (result.opened && result.opened.length > 0) {
                        const firstTabId = result.opened[0].tabId;
                        setTimeout(() => {
                            chrome.tabs.update(firstTabId, { active: true }, () => {
                                void chrome.runtime.lastError;
                            });
                        }, 0);
                    }
                })
                .catch(error => {
                    bulkOpenInProgress = false;
                    sendResponse({
                        success: false,
                        error: error && error.message ? error.message : String(error),
                        opened: [],
                        failed: []
                    });
                });

            return true;
        }

        if (ACTIONS_THAT_USE_ACCOUNT.has(request.action) && request.profileName) {
            runInQueue(() => markAccountUsed(request.profileName)).catch(() => undefined);
        }

        return undefined;
    });

    self.ChannaBulkAccountManager = Object.freeze({
        normalizeQueue,
        moveNamesToBottom,
        openMultipleAccounts,
        markAccountUsed
    });
})();
