try { /* bulk-account-manager disabled — 1 Chrome profile = 1 Dola acc */ } catch (e) {}

// Legacy maps kept empty so leftover refs don't throw.
const tabSessionMap = new Map();
const cleanLoginTabIds = new Set();
const tabDnrRuleIds = new Map();
let nextDnrRuleId = 1;

const DEBUGGER_VERSION = "1.3";
const DOUBAO_SKILL_PACK_URL_PART = "doubao.com/samantha/skill/pack";
const DOLA_SKILL_PACK_URL_PART = "dola.com/samantha/skill/pack";
const ACTION_BAR_CONF_URL_PART = ".com/alice/slot/action_bar_v3/get_item_conf";
const DOUBAO_CHAIN_SINGLE_URL_PART = "doubao.com/im/chain/single";
const DOLA_CHAIN_SINGLE_URL_PART = "dola.com/im/chain/single";
const CHAT_COMPLETION_URL_PART = "/chat/completion";
const CHAT_COMPLETION_URL_PART_ALT = "/samantha/chat/completion";
const QAAB_SALT_HEX = "4dd4c2e6b83162090e52b3c7a6733ba4"
  + "1cb2462b829ab58a196b39db57177524"
  + "f49baf7f08e8d68d26a72e37c1a95a2f"
  + "1f05a51892aef2949732b62a38aadd58";

const fetchPatterns = [
  { urlPattern: `*${DOUBAO_SKILL_PACK_URL_PART}*`, requestStage: "Request" },
  { urlPattern: `*${DOLA_SKILL_PACK_URL_PART}*`, requestStage: "Request" },
  { urlPattern: `*${CHAT_COMPLETION_URL_PART}*`, requestStage: "Request" },
  { urlPattern: `*${CHAT_COMPLETION_URL_PART_ALT}*`, requestStage: "Request" },
  { urlPattern: `*dola.com/*/completion*`, requestStage: "Request" },
  { urlPattern: `*doubao.com/*/completion*`, requestStage: "Request" },
  { urlPattern: `*byteintlapi.com/*/completion*`, requestStage: "Request" },
  { urlPattern: `*${ACTION_BAR_CONF_URL_PART}*`, requestStage: "Response" },
  { urlPattern: `*${DOUBAO_CHAIN_SINGLE_URL_PART}*`, requestStage: "Response" },
  { urlPattern: `*${DOLA_CHAIN_SINGLE_URL_PART}*`, requestStage: "Response" }
];

const attachedTabs = new Set();
const responseFileBodyPromises = new Map();
const pendingVideoParamsByTab = new Map();

function setPendingVideoParams(tabId, params) {
  if (!tabId) return;
  pendingVideoParamsByTab.set(tabId, {
    duration: Number(params?.duration) || 15,
    ratio: String(params?.ratio || "16:9"),
    model: String(params?.model || "seedance_v2.0"),
    setAt: Date.now()
  });
}

function getPendingVideoParams(tabId) {
  const params = pendingVideoParamsByTab.get(tabId);
  if (!params) return null;
  if (Date.now() - Number(params.setAt || 0) > 10 * 60 * 1000) {
    pendingVideoParamsByTab.delete(tabId);
    return null;
  }
  return params;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ sr_enable_debugger: false });
  // Không gắn CDP bao giờ — Dola detect debugger → logout.
});
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ sr_enable_debugger: false });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.sr_enable_debugger && changes.sr_enable_debugger.newValue === true) {
    // Chặn bật lại debugger từ UI cũ.
    chrome.storage.local.set({ sr_enable_debugger: false });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  // Stealth: không attach debugger / không đụng tab khi focus.
  void tabId;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Stealth: không attach CDP khi navigate Dola.
  void tabId;
  void changeInfo;
  void tab;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  pendingVideoParamsByTab.delete(tabId);
  tabSessionMap.delete(tabId);
  cleanLoginTabIds.delete(tabId);
});

chrome.action.onClicked.addListener(() => {
  // Side panel only — không attach debugger.
});

if (chrome.debugger && chrome.debugger.onDetach) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) {
      attachedTabs.delete(source.tabId);
      setBadge(source.tabId, "");
    }
  });
}

if (chrome.debugger && chrome.debugger.onEvent) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method === "Fetch.requestPaused" && source.tabId && params) {
      // Debugger disabled — ignore.
      void source;
      void params;
    }
  });
}

const downloadedUrlsInBg = new Set();

function isWatermarkedMediaUrl(url) {
  const u = String(url || "");
  if (!u) return true;
  if (/video_gen_watermark/i.test(u)) return true;
  if (/[?&]lr=watermarked\b/i.test(u)) return true;
  if (/[?&]logo_type=(?:watermarked|wm)\b/i.test(u)) return true;
  if (/\/(?:wm|watermark)(?:\/|_)/i.test(u)) return true;
  return false;
}

function toUnwatermarkedUrl(url) {
  return String(url || "")
    .replace(/([?&])lr=watermarked\b/gi, "$1lr=unwatermarked")
    .replace(/([?&])logo_type=(?:watermarked|wm)\b/gi, "$1logo_type=unwatermarked");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "RESOLVE_AND_DOWNLOAD_FALLBACK_API" && message.fallbackApi) {
    getDoubaoVideoUrlFromFallbackApi(message.fallbackApi).then((cleanUrl) => {
      if (cleanUrl) {
        const tabId = sender && sender.tab ? sender.tab.id : null;
        if (tabId) {
          sendToTab(tabId, {
            type: "MEDIA_FOUND",
            items: [{ type: "video", url: cleanUrl, source: "fallback_api" }]
          });
        }
        chrome.storage.local.get(["autoDownload"], (res) => {
          if (res?.autoDownload !== false) {
            triggerBackgroundDownload(cleanUrl);
          }
        });
      }
    }).catch((err) => {
      console.warn("RESOLVE_AND_DOWNLOAD_FALLBACK_API failed:", err);
    });
    sendResponse({ received: true });
    return true;
  }
});

function triggerBackgroundDownload(url, customFilename) {
  if (!url || !isHttpUrl(url)) return;
  const cleanUrl = toUnwatermarkedUrl(url);
  // Never save watermarked preview streams (DOM / native page downloads).
  if (isWatermarkedMediaUrl(cleanUrl)) {
    console.log("[Seedance Studio Pro] Skip watermarked URL:", cleanUrl.slice(0, 160));
    return;
  }

  const keyMatch = cleanUrl.match(/tos-[^/]+\/([^/?]+)/);
  const vidKey = keyMatch ? keyMatch[1] : cleanUrl.split("?")[0];
  if (downloadedUrlsInBg.has(vidKey)) {
    console.log("[Seedance Studio Pro] Video already downloaded, skipping duplicate:", vidKey);
    return;
  }
  downloadedUrlsInBg.add(vidKey);
  setTimeout(() => downloadedUrlsInBg.delete(vidKey), 300000);

  const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  chrome.downloads.download({
    url: cleanUrl,
    filename: customFilename || `seedance_video_1080p_${ts}.mp4`,
    saveAs: false
  }).catch((error) => {
    console.warn("[Seedance Studio Pro] background download failed:", error);
  });
}

// Cancel native Dola/Doubao downloads that are clearly watermarked previews.
if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener((item) => {
    const url = String(item?.finalUrl || item?.url || "");
    if (!url || !isHttpUrl(url)) return;
    if (!isWatermarkedMediaUrl(url)) return;
    // Only cancel page-originated watermarked downloads, not our rewritten masters.
    try {
      chrome.downloads.cancel(item.id, () => {
        console.log("[Seedance Studio Pro] Cancelled watermarked download:", url.slice(0, 160));
      });
      chrome.downloads.erase({ id: item.id }, () => {});
    } catch (e) {}
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "DOWNLOAD_MEDIA" && isHttpUrl(message.url)) {
    triggerBackgroundDownload(message.url, message.filename);
    sendResponse({ success: true });
    return true;
  }
});

async function attachExistingTabs() {
  const enabled = await getDebuggerEnabled();
  if (!enabled) {
    await detachAllDebuggers();
    return;
  }
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && shouldAttachToTab(tab.url)) {
      ensureAttached(tab.id);
    }
  }
}

async function safeGetTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function shouldAttachToTab(url) {
  return typeof url === "string"
    && /^https?:\/\//i.test(url)
    && (url.includes("doubao.com") || url.includes("dola.com"));
}

/** Stealth mode: KHÔNG BAO GIỜ gắn chrome.debugger / Fetch CDP. */
function getDebuggerEnabled() {
  return Promise.resolve(false);
}

