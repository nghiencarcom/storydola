"""Video worker: in-page fetch submission and /im/chain/single polling."""
import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

import aiohttp
import cv2
from patchright.async_api import async_playwright

import config
from browser import cookie_value, has_dola_session, launch_account_context
from dola_client import CREDIT_FAIL_PATTERN, CreditError
from video_probe import SUBMIT_JS

# Poll /im/chain/single for video status.  Dola's creation response exposes a
# signed ``fallback_api`` in ``video_model``.  Asking that endpoint for
# ``channel=no`` + ``logo_type=unwatermarked`` returns the original H.264
# resource, but its ``main_url`` is a qAAB/AES token.  Resolve that token in
# the authenticated page so the worker never has to copy browser cookies into
# a second HTTP client.
POLL_JS = r"""
async ({conversationId, msToken, fp}) => {
  const params = new URLSearchParams({
    version_code: "20800", language: "ja", device_platform: "web",
    doubao_device_platform: "web", aid: "495671", real_aid: "495671",
    pkg_type: "release_version", pc_version: "3.32.61", doubao_pc_version: "3.32.61",
    region: "JP", sys_region: "JP", samantha_web: "1", web_platform: "browser",
    "use-olympus-account": "1", web_tab_id: crypto.randomUUID(),
  });

  const resp = await fetch("/im/chain/single?" + params.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json; encoding=utf-8",
      "agw-js-conv": "str",
      "Accept": "*/*",
    },
    body: JSON.stringify({
      cmd: 3100,
      uplink_body: {
        pull_singe_chain_uplink_body: {
          conversation_id: conversationId,
          anchor_index: Number.MAX_SAFE_INTEGER,
          conversation_type: 3,
          direction: 1,
          limit: 20,
          ext: {},
          filter: {index_list: []},
          evaluate_ab_params: "",
          evaluate_common_params: "",
        },
      },
      sequence_id: crypto.randomUUID(),
      channel: 2,
      version: "1",
    }),
    credentials: "include",
  });
  const collectProviderErrors = (root) => {
    const found = [];
    const seen = new Set();
    const add = (value) => {
      const text = String(value || "").trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        found.push(text.slice(0, 400));
      }
    };
    const visit = (value, depth = 0) => {
      if (!value || depth > 7) return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      if (typeof value === "string") {
        if (/710022002|710022004|rate[\s_-]*limit|too many requests|high demand|try again later|captcha|risk[\s_-]*control|shark_admin|daily.{0,30}(?:limit|quota)/i.test(value)) {
          add(value);
        }
        return;
      }
      if (typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        const normalized = key.toLowerCase();
        if (/^(?:error_code|err_code|status_code|code)$/.test(normalized) &&
            ["710022002", "710022004"].includes(String(child))) {
          add(`${key}: ${child}`);
        } else if (/^(?:error|errors|error_msg|error_message|message|msg|detail)$/.test(normalized) &&
            typeof child === "string" &&
            /710022002|710022004|rate[\s_-]*limit|too many requests|high demand|try again later|captcha|risk[\s_-]*control|shark_admin|daily.{0,30}(?:limit|quota)/i.test(child)) {
          add(child);
        }
        if (["data", "downlink_body", "pull_singe_chain_downlink_body", "result", "error", "errors"].includes(normalized)) {
          visit(child, depth + 1);
        }
      }
    };
    visit(root);
    return found;
  };
  if (!resp.ok) {
    let body = "";
    try { body = await resp.text(); } catch (e) {}
    let parsed = body;
    try { parsed = JSON.parse(body); } catch (e) {}
    const providerErrors = collectProviderErrors(parsed);
    if (resp.status === 429) providerErrors.unshift("HTTP 429 rate limit");
    return {ok: false, status: resp.status, providerErrors, texts: [], videos: [], videoModels: [], videoSources: []};
  }

  let body = "";
  let data = null;
  try {
    body = await resp.text();
    data = JSON.parse(body);
  } catch (e) {
    return {
      ok: false,
      status: resp.status,
      providerErrors: collectProviderErrors(body),
      texts: [],
      videos: [],
      videoModels: [],
      videoSources: [],
    };
  }
  const providerErrors = collectProviderErrors(data);
  if (!data || typeof data !== "object") {
    return {ok: false, status: resp.status, providerErrors, texts: [], videos: [], videoModels: [], videoSources: []};
  }
  const envelopes = [data, data.data, data.result].filter(
    value => value && typeof value === "object"
  );
  const messageLists = [];
  for (const envelope of envelopes) {
    messageLists.push(
      envelope.messages,
      envelope.message_list,
      (((envelope.downlink_body || {}).pull_singe_chain_downlink_body) || {}).messages,
      (((envelope.data || {}).downlink_body || {}).pull_singe_chain_downlink_body || {}).messages,
    );
  }
  // Dola has moved the message list between several wrapper levels. Keep the
  // known paths above, then find message arrays recursively so a new wrapper
  // does not turn an already-generated video into an endless "Generating" poll.
  const collectNestedMessageLists = (root, depth = 0, seen = new Set()) => {
    if (!root || depth > 12 || typeof root !== "object" || seen.has(root)) return;
    seen.add(root);
    if (Array.isArray(root)) {
      for (const item of root) collectNestedMessageLists(item, depth + 1, seen);
      return;
    }
    for (const [key, child] of Object.entries(root)) {
      const normalized = key.toLowerCase();
      if (Array.isArray(child) && /^(?:messages?|message_list(?:_v\d+)?|msg_list|chain_messages|conversation_messages)$/.test(normalized)) {
        messageLists.push(child);
      }
      collectNestedMessageLists(child, depth + 1, seen);
    }
  };
  collectNestedMessageLists(data);
  // Process all discovered lists. The same message can appear in more than
  // one wrapper; URLs and text are de-duplicated below.
  const uniqueMessageLists = [...new Set(messageLists.filter(Array.isArray))];
  const messages = uniqueMessageLists.flat();
  const assistantRoleNames = new Set([
    "assistant", "assistant_message", "bot", "bot_message", "ai", "model",
  ]);
  const userRoleNames = new Set([
    "user", "user_message", "human", "human_message",
  ]);
  const messageRole = (msg) => {
    const author = msg.author || {};
    const userType = msg.user_type ?? msg.userType;
    const nestedUserTypes = userType && typeof userType === "object"
      ? [userType.role, userType.name, userType.type, userType.user_type, userType.value]
      : [userType];
    const candidates = [
      msg.role, msg.author_role, msg.sender_type, msg.sender_role,
      msg.author_type, msg.role_name, msg.message_type, msg.sender,
      author.role, author.type, ...nestedUserTypes,
    ].filter(value => typeof value === "string")
      .map(value => value.trim().toLowerCase().replace(/[\s-]+/g, "_"));
    if (candidates.some(value => userRoleNames.has(value))) return "user";
    if (candidates.some(value => assistantRoleNames.has(value))) return "assistant";
    // Current Dola chain messages use user_type=1 for user and 2 for assistant.
    const numericUserType = Number(userType);
    if (numericUserType === 1) return "user";
    if (numericUserType === 2) return "assistant";
    return "";
  };
  const decodeContent = (value) => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch (e) { return value; }
  };
  const extractText = (value) => {
    const output = [];
    const seen = new Set();
    const add = (text) => {
      const normalized = String(text || "").trim();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        output.push(normalized);
      }
    };
    const visit = (node, depth = 0) => {
      if (node == null || depth > 8) return;
      if (typeof node === "string") {
        const normalized = node.trim();
        if (!normalized) return;
        if (normalized.startsWith("{") || normalized.startsWith("[")) {
          try {
            const parsed = JSON.parse(normalized);
            if (parsed && typeof parsed === "object") {
              visit(parsed, depth + 1);
              return;
            }
          } catch (e) { /* Keep non-JSON provider text as-is. */ }
        }
        add(normalized);
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1);
        return;
      }
      if (typeof node !== "object") return;
      const textBlock = node.text_block;
      if (typeof textBlock?.text === "string") add(textBlock.text);
      if (typeof node.text === "string") add(node.text);
      for (const key of ["content", "content_block", "patch_value", "patch_op", "blocks"]) {
        if (node[key] !== undefined) visit(node[key], depth + 1);
      }
    };
    visit(decodeContent(value));
    return output;
  };
  const texts = [];
  const videos = [];
  const videoModels = [];
  const videoSources = [];
  let assistantMessageCount = 0;
  let videoCandidateCount = 0;
  const messageKeyNames = new Set();
  const messageRoleKinds = new Set();
  const schemaKinds = new Set();
  const seenVideoUrls = new Set();
  const collectVideoCandidates = (root) => {
    const candidates = [];
    const seenNodes = new Set();
    const addCandidate = (video, owner = {}) => {
      if (!video || typeof video !== "object") return;
      const urlFields = [
        video.download_url, video.downloadUrl, video.video_download_url,
        video.video_url, video.play_url, video.url, video.file_url,
        video.resource_url, video.origin_download_url, video.origin_url,
        video.main_url,
      ];
      for (const [key, value] of Object.entries(video)) {
        if (/(?:url|src|link|uri|download|play)/i.test(key)
            && !/(?:poster|cover|thumb|thumbnail|image)/i.test(key)) {
          if (typeof value === "string") urlFields.push(value);
          else if (Array.isArray(value)) {
            for (const item of value) {
              if (typeof item === "string") urlFields.push(item);
              else if (item && typeof item === "object") {
                for (const [nestedKey, nestedValue] of Object.entries(item)) {
                  if (/(?:url|src|link|uri|download|play)/i.test(nestedKey)
                      && typeof nestedValue === "string") urlFields.push(nestedValue);
                }
              }
            }
          }
        }
      }
      const fallbackUrl = urlFields.find(value =>
        typeof value === "string" && /^https?:\/\//i.test(value.trim())
      )?.trim() || "";
      if (!fallbackUrl || seenVideoUrls.has(fallbackUrl)) return;
      seenVideoUrls.add(fallbackUrl);
      candidates.push({
        fallbackUrl,
        videoModel: video.video_model || video.videoModel || owner.video_model || owner.videoModel || "",
        vid: video.vid || owner.video_id || owner.vid || owner.id || "",
      });
    };
    const visit = (node, path = "", depth = 0, insideUserMessage = false, insideVideoContext = false) => {
      if (node == null || depth > 14) return;
      if (typeof node === "string") {
        const decoded = decodeContent(node);
        if (decoded !== node) visit(decoded, path, depth + 1, insideUserMessage, insideVideoContext);
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) visit(item, path, depth + 1, insideUserMessage, insideVideoContext);
        return;
      }
      if (typeof node !== "object" || seenNodes.has(node)) return;
      const isUserMessage = insideUserMessage || messageRole(node) === "user";
      if (isUserMessage) return;
      seenNodes.add(node);
      for (const key of ["user_type", "content_type", "message_type", "msg_type", "block_type", "type", "media_type"]) {
        const value = node[key];
        if (["string", "number", "boolean"].includes(typeof value)) {
          schemaKinds.add(`${key}:${typeof value}:${String(value).slice(0, 24)}`);
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
          schemaKinds.add(`${key}:object:${Object.keys(value).slice(0, 10).join(".")}`);
          if (["user_type", "role", "sender_type"].includes(key)) {
            for (const nestedKey of ["type", "name", "role", "user_type", "value"]) {
              const nestedValue = value[nestedKey];
              if (["string", "number", "boolean"].includes(typeof nestedValue)) {
                schemaKinds.add(`${key}.${nestedKey}:${typeof nestedValue}:${String(nestedValue).slice(0, 24)}`);
              }
            }
          }
        }
      }
      for (const key of Object.keys(node)) {
        if (/(?:creation|video|media|download|file|resource|play|url|src|link|uri|asset)/i.test(key)
            && schemaKinds.size < 80) schemaKinds.add(`key:${key}`);
      }
      const type = String(node.type ?? node.content_type ?? node.block_type ?? node.media_type ?? node.mediaType ?? "")
        .trim().toLowerCase();
      const videoContext = insideVideoContext
        || /(?:creation_block|creations|video|video_info|media)/i.test(path)
        || type === "2"
        || type === "2074"
        || /^(?:mp4|m4v|mov|webm|m3u8)$/i.test(type)
        || type.includes("video")
        || String(node.mime_type || node.mimeType || "").toLowerCase().startsWith("video/")
        || Boolean(node.video_model || node.videoModel || node.vid || node.video_id);
      if (node.video && typeof node.video === "object") addCandidate(node.video, node);
      if (videoContext) addCandidate(node, node);
      for (const [key, child] of Object.entries(node)) {
        visit(child, path ? `${path}.${key}` : key, depth + 1, isUserMessage, videoContext);
      }
    };
    visit(root);
    return candidates;
  };
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = messageRole(msg);
    for (const key of Object.keys(msg)) {
      if (messageKeyNames.size < 24) messageKeyNames.add(key);
    }
    for (const key of [
      "role", "author_role", "sender_type", "sender_role", "author_type",
      "role_name", "message_type", "sender", "user_type",
    ]) {
      const value = msg[key];
      if (["string", "number", "boolean"].includes(typeof value)) {
        messageRoleKinds.add(`${typeof value}:${String(value).slice(0, 24)}`);
      }
    }
    // Dola has returned the same assistant reply under different fields across
    // chat and poll responses. Read every supported content field so an empty
    // wrapper field cannot mask the populated one.
    const contentRoots = [msg.content, msg.content_block, msg.blocks, msg.text]
      .filter(value => value !== undefined && value !== null)
      .map(decodeContent);
    const content = contentRoots.find(value => Array.isArray(value))
      || contentRoots[0]
      || null;
    const messageText = [...new Set(contentRoots.flatMap(extractText))];
    if (role === "assistant") assistantMessageCount += 1;
    if (role === "assistant" && messageText.length) {
      const finalValue = msg.is_final ?? msg.is_complete ?? msg.isFinal;
      const finalText = String(finalValue ?? "").trim().toLowerCase();
      const isFinal = finalValue == null
        ? null
        : !(finalValue === false || finalValue === 0 || ["0", "false", "no"].includes(finalText));
      texts.push({
        text: messageText.join("\n"),
        role,
        status: msg.status ?? msg.message_status ?? msg.state ?? "",
        isFinal,
      });
    }
    // User messages can contain reference media. Only inspect assistant and
    // unlabelled message records, and recursively support Dola's nested or
    // encoded creation-block variants instead of depending on block_type=2074.
    if (role !== "user") {
      const candidates = collectVideoCandidates(msg);
      videoCandidateCount += candidates.length;
      for (const candidate of candidates) {
        const resolved = await resolveOriginalVideoUrl(
          candidate.videoModel, candidate.fallbackUrl
        );
        const url = resolved.url || candidate.fallbackUrl;
        if (videos.includes(url)) continue;
        videos.push(url);
        videoModels.push(candidate.videoModel);
        videoSources.push({
          url,
          fallbackUrl: candidate.fallbackUrl,
          vid: candidate.vid,
          source: resolved.source,
          watermarkFree: Boolean(resolved.watermarkFree),
        });
      }
    }
  }
  // A few Dola responses place the completed creation beside the message list
  // instead of inside a message. Scan the response tree for output-shaped
  // video records while explicitly excluding user-authored message branches.
  const responseCandidates = collectVideoCandidates(data);
  videoCandidateCount += responseCandidates.length;
  for (const candidate of responseCandidates) {
    const resolved = await resolveOriginalVideoUrl(
      candidate.videoModel, candidate.fallbackUrl
    );
    const url = resolved.url || candidate.fallbackUrl;
    if (videos.includes(url)) continue;
    videos.push(url);
    videoModels.push(candidate.videoModel);
    videoSources.push({
      url,
      fallbackUrl: candidate.fallbackUrl,
      vid: candidate.vid,
      source: resolved.source,
      watermarkFree: Boolean(resolved.watermarkFree),
    });
  }
  return {
    ok: true, status: resp.status, providerErrors, texts, videos, videoModels, videoSources,
    diagnostics: {
      messageListCount: uniqueMessageLists.length,
      messageCount: messages.length,
      assistantMessageCount,
      videoCandidateCount,
      messageKeyNames: [...messageKeyNames],
      messageRoleKinds: [...messageRoleKinds],
      schemaKinds: [...schemaKinds].slice(0, 40),
    },
  };

  async function resolveOriginalVideoUrl(videoModelText, fallbackUrl) {
    const model = parseJsonObject(videoModelText);
    const fallbackApi = typeof model?.fallback_api === "string" ? model.fallback_api : "";
    if (!fallbackApi) {
      return {url: fallbackUrl, source: "download_url", watermarkFree: false};
    }

    try {
      const endpoint = new URL(fallbackApi, location.href);
      endpoint.searchParams.set("channel", "no");
      endpoint.searchParams.set("codec_type", "8");
      endpoint.searchParams.set("logo_type", "unwatermarked");
      const originalResponse = await fetch(endpoint.toString(), {
        method: "GET",
        credentials: "omit",
        headers: {"accept": "application/json,text/plain,*/*"},
      });
      if (!originalResponse.ok) {
        return {url: fallbackUrl, source: "download_url", watermarkFree: false};
      }
      const payload = await originalResponse.json();
      const data = extractVideoData(payload);
      const keySeed = data.key_seed || model.key_seed || endpoint.searchParams.get("key_seed") || "";

      const directCandidates = [
        data.original_media_info?.main_url,
        payload?.data?.original_media_info?.main_url,
        payload?.original_media_info?.main_url,
        data.unwatermarked_url,
        data.no_watermark_url,
        data.origin_url,
        data.origin_download_url,
      ];
      for (const token of directCandidates) {
        const url = await decodeMainUrl(token, keySeed);
        if (/^https?:\/\//i.test(url)) {
          return {url, source: "fallback_api_unwatermarked", watermarkFree: true};
        }
      }

      const videoList = data.video_list;
      const entries = videoList && typeof videoList === "object"
        ? (Array.isArray(videoList) ? videoList : Object.values(videoList))
        : [data];
      entries.sort((left, right) => videoEntryScore(right) - videoEntryScore(left));
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        for (const token of [entry.main_url, entry.play_url, entry.url, entry.download_url]) {
          const url = await decodeMainUrl(token, keySeed);
          if (/^https?:\/\//i.test(url)) {
            return {url, source: "fallback_api_unwatermarked", watermarkFree: true};
          }
        }
      }
    } catch (error) {
      // A signed fallback API can expire while a conversation is being
      // resumed. Keep the normal download URL as a safe last resort.
    }
    return {url: fallbackUrl, source: "download_url", watermarkFree: false};
  }

  function parseJsonObject(value) {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function extractVideoData(payload) {
    const videoInfo = payload?.video_info || payload?.data?.video_info || payload;
    const data = videoInfo?.data || videoInfo;
    return data && typeof data === "object" ? data : {};
  }

  function videoEntryScore(entry) {
    const quality = String(entry?.quality || entry?.definition || "").toLowerCase();
    const codec = String(entry?.codec_type || "").toLowerCase();
    return (quality === "original" ? 1e12 : 0)
      + (codec === "h264" ? 1e9 : 0)
      + Number(entry?.bitrate || entry?.real_bitrate || 0)
      + Number(entry?.vwidth || entry?.width || 0) * Number(entry?.vheight || entry?.height || 0);
  }

  async function decodeMainUrl(token, keySeed) {
    if (typeof token !== "string" || !token.trim()) return "";
    const value = token.trim();
    if (/^https?:\/\//i.test(value)) return value;
    const plainUrl = tryDecodeBase64Url(value);
    if (plainUrl) return plainUrl;
    if (value.startsWith("qAAB") && keySeed) {
      return await decodeQaabToken(value, keySeed);
    }
    return "";
  }

  function tryDecodeBase64Url(value) {
    const bytes = base64DecodeLoose(value);
    if (!bytes) return "";
    const text = asciiUrlFromBytes(bytes);
    return /^https?:\/\//i.test(text) ? text : "";
  }

  function base64DecodeLoose(value) {
    const input = String(value || "").trim();
    const variants = [
      input,
      input.replace(/[$@#]/g, (char) => ({"$": "_", "@": "/", "#": "."}[char])),
      input.replace(/[$@#]/g, (char) => ({"$": "+", "@": "/", "#": "="}[char])),
    ];
    const seen = new Set();
    for (const candidate of variants) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      try {
        const normalized = candidate.padEnd(Math.ceil(candidate.length / 4) * 4, "=")
          .replace(/-/g, "+").replace(/_/g, "/");
        const binary = atob(normalized);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      } catch (error) {
        // Try the next alphabet variant.
      }
    }
    return null;
  }

  function asciiUrlFromBytes(bytes) {
    if (!bytes || !bytes.length) return "";
    for (const byte of bytes) {
      if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) return "";
    }
    return new TextDecoder().decode(bytes);
  }

  async function decodeQaabToken(token, keySeed) {
    const data = base64DecodeLoose(token);
    const seed = base64DecodeLoose(keySeed);
    if (!data || !seed) return "";
    const salt = hexToBytes(
      "4dd4c2e6b83162090e52b3c7a6733ba4"
        + "1cb2462b829ab58a196b39db57177524"
        + "f49baf7f08e8d68d26a72e37c1a95a2f"
        + "1f05a51892aef2949732b62a38aadd58"
    );
    const digest1 = new Uint8Array(await crypto.subtle.digest("SHA-512", seed.slice(0, 32)));
    const digest2 = new Uint8Array(await crypto.subtle.digest("SHA-512", concatBytes(digest1, salt)));
    const key = digest2.slice(0, 16);
    const iv = digest2.slice(16, 32);
    const attempts = [];
    if (data.length >= 4 && data[0] === 0xa8 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00) {
      attempts.push({payload: data.slice(4), key, iv});
      attempts.push({payload: data.slice(4), key: iv, iv: key});
      if (data.length > 36) {
        attempts.push({payload: data.slice(36), key, iv: data.slice(20, 36)});
        attempts.push({payload: data.slice(36), key, iv});
      }
    } else {
      attempts.push({payload: data, key, iv});
    }
    for (const attempt of attempts) {
      const url = await decryptAesCbcUrl(attempt.payload, attempt.key, attempt.iv);
      if (/^https?:\/\//i.test(url)) return url;
    }
    return "";
  }

  async function decryptAesCbcUrl(payload, keyBytes, ivBytes) {
    if (!payload.length || payload.length % 16 !== 0) return "";
    try {
      const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["decrypt"]);
      const plain = new Uint8Array(await crypto.subtle.decrypt(
        {name: "AES-CBC", iv: ivBytes}, key, payload
      ));
      return asciiUrlFromBytes(plain) || asciiUrlFromBytes(stripPkcs7(plain));
    } catch (error) {
      return "";
    }
  }

  function stripPkcs7(bytes) {
    if (!bytes || !bytes.length) return new Uint8Array();
    const padding = bytes[bytes.length - 1];
    if (padding < 1 || padding > 16 || padding > bytes.length) return bytes;
    for (let index = bytes.length - padding; index < bytes.length; index += 1) {
      if (bytes[index] !== padding) return bytes;
    }
    return bytes.slice(0, bytes.length - padding);
  }

  function hexToBytes(value) {
    const bytes = new Uint8Array(value.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }

  function concatBytes(first, second) {
    const bytes = new Uint8Array(first.length + second.length);
    bytes.set(first, 0);
    bytes.set(second, first.length);
    return bytes;
  }
}
"""


