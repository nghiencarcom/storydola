// Seedance Studio Pro - Page Bridge (MAIN world)
// Bắt fallback_api từ React Fiber → content/background resolve master 1080P không logo.
// KHÔNG hook fetch/XHR, KHÔNG sửa request body (tránh detect/logout).

(function () {
  'use strict';
  const seenFallbackApis = new Set();
  try { localStorage.removeItem('seedance-studio-video-params'); } catch (e) {}

  function emitFallback(fallbackApi, keySeed, vid) {
    if (!fallbackApi || typeof fallbackApi !== 'string') return;
    if (seenFallbackApis.has(fallbackApi)) return;
    seenFallbackApis.add(fallbackApi);
    try {
      window.postMessage(
        {
          type: 'SEEDANCE_PAGE_FALLBACK_API',
          fallbackApi,
          keySeed: keySeed || '',
          vid: vid || ''
        },
        '*'
      );
    } catch (e) {}
  }

  function tryParseVideoModel(raw) {
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return null;
    }
  }

  function harvestFromVideoModel(vm, vidHint) {
    if (!vm || typeof vm !== 'object') return;
    const fallbackApi = vm.fallback_api || vm.fallbackApi;
    if (!fallbackApi) return;
    emitFallback(fallbackApi, vm.key_seed || vm.keySeed || '', vidHint || vm.video_id || vm.vid || '');
  }

  function walkValue(value, depth) {
    if (depth > 8 || value == null) return;
    if (typeof value === 'string') {
      if (value.includes('fallback_api') && value.length < 500000) {
        try {
          if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
            walkValue(JSON.parse(value), depth + 1);
          }
        } catch (e) {}
        const m = value.match(/"fallback_api"\s*:\s*"([^"]+)"/);
        if (m && m[1]) emitFallback(m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'), '', '');
      }
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length && i < 80; i++) walkValue(value[i], depth + 1);
      return;
    }
    if (value.fallback_api) {
      emitFallback(value.fallback_api, value.key_seed || '', value.vid || value.video_id || '');
    }
    if (value.video_model) {
      harvestFromVideoModel(tryParseVideoModel(value.video_model), value.vid);
    }
    if (value.video && value.video.video_model) {
      harvestFromVideoModel(tryParseVideoModel(value.video.video_model), value.video.vid);
    }
    if (Array.isArray(value.creationsVideoList)) {
      for (const item of value.creationsVideoList) {
        if (item && item.video && item.video.video_model) {
          harvestFromVideoModel(tryParseVideoModel(item.video.video_model), item.video.vid);
        }
      }
    }
    // Chỉ đi vài key hay gặp — tránh walk cả React tree khổng lồ.
    const keys = [
      'creationsVideoList', 'video', 'video_model', 'content_block', 'contentBlock',
      'message', 'messages', 'data', 'payload', 'result', 'list', 'items', 'children'
    ];
    for (const k of keys) {
      if (k in value) walkValue(value[k], depth + 1);
    }
  }

  function scanFiberFromNode(node) {
    if (!node) return;
    const fiberKey = Object.keys(node).find(
      (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    if (!fiberKey) return;
    let curr = node[fiberKey];
    let hops = 0;
    while (curr && hops < 40) {
      try {
        if (curr.memoizedProps) walkValue(curr.memoizedProps, 0);
        if (curr.memoizedState) {
          let st = curr.memoizedState;
          let si = 0;
          while (st && si < 12) {
            walkValue(st.memoizedState, 0);
            st = st.next;
            si++;
          }
        }
      } catch (e) {}
      curr = curr.return;
      hops++;
    }
  }

  function scanReactCards() {
    try {
      const cards = document.querySelectorAll(
        [
          '.block-video-MzfWVN',
          '.video-player-NmhH16',
          '[class*="video-player"]',
          '[class*="block-video"]',
          'video',
          '[class*="creation"]',
          '[class*="media-card"]',
          '[class*="Message"]'
        ].join(',')
      );
      for (const card of cards) {
        scanFiberFromNode(card);
        if (card.parentElement) scanFiberFromNode(card.parentElement);
      }
    } catch (e) {}
  }

  setInterval(scanReactCards, 900);
  setTimeout(scanReactCards, 400);
  setTimeout(scanReactCards, 2000);

  try {
    const mo = new MutationObserver(() => {
      clearTimeout(window.__svBridgeScanT);
      window.__svBridgeScanT = setTimeout(scanReactCards, 250);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  // ==========================================================================
  // ProseMirror inject (MAIN) — paste prompt ổn định hơn DOM isolated
  // ==========================================================================
  function findActiveEditorElement() {
    const allProse = Array.from(document.querySelectorAll('.tiptap.ProseMirror, .ProseMirror, div[contenteditable="true"]'));
    const bottomProse = allProse.filter((el) => {
      if (el.closest('header, nav, aside, [class*="sidebar"]')) return false;
      const r = el.getBoundingClientRect();
      return r.height > 15 && r.width > 80 && r.top > window.innerHeight * 0.35;
    });
    if (bottomProse.length > 0) {
      bottomProse.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return bottomProse[0];
    }
    return null;
  }

  function findEditorView(el) {
    if (!el) return null;
    let curr = el;
    while (curr && curr !== document.body) {
      if (curr.pmViewDesc && curr.pmViewDesc.editorView) {
        return curr.pmViewDesc.editorView;
      }
      curr = curr.parentElement;
    }
    const child = el.querySelector?.('.ProseMirror');
    if (child && child.pmViewDesc && child.pmViewDesc.editorView) {
      return child.pmViewDesc.editorView;
    }
    return null;
  }

  function findSendButton() {
    const exact = document.getElementById('flow-end-msg-send') ||
                  document.querySelector('#flow-end-msg-send') ||
                  document.querySelector('button[class*="send-msg-btn"]') ||
                  document.querySelector('[class*="send-msg-btn"]') ||
                  document.querySelector('.send-btn-wrapper button') ||
                  document.querySelector('[data-testid*="send"]') ||
                  document.querySelector('button[aria-label*="send" i]') ||
                  document.querySelector('button[aria-label*="gửi" i]') ||
                  document.querySelector('[id*="msg-send"]');
    if (exact) return exact.closest('button') || exact;

    const input = findActiveEditorElement();
    if (input) {
      const composerBox = input.closest('form, [class*="composer"], [class*="chat-input"], [class*="input-wrap"], [class*="relative"]') || input.parentElement?.parentElement;
      if (composerBox) {
        const composerButtons = Array.from(composerBox.querySelectorAll('button, div[role="button"]'));
        const sendCandidate = composerButtons.reverse().find((btn) => {
          const r = btn.getBoundingClientRect();
          if (r.width < 15 || r.height < 15) return false;
          if (btn.closest('[class*="exit"], .bg-g-exit-skill-btn-bg')) return false;
          const t = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          if (/^(?:fast|pro|nhanh|2\.0|2\.5|5s|10s|15s|30s|ratio|tỉ\s*lệ|skills?|kỹ\s*năng|dự\s*án|\+|\.\.\.)$/i.test(t)) return false;
          return btn.querySelector('svg') || /send|submit|gửi/i.test(btn.className + (btn.id || ''));
        });
        if (sendCandidate) return sendCandidate.closest('button') || sendCandidate;
      }
    }
    return null;
  }

  function handleBridgeActivateVideoSkill() {
    try {
      const labels = Array.from(document.querySelectorAll('button, div[role="button"], span, a'));
      const hit = labels.find((el) => /create\s*videos?|tạo\s*video/i.test((el.innerText || el.textContent || '').trim()));
      if (hit) {
        (hit.closest('button') || hit).click();
        window.postMessage({ type: 'SEEDANCE_SKILL_CLICK_RESULT', success: true }, '*');
        return;
      }
    } catch (e) {}
    window.postMessage({ type: 'SEEDANCE_SKILL_CLICK_RESULT', success: false }, '*');
  }

  function handleBridgePromptInjection(text, autoSubmit) {
    try {
      const editorEl = findActiveEditorElement();
      const expected = String(text || '');
      if (!editorEl) {
        window.postMessage({ type: 'SEEDANCE_INJECT_RESULT', success: false, reason: 'No editor element' }, '*');
        return false;
      }
      editorEl.focus();
      const view = findEditorView(editorEl);
      if (view && view.state && view.dispatch) {
        const { state, dispatch } = view;
        const tr = state.tr;
        tr.delete(0, state.doc.content.size);
        tr.insertText(expected);
        dispatch(tr);
        editorEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      } else {
        // Some profile builds expose a contenteditable without a ProseMirror
        // view for one render turn. Use the same selection/DOM fallback as the
        // isolated content script, then fire the full input/change sequence so
        // React has a chance to commit the value.
        try {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editorEl);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
        } catch (e) {}
        let inserted = false;
        try { inserted = document.execCommand('insertText', false, expected); } catch (e) {}
        if (!inserted || !String(editorEl.innerText || editorEl.textContent || '').includes(expected.slice(0, 15))) {
          editorEl.textContent = expected;
        }
        try {
          editorEl.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: expected
          }));
        } catch (e) {}
        editorEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: expected }));
        editorEl.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const actual = String(editorEl.innerText || editorEl.textContent || '')
        .replace(/\u200b/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const expectedKey = expected.replace(/\u200b/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (actual !== expectedKey) {
        window.postMessage({ type: 'SEEDANCE_INJECT_RESULT', success: false, reason: 'Editor value was not committed' }, '*');
        return false;
      }
      window.postMessage({ type: 'SEEDANCE_INJECT_RESULT', success: true }, '*');
      if (autoSubmit) {
        setTimeout(() => {
          const btn = findSendButton();
          if (btn) btn.click();
          else {
            const enterProps = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            editorEl.dispatchEvent(new KeyboardEvent('keydown', enterProps));
            editorEl.dispatchEvent(new KeyboardEvent('keyup', enterProps));
          }
        }, 300);
      }
      return true;
    } catch (e) {
      window.postMessage({ type: 'SEEDANCE_INJECT_RESULT', success: false, error: e.message }, '*');
      return false;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'SEEDANCE_INJECT_PROMPT') {
      handleBridgePromptInjection(event.data.text, event.data.autoSubmit);
    }
    if (event.data.type === 'SEEDANCE_ACTIVATE_VIDEO_SKILL') {
      handleBridgeActivateVideoSkill();
    }
  });
})();