async function detachDebugger(tabId) {
  if (!tabId || !chrome.debugger) return;
  try {
    await new Promise((resolve) => {
      chrome.debugger.detach({ tabId }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  } catch (e) {}
  attachedTabs.delete(tabId);
  try { setBadge(tabId, ""); } catch (e) {}
}

async function detachAllDebuggers() {
  if (!chrome.debugger) {
    attachedTabs.clear();
    return;
  }
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && shouldAttachToTab(tab.url)) {
      await detachDebugger(tab.id);
    }
  }
  attachedTabs.clear();
}

async function ensureAttached(tabId) {
  // Anti-detect: luôn no-op. Không attach CDP dù Cài đặt có bật.
  if (tabId && attachedTabs.has(tabId)) {
    await detachDebugger(tabId);
  }
}

async function attachExistingTabs() {
  await detachAllDebuggers();
}

function attachDebugger() {
  return Promise.reject(new Error('Debugger disabled (anti-detect)'));
}

function sendCommand() {
  return Promise.reject(new Error('Debugger disabled (anti-detect)'));
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evalOnTab(tabId, expression) {
  const res = await sendCommand(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true
  });
  return res && res.result ? res.result.value : null;
}

async function trustedClickXY(tabId, x, y) {
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1
  });
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1
  });
}

async function clickExprCenter(tabId, expression) {
  const box = await evalOnTab(tabId, expression);
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) {
    return null;
  }
  await trustedClickXY(tabId, box.x, box.y);
  return box;
}

async function applyDolaCreateVideoSettings(tabId, duration, ratio) {
  try {
    await ensureAttached(tabId);
  } catch (error) {
    return {
      success: false,
      error: "Debugger chưa gắn được tab Dola. Mở Dola trong Chrome có cài extension, rồi F5 tab."
    };
  }
  try {
    await sendCommand(tabId, "Runtime.enable", {});
  } catch (e) {}

  const dur = `${String(duration || "15s").replace(/[^0-9]/g, "") || "15"}s`;
  const rat = String(ratio || "16:9").trim();
  setPendingVideoParams(tabId, {
    duration: Number(String(dur).replace(/[^0-9]/g, "")) || 15,
    ratio: rat && rat !== "none" ? rat : "16:9",
    model: "seedance_v2.0"
  });

  const skillBoxExpr = `(() => {
    const el = Array.from(document.querySelectorAll('button[data-component-type="skill-item"]'))
      .find((e) => /^(?:create\\s*videos?|tạo\\s*videos?)$/i.test((e.innerText || "").trim()));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText || "").trim() };
  })()`;

  let hasBar = await evalOnTab(tabId, `!!document.querySelector('[data-input-engine-actionbar-control-key="video-duration"]')`);
  if (!hasBar) {
    await clickExprCenter(tabId, skillBoxExpr);
    for (let i = 0; i < 25; i++) {
      await sleepMs(200);
      hasBar = await evalOnTab(tabId, `!!document.querySelector('[data-input-engine-actionbar-control-key="video-duration"]')`);
      if (hasBar) break;
    }
  }

  if (!hasBar) {
    return {
      success: false,
      error: "Chưa vào Create Videos (không thấy Duration trên thanh Dola). Bấm Create Videos thủ công rồi thử lại."
    };
  }

  const triggerExpr = (key) => `(() => {
    const el = document.querySelector('[data-input-engine-actionbar-control-key="${key}"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText || "").trim() };
  })()`;

  const itemExpr = (label) => `(() => {
    const wanted = String(${JSON.stringify(label)}).toLowerCase();
    const el = Array.from(document.querySelectorAll('[role="menuitem"], [data-slot="dropdown-menu-item"], [role="option"]'))
      .find((e) => (e.innerText || "").trim().toLowerCase() === wanted);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText || "").trim() };
  })()`;

  const listMenuExpr = `(() => Array.from(document.querySelectorAll('[role="menuitem"], [data-slot="dropdown-menu-item"], [role="option"]'))
    .map((e) => (e.innerText || "").trim())
    .filter(Boolean)
    .slice(0, 20))()`;

  let durNow = await evalOnTab(tabId, `document.querySelector('[data-input-engine-actionbar-control-key="video-duration"]')?.innerText || ""`);
  let menuOptions = [];
  if (!String(durNow || "").toLowerCase().includes(dur.toLowerCase())) {
    await clickExprCenter(tabId, triggerExpr("video-duration"));
    await sleepMs(650);
    menuOptions = (await evalOnTab(tabId, listMenuExpr)) || [];
    const clicked = await clickExprCenter(tabId, itemExpr(dur));
    await sleepMs(450);
    if (!clicked) {
      // Retry once — skill pack may finish injecting late.
      await clickExprCenter(tabId, triggerExpr("video-duration"));
      await sleepMs(700);
      menuOptions = (await evalOnTab(tabId, listMenuExpr)) || [];
      await clickExprCenter(tabId, itemExpr(dur));
      await sleepMs(450);
    }
  }

  if (rat && rat !== "none") {
    const ratioNow = await evalOnTab(tabId, `document.querySelector('[data-input-engine-actionbar-control-key="video-ratio"]')?.innerText || ""`);
    if (!String(ratioNow || "").includes(rat)) {
      await clickExprCenter(tabId, triggerExpr("video-ratio"));
      await sleepMs(550);
      await clickExprCenter(tabId, itemExpr(rat));
      await sleepMs(400);
    }
  }

  const finalDur = String(await evalOnTab(tabId, `document.querySelector('[data-input-engine-actionbar-control-key="video-duration"]')?.innerText || ""`) || "").trim();
  const finalRatio = String(await evalOnTab(tabId, `document.querySelector('[data-input-engine-actionbar-control-key="video-ratio"]')?.innerText || ""`) || "").trim();
  const ok = finalDur.toLowerCase().includes(dur.toLowerCase());
  if (!ok) {
    const opts = (menuOptions || []).join(", ") || "không đọc được menu";
    return {
      success: false,
      duration: dur,
      ratio: rat,
      appliedDuration: finalDur,
      appliedRatio: finalRatio,
      menuOptions,
      error: `Không chọn được ${dur}. Menu Duration hiện: ${opts}. F5 Dola khi badge extension = ON rồi chọn lại Create Videos.`
    };
  }

  return {
    success: true,
    duration: dur,
    ratio: rat,
    appliedDuration: finalDur,
    appliedRatio: finalRatio
  };
}

async function handlePausedRequest(tabId, event) {
  const requestId = event.requestId;
  const request = event.request || {};
  const url = request.url || "";

  try {
    if (url.includes(DOUBAO_SKILL_PACK_URL_PART)) {
      await fulfillJsonFile(tabId, requestId, request.method, "doubao-skill-pack-response.json");
      return;
    }

    if (url.includes(DOLA_SKILL_PACK_URL_PART)) {
      await fulfillJsonFile(tabId, requestId, request.method, "dola-skill-pack-response.json");
      return;
    }

    if ((url.includes(CHAT_COMPLETION_URL_PART) || url.includes("completion"))
      && (url.includes("dola.com") || url.includes("doubao.com") || url.includes("byteintlapi.com"))) {
      await rewriteChatCompletionRequest(tabId, event);
      return;
    }

    if (url.includes(ACTION_BAR_CONF_URL_PART)) {
      await rewriteActionBarConfigResponse(tabId, event);
      return;
    }

    if (url.includes(DOUBAO_CHAIN_SINGLE_URL_PART)) {
      await inspectChainSingleResponse(tabId, event, "doubao");
      return;
    }

    if (url.includes(DOLA_CHAIN_SINGLE_URL_PART)) {
      await inspectChainSingleResponse(tabId, event, "dola");
      return;
    }

    await continueRequest(tabId, requestId);
  } catch (error) {
    console.warn("request handling failed:", error.message || error);
    await continueRequest(tabId, requestId).catch(() => {});
  }
}

async function fulfillJsonFile(tabId, requestId, method, fileName) {
  if ((method || "").toUpperCase() === "OPTIONS") {
    await sendCommand(tabId, "Fetch.fulfillRequest", {
      requestId,
      responseCode: 204,
      responsePhrase: "No Content",
      responseHeaders: corsHeaders()
    });
    return;
  }

  const body = await getResponseFileBody(fileName);
  await sendCommand(tabId, "Fetch.fulfillRequest", {
    requestId,
    responseCode: 200,
    responsePhrase: "OK",
    responseHeaders: responseHeadersForTextBody(corsHeaders(), body),
    body: toBase64Utf8(body)
  });
}

function continueRequest(tabId, requestId, overrides = {}) {
  return sendCommand(tabId, "Fetch.continueRequest", { requestId, ...overrides });
}