def provider_response_texts(poll, *, include_in_progress: bool = False) -> list[str]:
    """Return attributable assistant text, omitting known in-progress messages.

    `/im/chain/single` includes the submitted user prompt as well as provider
    messages. Treating every text block as a Dola response can mistake words
    in a prompt (for example, a story mentioning a daily limit) for a quota
    rejection and disable the profile. Unknown/legacy string-only entries are
    deliberately ignored because their author cannot be verified.
    """
    if not isinstance(poll, dict):
        return []
    entries = poll.get("texts")
    if not isinstance(entries, list):
        return []

    assistant_roles = {"assistant", "bot", "ai", "model"}
    in_progress_states = {
        "pending", "processing", "thinking", "streaming", "generating",
        "running", "in_progress", "in progress", "unfinished",
    }
    result = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        role = str(entry.get("role") or "").strip().lower()
        if role not in assistant_roles:
            continue
        if not include_in_progress:
            if entry.get("isFinal") is False or entry.get("is_complete") is False:
                continue
            status = str(entry.get("status") or "").strip().lower().replace("-", "_")
            if status in in_progress_states:
                continue
        text = str(entry.get("text") or "")
        if text:
            result.append(text)
    return result


def _decode_base64_url(value: str) -> str:
    """Decode a plain base64/URL-safe media token when it contains a URL."""
    if not isinstance(value, str) or not value.strip():
        return ""
    value = value.strip()
    if value.startswith(("http://", "https://")):
        return value
    variants = (
        value,
        value.replace("$", "_").replace("@", "/").replace("#", "."),
        value.replace("$", "+").replace("@", "/").replace("#", "="),
    )
    for candidate in variants:
        try:
            raw = base64.b64decode(candidate + "=" * (-len(candidate) % 4), validate=False)
            decoded = raw.decode("utf-8", "ignore").strip()
        except (ValueError, UnicodeError):
            continue
        if decoded.startswith(("http://", "https://")):
            return decoded
    return ""


