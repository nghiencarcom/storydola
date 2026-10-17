// StudioRelay license presentation flag.
// Set licenseFrontPageEnabled to false so the extension opens directly into the main unlocked UI.
window.CHANNA_EXTENSION_FLAGS = Object.freeze({
    licenseFrontPageEnabled: false
});

document.documentElement.classList.add('license-front-page-disabled');

try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
            'ctb_vip_license_key': 'CTB-VIP-PRO-KEY-ACTIVE',
            'ctb_vip_license_active': true,
            'sr_license_active': true,
            'license_key': 'CTB-VIP-PRO-KEY-ACTIVE',
            'is_activated': true,
            'durationOverride': '15'
        });
    }
} catch (e) {}