async function rewriteChatCompletionRequest(tabId, event) {
  const request = event.request || {};
  const method = String(request.method || "POST").toUpperCase();
  if (method === "OPTIONS" || method === "GET") {
    await continueRequest(tabId, event.requestId);
    return;
  }

  let rawBody = String(request.postData || "");
  if (!rawBody) {
    try {
      const got = await sendCommand(tabId, "Fetch.getRequestPostData", { requestId: event.requestId });
      rawBody = String(got?.postData || "");
    } catch (e) {}
  }
  if (!rawBody) {
    await continueRequest(tabId, event.requestId);
    return;
  }

  let json;
  try {
    json = JSON.parse(rawBody);
  } catch (e) {
    await continueRequest(tabId, event.requestId);
    return;
  }

  const pending = getPendingVideoParams(tabId);
  let ability = {};
  try {
    const rawParam = json?.chat_ability?.ability_param;
    if (typeof rawParam === "string" && rawParam.trim()) {
      ability = JSON.parse(rawParam);
    } else if (rawParam && typeof rawParam === "object") {
      ability = { ...rawParam };
    }
  } catch (e) {
    ability = {};
  }

  const abilityType = Number(json?.chat_ability?.ability_type || 0);
  const looksLikeVideoSkill = abilityType === 17
    || Object.prototype.hasOwnProperty.call(ability, "duration")
    || Object.prototype.hasOwnProperty.call(ability, "ratio")
    || Object.prototype.hasOwnProperty.call(ability, "model");

  // Credit/Create-Video mode sets pending. Without it, only touch real video-skill payloads.
  if (!pending && !looksLikeVideoSkill) {
    await continueRequest(tabId, event.requestId);
    return;
  }

  const desired = {
    ratio: String((pending && pending.ratio) || ability.ratio || "16:9"),
    model: String((pending && pending.model) || ability.model || "seedance_v2.0"),
    duration: Number((pending && pending.duration) || ability.duration || 30) || 30
  };

  if (!json.chat_ability || typeof json.chat_ability !== "object") {
    json.chat_ability = {};
  }
  // Force video skill ability (dola_client uses ability_type 17).
  json.chat_ability.ability_type = 17;
  ability.duration = desired.duration;
  ability.ratio = desired.ratio;
  ability.model = desired.model;
  json.chat_ability.ability_param = JSON.stringify(ability);

  // Help credit/30s path when Dola checks commerce flags.
  if (!json.ext || typeof json.ext !== "object") json.ext = {};
  if (desired.duration >= 30) {
    json.ext.commerce_credit_config_enable = "1";
  }

  const patched = JSON.stringify(json);
  console.log("[Seedance Studio Pro] Patched chat/completion ability_param:", ability);
  try {
    await chrome.storage.local.set({
      sr_last_ability_patch: {
        at: Date.now(),
        tabId,
        ability,
        url: String(request.url || "").slice(0, 180)
      }
    });
  } catch (e) {}

  // Some Chrome builds reject continueRequest when headers are overridden.
  // Prefer postData+Content-Length, then fall back to postData-only.
  const headers = rewriteRequestHeadersForBody(request.headers || [], patched);
  try {
    await continueRequest(tabId, event.requestId, { postData: patched, headers });
    return;
  } catch (err1) {
    console.warn("[Seedance Studio Pro] continueRequest+headers failed:", err1?.message || err1);
  }
  try {
    await continueRequest(tabId, event.requestId, { postData: patched });
    return;
  } catch (err2) {
    console.warn("[Seedance Studio Pro] continueRequest+postData failed:", err2?.message || err2);
  }
  await continueRequest(tabId, event.requestId);
}

function rewriteRequestHeadersForBody(headers, bodyText) {
  const bytes = (typeof TextEncoder !== "undefined")
    ? new TextEncoder().encode(String(bodyText || "")).length
    : unescape(encodeURIComponent(String(bodyText || ""))).length;

  const next = [];
  for (const header of headers || []) {
    const name = String(header?.name || "");
    if (!name) continue;
    if (name.toLowerCase() === "content-length") continue;
    next.push({ name, value: String(header.value || "") });
  }
  next.push({ name: "Content-Length", value: String(bytes) });
  return next;
}

async function rewriteActionBarConfigResponse(tabId, event) {
  const response = await getPausedResponseBody(tabId, event.requestId);
  const patchedBody = patchActionBarDuration(response.body);

  await sendCommand(tabId, "Fetch.fulfillRequest", {
    requestId: event.requestId,
    responseCode: event.responseStatusCode || 200,
    responsePhrase: event.responseStatusText || "OK",
    responseHeaders: responseHeadersForTextBody(event.responseHeaders || [], patchedBody),
    body: toBase64Utf8(patchedBody)
  });
}

async function inspectChainSingleResponse(tabId, event, source) {
  const sourceKey = `${source}:${event.requestId}`;
  const response = await getPausedResponseBody(tabId, event.requestId);

  let items = [];
  try {
    const json = JSON.parse(response.body);
    if (source === "doubao") {
      items = await extractDoubaoItems(json, response.body);
    } else {
      items = await extractDolaItems(json, response.body);
    }
  } catch (error) {
    console.warn(`${source} chain parse failed:`, error.message || error);
  }

  if (items.length) {
    for (const item of items) {
      if (item && item.type === "video" && isHttpUrl(item.url) && !isWatermarkedMediaUrl(item.url)) {
        chrome.storage.local.get(["autoDownload"], (res) => {
          if (res?.autoDownload !== false) {
            triggerBackgroundDownload(item.url);
          }
        });
      }
    }
    await sendToTab(tabId, {
      type: "MEDIA_FOUND",
      sourceKey,
      items: items.map((it) => ({ ...it, source: it.source || "fallback_api" }))
    });
  } else {
    await sendToTab(tabId, {
      type: "MEDIA_STATUS",
      sourceKey,
      text: "未提取到资源"
    });
  }

  await sendCommand(tabId, "Fetch.fulfillRequest", {
    requestId: event.requestId,
    responseCode: event.responseStatusCode || 200,
    responsePhrase: event.responseStatusText || "OK",
    responseHeaders: responseHeadersForTextBody(event.responseHeaders || [], response.body),
    body: toBase64Utf8(response.body)
  });
}

async function getPausedResponseBody(tabId, requestId) {
  const response = await sendCommand(tabId, "Fetch.getResponseBody", { requestId });
  return {
    body: response.base64Encoded ? fromBase64Utf8(response.body) : response.body
  };
}

async function extractDoubaoItems(json, rawBody) {
  const items = [];
  const seenUrls = new Set();

  for (const url of findImageOriRawUrls(json)) {
    addItem(items, seenUrls, "image", url);
  }

  for (const fallbackApi of findDoubaoFallbackApis(json, rawBody)) {
    const videoUrl = await getDoubaoVideoUrlFromFallbackApi(fallbackApi);
    addItem(items, seenUrls, "video", videoUrl);
  }

  return items;
}

function findDoubaoFallbackApis(json, rawBody) {
  const apis = new Set();

  for (const value of findValuesByKey(json, "fallback_api")) {
    addFallbackApi(apis, value);
  }

  const patterns = [
    /fallback_api\\":\\"(.*?)\\"/g,
    /"fallback_api"\s*:\s*"([^"]+)"/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(rawBody);
    while (match) {
      addFallbackApi(apis, decodeJsonEscapedFragment(match[1]));
      match = pattern.exec(rawBody);
    }
  }

  return Array.from(apis);
}

function addFallbackApi(apis, value) {
  if (typeof value !== "string" || !value) {
    return;
  }

  const url = decodeJsonEscapedFragment(value);
  if (isHttpUrl(url)) {
    apis.add(url);
  }
}

function decodeJsonEscapedFragment(value) {
  let text = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
      if (decoded === text) {
        break;
      }
      text = decoded;
    } catch {
      break;
    }
  }
  return text.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}

async function getDoubaoVideoUrlFromFallbackApi(fallbackApi) {
  try {
    const url = replaceQueryParams(fallbackApi, {
	  channel: "no",
      codec_type: "8",
      logo_type: "unwatermarked"
    });
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      headers: {
        "accept": "application/json,text/plain,*/*"
      }
    });
    const payload = await response.json();
    const data = getVideoData(payload);
    const token = pickMainUrlToken(data);
    if (!token) {
      return "";
    }
    const keySeed = findKeySeedDeep(payload) || findKeySeedDeep(fallbackApi);
    return await decodeMainUrl(token, keySeed);
  } catch (error) {
    console.warn("doubao fallback_api failed:", error.message || error);
    return "";
  }
}

function replaceQueryParams(url, params) {
  const parsedUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsedUrl.searchParams.set(key, value);
  }
  return parsedUrl.toString();
}

function getVideoData(payload) {
  const videoInfo = payload?.video_info || payload?.data?.video_info || payload;
  const data = videoInfo?.data || videoInfo;
  return data && typeof data === "object" ? data : {};
}

function pickMainUrlToken(data) {
  const videoList = data?.video_list;
  const entries = videoList && typeof videoList === "object" && Object.keys(videoList).length
    ? Object.values(videoList)
    : [data];
  let best = null;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const token = entry.main_url || entry.play_url || "";
    if (typeof token !== "string" || !token.trim()) {
      continue;
    }
    const score = Number(entry.bitrate || entry.real_bitrate || 0)
      + Number(entry.vwidth || entry.width || 0) * Number(entry.vheight || entry.height || 0);
    if (!best || score > best.score) {
      best = { token: token.trim(), score };
    }
  }

  return best ? best.token : "";
}