def _explicit_original_urls(value):
    """Yield only fields explicitly labelled as an original/no-watermark URL."""
    if isinstance(value, dict):
        for key in (
            "original_url", "unwatermarked_url", "no_watermark_url",
            "origin_url", "origin_download_url",
        ):
            decoded = _decode_base64_url(value.get(key, ""))
            if decoded:
                yield decoded
        for key in ("original_media_info", "original_video", "origin_media_info"):
            yield from _explicit_original_urls(value.get(key))
        for child in value.values():
            if isinstance(child, (dict, list)):
                yield from _explicit_original_urls(child)
    elif isinstance(value, list):
        for child in value:
            yield from _explicit_original_urls(child)


def extract_unwatermarked_url(video_model_str: str, fallback_url: str) -> str:
    """Return an explicitly-labelled original URL, otherwise keep the fallback.

    ``video_model.video_list.main_url`` is commonly the watermarked download
    resource (its ``gear_des_key`` contains ``video_gen_watermark_dyn``), so it
    must not be treated as watermark-free merely because it is base64 encoded.
    The normal polling path resolves Dola's unwatermarked fallback API in-page;
    this helper remains a conservative compatibility fallback for older data.
    """
    try:
        model = json.loads(video_model_str or "{}") if isinstance(video_model_str, str) else video_model_str
        if isinstance(model, dict):
            for url in _explicit_original_urls(model):
                return url
    except (TypeError, json.JSONDecodeError):
        pass
    return fallback_url


