(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const toggleBulk = document.getElementById('toggle-bulk-mode');
    const chkBulk = document.getElementById('chk-bulk-mode');
    const btnScroll = document.getElementById('btn-scroll-chat-videos');

    function syncToggles(val) {
      if (toggleBulk) toggleBulk.checked = Boolean(val);
      if (chkBulk) chkBulk.checked = Boolean(val);
    }

    // Load initial state
    try {
      chrome.storage.local.get(['brandai_bulk_mode'], res => {
        syncToggles(res?.brandai_bulk_mode);
      });
    } catch (e) {}

    async function broadcastBulkMode(enabled) {
      syncToggles(enabled);
      try {
        await chrome.storage.local.set({ brandai_bulk_mode: Boolean(enabled) });
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id && tab.url && (tab.url.includes('dola.com') || tab.url.includes('zdola.com'))) {
            chrome.tabs.sendMessage(tab.id, { type: 'BRANDAI_SET_BULK_MODE', enabled: Boolean(enabled) }, () => {
              void chrome.runtime.lastError;
            });
          }
        }
      } catch (e) {}
    }

    if (toggleBulk) {
      toggleBulk.addEventListener('change', (e) => {
        broadcastBulkMode(e.target.checked);
      });
    }

    if (chkBulk) {
      chkBulk.addEventListener('change', (e) => {
        broadcastBulkMode(e.target.checked);
      });
    }

    if (btnScroll) {
      btnScroll.addEventListener('click', async () => {
        try {
          await broadcastBulkMode(true);
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'BRANDAI_START_CHAT_SCROLL' }, () => {
              void chrome.runtime.lastError;
            });
            window.close();
          }
        } catch (e) {}
      });
    }

    const btnZipPopup = document.getElementById('btn-download-zip-popup');
    if (btnZipPopup) {
      btnZipPopup.addEventListener('click', async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            const label = document.getElementById('popup-zip-btn-text');
            if (label) label.textContent = '⏳ Đang nén ZIP trên tab Dola...';
            chrome.tabs.sendMessage(tab.id, { action: 'download_all_videos_zip' }, (res) => {
              if (chrome.runtime.lastError || !res?.success) {
                if (label) label.textContent = '⚠️ Hãy mở tab Dola trước!';
                setTimeout(() => {
                  if (label) label.textContent = 'Tải Toàn Bộ Video Chat (File ZIP)';
                }, 2500);
              } else {
                if (label) label.textContent = `🎉 Đang tải ZIP (${res.count} video)...`;
                setTimeout(() => {
                  if (label) label.textContent = 'Tải Toàn Bộ Video Chat (File ZIP)';
                }, 3500);
              }
            });
          }
        } catch (e) {}
      });
    }
  });
})();