function findKeySeedDeep(value, depth = 0) {
  if (depth > 10 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    let match = value.match(/(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    match = value.match(/["']key_seed["']\s*:\s*["']([^"']+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  if (typeof value !== "object") {
    return "";
  }

  if (typeof value.key_seed === "string" && value.key_seed.trim()) {
    return value.key_seed.trim();
  }

  for (const item of Object.values(value)) {
    const hit = findKeySeedDeep(item, depth + 1);
    if (hit) {
      return hit;
    }
  }

  return "";
}

async function decodeMainUrl(token, keySeed = "") {
  if (isHttpUrl(token)) {
    return token;
  }

  const plainUrl = tryDecodeBase64Url(token);
  if (plainUrl) {
    return plainUrl;
  }

  if (token.startsWith("qAAB") && keySeed) {
    return await decodeQaabToken(token, keySeed);
  }

  return "";
}

function tryDecodeBase64Url(token) {
  const bytes = base64DecodeLoose(token);
  if (!bytes) {
    return "";
  }
  const text = asciiUrlFromBytes(bytes);
  return isHttpUrl(text) ? text : "";
}

function base64DecodeLoose(text) {
  const input = String(text || "").trim();
  const variants = [
    input,
    input.replace(/[$@#]/g, (char) => ({ "$": "_", "@": "/", "#": "." }[char])),
    input.replace(/[$@#]/g, (char) => ({ "$": "+", "@": "/", "#": "=" }[char]))
  ];
  const seen = new Set();

  for (const candidate of variants) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    try {
      const normalized = padBase64(candidate).replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(normalized);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    } catch {
      // Try the next variant.
    }
  }

  return null;
}

function padBase64(text) {
  const pad = (4 - (text.length % 4)) % 4;
  return text + "=".repeat(pad);
}

function asciiUrlFromBytes(bytes) {
  if (!bytes || !bytes.length) {
    return "";
  }
  for (const byte of bytes) {
    if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) {
      return "";
    }
  }
  return new TextDecoder().decode(bytes);
}

async function decodeQaabToken(token, keySeed) {
  const data = base64DecodeLoose(token);
  const seed = base64DecodeLoose(keySeed);
  if (!data || !seed) {
    return "";
  }

  const digest1 = await crypto.subtle.digest("SHA-512", seed.slice(0, 32));
  const salt = hexToBytes(QAAB_SALT_HEX);
  const digest2Input = concatBytes(new Uint8Array(digest1), salt);
  const digest2 = new Uint8Array(await crypto.subtle.digest("SHA-512", digest2Input));
  const key = digest2.slice(0, 16);
  const iv = digest2.slice(16, 32);
  const attempts = [];

  if (data.length >= 4 && data[0] === 0xa8 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00) {
    attempts.push({ payload: data.slice(4), key, iv });
    attempts.push({ payload: data.slice(4), key: iv, iv: key });
    if (data.length > 36) {
      attempts.push({ payload: data.slice(36), key, iv: data.slice(20, 36) });
      attempts.push({ payload: data.slice(36), key, iv });
    }
  } else {
    attempts.push({ payload: data, key, iv });
  }

  for (const attempt of attempts) {
    const url = await decryptAesCbcUrl(attempt.payload, attempt.key, attempt.iv);
    if (url) {
      return url;
    }
  }

  return "";
}

async function decryptAesCbcUrl(payload, keyBytes, ivBytes) {
  if (!payload.length || payload.length % 16 !== 0) {
    return "";
  }

  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, payload));
    const direct = asciiUrlFromBytes(plain);
    if (isHttpUrl(direct)) {
      return direct;
    }
    const stripped = stripPkcs7(plain);
    const url = asciiUrlFromBytes(stripped);
    return isHttpUrl(url) ? url : "";
  } catch {
    return "";
  }
}

function stripPkcs7(bytes) {
  if (!bytes || !bytes.length) {
    return new Uint8Array();
  }
  const pad = bytes[bytes.length - 1];
  if (pad < 1 || pad > 16 || pad > bytes.length) {
    return bytes;
  }
  for (let index = bytes.length - pad; index < bytes.length; index += 1) {
    if (bytes[index] !== pad) {
      return bytes;
    }
  }
  return bytes.slice(0, bytes.length - pad);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(first, second) {
  const bytes = new Uint8Array(first.length + second.length);
  bytes.set(first, 0);
  bytes.set(second, first.length);
  return bytes;
}

async function extractDolaItems(json, rawBody) {
  const items = [];
  const seenUrls = new Set();

  for (const url of findImageOriRawUrls(json)) {
    addItem(items, seenUrls, "image", url);
  }

  for (const fallbackApi of findDoubaoFallbackApis(json, rawBody)) {
    const videoUrl = await getDoubaoVideoUrlFromFallbackApi(fallbackApi);
    if (videoUrl && !isWatermarkedMediaUrl(videoUrl)) {
      addItem(items, seenUrls, "video", videoUrl);
    }
  }

  if (items.filter((i) => i.type === "video").length === 0) {
    for (const encodedUrl of findDolaEncodedVideoUrls(json)) {
      const url = decodeBase64Url(encodedUrl);
      if (url && !isWatermarkedMediaUrl(url)) {
        addItem(items, seenUrls, "video", url);
      }
    }
  }

  return items;
}

function findDolaEncodedVideoUrls(json) {
  const values = [];
  for (const value of findValuesByKey(json, "man_url")) {
    values.push(value);
  }
  for (const value of findValuesByKey(json, "main_url")) {
    values.push(value);
  }
  return values;
}

function patchActionBarDuration(body) {
  try {
    const json = JSON.parse(body);
    const changed = patchNestedJsonStrings(json);
    return changed ? JSON.stringify(json) : body;
  } catch (error) {
    console.warn("patch action bar duration failed:", error.message || error);
    return body;
  }
}

function patchNestedJsonStrings(value, seen = new Set()) {
  if (value == null || typeof value !== "object" || seen.has(value)) {
    return false;
  }

  seen.add(value);
  let changed = false;

  if (Array.isArray(value)) {
    for (const item of value) {
      changed = patchNestedJsonStrings(item, seen) || changed;
    }
    return changed;
  }

  for (const key of Object.keys(value)) {
    const child = value[key];
    if (typeof child === "string") {
      const patchedString = patchJsonStringDuration(child);
      if (patchedString !== child) {
        value[key] = patchedString;
        changed = true;
      }
    } else {
      changed = patchNestedJsonStrings(child, seen) || changed;
    }
  }

  return changed;
}

function patchJsonStringDuration(text) {
  if (!text || (!text.trim().startsWith("{") && !text.trim().startsWith("["))) {
    return text;
  }

  try {
    const json = JSON.parse(text);
    const changed = patchDurationSelector(json);
    return changed ? JSON.stringify(json) : text;
  } catch {
    return text;
  }
}

function patchDurationSelector(value, seen = new Set()) {
  if (value == null || typeof value !== "object" || seen.has(value)) {
    return false;
  }

  seen.add(value);
  let changed = false;

  if (Array.isArray(value)) {
    for (const item of value) {
      changed = patchDurationSelector(item, seen) || changed;
    }
    return changed;
  }

  const label = String(value.label || value.display_text || value.show_name || "");
  const selectorKey = String(value.key || value.value || "");
  const options = Array.isArray(value.option_list) ? value.option_list : [];
  const looksLikeDuration = selectorKey === "video-duration"
    || selectorKey === "duration"
    || /时长|鏃堕暱|時間|長さ|duration/i.test(label)
    || (options.some((option) => String(option?.option_key || option?.value || "") === "5")
      && options.some((option) => String(option?.option_key || option?.value || "") === "10"));

  if (looksLikeDuration && options.length) {
    const has30s = options.some((option) => String(option?.option_key || option?.value || "") === "30");
    if (!has30s) {
      const tenSecondIndex = options.findIndex((option) => String(option?.option_key || option?.value || "") === "10");
      const insertIndex = tenSecondIndex >= 0 ? tenSecondIndex + 1 : options.length;
      options.splice(insertIndex, 0, createThirtySecondOption(options));
      changed = true;
    }
  }

  for (const key of Object.keys(value)) {
    const child = value[key];
    if (typeof child === "string") {
      const patchedString = patchJsonStringDuration(child);
      if (patchedString !== child) {
        value[key] = patchedString;
        changed = true;
      }
    } else {
      changed = patchDurationSelector(child, seen) || changed;
    }
  }

  return changed;
}

function createThirtySecondOption(optionList) {
  const maxId = optionList.reduce((maxValue, option) => {
    const id = Number(option?.id);
    return Number.isFinite(id) ? Math.max(maxValue, id) : maxValue;
  }, 0);

  return {
    id: maxId + 1,
    display_text: "30s",
    message_text: "",
    option_key: "30"
  };
}

function findImageOriRawUrls(value) {
  const urls = [];
  walkJsonAndStrings(value, (node) => {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      const image = node.image_ori_raw;
      if (image && typeof image === "object" && isHttpUrl(image.url)) {
        urls.push(image.url);
      }
    }
  });
  return urls;
}

function findValuesByKey(value, targetKey) {
  const values = [];
  walkJsonAndStrings(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(node, targetKey)) {
      values.push(node[targetKey]);
    }
  });
  return values;
}

function walkJsonAndStrings(value, visitor, seen = new Set()) {
  if (value == null) {
    return;
  }

  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    if (parsed !== null) {
      walkJsonAndStrings(parsed, visitor, seen);
    }
    return;
  }

  if (typeof value !== "object" || seen.has(value)) {
    return;
  }

  seen.add(value);
  visitor(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      walkJsonAndStrings(item, visitor, seen);
    }
    return;
  }

  for (const key of Object.keys(value)) {
    walkJsonAndStrings(value[key], visitor, seen);
  }
}