class RiskControlError(Exception):
    """Risk control triggered (slide / rate limit)."""


class RateLimitError(RiskControlError):
    """Dola explicitly rate-limited a profile before accepting a conversation."""


class PostSubmitRateLimitError(RateLimitError):
    """Dola rate-limited an already accepted conversation; another profile may retry."""


class VideoDownloadError(RuntimeError):
    """Dola returned a video, but both available media URLs failed to download."""


RATE_LIMIT_PATTERN = re.compile(
    r"710022002|\brate[\s_-]*limit(?:ed|ing)?\b|\btoo many requests\b|"
    r"请求频率过高|请求过于频繁|频率限制|速度限制|"
    r"giới hạn tần suất|tần suất.{0,30}giới hạn",
    re.IGNORECASE,
)


def is_rate_limit_response(value) -> bool:
    """Recognize an explicit Dola rate-limit code or message."""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (dict, list, tuple)):
        raw = json.dumps(value, ensure_ascii=False)
    else:
        raw = str(value or "")
    return bool(RATE_LIMIT_PATTERN.search(raw))


class VideoValidationError(RuntimeError):
    """Downloaded video does not match the requested output contract."""


def validate_video_output(path: Path, expected_duration: int | None = None,
                          expected_ratio: str | None = None) -> dict:
    """Read MP4 metadata; warn on duration drift and fail on unusable output."""
    if not config.VALIDATE_VIDEO_OUTPUT:
        return {}
    path = Path(path)
    if not path.is_file() or path.stat().st_size <= 0:
        raise VideoValidationError(f"Video output is missing or empty: {path.name}")

    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise VideoValidationError(f"Video output cannot be opened: {path.name}")
        width = int(round(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0))
        height = int(round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0))
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
        frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    finally:
        capture.release()

    if width <= 0 or height <= 0 or fps <= 0 or frames <= 0:
        raise VideoValidationError(f"Video output has incomplete metadata: {path.name}")

    actual_duration = frames / fps
    metadata = {
        "duration": round(actual_duration, 3),
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "frames": int(round(frames)),
    }

    if expected_duration is not None:
        tolerance = max(
            config.VIDEO_DURATION_TOLERANCE_SEC,
            float(expected_duration) * 0.08,
        )
        if abs(actual_duration - int(expected_duration)) > tolerance:
            # Dola can return a playable first segment or another valid
            # provider output whose duration differs from the requested value.
            # Keep the downloaded file available for operator inspection and
            # report the mismatch as metadata instead of discarding a usable
            # result. Hard failures (missing, unreadable, or incomplete files)
            # above remain terminal validation errors.
            metadata.update({
                "duration_mismatch": True,
                "requested_duration": int(expected_duration),
                "duration_difference": round(actual_duration - int(expected_duration), 3),
                "duration_warning": (
                    f"Thời lượng file là {actual_duration:.2f}s, khác yêu cầu "
                    f"{int(expected_duration)}s. Đã tải video để người dùng tự kiểm tra."
                ),
            })

    if expected_ratio and ":" in str(expected_ratio):
        try:
            expected_width, expected_height = (
                float(value) for value in str(expected_ratio).split(":", 1)
            )
            expected = expected_width / expected_height
            actual = width / height
            if abs(actual - expected) > 0.035:
                raise VideoValidationError(
                    f"Video ratio mismatch: requested {expected_ratio}, "
                    f"received {width}:{height}"
                )
        except (TypeError, ValueError, ZeroDivisionError):
            # Unknown ratio strings are left to the provider rather than
            # turning a valid file into a false negative.
            pass
    return metadata


