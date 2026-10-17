/**
 * Seedance session shield — port từ StudioRelay inject.js (document_start MAIN).
 * Chặn logout/F5 chéo khi mở nhiều nick cùng origin. Không patch localStorage get/set.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__seedanceSessionShieldActive || window.__studioRelaySessionShieldActive) return;
  window.__seedanceSessionShieldActive = true;
  window.__studioRelaySessionShieldActive = true;

  // 1. Cross-Tab Storage Event Blocker
  try {
    const originalAddEventListener = window.addEventListener;
    window.addEventListener = function (type, listener, options) {
      if (type === 'storage') {
        const wrappedListener = function (event) {
          try {
            if (!event || !event.key) return;
            const keyLower = String(event.key).toLowerCase();
            if (
              keyLower.includes('token') ||
              keyLower.includes('auth') ||
              keyLower.includes('session') ||
              keyLower.includes('user') ||
              keyLower.includes('login') ||
              keyLower.includes('logout') ||
              keyLower.includes('passport') ||
              keyLower.includes('account') ||
              keyLower.includes('credential') ||
              keyLower.includes('csrf') ||
              keyLower.includes('jwt')
            ) {
              return;
            }
          } catch (e) {}
          if (typeof listener === 'function') {
            return listener.apply(this, arguments);
          } else if (listener && typeof listener.handleEvent === 'function') {
            return listener.handleEvent(event);
          }
        };
        return originalAddEventListener.call(this, type, wrappedListener, options);
      }
      return originalAddEventListener.apply(this, arguments);
    };
  } catch (e) {}

  // 2. Cross-Tab BroadcastChannel Isolation
  try {
    if (typeof window.BroadcastChannel !== 'undefined') {
      const OriginalBroadcastChannel = window.BroadcastChannel;
      window.BroadcastChannel = function (channelName) {
        const channel = new OriginalBroadcastChannel(channelName);
        const nameLower = String(channelName || '').toLowerCase();
        const isAuthChannel = (
          nameLower.includes('auth') ||
          nameLower.includes('session') ||
          nameLower.includes('login') ||
          nameLower.includes('logout') ||
          nameLower.includes('user') ||
          nameLower.includes('token') ||
          nameLower.includes('passport') ||
          nameLower.includes('account')
        );

        const originalPostMessage = channel.postMessage.bind(channel);
        channel.postMessage = function (message) {
          try {
            if (isAuthChannel) return;
            if (message && typeof message === 'object') {
              const msgStr = JSON.stringify(message).toLowerCase();
              if (
                msgStr.includes('logout') ||
                msgStr.includes('unauthorized') ||
                msgStr.includes('token_expired') ||
                msgStr.includes('session_invalid') ||
                msgStr.includes('reload')
              ) {
                return;
              }
            }
          } catch (e) {}
          return originalPostMessage(message);
        };

        const originalAddEventListener = channel.addEventListener.bind(channel);
        channel.addEventListener = function (type, listener, options) {
          if (type === 'message') {
            const wrapped = function (event) {
              try {
                if (isAuthChannel) return;
                if (event && event.data && typeof event.data === 'object') {
                  const msgStr = JSON.stringify(event.data).toLowerCase();
                  if (
                    msgStr.includes('logout') ||
                    msgStr.includes('unauthorized') ||
                    msgStr.includes('token_expired') ||
                    msgStr.includes('session_invalid') ||
                    msgStr.includes('reload')
                  ) {
                    return;
                  }
                }
              } catch (e) {}
              if (typeof listener === 'function') {
                return listener.apply(this, arguments);
              }
            };
            return originalAddEventListener(type, wrapped, options);
          }
          return originalAddEventListener(type, listener, options);
        };

        return channel;
      };
      window.BroadcastChannel.prototype = OriginalBroadcastChannel.prototype;
    }
  } catch (e) {}

  // 3. Anti-Reload Loop Circuit Breaker
  try {
    const RELOAD_GUARD_KEY = '__studioRelay_reload_guard';
    const now = Date.now();
    let history = [];
    try {
      const stored = sessionStorage.getItem(RELOAD_GUARD_KEY);
      if (stored) history = JSON.parse(stored);
    } catch (e) {}

    history = (Array.isArray(history) ? history : []).filter((t) => typeof t === 'number' && now - t < 15000);
    history.push(now);
    try { sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify(history)); } catch (e) {}

    let userInteracted = false;
    ['click', 'keydown', 'touchstart'].forEach((evt) => {
      window.addEventListener(evt, () => { userInteracted = true; }, { capture: true, passive: true });
    });

    if (history.length > 2) {
      const preventLoop = function () {
        if (!userInteracted) {
          showReloadGuardBanner();
          return false;
        }
        return true;
      };

      try {
        const origReload = window.location.reload.bind(window.location);
        window.location.reload = function () {
          if (preventLoop()) origReload();
        };
      } catch (e) {}

      try {
        const origReplace = window.location.replace.bind(window.location);
        window.location.replace = function (url) {
          if (typeof url === 'string' && (url.includes('/login') || url.includes('/chat'))) {
            if (!preventLoop()) return;
          }
          origReplace(url);
        };
      } catch (e) {}

      function showReloadGuardBanner() {
        if (document.getElementById('studio-relay-reload-guard-banner')) return;
        const mount = () => {
          if (document.getElementById('studio-relay-reload-guard-banner')) return;
          const banner = document.createElement('div');
          banner.id = 'studio-relay-reload-guard-banner';
          banner.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:9999999;background:#1e1b4b;color:#e0e7ff;border:1px solid #6366f1;padding:8px 16px;border-radius:8px;font-family:sans-serif;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.5);display:flex;align-items:center;gap:10px;';
          banner.innerHTML = '<span>⚠️ Tab cookies expired or invalid. Auto-reload paused.</span><button id="studio-relay-reload-btn" style="background:#6366f1;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;">↻ Reload</button>';
          (document.body || document.documentElement).appendChild(banner);
          const btn = document.getElementById('studio-relay-reload-btn');
          if (btn) {
            btn.addEventListener('click', () => {
              try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch (e) {}
              window.location.reload();
            });
          }
        };
        if (document.body) mount();
        else document.addEventListener('DOMContentLoaded', mount, { once: true });
      }
    }
  } catch (e) {}
})();