function parseJsonString(text) {
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function addItem(items, seenUrls, type, url) {
  if (!isHttpUrl(url) || seenUrls.has(url)) {
    return;
  }
  seenUrls.add(url);
  items.push({ type, url });
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  if (isHttpUrl(value)) {
    return value;
  }

  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const decoded = fromBase64Utf8(padded);
    return isHttpUrl(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

function responseHeadersForTextBody(headers, body) {
  const contentLength = String(new TextEncoder().encode(body).length);
  const nextHeaders = [];
  let hasContentType = false;
  let hasContentLength = false;

  for (const header of headers) {
    const name = header.name || "";
    const lowerName = name.toLowerCase();
    if (lowerName === "content-encoding") {
      continue;
    }

    if (lowerName === "content-type") {
      hasContentType = true;
      nextHeaders.push({ name, value: "application/json; charset=utf-8" });
      continue;
    }

    if (lowerName === "content-length") {
      hasContentLength = true;
      nextHeaders.push({ name, value: contentLength });
      continue;
    }

    nextHeaders.push(header);
  }

  if (!hasContentType) {
    nextHeaders.push({ name: "content-type", value: "application/json; charset=utf-8" });
  }

  if (!hasContentLength) {
    nextHeaders.push({ name: "content-length", value: contentLength });
  }

  return nextHeaders;
}

function getResponseFileBody(fileName) {
  if (!responseFileBodyPromises.has(fileName)) {
    responseFileBodyPromises.set(fileName, fetch(chrome.runtime.getURL(fileName)).then((response) => response.text()));
  }
  return responseFileBodyPromises.get(fileName);
}

function corsHeaders() {
  return [
    { name: "access-control-allow-origin", value: "*" },
    { name: "access-control-allow-credentials", value: "true" },
    { name: "access-control-allow-methods", value: "GET, POST, OPTIONS" },
    { name: "access-control-allow-headers", value: "*" }
  ];
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64Utf8(base64Text) {
  const binary = atob(base64Text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function isHttpUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.warn("send panel message failed:", error.message || error);
  }
}

function setBadge(tabId, text) {
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#166534" }).catch(() => {});
}

// ============================================================================
// BATCH PROMPT & SIDE PANEL CONTROLLER
// ============================================================================
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

// ============================================================================
// MULTI-ACCOUNT COOKIE & TAB SESSION ISOLATION (declarativeNetRequest)
// ============================================================================
const SESSION_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316'
];

function getNextColor(index) {
  return SESSION_COLORS[Math.abs(index) % SESSION_COLORS.length];
}

const DNR_FILTERS_PER_TAB = [
  '||dola.com',
  '||doubao.com',
  '||byteintlapi.com',
  '||ibytedtos.com'
];

function allocTabDnrRuleIds(tabId) {
  const need = DNR_FILTERS_PER_TAB.length;
  const existing = tabDnrRuleIds.get(tabId);
  if (existing && existing.length >= need) {
    const ids = existing.slice(0, need);
    tabDnrRuleIds.set(tabId, ids);
    return ids;
  }
  const ids = [];
  for (let i = 0; i < need; i++) ids.push(nextDnrRuleId++);
  tabDnrRuleIds.set(tabId, ids);
  return ids;
}

function releaseTabDnrRuleIds(tabId) {
  const ids = tabDnrRuleIds.get(tabId);
  tabDnrRuleIds.delete(tabId);
  // Không fallback sang tabId/tabId+100000 — dễ trùng id rule của tab khác.
  return (ids && ids.length) ? ids : [];
}

/** Session rules sống sót khi SW restart — đồng bộ counter/map để không đụng id cũ. */
async function syncDnrRuleIdState() {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.getSessionRules) return;
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    let maxId = 0;
    for (const r of rules || []) {
      if (typeof r.id === 'number' && r.id > maxId) maxId = r.id;
      const tids = r.condition && r.condition.tabIds;
      if (tids && tids.length === 1) {
        const tid = tids[0];
        const arr = tabDnrRuleIds.get(tid) ? [...tabDnrRuleIds.get(tid)] : [];
        if (!arr.includes(r.id)) arr.push(r.id);
        // Giữ mọi id gắn tab; alloc tái dùng N id đầu (dola/doubao/api…).
        tabDnrRuleIds.set(tid, arr);
      }
    }
    if (maxId >= nextDnrRuleId) nextDnrRuleId = maxId + 1;
  } catch (e) {
    console.warn('[Seedance] syncDnrRuleIdState failed:', e);
  }
}

function getMultiAccStore() {
  return (chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;
}

function persistMultiAccState() {}
function releaseTabDnrRuleIds() { return []; }
async function syncDnrRuleIdState() {}

function restoreMultiAccState() {
  // Đa nick đã tắt — không restore DNR / cookie isolation theo tab.
}

async function pruneCleanLoginTabs() {
  for (const id of [...cleanLoginTabIds]) {
    try {
      await chrome.tabs.get(id);
    } catch (e) {
      cleanLoginTabIds.delete(id);
      tabSessionMap.delete(id);
      const ruleIds = releaseTabDnrRuleIds(id);
      if (ruleIds.length && chrome.declarativeNetRequest?.updateSessionRules) {
        try {
          await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds });
        } catch (err) {}
      }
    }
  }
  return cleanLoginTabIds.size;
}

/** Xóa session/DNR gắn tab đã đóng (sau SW restart / restore stale). */
async function pruneDeadTabSessions() {
  for (const tabId of [...tabSessionMap.keys()]) {
    try {
      await chrome.tabs.get(tabId);
    } catch (e) {
      tabSessionMap.delete(tabId);
      cleanLoginTabIds.delete(tabId);
      const ruleIds = releaseTabDnrRuleIds(tabId);
      if (ruleIds.length && chrome.declarativeNetRequest?.updateSessionRules) {
        try {
          await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds });
        } catch (err) {}
      }
    }
  }
}

async function assertNoPendingCleanLogin(actionLabel) {
  await pruneDeadTabSessions();
  await pruneCleanLoginTabs();
  if (cleanLoginTabIds.size === 0) return null;
  return `Đang có Tab Login Sạch chưa lưu (💾). Hãy Lưu Tab Này hoặc đóng tab đó trước khi ${actionLabel}.`;
}