def _check_submit(result: dict) -> str:
    """Validates submission result and returns conversation_id."""
    status = result.get("status")
    if status != 200:
        raise RiskControlError(f"Submission failed HTTP {status}: {json.dumps(result.get('events', []), ensure_ascii=False)[:300]}")

    for err in result.get("errors", []):
        if "710022004" in err or "slide" in err or "shark" in err:
            raise RiskControlError(f"Captcha risk control triggered: {err[:300]}")
        if is_rate_limit_response(err):
            raise RateLimitError(f"Rate limited: {err[:300]}")
        raise Exception(f"Submission returned error event: {err[:300]}")

    conv_id = result.get("convId") or ""
    if not conv_id:
        raise Exception(
            "Video accepted but no conversation_id returned: "
            + json.dumps(result.get("events", []), ensure_ascii=False)[:300]
        )
    return conv_id


async def _download(url: str, account: str, proxy: dict | str | None = None) -> Path:
    """Downloads video to DOWNLOAD_DIR and returns local path."""
    dl_dir = Path(config.DOWNLOAD_DIR)
    dl_dir.mkdir(parents=True, exist_ok=True)
    # A batch can finish two jobs in the same second. Include a nonce so a
    # later download never overwrites the URL of an earlier completed task.
    fname = dl_dir / (
        f"{account}_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:10]}.mp4"
    )
    timeout = aiohttp.ClientTimeout(total=300)
    try:
        proxy_url = proxy.get("server") if isinstance(proxy, dict) else proxy
        proxy_auth = None
        if isinstance(proxy, dict) and proxy.get("username"):
            proxy_auth = aiohttp.BasicAuth(
                str(proxy.get("username")), str(proxy.get("password") or "")
            )
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(
                url, proxy=proxy_url or config.PROXY or None, proxy_auth=proxy_auth
            ) as resp:
                resp.raise_for_status()
                with open(fname, "wb") as f:
                    async for chunk in resp.content.iter_chunked(1 << 16):
                        f.write(chunk)
    except Exception:
        # A signed URL can expire halfway through a transfer. Do not leave a
        # partial file in the public downloads directory before the fallback
        # URL is attempted.
        try:
            fname.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return fname


