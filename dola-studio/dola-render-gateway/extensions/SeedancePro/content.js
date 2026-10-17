/**
 * SEEDANCE STUDIO PRO (Dola-Pool Engine Edition)
 * Unified High-Precision Content Script for Dola AI & Doubao
 * Supports GPM Browser multi-profiles, auto 2-prompt new chat cycle,
 * and Human Artifact detection.
 */
(function () {
  'use strict';

  // NEVER run on direct media tabs or non-app hosts
  if (window.location.hostname.startsWith('v16-') ||
      window.location.pathname.includes('/video/') ||
      window.location.pathname.endsWith('.mp4') ||
      !/dola\.com|doubao\.com/i.test(window.location.hostname)) {
    return;
  }

  // Stealth: không log branding ra console trang (dễ bị site quét).
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SUPPORTED_DURATION_SECONDS = new Set([5, 10, 15, 30]);
  const WORKER_PROMPT_REQUEST_EVENT = 'studio-relay:worker-prompt-fill-request:v1';
  const WORKER_PROMPT_RESPONSE_EVENT = 'studio-relay:worker-prompt-fill-response:v1';
  const WORKER_PROMPT_REQUEST_MAX_CHARS = 256 * 1024;
  const WORKER_PROMPT_ATTEMPTS = 3;
  const pendingWorkerPromptRequests = new Map();

  function normalizeDuration(value, fallback = '15s') {
    const fallbackSeconds = Number(String(fallback).replace(/[^0-9]/g, '')) || 15;
    const candidate = Number(String(value ?? '').replace(/[^0-9]/g, ''));
    const seconds = SUPPORTED_DURATION_SECONDS.has(candidate)
      ? candidate
      : (SUPPORTED_DURATION_SECONDS.has(fallbackSeconds) ? fallbackSeconds : 15);
    return `${seconds}s`;
  }

  // ==========================================================================
  // 1. UNIVERSAL ELEMENT FINDERS & DISPATCHERS
  // ==========================================================================
  function findDolaInput() {
    // 1. Ưu tiên tìm ProseMirror / Tiptap trong khu vực soạn thảo tin nhắn ở nửa dưới màn hình
    const allProse = Array.from(document.querySelectorAll('.tiptap.ProseMirror, .ProseMirror, div[contenteditable="true"]'));
    const bottomProse = allProse.filter(el => {
      // Loại bỏ các phần tử nằm trong sidebar, header, hoặc nav
      if (el.closest('header, nav, aside, [class*="sidebar"]')) return false;
      const r = el.getBoundingClientRect();
      return r.height > 15 && r.width > 80 && r.top > window.innerHeight * 0.35;
    });

    if (bottomProse.length > 0) {
      // Sắp xếp theo vị trí top giảm dần: phần tử nào ở sát đáy màn hình nhất là ô soạn thảo hiện tại!
      bottomProse.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return bottomProse[0];
    }

    // 2. Tìm textarea ở khu vực dưới màn hình
    const allTextareas = Array.from(document.querySelectorAll('textarea')).filter(el => {
      if (el.closest('header, nav, aside, [class*="sidebar"]')) return false;
      const r = el.getBoundingClientRect();
      return r.height > 15 && r.width > 80 && r.top > window.innerHeight * 0.35;
    });
    if (allTextareas.length > 0) {
      allTextareas.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      return allTextareas[0];
    }

    // 3. Fallback: tìm bất kỳ ô nhập liệu nào có placeholder liên quan đến chat/video
    const allInputs = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]'));
    const matched = allInputs.find(el => {
      if (el.closest('header, nav, aside, [class*="sidebar"]')) return false;
      const r = el.getBoundingClientRect();
      if (r.height < 15 || r.width < 80) return false;
      const ph = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '').toLowerCase();
      return ph.includes('describe') || ph.includes('mô tả') || ph.includes('nhập') || ph.includes('message') || ph.includes('hỏi') || ph.includes('action');
    });
    if (matched) return matched;

    return allProse[0] || allTextareas[0] || null;
  }

  function triggerFullClick(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const eventProps = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      screenX: cx,
      screenY: cy,
      button: 0,
      buttons: 1
    };
    el.dispatchEvent(new PointerEvent('pointerdown', eventProps));
    el.dispatchEvent(new MouseEvent('mousedown', eventProps));
    el.dispatchEvent(new PointerEvent('pointerup', { ...eventProps, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...eventProps, buttons: 0 }));
    el.click();
  }

  function isHistoryOrSidebarEl(el) {
    if (!el) return true;
    if (el.closest('header, nav, aside, [class*="sidebar"], [class*="conversation-item"], a[id^="conversation_"]')) {
      return true;
    }
    const r = el.getBoundingClientRect();
    if (r.left < 280 && r.width < 300) return true;
    return false;
  }

  async function trustedClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (e) {}
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
      triggerFullClick(el);
      return false;
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const sent = await new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), 1500);
      try {
        chrome.runtime.sendMessage({ action: 'dispatch_trusted_click', x, y }, (resp) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            finish(false);
            return;
          }
          finish(Boolean(resp && resp.success));
        });
      } catch (e) {
        clearTimeout(timer);
        finish(false);
      }
    });
    if (!sent) {
      triggerFullClick(el);
      if (typeof el.click === 'function') el.click();
    }
    return sent;
  }

  function findSendButton() {
    // 1. Selector chính xác của Dola web
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

    // 2. Tìm nút gửi trong cùng container với ô nhập (kể cả chế độ Create Video nút tròn xanh mũi tên lên)
    const input = findDolaInput();
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
        if (sendCandidate) return sendCandidate;
      }
    }

    // 3. Các nút ở góc dưới phải của ô chat
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const bottomCandidates = candidates.filter((btn) => {
      const rect = btn.getBoundingClientRect();
      return rect.height > 15 && rect.width > 15 && rect.top > window.innerHeight * 0.45 && rect.left > window.innerWidth * 0.35;
    });

    for (const btn of bottomCandidates) {
      const text = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const id = (btn.id || '').toLowerCase();
      const cls = (btn.className || '').toString().toLowerCase();

      // Tuyệt đối không click nhầm vào nút Pro, Dự án, Kỹ năng, Voice, Menu
      if (/pro|nhanh|dự\s*án|kỹ\s*năng|mic|voice|attach|upload|ghi\s*âm|đính\s*kèm/i.test(text + aria + id + cls)) {
        continue;
      }
      if (id.includes('send') || cls.includes('send') || /send|submit|gửi/i.test(aria)) {
        return btn;
      }
    }

    return null;
  }

  let submitLock = false;
  async function submitDolaChatPrompt() {
    if (submitLock) {
      console.log('[Seedance Studio Pro] Submit prompt locked, skipping duplicate submit.');
      return;
    }
    submitLock = true;

    try {
      // 1. Chờ ngắn 350ms để ProseMirror / React nhận diện nội dung đã nhập và kích hoạt nút gửi
      await sleep(350);

      // 2. Ưu tiên tìm và click nút gửi Dola duy nhất (#flow-end-msg-send hoặc nút tròn ở góc phải)
      let sendBtn = findSendButton();
      for (let i = 0; i < 12; i++) {
        if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') break;
        await sleep(150);
        sendBtn = findSendButton();
      }

      if (sendBtn) {
        sendBtn.removeAttribute('disabled');
        sendBtn.setAttribute('aria-disabled', 'false');
        triggerFullClick(sendBtn);
        console.log('[Seedance Studio Pro] Đã click nút gửi Dola duy nhất!');
      } else {
        // Chỉ fallback gửi phím Enter nếu không tìm thấy nút gửi trên giao diện
        const input = findDolaInput();
        if (input) {
          input.focus();
          triggerFullClick(input);
          const enterProps = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
          input.dispatchEvent(new KeyboardEvent('keydown', enterProps));
          input.dispatchEvent(new KeyboardEvent('keyup', enterProps));
          console.log('[Seedance Studio Pro] Đã gửi Enter fallback duy nhất!');
        }
      }
    } catch (e) {
      console.warn('[Seedance Studio Pro] submitDolaChatPrompt error:', e);
    } finally {
      setTimeout(() => { submitLock = false; }, 1500);
    }
  }

  // ==========================================================================
  // 2. DOLA MODEL SWITCHER & VIDEO SKILL / CHAT MODE CONTROLLER
  // ==========================================================================
  function findModelButton() {
    // 1. Direct Dola mode select action button container
    const exact = document.querySelector('[data-valid-btn="mode-select-action-btn"]') ||
                  document.querySelector('[data-testid*="mode-select"]');
    if (exact) {
      const btn = exact.tagName === 'BUTTON' ? exact : (exact.querySelector('button') || exact);
      return btn;
    }

    // 2. Buttons containing Fast / Pro / Nhanh (EN / VI / ZH)
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], .semi-button'));
    const matched = buttons.find((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 15 || r.width < 25 || r.top < window.innerHeight * 0.3) return false;
      const text = (el.innerText || el.textContent || '').trim();
      return /\b(Pro|Fast|Nhanh|2\.5|2\.0)\b/i.test(text) && text.length < 25;
    });
    if (matched) return matched;

    return null;
  }

  function getModelMenuItems() {
    // Standard Semi UI & Dola dropdown menu items
    const selectors = '[role="menuitem"], [data-slot="dropdown-menu-item"], .semi-dropdown-item, [class*="dropdown-item"], [class*="menu-item"], [role="option"]';
    const items = Array.from(document.querySelectorAll(selectors));
    const visible = items.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 15 && r.top >= 0;
    });
    if (visible.length > 0) return visible;

    // Fallback: direct children inside open dropdown/popover container
    const containers = Array.from(document.querySelectorAll('.semi-dropdown-menu, .semi-dropdown, [role="menu"], [data-slot="dropdown-menu-content"]'));
    const fallback = [];
    for (const c of containers) {
      fallback.push(...Array.from(c.querySelectorAll('li, div[role="menuitem"], button')));
    }
    return fallback.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 15;
    });
  }

  async function ensureModel(targetModel = '2.5') {
    try {
      const isTargetPro = targetModel === '2.5' || targetModel === 'pro' || targetModel === 'Pro';

      let modelBtn = findModelButton();
      if (!modelBtn) {
        await sleep(400);
        modelBtn = findModelButton();
      }
      if (!modelBtn) {
        console.warn('[Seedance Studio Pro] Không tìm thấy nút đổi mô hình Pro/Fast/Nhanh');
        return false;
      }

      const currentText = (modelBtn.innerText || modelBtn.textContent || '').trim();
      if (isTargetPro && /\bPro\b/i.test(currentText)) {
        console.log('[Seedance Studio Pro] Mô hình trên web Dola đã là Pro');
        return true;
      }
      if (!isTargetPro && (/\b(Fast|Nhanh|2\.0)\b/i.test(currentText))) {
        console.log('[Seedance Studio Pro] Mô hình trên web Dola đã là Fast/2.0');
        return true;
      }

      showToast(`⚡ Đang chuyển mode web sang ${isTargetPro ? 'Pro (2.5)' : 'Fast (2.0)'}...`, 2000);
      triggerFullClick(modelBtn);
      await sleep(500);

      const menuItems = getModelMenuItems();
      console.log('[Seedance Studio Pro] Menu items found:', menuItems.map(m => (m.innerText || '').trim()));

      const targetItem = menuItems.find((el) => {
        const t = (el.innerText || el.textContent || '').trim();
        if (isTargetPro) {
          return /\bPro\b/i.test(t) || t.includes('Advanced Pro');
        } else {
          return /\b(Fast|Nhanh|2\.0)\b/i.test(t) || t.includes('Solves most problems');
        }
      });

      if (targetItem) {
        triggerFullClick(targetItem);
        await sleep(600);

        const checkBtn = findModelButton();
        const newText = checkBtn ? checkBtn.innerText.trim() : (isTargetPro ? 'Pro' : 'Fast');
        showToast(`✨ Đã kích hoạt mode web ${newText} thành công!`, 2000);
        return true;
      }

      document.body.click();
    } catch (e) {
      console.warn('[Seedance Studio Pro] ensureModel error:', e);
    }
    return false;
  }

  async function ensureProModel() {
    return ensureModel('2.5');
  }

  async function ensureFastModel() {
    return ensureModel('2.0');
  }

  function ensureNormalChatMode() {
    try {
      // Do not click arbitrary "exit-btn" controls: Dola uses that class for
      // popovers and attachment panels too. Only a control explicitly tied to
      // the active skill is allowed to replace the composer.
      const exitBtn = document.querySelector('[class*="exit-skill"], .bg-g-exit-skill-btn-bg, [data-testid*="exit-skill"]');
      if (exitBtn) {
        triggerFullClick(exitBtn);
        return true;
      }

      const skillChips = Array.from(document.querySelectorAll('[class*="skill"], [class*="chip"]')).filter(el => {
        const t = (el.innerText || '').trim();
        return /tạo\s*video|create\s*videos?/i.test(t);
      });
      for (const chip of skillChips) {
        const closeIcon = chip.querySelector('svg, [class*="close"], [class*="exit"]');
        if (closeIcon) {
          triggerFullClick(closeIcon);
          return true;
        }
      }
    } catch (e) {
      console.warn('[Seedance Studio Pro] ensureNormalChatMode error:', e);
    }
    return false;
  }

  function isVideoSkillActive() {
    try {
      // 1. Kiểm tra Action Bar controls chính thức của Dola
      if (document.querySelector('[data-input-engine-actionbar-control-key="video-duration"]')) return true;
      if (document.querySelector('[data-input-engine-actionbar-control-key="video-model"]')) return true;
      if (document.querySelector('[data-input-engine-actionbar-control-key="video-ratio"]')) return true;

      // 2. Kiểm tra chip active của Create Videos trên thanh công cụ (có icon hoặc chữ Create Videos kèm nút đóng X)
      const chips = Array.from(document.querySelectorAll('button[data-component-type="skill-item"], button'));
      const activeVideoChip = chips.find(el => {
        if (isHistoryOrSidebarEl(el)) return false;
        const t = (el.innerText || el.textContent || '').trim();
        if (/^Create Videos\s*[✕x×]?$/i.test(t) || /^Tạo videos?\s*[✕x×]?$/i.test(t)) {
          return !!el.querySelector('svg, [class*="close"], [class*="exit"]');
        }
        return false;
      });
      if (activeVideoChip) return true;

      // 3. Kiểm tra nút exit-skill CỦA TẠO VIDEO (tránh nhầm với tạo ảnh hay skill khác)
      const exitBtn = document.querySelector('[class*="exit-skill"], .bg-g-exit-skill-btn-bg, [data-testid*="exit-skill"], [class*="exit-btn"]');
      if (exitBtn) {
        const parentText = (exitBtn.parentElement?.innerText || exitBtn.innerText || '').toLowerCase();
        if (parentText.includes('video')) return true;
      }

      // 4. Kiểm tra placeholder ô nhập Dola khi ở chế độ tạo video
      const input = findDolaInput();
      if (input) {
        const ph = (
          input.getAttribute('placeholder') ||
          input.getAttribute('data-placeholder') ||
          input.querySelector('[data-placeholder]')?.getAttribute('data-placeholder') ||
          input.parentElement?.querySelector('[data-placeholder]')?.getAttribute('data-placeholder') ||
          ''
        ).toLowerCase();
        if (ph.includes('describe the action') || ph.includes('mô tả hành động')) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  function findCreateVideoSkillButton() {
    try {
      const skillItems = Array.from(document.querySelectorAll('button[data-component-type="skill-item"], button.skill-bar-button'));
      const exactSkill = skillItems.find((el) => {
        if (isHistoryOrSidebarEl(el)) return false;
        const t = (el.innerText || el.textContent || '').trim();
        return /^(?:create\s*videos?|tạo\s*videos?)$/i.test(t);
      });
      if (exactSkill) return exactSkill;

      const toolbarBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter((el) => {
        if (isHistoryOrSidebarEl(el)) return false;
        if (el.closest('[class*="exit"], .bg-g-exit-skill-btn-bg')) return false;
        const r = el.getBoundingClientRect();
        return r.top > window.innerHeight * 0.55 && r.width > 20 && r.height > 16 && r.left > 280;
      });
      const exactToolbar = toolbarBtns.find((el) => {
        const t = (el.innerText || el.textContent || '').trim();
        return /^(?:create\s*videos?|tạo\s*videos?)$/i.test(t);
      });
      if (exactToolbar) return exactToolbar.closest('button, [role="button"]') || exactToolbar;
    } catch (e) {}
    return null;
  }

  function findSkillsMenuButton() {
    // Tìm nút "Skills >" hoặc "Kỹ năng >" trên thanh công cụ Dola
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
    const matched = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 15 || r.width < 20 || r.top < window.innerHeight * 0.35 || r.top > window.innerHeight) return false;
      const text = (el.innerText || el.textContent || '').trim();
      return /\b(skills?|kỹ\s*năng|技能)\b/i.test(text) && text.length < 25;
    });

    if (matched) {
      return matched.closest('button, [role="button"]') || matched;
    }
    return null;
  }

  async function enterVideoSkill() {
    try {
      if (isVideoSkillActive()) {
        console.log('[Seedance Studio Pro] Đã ở trong Create Videos skill mode sẵn!');
        return true;
      }

      const directVideoBtn = findCreateVideoSkillButton();
      if (directVideoBtn) {
        console.log('[Seedance Studio Pro] Click nút Create Videos trên thanh skill:', directVideoBtn.innerText);
        await trustedClick(directVideoBtn);
        window.postMessage({ type: 'SEEDANCE_ACTIVATE_VIDEO_SKILL' }, '*');
        await sleep(800);
        if (isVideoSkillActive()) return true;
      }

      const skillBtn = findSkillsMenuButton();
      if (skillBtn) {
        console.log('[Seedance Studio Pro] Click nút Skills menu:', skillBtn);
        await trustedClick(skillBtn);
        await sleep(500);

        const allCandidates = Array.from(document.querySelectorAll('[role="menuitem"], [data-slot="dropdown-menu-item"], .semi-dropdown-item, button'));
        const videoMenuItem = allCandidates.find((el) => {
          if (isHistoryOrSidebarEl(el)) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 15 || r.height < 15 || r.top <= 0) return false;
          const t = (el.innerText || el.textContent || '').trim();
          return /^(?:create\s*videos?|tạo\s*videos?)$/i.test(t);
        });

        if (videoMenuItem) {
          const clickTarget = videoMenuItem.closest('button, [role="menuitem"]') || videoMenuItem;
          console.log('[Seedance Studio Pro] Click Create Videos trong Skills menu');
          await trustedClick(clickTarget);
          await sleep(800);
          if (isVideoSkillActive()) return true;
        }

        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        } catch (e) {}
        await sleep(200);
      }
    } catch (e) {
      console.warn('[Seedance Studio Pro] enterVideoSkill error:', e);
    }
    return isVideoSkillActive();
  }


  function findActionBarTrigger(controlKey) {
    const exact = document.querySelector(`[data-input-engine-actionbar-control-key="${controlKey}"]`);
    if (exact) return exact.closest('button, [role="button"]') || exact;

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    return buttons.find((el) => {
      if (isHistoryOrSidebarEl(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 15 || r.height < 12 || r.top < window.innerHeight * 0.55 || r.top > window.innerHeight) return false;
      const t = (el.innerText || el.textContent || '').trim();
      if (controlKey === 'video-duration') return /^(?:5s|10s|15s|30s)$/i.test(t);
      if (controlKey === 'video-ratio') return /^(?:ratio|tỉ\s*lệ|16:9|9:16|1:1|3:4|4:3|21:9)$/i.test(t);
      return false;
    }) || null;
  }

  function findMenuOption(cleanTarget) {
    const menus = Array.from(document.querySelectorAll('[data-radix-menu-content], [data-radix-popper-content-wrapper], [role="menu"], [data-slot="dropdown-menu-content"]'));
    const containers = menus.length ? menus : [document.body];
    for (const container of containers) {
      const candidates = Array.from(container.querySelectorAll('[role="menuitem"], [data-slot="dropdown-menu-item"]'));
      const exact = candidates.find((el) => {
        const t = (el.innerText || el.textContent || '').trim();
        return t === cleanTarget || t.toLowerCase() === cleanTarget.toLowerCase();
      });
      if (exact) return exact;
    }
    return null;
  }

  async function selectActionBarDropdown(controlKey, targetValue, friendlyLabel = '') {
    const cleanTarget = String(targetValue || '').trim();
    if (!cleanTarget || cleanTarget === 'none') return false;

    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    } catch (e) {}
    await sleep(180);

    let triggerBtn = findActionBarTrigger(controlKey);
    if (!triggerBtn) {
      console.log(`[Seedance Studio Pro] Không có nút ${controlKey} trên Action Bar (bỏ qua).`);
      return false;
    }

    const curText = (triggerBtn.innerText || triggerBtn.textContent || '').trim();
    if (curText.toLowerCase().includes(cleanTarget.toLowerCase())) {
      console.log(`[Seedance Studio Pro] ${controlKey} đã là "${cleanTarget}" sẵn!`);
      return true;
    }

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        triggerBtn = findActionBarTrigger(controlKey) || triggerBtn;
        console.log(`[Seedance Studio Pro] [Lần ${attempt}] Mở dropdown ${controlKey} (hiện tại: "${(triggerBtn.innerText || '').trim()}")...`);
        await trustedClick(triggerBtn);
        await sleep(500);

        const targetOpt = findMenuOption(cleanTarget);
        if (targetOpt) {
          console.log(`[Seedance Studio Pro] Click chọn mục "${cleanTarget}"`);
          await trustedClick(targetOpt);
          await sleep(450);

          const checkBtn = findActionBarTrigger(controlKey) || triggerBtn;
          const updatedText = (checkBtn.innerText || checkBtn.textContent || '').trim();
          if (updatedText.toLowerCase().includes(cleanTarget.toLowerCase())) {
            console.log(`[Seedance Studio Pro] Đã xác nhận ${controlKey} = "${updatedText}"`);
            showToast(`Đã chọn ${friendlyLabel || controlKey}: ${cleanTarget}`, 2000);
            return true;
          }
        }

        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        } catch (e) {}
        await sleep(250);
      } catch (err) {
        console.warn(`[Seedance Studio Pro] Lỗi khi chỉnh ${controlKey} lần ${attempt}:`, err);
        await sleep(300);
      }
    }
    return false;
  }

  async function selectActionBarDuration(targetSec = '15s') {
    return selectActionBarDropdown('video-duration', normalizeDuration(targetSec), 'Thời lượng');
  }

  async function selectActionBarRatio(targetRatio = '16:9') {
    return selectActionBarDropdown('video-ratio', targetRatio.trim(), 'Tỉ lệ khung hình');
  }

  let activeVideoSkillPromise = null;
  async function activateVideoSkillMode(duration = '15s', ratio = '16:9') {
    if (activeVideoSkillPromise) {
      console.log('[Seedance Studio Pro] Waiting for existing activateVideoSkillMode...');
      try {
        await activeVideoSkillPromise;
      } catch (e) {}
      if (isVideoSkillActive()) return true;
    }

    activeVideoSkillPromise = (async () => {
      try {
        console.log('[Seedance Studio Pro] activateVideoSkillMode: duration =', duration, 'ratio =', ratio);

        if (!isVideoSkillActive()) {
          showToast('BƯỚC 1: Đang bấm Create Videos...', 2000);
          let activated = false;
          for (let attempt = 1; attempt <= 4; attempt++) {
            const entered = await enterVideoSkill();
            if (entered) {
              activated = true;
              break;
            }
            for (let i = 0; i < 8; i++) {
              if (isVideoSkillActive() || document.querySelector('[data-input-engine-actionbar-control-key="video-duration"]')) {
                activated = true;
                break;
              }
              await sleep(200);
            }
            if (activated) break;
            await sleep(350);
          }

          if (!activated) {
            console.warn('[Seedance Studio Pro] Không thể mở Action Bar Create Videos sau 4 lần thử!');
          }
        } else {
          console.log('[Seedance Studio Pro] Đang ở trong Create Videos sẵn!');
        }

        await sleep(350);

        // BƯỚC 2: CHỈNH DURATION (THỜI LƯỢNG) TRÊN ACTION BAR
        showToast(`⚡ BƯỚC 2: Chỉnh thời lượng ${duration}...`, 1500);
        await selectActionBarDuration(duration);
        await sleep(350);

        // BƯỚC 3: CHỈNH RATIO (TỈ LỆ KHUNG HÌNH) TRÊN ACTION BAR
        if (ratio && ratio !== 'none') {
          showToast(`⚡ BƯỚC 3: Chỉnh tỉ lệ ${ratio}...`, 1500);
          await selectActionBarRatio(ratio);
          await sleep(300);
        }

        // Đóng mọi popover còn sót lại
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        } catch (e) {}

        showToast(`✨ Chế độ Create Videos sẵn sàng (Thời lượng: ${duration} · Tỉ lệ: ${ratio || '16:9'})!`, 2500);
        return true;
      } catch (e) {
        console.warn('[Seedance Studio Pro] activateVideoSkillMode error:', e);
        return false;
      }
    })();

    try {
      return await activeVideoSkillPromise;
    } finally {
      activeVideoSkillPromise = null;
    }
  }

  async function activateProChatMode() {
    try {
      const exited = ensureNormalChatMode();
      if (exited) {
        await sleep(600);
      } else {
        await sleep(200);
      }

      // Đợi nút đổi mô hình hiển thị sẵn sàng
      for (let i = 0; i < 8; i++) {
        const btn = findModelButton();
        if (btn) break;
        await sleep(250);
      }

      await ensureProModel();
      showToast('🔄 Đã chuyển sang Chế độ Pro (Seedance 2.5 Pro) trên Dola!', 3000);
      return true;
    } catch (e) {
      console.warn('[Seedance Studio Pro] activateProChatMode error:', e);
      return false;
    }
  }

  function activateVideoMode() {
    ensureNormalChatMode();
  }

  // ==========================================================================
  // 3. PROMPT FORMATTER (PREFIX, ASPECT RATIO, DURATION, DIRECT COMMAND)
  // ==========================================================================
  function formatDolaPrompt(rawPrompt, config = {}) {
    let clean = String(rawPrompt || '').trim();
    if (!clean) return '';

    const isCreditMode = config.mode === 'credit_video' || config.mode === 'distributed' || config.duration === '30s';
    const prefix = config.prefix !== undefined ? config.prefix : 'tạo video: ';
    const ratio = config.aspectRatio && config.aspectRatio !== 'none' ? config.aspectRatio : '16:9';

    if (isCreditMode) {
      // Ở CHẾ ĐỘ CREATE VIDEO (Credit · 30s):
      // Dola có giao diện Action Bar chuyên dụng ("Describe the actions in the video") với các dropdown riêng:
      // - Thời lượng 30s đã được chọn qua dropdown Duration
      // - Tỉ lệ khung hình đã được chọn qua dropdown Ratio
      // - Mô hình 2.0 Fast đã được chọn qua dropdown Model
      // DO ĐÓ: Prompt KHÔNG ĐƯỢC chứa các lệnh chat hay tham số thừa làm ô nhiễm prompt mô tả video.
      // Chúng ta lọc sạch các tham số thời lượng, tỉ lệ, mô hình và câu lệnh chatbot, chỉ giữ lại mô tả thuần túy!

      // 1. Bỏ tiền tố "tạo video:" hoặc "create video:" nếu có
      clean = clean.replace(/^(?:tạo\s*video|create\s*videos?)\s*:\s*/i, '');

      // 2. Bỏ các câu lệnh chatbot
      clean = clean.replace(/,?\s*tạo\s*video\s*luôn\s*(?:ko|không)\s*hỏi\s*lại/gi, '');
      clean = clean.replace(/,?\s*gửi\s*dưới\s*dạng\s*human\s*artifact/gi, '');
      clean = clean.replace(/,?\s*(?:ko|không)\s*hỏi\s*lại/gi, '');

      // 3. Bỏ tham số thời lượng đã gán vào chuỗi prompt
      clean = clean.replace(/,?\s*(?:thời\s*lượng|duration)\s*[:\s]*\d+\s*s?/gi, '');

      // 4. Bỏ tham số mô hình
      clean = clean.replace(/,?\s*(?:mô\s*hình|model|seedance)\s*[:\s]*[\w\.\s]+/gi, '');

      // 5. Bỏ tham số tỉ lệ khung hình (vì dropdown Ratio trên Action Bar đã chọn)
      clean = clean.replace(/(?:,\s*)?(?:tỉ\s*lệ|ratio)?\s*[:\s]*\b(16:9|9:16|1:1|4:3|21:9)\b/gi, '');

      // Xóa dấu phẩy thừa ở cuối chuỗi nếu có
      clean = clean.replace(/[,;\s]+$/, '').trim();

      return clean;
    }

    // Ở CHẾ ĐỘ PRO CHAT THƯỜNG (Dola Chatbot):
    // Ghi tỉ lệ + thời lượng vào prompt theo đúng dropdown extension (Dola tự đọc chỉ dẫn).
    // Không bấm dropdown Action Bar (trừ chế độ Create Videos / credit).
    let duration = String(config.duration || '15s').trim();
    if (!/^\d+s$/i.test(duration)) {
      const n = duration.replace(/[^0-9]/g, '') || '15';
      duration = `${n}s`;
    }
    if (duration === '30s') duration = '15s';
    const direct = config.directCreate !== false;

    let formatted = clean;

    if (prefix && prefix.trim()) {
      const normalizedPrefix = prefix.trim().toLowerCase();
      if (!formatted.toLowerCase().startsWith(normalizedPrefix)) {
        formatted = prefix.trim() + ' ' + formatted;
      }
    }

    // Luôn ép tỉ lệ theo cài đặt extension
    if (ratio && ratio !== 'none') {
      formatted = formatted.replace(/(?:,\s*)?(?:tỉ\s*lệ|ratio)\s*[:\s]*\b(?:16:9|9:16|1:1|4:3|21:9)\b/gi, '');
      formatted = formatted.replace(/(?:,\s*)?\b(?:16:9|9:16|1:1|4:3|21:9)\b/gi, '');
      formatted = formatted.replace(/[,;\s]+$/g, '').trim();
      formatted += `, tỉ lệ ${ratio}`;
    }

    // Luôn ép thời lượng theo cài đặt extension (5s / 10s / 15s)
    formatted = formatted.replace(/(?:,\s*)?(?:thời\s*lượng|duration)\s*[:\s]*\d+\s*s?/gi, '');
    formatted = formatted.replace(/(?:,\s*)?\b(?:5|10|15|30)\s*s\b/gi, '');
    formatted = formatted.replace(/[,;\s]+$/g, '').trim();
    formatted += `, thời lượng ${duration}`;

    // Gắn model Pro (2.5 / 2.0) vào prompt chat thường
    const modelRaw = String(config.model || '').trim();
    if (modelRaw && modelRaw !== 'credit' && !/^credit_/i.test(modelRaw)) {
      const modelLabel = /2\.5/.test(modelRaw)
        ? 'Seedance 2.5'
        : (/2\.0/.test(modelRaw) ? 'Seedance 2.0' : modelRaw);
      if (!/seedance\s*2\.[05]|mô\s*hình\s*2\.[05]|model\s*2\.[05]/i.test(formatted)) {
        formatted += `, mô hình ${modelLabel}`;
      }
    }

    if (direct) {
      if (!/không\s*hỏi\s*lại/i.test(formatted)) {
        formatted += ', tạo video luôn không hỏi lại';
      }
      if (!/human\s*artifact/i.test(formatted)) {
        formatted += ', gửi dưới dạng human artifact';
      }
    }

    return formatted;
  }

  // ==========================================================================
  // 4. PROMPT INJECTION INTO PROSEMIRROR / TIPTAP
  // ==========================================================================
  async function pasteTextIntoDolaInput(text, autoSubmit = false, mode = 'pro') {
    if (!text) return false;
    if (mode !== 'credit_video') {
      // Exiting Create Videos replaces the editor asynchronously. Waiting
      // here is required; otherwise the MAIN bridge can write into the
      // detached action-bar editor and report success while Dola's new chat
      // editor remains empty.
      const exitedSkill = ensureNormalChatMode();
      if (exitedSkill) await sleep(900);
    }
    let target = findDolaInput();
    if (!target) {
      console.warn('[Seedance Studio Pro] Không tìm thấy ô nhập Dola!');
      return false;
    }

    try {
      target.focus();

      // 1. Thử Page Bridge MAIN (ProseMirror) rồi fallback DOM.
      let bridgeSuccess = false;
      try {
        bridgeSuccess = await new Promise((resolve) => {
          let resolved = false;
          const handler = (event) => {
            if (event.source !== window || !event.data) return;
            if (event.data.type === 'SEEDANCE_INJECT_RESULT') {
              window.removeEventListener('message', handler);
              resolved = true;
              resolve(Boolean(event.data.success));
            }
          };
          window.addEventListener('message', handler);
          window.postMessage({
            type: 'SEEDANCE_INJECT_PROMPT',
            text,
            autoSubmit
          }, '*');
          setTimeout(() => {
            if (!resolved) {
              window.removeEventListener('message', handler);
              resolve(false);
            }
          }, 600);
        });
      } catch (e) {}

      // The page bridge validates the node it found synchronously, but React
      // may replace that node immediately after the transaction. Re-read the
      // current composer before accepting bridge success so the caller never
      // proceeds with an editor that Dola will not submit.
      if (bridgeSuccess) {
        await sleep(250);
        const currentTarget = findDolaInput();
        const currentText = currentTarget
          ? String(currentTarget.innerText || currentTarget.textContent || currentTarget.value || '')
              .replace(/\u200b/g, '')
              .replace(/\u00a0/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
          : '';
        const expectedText = String(text)
          .replace(/\u200b/g, '')
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (currentText !== expectedText) {
          bridgeSuccess = false;
          target = currentTarget || target;
        }
      }

      // 2. Nếu Page Bridge chưa hoàn tất hoặc thất bại, chạy DOM fallback trong Content Script
      if (!bridgeSuccess) {
        target = findDolaInput() || target;
        if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
          // Luôn đảm bảo thẻ <p> tồn tại bên trong ô soạn thảo ProseMirror
          let p = target.querySelector('p');
          if (!p) {
            p = document.createElement('p');
            target.appendChild(p);
          }

          // Thiết lập Selection trỏ vào trong <p>
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(p);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (e) {}

          // Thử execCommand insertText
          let inserted = false;
          try {
            inserted = document.execCommand('insertText', false, text);
          } catch (e) {}

          // Nếu chưa có text thì gán nội dung vào thẻ <p> (TUYỆT ĐỐI KHÔNG gán target.innerText trực tiếp để tránh phá hỏng schema ProseMirror)
          if (!inserted || !target.innerText || !target.innerText.includes(text.slice(0, 15))) {
            p.textContent = text;
          }

          // Bắn chuỗi sự kiện input đầy đủ lên cả <p> và target
          p.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
          p.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
          target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) {
            setter.call(target, text);
          } else {
            target.value = text;
          }
          target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: text }));
        }

        if (autoSubmit) {
          await submitDolaChatPrompt();
        }
      }

      // Verify the editor that is current after React's possible re-render,
      // not only the node used by the first injection attempt. Returning false
      // here lets the bounded worker retry/fallback instead of moving on with
      // a prompt that is visible only in a detached DOM node.
      const finalTarget = findDolaInput();
      const finalText = finalTarget
        ? String(finalTarget.innerText || finalTarget.textContent || finalTarget.value || '')
            .replace(/\u200b/g, '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : '';
      const expectedFinalText = String(text)
        .replace(/\u200b/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (finalText !== expectedFinalText) return false;

      console.log('[Seedance Studio Pro] Đã điền prompt thành công vào ô chat:', text.slice(0, 40));
      return true;
    } catch (e) {
      console.error('[Seedance Studio Pro] Error pasting prompt:', e);
      return false;
    }
  }

  // The Gateway owns prompt formatting and asks SeedancePro to perform the
  // actual editor injection. Do not call formatDolaPrompt here: doing so would
  // make the Gateway and extension append the same video parameters twice.
  function normalizeWorkerPromptRequestId(value) {
    const id = String(value || '').trim();
    return id && id.length <= 160 ? id : '';
  }

  function respondToWorkerPrompt(requestId, result) {
    try {
      document.dispatchEvent(new CustomEvent(WORKER_PROMPT_RESPONSE_EVENT, {
        detail: JSON.stringify({ v: 1, requestId, ...result })
      }));
    } catch (e) {}
  }

  async function fillWorkerPromptWithRetry(prompt) {
    let lastError = null;
    const waitWindows = [4500, 3000, 2500];

    for (let attempt = 0; attempt < WORKER_PROMPT_ATTEMPTS; attempt += 1) {
      // Image uploads and Pro-mode selection can replace the editor node
      // after the Gateway has already dispatched the event. Resolve the
      // current node on every attempt instead of typing into a detached one.
      const input = await waitForInputReady(waitWindows[attempt]);
      if (!input) {
        lastError = new Error('Ô nhập prompt chưa sẵn sàng sau khi composer re-render');
      } else {
        try {
          if (await pasteTextIntoDolaInput(prompt, false, 'pro')) return true;
          lastError = new Error('SeedancePro không điền được ô prompt hiện tại');
        } catch (error) {
          lastError = error;
        }
      }

      if (attempt + 1 < WORKER_PROMPT_ATTEMPTS) {
        await sleep(attempt === 0 ? 250 : 500);
      }
    }

    return false;
  }

  function handleWorkerPromptRequest(event) {
    if (typeof event.detail !== 'string' || event.detail.length > WORKER_PROMPT_REQUEST_MAX_CHARS) return;

    let request;
    try { request = JSON.parse(event.detail); } catch (e) { return; }
    const requestId = normalizeWorkerPromptRequestId(request?.requestId);
    const prompt = String(request?.prompt || request?.text || '').trim();
    if (request?.v !== 1 || !requestId || !prompt) return;

    // The Gateway may redispatch the same request while waiting for a
    // late-loaded content script. Keep one in-flight operation per request
    // ID so those redispatches can never paste the prompt concurrently.
    const existing = pendingWorkerPromptRequests.get(requestId);
    if (existing) return;

    const operation = fillWorkerPromptWithRetry(prompt);
    pendingWorkerPromptRequests.set(requestId, operation);
    operation
      .then((success) => respondToWorkerPrompt(requestId, {
        success: Boolean(success),
        prompt: success ? prompt : '',
        error: success ? '' : 'SeedancePro không tìm thấy hoặc không điền được ô prompt'
      }))
      .catch((error) => respondToWorkerPrompt(requestId, {
        success: false,
        prompt: '',
        error: error?.message || String(error)
      }))
      .finally(() => {
        if (pendingWorkerPromptRequests.get(requestId) === operation) {
          pendingWorkerPromptRequests.delete(requestId);
        }
      });
  }

  if (!globalThis.__studioRelayWorkerPromptHandlerInstalledV1) {
    globalThis.__studioRelayWorkerPromptHandlerInstalledV1 = true;
    document.addEventListener(WORKER_PROMPT_REQUEST_EVENT, handleWorkerPromptRequest, true);
  }

  // ==========================================================================
  // 5. NEW CHAT RESET CYCLER (STRICT 2 PROMPTS / CONVERSATION)
  // ==========================================================================
  async function waitForInputReady(maxWaitMs = 8000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const input = findDolaInput();
      if (input && input.getBoundingClientRect().height > 0) {
        return input;
      }
      await sleep(300);
    }
    return findDolaInput();
  }

  function findNewChatButton() {
    // Dola hiện dùng nút pill "New Chat" (+ "Ctrl Shift K") — KHÔNG phải icon thu sidebar.
    const candidates = Array.from(
      document.querySelectorAll('button, a, [role="button"], div[tabindex], span[role="button"]')
    );

    const scoreNewChat = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 18 || r.bottom < 0 || r.top > window.innerHeight) return -1;
      // Sidebar collapse thường nằm sát mép trái và rất nhỏ — loại.
      if (r.left < 8 && r.width < 48 && r.height < 48 && r.width / Math.max(r.height, 1) < 1.4) return -1;

      const aria = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim();
      const text = `${(el.innerText || el.textContent || '')}`.replace(/\s+/g, ' ').trim();
      const blob = `${aria} ${text}`.toLowerCase();

      // Loại rõ ràng nút thu/mở sidebar
      if (/(collapse|expand|toggle)\s*(sidebar|panel|nav)|thu\s*(gọn|sidebar)|đóng\s*sidebar|mở\s*sidebar/i.test(blob)) {
        return -1;
      }
      if (!/new\s*chat|cuộc\s*trò\s*chuyện\s*mới|đoạn\s*chat\s*mới|tạo\s*chat\s*mới/i.test(blob)) {
        return -1;
      }

      let score = 10;
      if (/^new\s*chat\b/i.test(text) || /^new\s*chat\b/i.test(aria)) score += 50;
      if (/ctrl\s*shift\s*k/i.test(blob)) score += 40;
      if (/cuộc\s*trò\s*chuyện\s*mới/i.test(blob)) score += 30;
      // Ưu tiên nút nằm vùng sidebar trái / header
      if (r.left < window.innerWidth * 0.42) score += 15;
      if (r.top < 120) score += 10;
      // Pill chữ "New Chat" thường rộng hơn icon
      if (r.width >= 90) score += 20;
      return score;
    };

    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      const s = scoreNewChat(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    if (best) {
      return best.closest('button, a, [role="button"]') || best;
    }

    // Fallback: link chat gốc
    const directLink = document.querySelector('a[href="/chat"], a[href="/chat/"], a[href="/"]');
    return directLink || null;
  }

  async function triggerNewChat() {
    showToast('🔄 Đang bấm New Chat...', 2500);

    // Ưu tiên phím tắt chính thức của Dola: Ctrl+Shift+K
    try {
      const keyOpts = {
        key: 'K',
        code: 'KeyK',
        keyCode: 75,
        which: 75,
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      };
      document.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      window.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      document.body?.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      await sleep(700);
    } catch (e) {}

    const beforeUrl = window.location.href;
    const btn = findNewChatButton();
    if (btn) {
      console.log('[Seedance Studio Pro] Click New Chat:', (btn.innerText || btn.getAttribute('aria-label') || '').trim());
      triggerFullClick(btn);
      await sleep(1200);
    } else {
      showToast('⚠️ Không thấy nút New Chat — thử lại Ctrl+Shift+K', 2500);
      try {
        const keyOpts = {
          key: 'K',
          code: 'KeyK',
          keyCode: 75,
          which: 75,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true
        };
        document.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      } catch (e) {}
      await sleep(900);
    }

    // Không dùng window.location.href — sẽ reload và hủy batch

    const readyInput = await waitForInputReady(6000);
    const urlChanged = window.location.href !== beforeUrl;
    if (readyInput || urlChanged) {
      showToast('✨ Đã vào New Chat sẵn sàng!', 2000);
      return true;
    }
    showToast('⚠️ New Chat có thể chưa mở — kiểm tra nút New Chat trên Dola', 3000);
    return false;
  }

  // ==========================================================================
  // 6. AUTONOMOUS BATCH RUNNER & LOAD BALANCING
  // ==========================================================================
  let isBatchRunning = false;
  let currentBatchId = 0;
  let abortBatchSignal = false;

  async function waitForArtifactOrDelay(delayMs = 7500) {
    const startTime = Date.now();
    let detected = false;

    while (Date.now() - startTime < delayMs) {
      const artifacts = document.querySelectorAll('[class*="artifact"], [data-testid*="artifact"], [class*="video-card"], [class*="generating"], video');
      if (artifacts.length > 0 && !detected) {
        detected = true;
        showToast('⚡ Phát hiện Human Artifact! Đang tiến hành tạo video...', 3500);
        try {
          chrome.runtime.sendMessage({ action: 'NOTIFY_HUMAN_ARTIFACT', count: artifacts.length });
        } catch (e) {}
      }
      await sleep(500);
    }
  }

  async function waitForChatVideosCompleted(targetCount, initialDlCount, initialVideoUrls, initialChatText, maxTimeoutMs = 240000, sessionIdx = 1) {
    const startTime = Date.now();
    let lastProgressToast = 0;

    while (Date.now() - startTime < maxTimeoutMs) {
      if (abortBatchSignal) break;

      const elapsed = Date.now() - startTime;
      const currentChatText = (document.querySelector('main') || document.body).innerText;

      if (checkDailyLimitExceeded()) {
        stopBatchForDailyLimit();
        return false;
      }

      // 1. Kiểm tra nếu Dola báo lỗi giới hạn quota 2 video (hỗ trợ Tiếng Việt & Tiếng Anh)
      const is2VideoBlocked = currentChatText.includes('Chỉ có thể tạo tối đa 2 video cùng lúc') ||
                              /only\s*2\s*videos|maximum\s*(?:of\s*)?2\s*videos|can\s*only\s*generate\s*2\s*videos/i.test(currentChatText);
      if (is2VideoBlocked && elapsed > 6000) {
        showToast('⚠️ Dola thông báo đang chạy tối đa 2 video! Đang đợi render hoàn tất...', 4000);
      }

      // 2. Tìm các video mới xuất hiện trên phiên chat hiện tại
      const allVideos = Array.from(document.querySelectorAll('video'));
      const newVideos = allVideos.filter(v => {
        const src = v.currentSrc || v.src;
        return src && !initialVideoUrls.has(src);
      });

      // Video đã hoàn thành thực sự: có thời lượng > 0 và trạng thái sẵn sàng phát (readyState >= 2)
      const readyVideos = newVideos.filter(v => {
        return (v.duration > 0 && !isNaN(v.duration) && v.readyState >= 2);
      });

      // Không tải từ thẻ <video> DOM (preview thường có watermark).
      // Master không logo chỉ do background tải từ fallback_api.

      // Cập nhật thông báo tiến độ trực tiếp lên màn hình mỗi 4 giây
      if (Date.now() - lastProgressToast > 4000) {
        lastProgressToast = Date.now();
        const secs = Math.round(elapsed / 1000);
        showToast(`⏳ [Phiên #${sessionIdx}] Đang chờ Dola render (${readyVideos.length}/${targetCount} video xong)... (${secs}s)`, 3000);
      }

      // 3. ĐIỀU KIỆN HOÀN TẤT PHIÊN: đã có đủ số video render xong
      if (readyVideos.length >= targetCount) {
        showToast(`🎉 [Phiên #${sessionIdx}] Đã xong ${readyVideos.length}/${targetCount} video! Đang lưu bản Master không logo…`, 3500);
        await sleep(4000); // Đợi background downloader hoàn tất
        return true;
      }

      await sleep(2000);
    }

    console.warn('[Seedance Studio Pro] Chờ render video đạt maxTimeout');
    return false;
  }

  const DAILY_LIMIT_RE = /you(?:['’]ve| have)\s+reached\s+the\s+daily\s+limit(?:\s+for\s+video\s+generation)?|please\s+try\s+again\s+tomorrow|đạt\s*giới\s*hạn\s*(?:tạo\s*)?video|giới\s*hạn\s*tạo\s*video\s*hằng\s*ngày|daily\s+(?:video\s+)?(?:generation\s+)?limit|limit\s+reached/i;

  // Dola từ chối tạo video vì ảnh/prompt vi phạm (content policy).
  const CONTENT_POLICY_RE = /content\s+creation\s+is\s+prohibited|creation\s+is\s+prohibited|cannot\s+be\s+generated\s+temporarily|requested\s+content\s+cannot\s+be\s+generated|prohibited\s+content|violat(?:es|ion)\s+(?:our\s+)?(?:content\s+)?(?:policy|guidelines)|không\s+thể\s+tạo\s+nội\s+dung\s+video|tạm\s+thời\s+không\s+thể\s+tạo\s+(?:nội\s+dung\s+)?video|không\s+thể\s+tạo\s+video\s+bạn\s+yêu\s+cầu|nội\s+dung\s+(?:bị\s+)?(?:cấm|chặn|không\s+được\s+phép)|ảnh\s+(?:không\s+hợp\s+lệ|bị\s+cấm|không\s+được\s+phép)|image\s+(?:not\s+allowed|is\s+prohibited|violat)|无法生成|内容违规|暂不支持生成|不符合.*?规范/i;

  function textLooksLikeDailyLimit(text) {
    return DAILY_LIMIT_RE.test(String(text || ''));
  }

  function textLooksLikeContentPolicy(text) {
    return CONTENT_POLICY_RE.test(String(text || ''));
  }

  function collectVisibleChatTexts() {
    const texts = [];
    try {
      const popups = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="popup"], [class*="toast"], [class*="alert"], [class*="banner"]'));
      for (const el of popups) {
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 10) continue;
        const t = (el.innerText || '').trim();
        if (t) texts.push(t);
      }

      const messages = Array.from(document.querySelectorAll('[data-testid*="message"], [class*="message-item"], [class*="message_"], [class*="chat-message"], [class*="markdown"], [class*="assistant"], [class*="answer"]'));
      for (const msg of messages.slice(-6)) {
        const t = (msg.innerText || '').trim();
        if (t) texts.push(t);
      }

      const main = document.querySelector('main') || document.body;
      const visibleBits = Array.from(main.querySelectorAll('p, div, span, li'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 40 && r.height > 10 && r.top > 80 && r.top < window.innerHeight;
        })
        .slice(-40);
      for (const el of visibleBits) {
        const t = (el.innerText || '').trim();
        if (t.length > 20 && t.length < 500) texts.push(t);
      }
    } catch (e) {}
    return texts;
  }

  function checkDailyLimitExceeded() {
    try {
      for (const t of collectVisibleChatTexts()) {
        if (textLooksLikeDailyLimit(t)) return true;
      }
    } catch (e) {}
    return false;
  }

  function checkContentPolicyBlocked() {
    try {
      for (const t of collectVisibleChatTexts()) {
        if (textLooksLikeContentPolicy(t)) return true;
      }
    } catch (e) {}
    return false;
  }

  function stopBatchForDailyLimit() {
    abortBatchSignal = true;
    isBatchRunning = false;
    showToast('Đã dừng: Dola báo hết hạn mức tạo video hôm nay. Thử lại ngày mai.', 8000);
    try {
      chrome.runtime.sendMessage({ action: 'DAILY_LIMIT_EXCEEDED', url: window.location.href });
    } catch (e) {}
  }

  function stopBatchForContentPolicy(meta = {}) {
    abortBatchSignal = true;
    isBatchRunning = false;
    const imgName = meta.imageName ? ` «${meta.imageName}»` : '';
    const msg = `⚠️ Ảnh${imgName} bị Dola chặn (không được phép tạo video). Hãy ĐỔI ẢNH khác rồi bắn lại.`;
    showToast(msg, 9000);
    try {
      chrome.runtime.sendMessage({
        action: 'CONTENT_POLICY_BLOCKED',
        url: window.location.href,
        imageName: meta.imageName || '',
        pairIndex: meta.pairIndex || 0,
        reason: 'img2vid_image_blocked'
      });
    } catch (e) {}
  }

  /** Sau khi gửi: chờ Dola trả lời hạn mức / chặn ảnh-policy. */
  async function waitForPostSubmitOutcome(options = {}) {
    const {
      isImg2Vid = false,
      imageName = '',
      pairIndex = 0,
      timeoutMs = isImg2Vid ? 18000 : 3500
    } = options;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (abortBatchSignal) return { ok: false, kind: 'aborted' };
      if (checkDailyLimitExceeded()) {
        stopBatchForDailyLimit();
        return { ok: false, kind: 'daily_limit' };
      }
      if (checkContentPolicyBlocked()) {
        stopBatchForContentPolicy({ imageName, pairIndex });
        return { ok: false, kind: 'content_policy' };
      }
      await sleep(500);
    }
    return { ok: true, kind: 'none' };
  }

  async function executeBatchSession(prompts, config = {}) {
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return { success: false, reason: 'Danh sách prompt rỗng' };
    }

    // Nếu đang có tiến trình cũ, tự động ngắt để ưu tiên lệnh bấm mới nhất của người dùng
    if (isBatchRunning) {
      console.log('[Seedance Studio Pro] Đang có batch cũ chạy, tự động hủy để chạy lệnh mới...');
      abortBatchSignal = true;
      await sleep(350);
    }

    isBatchRunning = true;
    abortBatchSignal = false;
    const thisBatchId = ++currentBatchId;

    try {
      // Chế độ Create Video (Credit 30s): 1 acc tạo 1 video 30s
      // Chế độ Img2Vid: 1 ảnh + 1 prompt / chat
      // Chế độ Pro Model: tối đa 2 prompt / phiên chat (khoảng vài chục video/ngày tùy nick)
      const requestedDuration = normalizeDuration(config.duration, '15s');
      const isCreditMode = config.mode === 'credit_video' || config.mode === 'distributed' || requestedDuration === '30s';
      const isImg2Vid = config.mode === 'img2vid';
      const pairImages = Array.isArray(config.images) ? config.images : [];
      const CHUNK_SIZE = (isCreditMode || isImg2Vid) ? 1 : 2;
      const chunks = [];
      for (let i = 0; i < prompts.length; i += CHUNK_SIZE) {
        chunks.push(prompts.slice(i, i + CHUNK_SIZE));
      }

      showToast(
        isImg2Vid
          ? `🖼️ Img2Vid: ${prompts.length} cặp (1 ảnh + 1 prompt / chat)...`
          : `⚡ Bắt đầu tiến trình (${prompts.length} cảnh, ${chunks.length} cửa sổ chat, ${CHUNK_SIZE} video/chat)...`,
        3500
      );

      const createdChatUrls = [];
      let completedCount = 0;

    // GIAI ĐOẠN 1: BẮN PROMPT LIÊN TỤC VÀO TỪNG CỬA SỔ CHAT (CỨ 30S TẠO CỬA SỔ MỚI)
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      if (abortBatchSignal || currentBatchId !== thisBatchId) {
        showToast('⏹️ Đã dừng tiến trình theo yêu cầu', 3000);
        break;
      }

      if (checkDailyLimitExceeded()) {
        stopBatchForDailyLimit();
        break;
      }

      const chunk = chunks[cIdx];
      const startNum = cIdx * CHUNK_SIZE + 1;
      const endNum = cIdx * CHUNK_SIZE + chunk.length;

      // 0. Luôn chạy trực tiếp trên cuộc trò chuyện hiện tại (không nhảy về chat cũ, không reload trang)

      // 1. Bấm Create Videos trên web Dola trước, rồi mới điền prompt
      if (isCreditMode) {
        showToast(`Đang đổi Create Videos + ${requestedDuration} + tỉ lệ trên Dola...`, 2500);
        try {
          chrome.runtime.sendMessage({
            action: 'set_pending_video_params',
            duration: requestedDuration,
            aspectRatio: config.aspectRatio || '16:9',
            model: 'seedance_v2.0'
          }, () => { try { void chrome.runtime.lastError; } catch (e) {} });
        } catch (e) {}
        let settingsOk = false;
        let settingsError = '';
        try {
          const applied = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              action: 'apply_create_video_settings',
              duration: requestedDuration,
              aspectRatio: config.aspectRatio || '16:9'
            }, (resp) => resolve(resp || null));
          });
          settingsOk = !!(applied && applied.success);
          settingsError = applied && applied.error ? String(applied.error) : '';
          if (settingsOk) {
            showToast(`✅ Duration ${applied.appliedDuration || requestedDuration} · Ratio ${applied.appliedRatio || config.aspectRatio || '16:9'}`, 2200);
          }
        } catch (e) {
          settingsError = e && e.message ? e.message : String(e);
        }
        if (!settingsOk) {
          await activateVideoSkillMode(requestedDuration, config.aspectRatio || '16:9');
          await sleep(400);
          const durText = (document.querySelector('[data-input-engine-actionbar-control-key="video-duration"]')?.innerText || '').toLowerCase();
          settingsOk = durText.includes(requestedDuration.toLowerCase());
        }
        if (!settingsOk) {
          showToast(settingsError || `❌ Chưa chọn được ${requestedDuration} trên Dola. F5 tab rồi thử lại.`, 5000);
          try {
            chrome.runtime.sendMessage({
              action: 'BATCH_PROGRESS',
              current: 0,
              total: prompts.length,
              error: settingsError || `duration_${requestedDuration.replace(/[^0-9]/g, '')}_failed`
            });
          } catch (e) {}
          break;
        }
      } else {
        // Pro + Img2Vid: chat thường / Pro model
        ensureNormalChatMode();
        await ensureProModel();
      }
      await sleep(400);

      // Img2Vid: gắn ảnh mẫu TRƯỚC khi điền prompt (1 ảnh / 1 chat)
      if (isImg2Vid) {
        const imgPayload = pairImages[cIdx] || pairImages[startNum - 1];
        if (!imgPayload || !imgPayload.dataUrl) {
          showToast('⚠️ Img2Vid thiếu ảnh payload — dừng.', 4000);
          return {
            success: false,
            completed: completedCount,
            reason: 'img2vid_missing_image'
          };
        }
        showToast(`🖼️ [${cIdx + 1}/${chunks.length}] Đang gắn ảnh mẫu vào chat...`, 2500);
        try {
          if (typeof globalThis.__seedanceAttachImagePayload !== 'function') {
            throw new Error('Image uploader chưa sẵn sàng — Reload extension + F5 tab Dola rồi thử lại.');
          }
          await globalThis.__seedanceAttachImagePayload({
            name: imgPayload.name || `img2vid_${cIdx + 1}.png`,
            type: imgPayload.type || 'image/png',
            size: imgPayload.size || 0,
            lastModified: imgPayload.lastModified || Date.now(),
            dataUrl: imgPayload.dataUrl
          });
          await sleep(1400);
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          showToast('⚠️ Gắn ảnh thất bại: ' + msg, 4000);
          try {
            chrome.runtime.sendMessage({
              action: 'BATCH_PROGRESS',
              current: completedCount,
              total: prompts.length,
              error: 'img2vid_attach_failed:' + msg
            });
          } catch (err) {}
          return {
            success: false,
            completed: completedCount,
            reason: 'img2vid_attach_failed:' + msg
          };
        }
      }

      // 2. Định dạng từng prompt rồi ghép lại thành 1 văn bản gửi cùng lúc trong 1 message duy nhất
      const formattedList = chunk.map((p) => {
        const rawText = typeof p === 'string' ? p : (p.text || '');
        return formatDolaPrompt(rawText, config);
      });
      const combinedText = formattedList.join('\n');

      showToast(
        isImg2Vid
          ? `🎬 [Img2Vid ${cIdx + 1}/${chunks.length}] Gửi prompt kèm ảnh (Cảnh ${startNum})...`
          : `🎬 [Cửa sổ #${cIdx + 1}/${chunks.length}] Điền ${chunk.length} prompt vào 1 message (Cảnh ${startNum}-${endNum})...`,
        3000
      );

      // Điền và gửi ĐÚNG 1 LẦN DUY NHẤT
      await waitForInputReady(4000);
      let pasted = await pasteTextIntoDolaInput(combinedText, true, isCreditMode ? 'credit_video' : 'pro');
      if (!pasted) {
        await sleep(600);
        pasted = await pasteTextIntoDolaInput(combinedText, true, isCreditMode ? 'credit_video' : 'pro');
      }
      if (!pasted) {
        showToast('⚠️ Không điền được prompt vào ô chat Dola.', 4000);
        return {
          success: false,
          completed: completedCount,
          reason: isImg2Vid ? 'img2vid_prompt_paste_failed' : 'prompt_paste_failed'
        };
      }

      const imgMeta = isImg2Vid ? (pairImages[cIdx] || pairImages[startNum - 1] || {}) : {};
      showToast(
        isImg2Vid
          ? `👀 Đang chờ Dola duyệt ảnh/prompt (cặp ${cIdx + 1})...`
          : '👀 Đang chờ phản hồi Dola...',
        2500
      );
      const outcome = await waitForPostSubmitOutcome({
        isImg2Vid,
        imageName: imgMeta.name || '',
        pairIndex: cIdx + 1,
        timeoutMs: isImg2Vid ? 20000 : 4000
      });
      if (outcome.kind === 'daily_limit') {
        return {
          success: false,
          completed: completedCount,
          reason: 'Đã dừng vì Dola báo hết hạn mức tạo video hôm nay'
        };
      }
      if (outcome.kind === 'content_policy') {
        return {
          success: false,
          completed: completedCount,
          code: 'img2vid_image_blocked',
          reason: `Ảnh «${imgMeta.name || ('#' + (cIdx + 1))}» bị Dola chặn — cần ĐỔI ẢNH rồi bắn lại`
        };
      }
      if (outcome.kind === 'aborted') break;

      try {
        chrome.runtime.sendMessage({
          action: 'BATCH_PROGRESS',
          current: endNum,
          total: prompts.length,
          chatCount: chunk.length,
          promptText: combinedText.slice(0, 50) + '...'
        });
      } catch (e) {}

      // Chờ để Dola tạo URL cuộc trò chuyện có ID
      await sleep(1000);
      const curUrl = window.location.href;
      if (curUrl && curUrl.includes('/chat/') && !createdChatUrls.includes(curUrl)) {
        createdChatUrls.push(curUrl);
      }

      completedCount += chunk.length;

      // 3. CỨ 30S LẠI ĐẨY PROMPT THÊM TRÊN CỬA SỔ MỚI: Đếm ngược đúng 30 giây rồi mở Cửa Sổ Chat Mới
      if (cIdx < chunks.length - 1) {
        const WAIT_SECONDS = 30;
        for (let s = WAIT_SECONDS; s > 0; s--) {
          if (abortBatchSignal) break;
          if (checkDailyLimitExceeded()) {
            stopBatchForDailyLimit();
            break;
          }
          if (checkContentPolicyBlocked()) {
            const imgMeta = isImg2Vid ? (pairImages[cIdx] || {}) : {};
            stopBatchForContentPolicy({ imageName: imgMeta.name || '', pairIndex: cIdx + 1 });
            break;
          }
          showToast(`⏳ [Chat #${cIdx + 1}/${chunks.length}] Đã gửi! Đang chờ ${s}s rồi bấm New Chat đẩy Cảnh ${endNum + 1}-${Math.min(endNum + CHUNK_SIZE, prompts.length)}...`, 1200);
          await sleep(1000);
        }

        if (abortBatchSignal) break;

        showToast(`🔄 Đang bấm New Chat để đẩy batch #${cIdx + 2}...`, 2500);
        const opened = await triggerNewChat();
        if (!opened) {
          showToast('⚠️ New Chat chưa mở — dừng batch để tránh gửi nhầm chat cũ', 4000);
          break;
        }
        await sleep(2000);
        if (isCreditMode) {
          await activateVideoSkillMode(requestedDuration, config.aspectRatio || '16:9');
        } else {
          ensureNormalChatMode();
          await ensureProModel();
        }
        await sleep(600);
      }
    }

    if (abortBatchSignal) {
      if (checkContentPolicyBlocked()) {
        return {
          success: false,
          completed: completedCount,
          code: 'img2vid_image_blocked',
          reason: 'Ảnh bị Dola chặn (không được phép tạo video) — hãy đổi ảnh'
        };
      }
      return { success: false, completed: completedCount, reason: 'Đã dừng vì Dola báo hết hạn mức tạo video hôm nay' };
    }
    showToast(`🎉 Đã gửi xong toàn bộ ${completedCount} cảnh! Bảng 1080P sẽ tự động bắt video để tải về.`, 4000);
    return { success: true, completed: completedCount };
    } finally {
      if (currentBatchId === thisBatchId) {
        isBatchRunning = false;
      }
    }
  }

  // ==========================================================================
  // 7. TOAST NOTIFICATION
  // ==========================================================================
  function showToast(message, duration = 2500) {
    let toast = document.getElementById('sv-toast-n');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sv-toast-n';
      toast.style.cssText =
        'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.95);color:#fff;' +
        'padding:10px 20px;border-radius:24px;font-size:13px;font-weight:600;z-index:2147483647;' +
        'box-shadow:0 10px 30px rgba(0,0,0,0.3);border:1px solid rgba(99,102,241,0.5);' +
        'backdrop-filter:blur(8px);pointer-events:none;transition:opacity 0.3s;font-family:sans-serif;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => {
      toast.style.opacity = '0';
    }, duration);
  }

  // ==========================================================================
  // 8. UNIVERSAL DOWNLOAD TRIGGER & WATERMARK STRIPPER (SINGLE CLEAN DOWNLOAD)
  // ==========================================================================
  const downloadedVideoKeys = new Set();
  const seenBridgeApis = new Set();

  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SEEDANCE_PAGE_FALLBACK_API') {
      const { fallbackApi, keySeed, vid } = event.data;
      if (!fallbackApi || seenBridgeApis.has(fallbackApi)) return;
      seenBridgeApis.add(fallbackApi);

      try {
        chrome.runtime.sendMessage({
          type: 'RESOLVE_AND_DOWNLOAD_FALLBACK_API',
          fallbackApi,
          keySeed,
          vid
        });
      } catch (e) {
        console.warn('[Seedance Studio Pro] Error forwarding fallbackApi:', e);
      }
    }
  });

  function getVideoKey(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      const tosMatch = u.pathname.match(/tos-[^/]+\/([^/?]+)/);
      if (tosMatch) return tosMatch[1];
      const segments = u.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] || u.pathname;
    } catch (e) {
      return String(url).split('?')[0];
    }
  }

  function isWatermarkedMediaUrl(url) {
    const u = String(url || '');
    if (!u) return true;
    if (/video_gen_watermark/i.test(u)) return true;
    if (/[?&]lr=watermarked\b/i.test(u)) return true;
    if (/[?&]logo_type=(?:watermarked|wm)\b/i.test(u)) return true;
    if (/\/(?:wm|watermark)(?:\/|_)/i.test(u)) return true;
    return false;
  }

  function toUnwatermarkedUrl(url) {
    return String(url || '')
      .replace(/([?&])lr=watermarked\b/gi, '$1lr=unwatermarked')
      .replace(/([?&])logo_type=(?:watermarked|wm)\b/gi, '$1logo_type=unwatermarked');
  }

  function downloadVideoDirect(url, customName, options = {}) {
    if (!url) return;
    const allowPreview = options.allowPreview === true;
    const cleanUrl = toUnwatermarkedUrl(url);

    // Auto path: never save watermarked DOM preview streams.
    if (!allowPreview && isWatermarkedMediaUrl(url) && isWatermarkedMediaUrl(cleanUrl)) {
      console.log('[Seedance Studio Pro] Skip watermarked preview download:', cleanUrl.slice(0, 160));
      return;
    }
    if (!allowPreview && isWatermarkedMediaUrl(url)) {
      // Query flip alone is not a real master — wait for fallback_api MEDIA_FOUND.
      console.log('[Seedance Studio Pro] Skip DOM watermarked stream (waiting for master API)');
      return;
    }

    const vidKey = getVideoKey(cleanUrl);
    if (downloadedVideoKeys.has(vidKey)) {
      console.log('[Seedance Studio Pro] Video already downloaded once, skipping duplicate:', vidKey);
      return;
    }
    downloadedVideoKeys.add(vidKey);

    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const finalName = customName || `seedance_video_1080p_${ts}.mp4`;

    const triggerAnchorDownload = () => {
      const a = document.createElement('a');
      a.href = cleanUrl;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 800);
    };

    try {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_MEDIA',
        url: cleanUrl,
        filename: finalName
      }, (resp) => {
        if (chrome.runtime.lastError || !resp?.success) {
          console.warn('[Seedance Studio Pro] Direct background download failed, fallback to anchor:', chrome.runtime.lastError);
          triggerAnchorDownload();
        }
      });
    } catch (e) {
      console.warn('[Seedance Studio Pro] Direct background download failed, fallback to anchor:', e);
      triggerAnchorDownload();
    }
  }

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('button, [role=button], div, a');
    if (!btn) return;
    const text = (btn.textContent || '').trim();

    if (/tải\s*video|download\s*video|下载/i.test(text)) {
      event.preventDefault();
      event.stopPropagation();

      // Ưu tiên bản master đã extract (fallback_api) — tránh tải preview watermark của Dola.
      if (mediaItems.size > 0) {
        const masters = Array.from(mediaItems.values()).filter((it) => it && it.url && !isWatermarkedMediaUrl(it.url));
        const lastItem = masters.length ? masters[masters.length - 1] : null;
        if (lastItem && lastItem.url) {
          downloadVideoDirect(lastItem.url);
          showToast('⚡ Đang tải video Master 1080P không logo!', 2500);
          return;
        }
      }

      showToast('⏳ Đang chờ link Master không logo từ API…', 2500);
      return;
    }
  }, true);

  // ==========================================================================
  // 9. MEDIA DRAWER & AUTO SCANNER
  // ==========================================================================
  const PANEL_ID = 'sv-wf-dock';
  const mediaItems = new Map();
  const autoDownloadedVideos = new Set();

  function scanExistingVideos() {
    const videos = Array.from(document.querySelectorAll('video'));
    let hasNew = false;
    videos.forEach((v) => {
      let src = v.currentSrc || v.src || v.getAttribute('src') || v.getAttribute('data-src');
      if (!src) {
        const s = v.querySelector('source');
        if (s) src = s.currentSrc || s.src || s.getAttribute('src') || s.getAttribute('data-src');
      }
      if (!src || !/^https?:\/\//i.test(src)) return;

      // DOM preview thường có watermark — chỉ catalog nếu chưa có bản master.
      // KHÔNG auto-download từ DOM.
      if (isWatermarkedMediaUrl(src)) {
        return;
      }

      const cleanSrc = toUnwatermarkedUrl(src);
      const vidKey = getVideoKey(cleanSrc);

      if (!mediaItems.has(vidKey)) {
        mediaItems.set(vidKey, { type: 'video', url: cleanSrc, key: vidKey, source: 'dom' });
        hasNew = true;
      }
    });

    if (hasNew) {
      ensureMediaPanel();
      if (window.__sr_renderMedia) window.__sr_renderMedia();
    }
  }

  // ==========================================================================
  // PURE JS STREAMING ZIP ENGINE (KHÔNG CẦN THƯ VIỆN BÊN NGOÀI)
  // ==========================================================================
  function createZipCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  }
  const zipCrcTable = createZipCrcTable();

  function updateZipCrc(crc, bytes) {
    let c = crc;
    for (let i = 0; i < bytes.length; i++) {
      c = zipCrcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return c >>> 0;
  }

  function zipDosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
      date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
    };
  }

  function zipLocalHeader(nameBytes, crc, size, timestamp) {
    const buffer = new ArrayBuffer(30);
    const view = new DataView(buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, timestamp.time, true);
    view.setUint16(12, timestamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    return new Uint8Array(buffer);
  }

  function zipCentralHeader(nameBytes, crc, size, offset, timestamp) {
    const buffer = new ArrayBuffer(46);
    const view = new DataView(buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, timestamp.time, true);
    view.setUint16(14, timestamp.date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, offset, true);
    return new Uint8Array(buffer);
  }

  function zipEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
    const buffer = new ArrayBuffer(22);
    const view = new DataView(buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, entryCount, true);
    view.setUint16(10, entryCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);
    return new Uint8Array(buffer);
  }

  let isZipping = false;

  async function downloadAllVideosAsZip() {
    if (isZipping) {
      showToast('⏳ Đang có tiến trình nén file ZIP, vui lòng đợi...', 2500);
      return;
    }

    const items = Array.from(mediaItems.values()).filter(it => it && it.url);
    if (items.length === 0) {
      showToast('⚠️ Chưa phát hiện video nào để nén ZIP!', 3000);
      return;
    }

    isZipping = true;
    const btnZip = window.__sr_btnZip;
    const btnZipLabel = window.__sr_btnZipLabel;
    if (btnZip) btnZip.disabled = true;

    showToast(`📦 Bắt đầu tải và đóng gói ${items.length} video vào file ZIP...`, 4000);

    const encoder = new TextEncoder();
    const timestamp = zipDosDateTime();
    const results = new Array(items.length);
    let completedCount = 0;

    const updateZipProgress = (msg) => {
      if (btnZipLabel) btnZipLabel.textContent = msg;
    };

    updateZipProgress(`⏳ Đang tải 0/${items.length}...`);

    const CONCURRENCY = 4;
    let nextIdx = 0;

    async function fetchWorker() {
      while (nextIdx < items.length) {
        const idx = nextIdx++;
        const item = items[idx];
        const numStr = String(idx + 1).padStart(2, '0');
        const filename = `Video_${numStr}_1080p.mp4`;

        try {
          const res = await fetch(item.url, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          const u8 = new Uint8Array(buffer);
          const crc = (updateZipCrc(0xffffffff, u8) ^ 0xffffffff) >>> 0;
          results[idx] = {
            nameBytes: encoder.encode(filename),
            blob: new Blob([u8], { type: 'video/mp4' }),
            size: u8.length,
            crc
          };
        } catch (err) {
          console.warn(`[Seedance Studio Pro] Video #${idx + 1} download error:`, err);
          const note = `Video #${idx + 1} could not be downloaded: ${err.message}\nURL: ${item.url}\n`;
          const noteBytes = encoder.encode(note);
          results[idx] = {
            nameBytes: encoder.encode(`Video_${numStr}_error.txt`),
            blob: new Blob([noteBytes], { type: 'text/plain' }),
            size: noteBytes.length,
            crc: (updateZipCrc(0xffffffff, noteBytes) ^ 0xffffffff) >>> 0
          };
        }

        completedCount++;
        const pct = Math.round((completedCount / items.length) * 100);
        updateZipProgress(`⏳ Nén ZIP ${completedCount}/${items.length} (${pct}%)...`);
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(CONCURRENCY, items.length); w++) {
      workers.push(fetchWorker());
    }
    await Promise.all(workers);

    updateZipProgress('📦 Đang đóng gói file ZIP...');
    await sleep(200);

    const zipParts = [];
    const centralParts = [];
    let offset = 0;
    let centralSize = 0;

    for (let i = 0; i < items.length; i++) {
      const entry = results[i];
      if (!entry) continue;
      const local = zipLocalHeader(entry.nameBytes, entry.crc, entry.size, timestamp);
      const central = zipCentralHeader(entry.nameBytes, entry.crc, entry.size, offset, timestamp);
      zipParts.push(local, entry.nameBytes, entry.blob);
      centralParts.push(central, entry.nameBytes);
      offset += local.length + entry.nameBytes.length + entry.size;
      centralSize += central.length + entry.nameBytes.length;
    }

    const eocd = zipEndOfCentralDirectory(items.length, centralSize, offset);
    zipParts.push(...centralParts, eocd);

    const zipBlob = new Blob(zipParts, { type: 'application/zip' });
    const blobUrl = URL.createObjectURL(zipBlob);

    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const zipFilename = `seedance_1080p_${items.length}_videos_${ts}.zip`;

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = zipFilename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }, 30000);

    isZipping = false;
    if (btnZip) btnZip.disabled = false;
    if (btnZipLabel) btnZipLabel.textContent = `📦 TẢI TẤT CẢ ZIP (${items.length} VIDEO)`;
    showToast(`🎉 Đã tải file ZIP trọn gói ${items.length} video (1080P Master)!`, 5000);
  }

  // ==========================================================================
  // AUTO-SCROLL CHAT SCANNER (TỰ ĐỘNG CUỘN ĐỂ QUÉT VIDEO CŨ)
  // ==========================================================================
  let isAutoScrolling = false;
  let autoScrollTimer = null;

  function findChatScrollContainer() {
    const selectors = [
      '[class*="chat-scroll" i]',
      '[class*="chat-list" i]',
      '[class*="chat-body" i]',
      '[class*="chat-content" i]',
      '[class*="chat-container" i]',
      '[class*="message-list" i]',
      '[class*="messageList" i]',
      '[class*="message-container" i]',
      '[class*="messages" i]',
      '[class*="conversation" i]',
      '[class*="history" i]',
      'main',
      '[role="main"]'
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (!el) continue;
        const style = window.getComputedStyle(el);
        const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll');
        if (isScrollable && el.scrollHeight > el.clientHeight + 30) {
          return el;
        }
      }
    }
    return document.scrollingElement || document.documentElement || document.body || window;
  }

  function startAutoScrollChat() {
    if (isAutoScrolling) {
      isAutoScrolling = false;
      if (autoScrollTimer) clearInterval(autoScrollTimer);
      showToast('⏹️ Đã dừng cuộn chat', 2000);
      return;
    }

    const container = findChatScrollContainer();
    isAutoScrolling = true;
    showToast('📜 Bắt đầu tự động cuộn lên để bóc tách video lịch sử...', 3000);

    let unchangedCount = 0;
    let lastScrollHeight = (container && container.scrollHeight) || 0;
    let iterations = 0;

    if (autoScrollTimer) clearInterval(autoScrollTimer);
    autoScrollTimer = setInterval(() => {
      if (!isAutoScrolling) {
        clearInterval(autoScrollTimer);
        autoScrollTimer = null;
        return;
      }

      iterations++;

      try {
        if (container === window || container === document.body || container === document.documentElement) {
          window.scrollBy({ top: -Math.max(500, window.innerHeight * 0.8), behavior: 'smooth' });
        } else if (container) {
          container.scrollBy({ top: -Math.max(500, container.clientHeight * 0.8), behavior: 'smooth' });
          container.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
      } catch (e) {}

      scanExistingVideos();

      const currentHeight = (container && container.scrollHeight) || 0;
      const isAtTop = (container && (container.scrollTop <= 15 || window.scrollY <= 15));

      if (currentHeight > lastScrollHeight) {
        lastScrollHeight = currentHeight;
        unchangedCount = 0;
      } else if (isAtTop) {
        unchangedCount++;
      }

      if (unchangedCount >= 4 || iterations >= 50) {
        isAutoScrolling = false;
        clearInterval(autoScrollTimer);
        autoScrollTimer = null;
        showToast(`🎉 Đã quét xong lịch sử chat! Tổng cộng tìm thấy ${mediaItems.size} video Master 1080P.`, 4000);
      }
    }, 800);
  }

  function initMediaPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const host = document.createElement('div');
    host.id = PANEL_ID;
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          right: 20px;
          bottom: 95px; /* Nâng cao lên 95px để hoàn toàn không che thanh nhập và nút gửi của Dola */
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;
          transition: bottom 0.2s ease, right 0.2s ease;
        }
        .panel {
          width: 270px;
          max-height: 280px;
          display: flex;
          flex-direction: column;
          color: #e2e8f0;
          background: #0f172a;
          border: 1px solid rgba(99, 102, 241, 0.45);
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          overflow: hidden;
          transition: all 0.2s ease;
        }
        .panel.collapsed {
          width: auto;
          min-width: 165px;
          max-height: 36px;
        }
        .panel.collapsed .list {
          display: none;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: #1e293b;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          cursor: pointer;
          user-select: none;
        }
        .header:hover {
          background: #253349;
        }
        .title {
          font-size: 12px;
          font-weight: 700;
          color: #818cf8;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .toggle-icon {
          font-size: 10px;
          color: #94a3b8;
          transition: transform 0.2s ease;
        }
        .panel.collapsed .toggle-icon {
          transform: rotate(180deg);
        }
        .count {
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 9px;
          background: #6366f1;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          line-height: 18px;
          text-align: center;
        }
        .list {
          min-height: 40px;
          max-height: 220px;
          overflow-y: auto;
          padding: 6px 8px;
        }
        .empty {
          padding: 10px;
          color: #64748b;
          font-size: 11px;
          text-align: center;
        }
        .item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 6px 8px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 6px;
          background: #1e293b;
          margin-bottom: 5px;
        }
        .label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: #cbd5e1;
        }
        .tag {
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          background: #7c3aed;
          color: #fff;
        }
        button {
          padding: 5px 10px;
          border: 0;
          border-radius: 5px;
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        button:hover { opacity: 0.9; }
        .panel.collapsed .zip-action-bar {
          display: none !important;
        }
        .zip-action-bar {
          padding: 6px 8px;
          background: #131d31;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
        }
        .btn-zip-all {
          width: 100%;
          padding: 8px 10px;
          border: 0;
          border-radius: 6px;
          background: linear-gradient(135deg, #10b981, #059669);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);
          transition: all 0.2s;
        }
        .btn-zip-all:hover {
          opacity: 0.92;
          transform: translateY(-1px);
        }
        .btn-zip-all:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      </style>
      <section class="panel collapsed" aria-label="Bảng Video Không Watermark">
        <div class="header" id="panel-toggle" title="Bấm để thu nhỏ hoặc mở rộng danh sách video">
          <div class="title">
            <span>⚡ Video 1080P</span>
            <span class="toggle-icon">▲</span>
          </div>
          <div class="count">0</div>
        </div>
        <div class="zip-action-bar" id="zip-action-bar" style="display: none;">
          <button id="btn-download-all-zip" class="btn-zip-all" type="button" title="Đóng gói tất cả video trên trang thành 1 file ZIP duy nhất">
            <span>📦</span>
            <span id="btn-zip-label">TẢI TẤT CẢ (FILE ZIP)</span>
          </button>
        </div>
        <div class="list">
          <div class="empty">Đang tìm video trên trang...</div>
        </div>
      </section>
    `;

    const panel = shadow.querySelector('.panel');
    const header = shadow.querySelector('#panel-toggle');
    if (header && panel) {
      header.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
      });
    }

    const btnZip = shadow.querySelector('#btn-download-all-zip');
    const btnZipLabel = shadow.querySelector('#btn-zip-label');
    const zipActionBar = shadow.querySelector('#zip-action-bar');
    window.__sr_btnZip = btnZip;
    window.__sr_btnZipLabel = btnZipLabel;
    if (btnZip) {
      btnZip.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadAllVideosAsZip();
      });
    }

    const list = shadow.querySelector('.list');
    const count = shadow.querySelector('.count');

    window.__sr_renderMedia = function () {
      count.textContent = String(mediaItems.size);
      list.textContent = '';

      if (zipActionBar) {
        zipActionBar.style.display = mediaItems.size > 0 ? 'flex' : 'none';
      }
      if (btnZipLabel && !isZipping) {
        btnZipLabel.textContent = mediaItems.size > 1
          ? `TẢI TẤT CẢ ZIP (${mediaItems.size} VIDEO)`
          : `TẢI TẤT CẢ (FILE ZIP)`;
      }

      // Tự động mở rộng khi có video mới để người dùng dễ nhìn thấy
      if (mediaItems.size > 0 && panel && panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
      }

      if (!mediaItems.size) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Đang tìm video trên trang...';
        list.appendChild(empty);
        return;
      }

      Array.from(mediaItems.values()).forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'item';

        const label = document.createElement('div');
        label.className = 'label';

        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = '1080P';

        const num = document.createElement('span');
        num.textContent = `Video #${index + 1}`;

        label.append(tag, num);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '⬇ Tải Về';
        btn.addEventListener('click', () => {
          downloadVideoDirect(item.url);
          showToast(`⚡ Đang tải Video #${index + 1}...`, 2000);
        });

        row.append(label, btn);
        list.appendChild(row);
      });
    };

    scanExistingVideos();
    setInterval(scanExistingVideos, 1500);
  }

  // ==========================================================================
  // 10. MESSAGE LISTENER FROM POPUP & BACKGROUND
  // ==========================================================================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return;

    if (request.action === 'download_all_videos_zip') {
      downloadAllVideosAsZip()
        .then(() => sendResponse({ success: true, count: mediaItems.size }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.type === 'BRANDAI_START_CHAT_SCROLL' || request.action === 'start_chat_scroll') {
      startAutoScrollChat();
      sendResponse({ success: true });
      return true;
    }

    if (request.type === 'BRANDAI_SET_BULK_MODE') {
      chrome.storage.local.set({ brandai_bulk_mode: Boolean(request.enabled) });
      if (request.enabled) {
        showToast('📦 Đã bật Chế Độ Nén ZIP Trọn Gói (tạm dừng tải lẻ)', 2500);
      }
      sendResponse({ success: true });
      return true;
    }

    if (request.action === 'ping') {
      sendResponse({ pong: true, status: 'ready', url: window.location.href });
      return true;
    }

    if (request.action === 'paste_specific_prompt') {
      const text = request.text || request.prompt || '';
      const cfg = request.config || {};
      const requestedDuration = normalizeDuration(cfg.duration, '15s');
      const isCredit = cfg.mode === 'credit_video' || cfg.mode === 'distributed' || requestedDuration === '30s';

      if (isCredit) {
        activateVideoSkillMode(requestedDuration, cfg.aspectRatio || '16:9').then(async () => {
          await sleep(400);
          const formatted = formatDolaPrompt(text, cfg);
          const success = await pasteTextIntoDolaInput(formatted, request.autoSubmit, 'credit_video');
          if (success) {
            showToast(`⚡ Đã điền (Create Video ${requestedDuration}): ${formatted.slice(0, 30)}...`, 2000);
          }
          sendResponse({ success });
        });
        return true;
      } else {
        const formatted = request.config ? formatDolaPrompt(text, request.config) : text;
        pasteTextIntoDolaInput(formatted, request.autoSubmit, 'pro').then((success) => {
          if (success) {
            showToast(`⚡ Đã điền: ${text.slice(0, 30)}...`, 2000);
          }
          sendResponse({ success });
        });
        return true;
      }
    }

    if (request.action === 'SET_DOLA_GENERATION_MODE') {
      if (request.mode === 'credit_video' || request.mode === 'distributed') {
        activateVideoSkillMode(normalizeDuration(request.duration, '15s'), request.aspectRatio || '16:9').then((success) => sendResponse({ success }));
      } else {
        activateProChatMode().then((success) => sendResponse({ success }));
      }
      return true;
    }

    if (request.action === 'set_duration') {
      const duration = normalizeDuration(request.duration, '15s');
      const durationNumber = Number(duration.replace(/[^0-9]/g, '')) || 15;
      try {
        chrome.storage.local.set({ durationOverride: String(durationNumber) });
      } catch (e) {}
      const applyToActionBar = isVideoSkillActive();
      const applyPromise = applyToActionBar ? selectActionBarDuration(duration) : Promise.resolve(false);
      applyPromise
        .then((applied) => {
          showToast(`⏱️ Đã chọn thời lượng ${duration}${applied ? ' trên Dola' : ' làm mặc định'}.`, 2200);
          sendResponse({ success: true, duration, applied });
        })
        .catch((error) => {
          console.warn('[Seedance Studio Pro] set_duration apply failed:', error);
          showToast(`⏱️ Đã lưu thời lượng mặc định ${duration}.`, 2200);
          sendResponse({ success: true, duration, applied: false });
        });
      return true;
    }

    if (request.action === 'ensure_pro_model') {
      ensureProModel().then((success) => sendResponse({ success }));
      return true;
    }

    if (request.action === 'trigger_new_chat') {
      triggerNewChat().then((success) => sendResponse({ success }));
      return true;
    }

    if (request.action === 'execute_batch_prompt_session') {
      executeBatchSession(request.prompts || [], request.config || {})
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (request.action === 'abort_batch_session') {
      abortBatchSignal = true;
      isBatchRunning = false;
      showToast('🛑 Đã dừng tiến trình tự động!', 2500);
      sendResponse({ success: true });
      return true;
    }

    if (request.type === 'MEDIA_FOUND' && Array.isArray(request.items)) {
      ensureMediaPanel();
      for (const it of request.items) {
        if (it && it.url) {
          if (isWatermarkedMediaUrl(it.url)) {
            continue;
          }
          const cleanUrl = toUnwatermarkedUrl(it.url);
          const vidKey = getVideoKey(cleanUrl);
          mediaItems.set(vidKey, {
            type: it.type || 'video',
            url: cleanUrl,
            key: vidKey,
            source: it.source || 'fallback_api'
          });
          // Auto-download chỉ do background. Tắt autoDownload → vẫn lưu panel/ZIP.
          if (!downloadedVideoKeys.has(vidKey)) {
            chrome.storage.local.get(['autoDownload'], (res) => {
              if (res?.autoDownload === false) {
                showToast('📋 Đã thêm Master 1080P vào panel — tải ZIP hoặc tải lẻ tay', 2800);
                return;
              }
              downloadedVideoKeys.add(vidKey);
              showToast('✨ Đã bắt Master 1080P KHÔNG LOGO — đang lưu 1 file duy nhất', 2500);
            });
          }
        }
      }
      if (window.__sr_renderMedia) window.__sr_renderMedia();
      sendResponse({ received: true });
      return true;
    }
  });

  // Stealth: không gắn panel UI lúc load (DOM fingerprint). Chỉ tạo khi có video / lệnh tải.
  function ensureMediaPanel() {
    if (!document.getElementById(PANEL_ID)) {
      try { initMediaPanel(); } catch (e) {}
    }
  }

  // Không auto-init panel trên mọi trang Dola.
})();