/** Khi SW restart mất Map — đọc lại Cookie header đang ép trên tab từ DNR. */
async function cookiesFromDnrHeader(tabId) {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.getSessionRules) return [];
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const match = (rules || []).find((r) => {
      const tids = r.condition && r.condition.tabIds;
      return tids && tids.includes(tabId);
    });
    const hdr = match && match.action && match.action.requestHeaders
      ? match.action.requestHeaders.find((h) => String(h.header || '').toLowerCase() === 'cookie' && h.operation === 'set')
      : null;
    if (!hdr || !hdr.value) return [];
    const nowSec = Math.floor(Date.now() / 1000);
    return String(hdr.value).split(';').map((pair) => {
      const p = pair.trim();
      const eq = p.indexOf('=');
      if (eq <= 0) return null;
      return {
        name: p.slice(0, eq).trim(),
        value: p.slice(eq + 1).trim(),
        domain: '.dola.com',
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'no_restriction',
        expirationDate: nowSec + 86400 * 30
      };
    }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function parseCookiesUniversal(cookieInput) {
  if (!cookieInput || typeof cookieInput !== 'string') return [];
  const text = cookieInput.trim();
  let rawCookies = [];

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        rawCookies = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.cookies)) {
          rawCookies = parsed.cookies;
        } else if (Array.isArray(parsed.data)) {
          rawCookies = parsed.data;
        } else {
          rawCookies = Object.entries(parsed).map(([k, v]) => ({
            name: k,
            value: typeof v === 'object' ? JSON.stringify(v) : String(v)
          }));
        }
      }
    } catch (e) {}
  }

  if (rawCookies.length === 0) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line) => {
      const l = line.trim();
      if (!l || l.startsWith('#')) return;

      const tabs = l.split(/\t+|\s{2,}/);
      if (tabs.length >= 7) {
        rawCookies.push({
          domain: tabs[0].trim(),
          httpOnly: tabs[1].trim().toLowerCase() === 'true',
          path: tabs[2].trim() || '/',
          secure: tabs[3].trim().toLowerCase() === 'true',
          expires: parseFloat(tabs[4].trim()) || (Date.now() / 1000 + 86400 * 30),
          name: tabs[5].trim(),
          value: tabs[6].trim()
        });
      } else if (l.includes('=')) {
        l.split(';').forEach((pair) => {
          const eq = pair.indexOf('=');
          if (eq > 0) {
            rawCookies.push({
              name: pair.slice(0, eq).trim(),
              value: pair.slice(eq + 1).trim()
            });
          }
        });
      }
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const normalized = [];
  for (const c of rawCookies) {
    if (!c) continue;
    const name = String(c.name || '').trim();
    const value = String(c.value !== undefined ? c.value : '').trim();
    if (!name) continue;

    let domain = String(c.domain || '.dola.com').trim();
    if (!domain.includes('dola.com') && !domain.includes('doubao.com')) {
      domain = '.dola.com';
    }

    normalized.push({
      name,
      value,
      domain,
      path: c.path || '/',
      expirationDate: Math.floor(c.expires || c.expirationDate || (nowSec + 86400 * 30)),
      httpOnly: Boolean(c.httpOnly),
      secure: c.secure !== undefined ? Boolean(c.secure) : true,
      sameSite: c.sameSite || 'no_restriction'
    });
  }
  return normalized;
}

restoreMultiAccState();

function getCookieUrl(cookie) {
  let domain = String(cookie.domain || 'www.dola.com').trim();
  if (domain.startsWith('.')) domain = domain.slice(1);
  const path = cookie.path || '/';
  return `https://${domain}${path}`;
}

async function setDolaCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return;
  if (!chrome.cookies) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const promises = cookies.map((c) => {
    if (!c.name || c.value === undefined) return Promise.resolve();
    const url = getCookieUrl(c);
    const domain = c.domain && c.domain.startsWith('.') ? c.domain : undefined;
    const cookieDetails = {
      url,
      name: c.name.trim(),
      value: String(c.value),
      path: c.path || '/',
      secure: c.secure !== false,
      httpOnly: Boolean(c.httpOnly),
      sameSite: c.sameSite || 'no_restriction',
      expirationDate: c.expirationDate && c.expirationDate > nowSec ? Math.floor(c.expirationDate) : nowSec + 86400 * 30
    };
    if (domain) cookieDetails.domain = domain;

    return new Promise((resolve) => {
      chrome.cookies.set(cookieDetails, (result) => {
        if (chrome.runtime.lastError) {
          delete cookieDetails.domain;
          cookieDetails.url = 'https://www.dola.com' + (c.path || '/');
          chrome.cookies.set(cookieDetails, () => resolve());
        } else {
          resolve();
        }
      });
    });
  });

  await Promise.all(promises);
}

async function clearAllDolaCookies() {
  if (!chrome.cookies) return;
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: 'dola.com' }, (c1) => {
      chrome.cookies.getAll({ domain: 'doubao.com' }, (c2) => {
        const all = (c1 || []).concat(c2 || []);
        if (all.length === 0) return resolve();
        const promises = all.map((c) => {
          const url = (c.secure ? 'https://' : 'http://') + (c.domain.startsWith('.') ? c.domain.slice(1) : c.domain) + (c.path || '/');
          return new Promise((r) => chrome.cookies.remove({ url, name: c.name, storeId: c.storeId }, r));
        });
        Promise.all(promises).then(resolve);
      });
    });
  });
}

function waitTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (e) {}
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    function onUpdated(id, info) {
      if (id !== tabId) return;
      if (info.status === 'complete') {
        clearTimeout(timer);
        finish();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timer);
        finish();
        return;
      }
      if (tab && tab.status === 'complete' && tab.url && !String(tab.url).startsWith('about:')) {
        clearTimeout(timer);
        finish();
      }
    });
  });
}

// Shared with bulk-account-manager.js in the same service worker
self.applyTabSessionRule = applyTabSessionRule;
self.setDolaCookies = setDolaCookies;
self.clearAllDolaCookies = clearAllDolaCookies;
self.clearDolaCookies = clearAllDolaCookies;
self.waitTabComplete = waitTabComplete;
self.assertNoPendingCleanLogin = assertNoPendingCleanLogin;
self.isDeadDolaLoginUrl = () => false;

async function applyTabSessionRule(tabId, profile) {
  // Đa nick đã tắt — không còn ép Cookie theo tabId.
  console.log('[Seedance] applyTabSessionRule ignored (multi-acc disabled)');
}

function collectDolaCookiesFromJar() {
  return new Promise((resolve) => {
    if (!chrome.cookies) {
      resolve([]);
      return;
    }
    chrome.cookies.getAll({ domain: 'dola.com' }, (c1) => {
      chrome.cookies.getAll({ url: 'https://www.dola.com' }, (c2) => {
        chrome.cookies.getAll({ domain: 'doubao.com' }, (c3) => {
          const map = new Map();
          [...(c1 || []), ...(c2 || []), ...(c3 || [])].forEach((c) => {
            if (c && c.name) map.set(c.name + '@' + (c.domain || ''), c);
          });
          resolve(Array.from(map.values()));
        });
      });
    });
  });
}