def _watermark_cleanup_regions(width: int, height: int) -> list[tuple[int, int, int, int]]:
    """Return the known Dola dynamic-watermark regions for one frame size.

    Dola's regular download resource moves its ``Dola AI`` mark between the
    upper-right, left-middle and lower-right edges.  These small, scaled
    regions are used only for the fallback resource; the original resource is
    kept untouched so it retains its source quality.
    """
    width = max(1, int(width))
    height = max(1, int(height))
    region_specs = (
        # x, y, width, height as a fraction of the video frame
        (0.045, 0.465, 0.24, 0.09),   # left-middle
        (0.76, 0.015, 0.235, 0.085),  # upper-right
        (0.76, 0.90, 0.235, 0.095),   # lower-right
    )
    regions = []
    for x_ratio, y_ratio, w_ratio, h_ratio in region_specs:
        x = min(width - 1, max(0, round(width * x_ratio)))
        y = min(height - 1, max(0, round(height * y_ratio)))
        w = min(width - x, max(2, round(width * w_ratio)))
        h = min(height - y, max(2, round(height * h_ratio)))
        if w > 1 and h > 1:
            regions.append((x, y, w, h))
    return regions


def _video_dimensions(path: Path) -> tuple[int, int]:
    """Read frame dimensions without decoding the complete video."""
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise VideoValidationError(f"Video output cannot be opened: {path.name}")
        width = int(round(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0))
        height = int(round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0))
    finally:
        capture.release()
    if width <= 0 or height <= 0:
        raise VideoValidationError(f"Video output has incomplete dimensions: {path.name}")
    return width, height