async function openCleanLoginTab() {
  // Shared cookie jar is emptied so THIS tab starts logged-out.
  // Other already-isolated tabs keep their nick via DNR Cookie override.
  const pendingMsg = await assertNoPendingCleanLogin('mở thêm tab login sạch');
  if (pendingMsg) {
    throw new Error(pendingMsg);
  }

  const newTab = await new Promise((resolve, reject) => {
    chrome.tabs.create({ url: 'about:blank', active: true }, (tab) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(tab);
    });
  });

  await syncDnrRuleIdState();
  if (chrome.declarativeNetRequest?.updateSessionRules) {
    try {
      const staleIds = releaseTabDnrRuleIds(newTab.id);
      if (staleIds.length) {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: staleIds
        });
      }
    } catch (e) {}
  }

  await clearAllDolaCookies();
  // Không đụng Google SSO / AccountChooser — dễ 400 và phá session Gmail.
  // Nick Google mới: dùng Chrome Profile / GPM riêng, rồi 💾 Lưu hoặc nạp cookie.

  cleanLoginTabIds.add(newTab.id);
  tabSessionMap.set(newTab.id, {
    profileName: '__clean_login__',
    mode: 'clean_login',
    color: '#38bdf8'
  });
  persistMultiAccState();

  await new Promise((resolve, reject) => {
    chrome.tabs.update(newTab.id, { url: 'https://www.dola.com/chat' }, (tab) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(tab);
    });
  });
  await waitTabComplete(newTab.id, 25000);

  try {
    chrome.action.setBadgeText({ tabId: newTab.id, text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ tabId: newTab.id, color: '#0ea5e9' });
  } catch (e) {}

  return { tabId: newTab.id };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return;

  // ĐÃ TẮT ĐA NICK — 1 Chrome profile = 1 acc Dola.
  const DISABLED_MULTI_ACC = new Set([
    'open_multiple_accounts',
    'open_account_in_new_tab',
    'import_account_profile',
    'capture_active_session',
    'export_active_session_cookies',
    'open_clean_login_tab',
    'clear_all_accounts',
    'delete_account_profile',
    'switch_profile'
  ]);
  if (DISABLED_MULTI_ACC.has(request.action)) {
    sendResponse({
      success: false,
      error: 'Đã tắt đa nick. Dùng 1 Chrome Profile (hoặc GPM) cho 1 acc Dola, login tay rồi bắn prompt.'
    });
    return true;
  }

  if (request.action === 'open_clean_login_tab') {
    openCleanLoginTab()
      .then((result) => sendResponse({
        success: true,
        tabId: result.tabId,
        message: 'Đã mở tab Dola (xóa cookie Dola). Nick Google mới hãy login trong Profile/GPM riêng rồi 💾 Lưu hoặc nạp cookie.'
      }))
      .catch((err) => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (request.action === 'export_active_session_cookies') {
    const pickAndExport = async () => {
      let activeTab = null;
      if (request.tabId) {
        try { activeTab = await chrome.tabs.get(request.tabId); } catch (e) {}
      }
      if (!activeTab) {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({ url: ['*://*.dola.com/*', '*://dola.com/*', '*://*.doubao.com/*'] }, resolve);
        });
        const list = tabs || [];
        activeTab = list.find((t) => t.active) || list[0];
      }
      if (!activeTab || !activeTab.url) {
        sendResponse({ success: false, error: 'Hãy mở tab Dola đã đăng nhập rồi bấm Xuất Cookie!' });
        return;
      }

      const session = activeTab.id ? tabSessionMap.get(activeTab.id) : null;
      let cookies = [];
      if (session && Array.isArray(session.cookies) && session.cookies.length > 0 && session.mode !== 'clean_login') {
        cookies = session.cookies;
      } else if (activeTab.id && (!session || session.mode !== 'clean_login')) {
        cookies = await cookiesFromDnrHeader(activeTab.id);
      }
      if (!cookies.length) {
        cookies = await collectDolaCookiesFromJar();
      }
      if (!cookies.length) {
        sendResponse({ success: false, error: 'Chưa thấy cookie đăng nhập trên tab Dola.' });
        return;
      }

      const hint = (request.profileName && String(request.profileName).trim()) || '';
      const safeName = (hint || 'dola-session').replace(/[^\w\-.#@\u00C0-\u024F]+/g, '_').slice(0, 48);
      const exportPayload = cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '.dola.com',
        path: c.path || '/',
        expirationDate: c.expirationDate || c.expires || Math.floor(Date.now() / 1000) + 86400 * 30,
        httpOnly: Boolean(c.httpOnly),
        secure: c.secure !== false,
        sameSite: c.sameSite || 'no_restriction',
        session: false
      }));

      sendResponse({
        success: true,
        cookieCount: exportPayload.length,
        filename: `${safeName}-cookies.json`,
        cookies: exportPayload,
        tabUrl: activeTab.url || ''
      });
    };

    pickAndExport().catch((err) => {
      sendResponse({ success: false, error: err.message || String(err) });
    });
    return true;
  }

  if (request.action === 'capture_active_session') {
    const finishCapture = async (activeTab) => {
      if (!activeTab || !activeTab.url) {
        sendResponse({ success: false, error: 'Hãy mở ít nhất 1 Tab Dola đã đăng nhập nick rồi bấm nút này!' });
        return;
      }
      if (!chrome.cookies) {
        sendResponse({ success: false, error: 'Chưa cấp quyền chrome.cookies!' });
        return;
      }
      const session = activeTab.id ? tabSessionMap.get(activeTab.id) : null;
      let cookies = [];
      if (session && Array.isArray(session.cookies) && session.cookies.length > 0 && session.mode !== 'clean_login') {
        // Tab đã cô lập — lấy cookie đã gắn sẵn (jar chung có thể đang là nick khác).
        cookies = session.cookies;
      } else if (activeTab.id && (!session || session.mode !== 'clean_login')) {
        // SW restart có thể mất Map — thử đọc Cookie đang bị DNR ép trên tab.
        cookies = await cookiesFromDnrHeader(activeTab.id);
      }
      if (!cookies.length) {
        cookies = await collectDolaCookiesFromJar();
      }
      if (cookies.length === 0) {
        sendResponse({
          success: false,
          error: 'Chưa thấy cookie đăng nhập. Hãy login xong trên tab Dola rồi bấm Lưu lại.'
        });
        return;
      }

      chrome.storage.local.get(['multi_profiles'], async (res) => {
        const profiles = res?.multi_profiles || {};
        const existingKeys = Object.keys(profiles);
        const defaultName = request.profileName && request.profileName.trim()
          ? request.profileName.trim()
          : `Nick #${String(existingKeys.length + 1).padStart(2, '0')}`;

        const profile = {
          name: defaultName,
          cookies,
          color: getNextColor(existingKeys.length),
          createdAt: Date.now()
        };
        profiles[defaultName] = profile;

        chrome.storage.local.set({ multi_profiles: profiles }, async () => {
          const wasCleanLogin = cleanLoginTabIds.has(activeTab.id);
          // Lock this tab to the saved nick so later jar swaps won't steal the session.
          if (activeTab.id) {
            try {
              await applyTabSessionRule(activeTab.id, profile);
              cleanLoginTabIds.delete(activeTab.id);
              persistMultiAccState();
              try {
                chrome.action.setBadgeText({ tabId: activeTab.id, text: 'OK' });
                chrome.action.setBadgeBackgroundColor({ tabId: activeTab.id, color: '#10b981' });
              } catch (e) {}
            } catch (err) {
              console.warn('[Seedance] Lock tab after capture failed:', err);
            }
          }
          sendResponse({
            success: true,
            profileName: defaultName,
            cookieCount: cookies.length,
            lockedTabId: activeTab.id || null,
            fromCleanLogin: wasCleanLogin
          });
        });
      });
    };

    // Prefer explicit tabId, else clean-login tab, else active Dola tab.
    const pickAndCapture = async () => {
      if (request.tabId) {
        try {
          const tab = await chrome.tabs.get(request.tabId);
          await finishCapture(tab);
          return;
        } catch (e) {}
      }

      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ url: ['*://*.dola.com/*', '*://dola.com/*', '*://*.doubao.com/*'] }, resolve);
      });
      const list = tabs || [];
      // Ưu tiên tab đang active; chỉ ưu tiên clean-login khi chính tab đó đang focus.
      const cleanActive = list.find((t) => t.active && cleanLoginTabIds.has(t.id));
      const preferred = cleanActive || list.find((t) => t.active) || list[0];
      await finishCapture(preferred);
    };

    pickAndCapture().catch((err) => {
      sendResponse({ success: false, error: err.message || String(err) });
    });
    return true;
  }

  if (request.action === 'import_account_profile') {
    const rawCookies = request.cookies || '';
    const parsed = parseCookiesUniversal(rawCookies);
    if (parsed.length === 0) {
      sendResponse({ success: false, error: 'Định dạng Cookie không hợp lệ (hỗ trợ JSON, Netscape, Header string).' });
      return true;
    }
    chrome.storage.local.get(['multi_profiles'], (res) => {
      const profiles = res?.multi_profiles || {};
      const existingKeys = Object.keys(profiles);
      const name = request.name && request.name.trim()
        ? request.name.trim()
        : `Nick #${String(existingKeys.length + 1).padStart(2, '0')}`;

      profiles[name] = {
        name,
        cookies: parsed,
        color: getNextColor(existingKeys.length),
        createdAt: Date.now()
      };
      chrome.storage.local.set({ multi_profiles: profiles }, () => {
        sendResponse({ success: true, name, cookieCount: parsed.length });
      });
    });
    return true;
  }

  if (request.action === 'open_account_in_new_tab') {
    const profileName = request.profileName;
    chrome.storage.local.get(['multi_profiles'], async (res) => {
      const profiles = res?.multi_profiles || {};
      const profile = profiles[profileName];
      if (!profile || !Array.isArray(profile.cookies)) {
        sendResponse({ success: false, error: 'Không tìm thấy thông tin tài khoản hoặc cookies rỗng.' });
        return;
      }
      try {
        const blockMsg = await assertNoPendingCleanLogin('mở nick đã lưu');
        if (blockMsg) {
          sendResponse({ success: false, error: blockMsg });
          return;
        }
        const newTab = await new Promise((resolve, reject) => {
          chrome.tabs.create({ url: 'about:blank', active: true }, (tab) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(tab);
          });
        });
        await applyTabSessionRule(newTab.id, profile);
        // StudioRelay 1.7: chỉ setCookies, không clear jar (tránh đá nick đang mở).
        await setDolaCookies(profile.cookies);
        await new Promise((resolve, reject) => {
          chrome.tabs.update(newTab.id, { url: 'https://www.dola.com/chat' }, (tab) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(tab);
          });
        });
        sendResponse({ success: true, tabId: newTab.id, profileName, cookieCount: profile.cookies.length });
      } catch (err) {
        console.warn('[Seedance Background] Failed to open isolated account tab:', err);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  if (request.action === 'clear_all_accounts') {
    chrome.storage.local.remove(['multi_profiles', 'bulk_account_queue', 'bulk_account_tab_usage'], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'delete_account_profile') {
    const name = request.profileName;
    chrome.storage.local.get(['multi_profiles'], (res) => {
      const profiles = res?.multi_profiles || {};
      delete profiles[name];
      chrome.storage.local.set({ multi_profiles: profiles }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (request.action === 'studioRelayPendingGalleryDrag') {
    broadcastPendingGalleryDrag(request.pending);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'studioRelayGetDraggedImagePayload') {
    getStudioRelayImagePayload(request.imageId)
      .then((image) => sendResponse({ success: true, image }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'studioRelayManualImageAttached') {
    markStudioRelayImageAttached(request.image || {})
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'studioRelayManualImageFailed') {
    markStudioRelayImageFailed(request.image || {})
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'apply_create_video_settings') {
    const targetTabId = request.tabId || (sender && sender.tab && sender.tab.id);
    if (!targetTabId) {
      sendResponse({ success: false, error: 'missing tab' });
      return true;
    }
    const durNum = Number(String(request.duration || '15').replace(/[^0-9]/g, '')) || 15;
    setPendingVideoParams(targetTabId, {
      duration: durNum,
      ratio: request.aspectRatio || '16:9',
      model: 'seedance_v2.0'
    });
    applyDolaCreateVideoSettings(targetTabId, request.duration || '15s', request.aspectRatio || '16:9')
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'set_pending_video_params') {
    const targetTabId = request.tabId || (sender && sender.tab && sender.tab.id);
    if (!targetTabId) {
      sendResponse({ success: false, error: 'missing tab' });
      return true;
    }
    setPendingVideoParams(targetTabId, {
      duration: Number(String(request.duration || '15').replace(/[^0-9]/g, '')) || 15,
      ratio: request.aspectRatio || request.ratio || '16:9',
      model: request.model || 'seedance_v2.0'
    });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'dispatch_trusted_click') {
    const targetTabId = request.tabId || (sender && sender.tab && sender.tab.id);
    const x = Number(request.x);
    const y = Number(request.y);
    if (!targetTabId || !Number.isFinite(x) || !Number.isFinite(y)) {
      sendResponse({ success: false, error: 'missing tab or coordinates' });
      return true;
    }
    ensureAttached(targetTabId).then(() => {
      return sendCommand(targetTabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1
      });
    }).then(() => {
      return sendCommand(targetTabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1
      });
    }).then(() => {
      sendResponse({ success: true });
    }).catch((err) => {
      console.warn('[DolaDebugger] Trusted click failed:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

    if (request.action === 'dispatch_trusted_enter') {
    const targetTabId = request.tabId || (sender && sender.tab && sender.tab.id);
    if (targetTabId) {
      ensureAttached(targetTabId).then(() => {
        return sendCommand(targetTabId, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          windowsVirtualKeyCode: 13,
          code: 'Enter',
          key: 'Enter',
          text: '\r',
          unmodifiedText: '\r'
        });
      }).then(() => {
        return sendCommand(targetTabId, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          windowsVirtualKeyCode: 13,
          code: 'Enter',
          key: 'Enter'
        });
      }).then(() => {
        console.log('[DolaDebugger] Dispatched hardware Enter to tab', targetTabId);
        sendResponse({ success: true });
      }).catch((err) => {
        console.warn('[DolaDebugger] Enter dispatch failed:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  }

  if (request.action === 'DAILY_LIMIT_EXCEEDED') {
    const today = new Date().toDateString();
    chrome.storage.local.set({ sr_daily_limit_date: today, sr_daily_limit_exceeded: true });
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId) {
      setBadge(tabId, "LIMIT");
    }
    console.log('[Seedance Background] DAILY_LIMIT_EXCEEDED reported from tab:', tabId);
    sendResponse({ received: true });
    return true;
  }

  if (request.action === 'NOTIFY_HUMAN_ARTIFACT') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId) {
      setBadge(tabId, "VID");
      setTimeout(() => setBadge(tabId, "ON"), 4000);
    }
    console.log('[Seedance Background] Human Artifact reported from tab:', tabId);
    sendResponse({ received: true });
    return true;
  }

  if (request.action === 'get_dola_tabs') {
    chrome.tabs.query({ url: ['*://*.dola.com/*', '*://dola.com/*'] }, (tabs) => {
      sendResponse({ tabs: tabs || [] });
    });
    return true;
  }

  if (request.action === 'paste_all_tabs_sequentially') {
    chrome.storage.local.get(['ctb_saved_prompts', 'zdola_saved_prompts'], (res) => {
      const prompts = res?.ctb_saved_prompts || res?.zdola_saved_prompts || [];
      const uncompleted = prompts.filter(p => !p.done);

      if (uncompleted.length === 0) {
        sendResponse({ success: false, reason: 'Tất cả phân cảnh đã hoàn thành!' });
        return;
      }

      chrome.tabs.query({ url: ['*://*.dola.com/*', '*://dola.com/*'] }, (tabs) => {
        if (!tabs || tabs.length === 0) {
          sendResponse({ success: false, reason: 'Không tìm thấy tab Dola nào đang mở!' });
          return;
        }

        let promptIdx = 0;
        let distributedCount = 0;

        tabs.forEach((tab, index) => {
          if (promptIdx >= uncompleted.length) return;
          const currentPrompt = uncompleted[promptIdx];
          
          chrome.tabs.sendMessage(tab.id, {
            action: 'paste_specific_prompt',
            text: currentPrompt.text,
            promptNumber: promptIdx + 1,
            autoSubmit: true,
            tabIndex: index + 1,
            totalTabs: tabs.length
          }, () => {
            if (chrome.runtime.lastError) {
              if (chrome.scripting && chrome.scripting.executeScript) {
                chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: (t) => {
                    const el = document.querySelector('textarea, div[contenteditable=true], input[type=text]');
                    if (el) {
                      el.focus();
                      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                      if (setter) setter.call(el, t); else el.value = t;
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                      setTimeout(() => {
                        const btn = document.querySelector('button[type=submit], button[aria-label*=Send i], .send-button');
                        if (btn) btn.click();
                      }, 350);
                    }
                  },
                  args: [currentPrompt.text]
                }).catch(() => {});
              }
            }
          });

          currentPrompt.done = true;
          promptIdx++;
          distributedCount++;
        });

        chrome.storage.local.set({ ctb_saved_prompts: prompts, zdola_saved_prompts: prompts });
        sendResponse({ success: true, tabCount: distributedCount, totalTabs: tabs.length });
      });
    });
    return true;
  }
});

const STUDIO_IMAGE_DB = 'studio-relay-image-queue';
const STUDIO_IMAGE_STORE = 'images';

function openStudioImageDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STUDIO_IMAGE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STUDIO_IMAGE_STORE)) {
        db.createObjectStore(STUDIO_IMAGE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Khong mo duoc thu vien anh'));
  });
}

function getAllStudioImages() {
  return openStudioImageDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STUDIO_IMAGE_STORE, 'readonly');
    const req = tx.objectStore(STUDIO_IMAGE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('Khong doc duoc thu vien anh'));
  }));
}

function putStudioImage(record) {
  return openStudioImageDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STUDIO_IMAGE_STORE, 'readwrite');
    tx.objectStore(STUDIO_IMAGE_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Khong luu duoc anh'));
  }));
}

function blobToDataUrlBg(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Khong doc duoc file anh'));
    reader.readAsDataURL(blob);
  });
}

async function getStudioRelayImagePayload(imageId) {
  const records = await getAllStudioImages();
  const record = records.find((item) => String(item.id) === String(imageId || ''));
  if (!record || !(record.blob instanceof Blob)) {
    throw new Error('Anh keo tha khong con trong thu vien.');
  }
  return {
    name: record.name,
    type: record.type || record.blob.type || 'image/png',
    size: record.size,
    lastModified: record.lastModified,
    dataUrl: await blobToDataUrlBg(record.blob)
  };
}

async function markStudioRelayImageAttached(details) {
  const recordId = String(details.id || '');
  if (!recordId) return;
  const records = await getAllStudioImages();
  const record = records.find((item) => String(item.id) === recordId);
  if (!record) return;
  record.status = 'done';
  record.error = '';
  record.uploadedAt = Date.now();
  record.attachmentVerifiedAt = Date.now();
  record.attachmentEvidence = String(details.method || 'drop');
  await putStudioImage(record);
  await publishStudioImageSummary({
    id: recordId,
    name: String(record.name || details.name || 'Image'),
    status: 'done',
    evidence: record.attachmentEvidence
  });
}

async function markStudioRelayImageFailed(details) {
  const recordId = String(details.id || '');
  if (!recordId) return;
  const records = await getAllStudioImages();
  const record = records.find((item) => String(item.id) === recordId);
  if (!record) return;
  record.status = 'queued';
  record.error = String(details.error || 'Dola khong nhan anh.');
  record.uploadedAt = null;
  record.attachmentVerifiedAt = null;
  record.attachmentEvidence = '';
  await putStudioImage(record);
  await publishStudioImageSummary({
    id: recordId,
    name: String(record.name || details.name || 'Image'),
    status: 'error',
    error: record.error
  });
}

function broadcastPendingGalleryDrag(pending) {
  chrome.tabs.query({
    url: ['*://*.dola.com/*', '*://dola.com/*', '*://*.doubao.com/*']
  }, (tabs) => {
    (tabs || []).forEach((tab) => {
      if (!tab.id) return;
      chrome.tabs.sendMessage(tab.id, {
        action: 'studioRelayPendingGalleryDrag',
        pending: pending || null
      }, () => {
        try { void chrome.runtime.lastError; } catch {}
      });
    });
  });
}

async function publishStudioImageSummary(manualDrop) {
  const records = await getAllStudioImages();
  await chrome.storage.local.set({
    studio_relay_image_overlay_summary: {
      source: 'background',
      updatedAt: Date.now(),
      queued: records.filter((item) => item.status !== 'done').length,
      done: records.filter((item) => item.status === 'done').length,
      total: records.length,
      manualDrop: manualDrop || null
    }
  });
}