def _remove_dola_watermark_sync(path: Path) -> Path:
    """Re-encode a fallback download with Dola's dynamic logo regions removed."""
    path = Path(path)
    if not config.WATERMARK_CLEANUP_ENABLED:
        raise VideoValidationError(
            "Dola returned only a watermarked URL and download-time cleanup is disabled"
        )
    if not path.is_file() or path.stat().st_size <= 0:
        raise VideoValidationError(f"Video output is missing or empty: {path.name}")

    ffmpeg = str(config.FFMPEG_BINARY or "ffmpeg").strip()
    if not os.path.isabs(ffmpeg):
        ffmpeg = shutil.which(ffmpeg) or ""
    if not ffmpeg or not Path(ffmpeg).is_file():
        raise VideoValidationError(
            "Không tìm thấy FFmpeg để xoá watermark trước khi tải video"
        )

    width, height = _video_dimensions(path)
    filters = ",".join(
        f"delogo=x={x}:y={y}:w={w}:h={h}:show=0"
        for x, y, w, h in _watermark_cleanup_regions(width, height)
    )
    if not filters:
        raise VideoValidationError("Không xác định được vùng watermark của video")

    # Keep the temporary file beside the source so os.replace is atomic on the
    # same filesystem.  A failed encode never replaces the downloadable file.
    temporary = path.with_name(
        f".{path.stem}.watermark-clean-{uuid.uuid4().hex[:10]}{path.suffix}"
    )
    command = [
        ffmpeg,
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(path),
        "-vf", filters,
        "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
        str(temporary),
    ]
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=config.WATERMARK_CLEANUP_TIMEOUT_SEC,
        )
        if completed.returncode != 0 or not temporary.is_file() or temporary.stat().st_size <= 0:
            detail = (completed.stderr or completed.stdout or "FFmpeg failed").strip()
            raise VideoValidationError(
                f"Không thể xoá watermark khi tải video: {detail[-300:]}"
            )
        # Check that the result is readable before replacing the source.
        _video_dimensions(temporary)
        os.replace(temporary, path)
        return path
    except subprocess.TimeoutExpired as exc:
        raise VideoValidationError(
            "Quá thời gian xoá watermark khi tải video"
        ) from exc
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


async def _remove_dola_watermark(path: Path) -> Path:
    """Run FFmpeg off the event loop so other account tasks keep polling."""
    return await asyncio.to_thread(_remove_dola_watermark_sync, Path(path))


async def _download_video_source(
    source: dict,
    account: str,
    proxy: dict | str | None = None,
) -> tuple[Path, str, bool, bool]:
    """Download a resolved source and clean the fallback URL when needed.

    The unwatermarked URL is signed and can expire independently of the chat
    response. A failed original download should not discard a completed job;
    retry the provider URL, clean it before exposing it, and return the
    ``watermark_removed`` flag for task metadata.
    """
    source = source if isinstance(source, dict) else {}
    primary = str(source.get("url") or "").strip()
    fallback = str(source.get("fallbackUrl") or source.get("fallback_url") or "").strip()
    if not primary:
        raise VideoDownloadError("Dola returned an empty video URL")
    watermark_flag = source.get("watermarkFree")
    if watermark_flag is None:
        watermark_flag = source.get("watermark_free")
    watermark_free = bool(watermark_flag)
    try:
        local = await _download(primary, account, proxy=proxy)
    except Exception as primary_error:
        if not fallback or fallback == primary:
            raise VideoDownloadError(
                f"Failed to download Dola video media: {str(primary_error)[:300]}"
            ) from primary_error
        print(
            f"[{account}] Original media URL failed ({str(primary_error)[:100]}), "
            "retrying provider download URL",
            flush=True,
        )
        try:
            local = await _download(fallback, account, proxy=proxy)
        except Exception as fallback_error:
            raise VideoDownloadError(
                "Failed to download Dola video media from both original and fallback URLs: "
                f"{str(fallback_error)[:240]}"
            ) from fallback_error
        primary = fallback
        watermark_free = False

    # A signed original URL is already the provider's no-watermark stream. A
    # regular/fallback URL is cleaned locally before the task is marked done,
    # so a browser download can never receive the known watermarked resource.
    if not watermark_free:
        try:
            local = await _remove_dola_watermark(local)
        except Exception:
            try:
                local.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        print(f"[{account}] Fallback video cleaned with FFmpeg before download", flush=True)
        return local, primary, True, True
    return local, primary, True, False


async def generate_video(account: str, prompt: str, ratio: str = "9:16",
                         duration: int = 5, timeout: int = None) -> dict:
    """Complete generation flow: submit -> poll -> download.

    Returns {"video_url": cdn_url, "local_path": local_file, "conversation_id": ...}
    Exceptions: RiskControlError, CreditError, TimeoutError, FileNotFoundError
    """
    timeout = min(
        config.VIDEO_HARD_MAX_WAIT_SEC,
        timeout or config.VIDEO_TIMEOUT,
    )
    async with async_playwright() as p:
        context = await launch_account_context(p, account)
        try:
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto("https://www.dola.com/chat", timeout=60000, wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)

            cookies = await context.cookies("https://www.dola.com")
            if not has_dola_session(cookies):
                raise CreditError(f"{account} session expired (no Dola session), please re-login {account}")
            ms_token = cookie_value(cookies, "msToken")
            fp = cookie_value(cookies, "s_v_web_id")

            print(f"[{account}] Submitting video generation: {prompt[:40]} | {ratio} | {duration}s", flush=True)
            # Evaluate with wait_for timeout
            result = await asyncio.wait_for(page.evaluate(
                SUBMIT_JS,
                {"prompt": prompt, "ratio": ratio, "duration": duration,
                 "msToken": ms_token, "fp": fp},
            ), timeout=180)
            conv_id = _check_submit(result)
            print(f"[{account}] Accepted conversation_id={conv_id}, polling for video...", flush=True)

            start = time.time()
            while time.time() - start < timeout:
                await asyncio.sleep(5)
                try:
                    poll = await asyncio.wait_for(page.evaluate(
                        POLL_JS,
                        {"conversationId": conv_id, "msToken": ms_token, "fp": fp},
                    ), timeout=30)
                except Exception as e:
                    if "target page, context or browser has been closed" in str(e).lower():
                        raise RuntimeError("Render Chromium đã đóng trong lúc chờ video") from e
                    print(f"[{account}] Polling exception (retrying): {e}", flush=True)
                    continue
                if not poll.get("ok"):
                    provider_error = " ".join(poll.get("providerErrors") or [])
                    if is_rate_limit_response(provider_error) or poll.get("status") == 429:
                        raise RateLimitError(
                            f"Dola rate-limited profile during poll: {provider_error or 'HTTP 429'}"
                        )
                    continue

                for text in provider_response_texts(poll):
                    if CREDIT_FAIL_PATTERN.search(text):
                        raise CreditError(f"Insufficient quota: {text[:80]}")

                videos = poll.get("videos", [])
                if videos:
                    sources = poll.get("videoSources", [])
                    source = sources[0] if sources and isinstance(sources[0], dict) else {
                        "url": videos[0],
                        "source": "download_url",
                        "watermarkFree": False,
                    }
                    url = str(source.get("url") or videos[0])
                    print(
                        f"[{account}] Video completed ({source.get('source', 'download_url')})",
                        flush=True,
                    )
                    local, used_url, watermark_free, watermark_removed = await _download_video_source(
                        source, account
                    )
                    metadata = await asyncio.to_thread(
                        validate_video_output, local, duration, ratio
                    )
                    metadata.update({
                        "watermark_free": watermark_free,
                        "watermark_removed": watermark_removed,
                        "media_source": source.get("source", "download_url")
                        if not watermark_removed else "download_url_delogo",
                    })
                    print(f"[{account}] Downloaded {local} ({local.stat().st_size / 1e6:.1f} MB)", flush=True)
                    return {
                        "video_url": used_url,
                        "local_path": str(local),
                        "conversation_id": conv_id,
                        "account": account,
                        "video_metadata": metadata,
                    }
                print(f"[{account}] ...Generating ({int(time.time() - start)}s elapsed)", flush=True)

            raise TimeoutError(f"No video generated within {timeout}s (conversation_id={conv_id})")
        finally:
            await context.close()


async def _main():
    account = sys.argv[1] if len(sys.argv) > 1 else "acc1"
    prompt = sys.argv[2] if len(sys.argv) > 2 else "A cat chasing a butterfly on green grass"
    ratio = sys.argv[3] if len(sys.argv) > 3 else "9:16"
    duration = int(sys.argv[4]) if len(sys.argv) > 4 else 5

    try:
        result = await generate_video(account, prompt, ratio, duration)
    except (RiskControlError, CreditError, TimeoutError) as e:
        print(f"\nFailed: {e}")
        sys.exit(1)
    print("\n=== Result ===")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(_main())
