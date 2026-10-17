"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2
} from "lucide-react";

function formatDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "Chưa sử dụng";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value * 1000));
}

async function readResponse(response) {
  const raw = await response.text();
  try {
    const payload = raw ? JSON.parse(raw) : {};
    if (payload && typeof payload === "object" && payload.detail && !payload.error) {
      payload.error = String(payload.detail);
    }
    return payload;
  } catch {
    return { error: raw || "Phản hồi không hợp lệ" };
  }
}

async function writeClipboardText(value) {
  const text = String(value || "");
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for browsers or contexts that deny Clipboard API access.
    }
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  field.style.top = "0";
  document.body.appendChild(field);
  field.focus();
  field.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    field.remove();
  }
  return copied;
}

export default function UserApiKeysPanel() {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState("Seedance API");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const [revealedKey, setRevealedKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyingKeyId, setCopyingKeyId] = useState("");
  const [copiedKeyId, setCopiedKeyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const initialLoadPromiseRef = useRef(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/user/api-keys", { cache: "no-store" });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || "Không thể tải danh sách API key");
      setKeys(Array.isArray(payload.keys) ? payload.keys : []);
    } catch (loadError) {
      setError(loadError?.message || "Không thể tải danh sách API key");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!initialLoadPromiseRef.current) {
      initialLoadPromiseRef.current = (async () => {
        const response = await fetch("/api/user/api-keys", { cache: "no-store" });
        const payload = await readResponse(response);
        if (!response.ok) throw new Error(payload.error || "Không thể tải danh sách API key");
        return payload;
      })();
    }
    initialLoadPromiseRef.current
      .then((payload) => {
        if (cancelled) return;
        setKeys(Array.isArray(payload.keys) ? payload.keys : []);
        const newSecret = String(payload.created?.key || "");
        if (newSecret) {
          setRevealedKey(newSecret);
          setNotice("Đã tự tạo key đầu tiên cho tài khoản của bạn. Hãy lưu an toàn; bạn có thể sao chép key đang hoạt động từ danh sách bên dưới.");
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError?.message || "Không thể tải danh sách API key");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function createKey(event) {
    event.preventDefault();
    const keyName = name.trim();
    if (!keyName || keyName.length > 64) {
      setError("Tên API key cần từ 1 đến 64 ký tự.");
      return;
    }
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/user/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName })
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || "Không thể tạo API key");
      const secret = String(payload.created?.key || "");
      if (!secret) throw new Error("Gateway không trả về key mới. Hãy tải lại danh sách trước khi thử lại.");
      setRevealedKey(secret);
      setNotice("Đã tạo key. Hãy lưu an toàn; bạn có thể sao chép key đang hoạt động từ danh sách bên dưới.");
      setName("Seedance API");
      await loadKeys();
    } catch (createError) {
      setError(createError?.message || "Không thể tạo API key");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyKey() {
    if (!revealedKey) return;
    try {
      const didCopy = await writeClipboardText(revealedKey);
      if (!didCopy) throw new Error("Không thể sao chép tự động");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Không thể sao chép tự động. Hãy chọn và sao chép key hiển thị.");
    }
  }

  async function copyExistingKey(key) {
    setCopyingKeyId(key.key_id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/user/api-keys/" + encodeURIComponent(key.key_id), { cache: "no-store" });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || "Không thể lấy API key");
      const secret = String(payload.key || "");
      if (!secret) throw new Error("Gateway không trả về API key đầy đủ.");
      if (!await writeClipboardText(secret)) {
        setRevealedKey(secret);
        throw new Error("Không thể sao chép tự động; key đầy đủ đã hiển thị phía trên để bạn sao chép thủ công.");
      }
      setCopiedKeyId(key.key_id);
      setNotice("Đã sao chép API key “" + (key.name || "Seedance API") + "” vào clipboard.");
      window.setTimeout(() => setCopiedKeyId((current) => current === key.key_id ? "" : current), 1600);
    } catch (copyError) {
      setError(copyError?.message || "Không thể sao chép API key.");
    } finally {
      setCopyingKeyId("");
    }
  }

  async function revokeKey(key) {
    if (!window.confirm(`Thu hồi API key “${key.name || key.masked_key}”? Những ứng dụng đang dùng key này sẽ mất quyền gọi API.`)) return;
    setRevokingId(key.key_id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/user/api-keys/" + encodeURIComponent(key.key_id), {
        method: "DELETE"
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error || "Không thể thu hồi API key");
      setRevealedKey("");
      setNotice("Đã thu hồi API key.");
      await loadKeys();
    } catch (revokeError) {
      setError(revokeError?.message || "Không thể thu hồi API key");
    } finally {
      setRevokingId("");
    }
  }

  const activeApiKeyCount = keys.filter((key) => key.enabled).length;

  return (
    <div className="panel settings-panel full-settings user-api-panel">
      <div className="panel-heading">
        <div><div className="panel-kicker">DEVELOPER ACCESS</div><h2>API cá nhân</h2></div>
        <KeyRound size={18} className="heading-icon" />
      </div>
      <p className="settings-copy">Key đầu tiên được tự tạo khi bạn mở mục này. Mỗi tài khoản chỉ có tối đa một key đang hoạt động; muốn thay key, hãy thu hồi key hiện tại rồi tạo key mới. Key chỉ xác thực quyền gọi API, không cấp credit riêng; video dùng credit của các profile Seedance đang kết nối với Gateway.</p>

      {!loading && activeApiKeyCount === 0 ? (
        <form className="user-api-create" onSubmit={createKey}>
          <label htmlFor="user-api-key-name">Tên key</label>
          <input
            id="user-api-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            placeholder="Ví dụ: Production app"
            disabled={submitting}
          />
          <button className="button button-submit" type="submit" disabled={submitting || loading}>
            {submitting ? <LoaderCircle size={15} className="spin" /> : <KeyRound size={15} />}
            {submitting ? "Đang tạo..." : "Tạo API key"}
          </button>
          <button className="mini-action" type="button" onClick={loadKeys} disabled={loading || submitting} title="Tải lại danh sách">
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Làm mới
          </button>
        </form>
      ) : (
        <div className="user-api-active-limit">
          <span>{activeApiKeyCount > 1
            ? `Đang có ${activeApiKeyCount} key hoạt động từ trước. Hãy thu hồi key dư để giữ lại một key; ứng dụng dùng key bị thu hồi sẽ mất quyền gọi API.`
            : activeApiKeyCount === 1
              ? "Đã có một key hoạt động. Để tạo key thay thế, hãy thu hồi key hiện tại trước."
              : "Đang tải trạng thái API key..."}</span>
          <button className="mini-action" type="button" onClick={loadKeys} disabled={loading || submitting} title="Tải lại danh sách">
            {loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Làm mới
          </button>
        </div>
      )}

      {error ? <div className="user-api-message user-api-error"><AlertCircle size={15} /><span>{error}</span></div> : null}
      {notice ? <div className="user-api-message user-api-notice"><ShieldCheck size={15} /><span>{notice}</span></div> : null}

      {revealedKey ? (
        <div className="user-api-secret">
          <div><strong>API key đầy đủ — hãy lưu an toàn</strong><small>Key chỉ hiển thị trong phiên hiện tại; hãy sao chép và lưu ở nơi an toàn.</small></div>
          <code>{revealedKey}</code>
          <button className="button button-secondary" type="button" onClick={copyKey}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Đã sao chép" : "Sao chép key"}</button>
        </div>
      ) : null}

      <div className="user-api-key-list">
        {loading && !keys.length ? <div className="user-api-empty"><LoaderCircle size={16} className="spin" /> Đang tải key...</div> : keys.length ? keys.map((key) => (
          <div className="user-api-key-row" key={key.key_id}>
            <KeyRound size={16} className="user-api-key-icon" />
            <div className="user-api-key-info">
              <strong>{key.name || "Seedance API"}</strong>
              <code>{key.masked_key}</code>
              <small>Tạo {formatDate(key.created_at)} · Dùng gần nhất {formatDate(key.last_used_at)}</small>
            </div>
            <span className={"user-api-key-state" + (key.enabled ? " is-enabled" : "")}>{key.enabled ? "Đang hoạt động" : "Đã thu hồi / tắt"}</span>
            {key.enabled ? <div className="user-api-key-actions">
              <button className="mini-action user-api-copy-key" type="button" onClick={() => copyExistingKey(key)} disabled={copyingKeyId === key.key_id || revokingId === key.key_id}>
                {copyingKeyId === key.key_id ? <LoaderCircle size={13} className="spin" /> : copiedKeyId === key.key_id ? <Check size={13} /> : <Copy size={13} />}
                {copyingKeyId === key.key_id ? "Đang lấy..." : copiedKeyId === key.key_id ? "Đã sao chép" : "Sao chép key"}
              </button>
              <button className="mini-action mini-action-danger" type="button" onClick={() => revokeKey(key)} disabled={revokingId === key.key_id || copyingKeyId === key.key_id}>
                {revokingId === key.key_id ? <LoaderCircle size={13} className="spin" /> : <Trash2 size={13} />}{revokingId === key.key_id ? "Đang thu hồi..." : "Thu hồi"}
              </button>
            </div> : null}
          </div>
        )) : <div className="user-api-empty">Chưa có API key. Tạo key đầu tiên để bắt đầu.</div>}
      </div>

      <div className="user-api-guide">
        <div className="user-api-guide-heading"><div><div className="panel-kicker">QUICK START</div><strong>Gọi API tạo video</strong></div><a className="button button-secondary" href="/docs" target="_blank" rel="noreferrer">Mở tài liệu API <ExternalLink size={14} /></a></div>
        <p>Đặt <code>DOLA_BASE_URL</code> là hostname Studio, rồi thay <code>$SEEDANCE_API_KEY</code> bằng key vừa tạo. API trả về task ID ngay; dùng <code>GET /v1/videos/{"{task_id}"}</code> để kiểm tra đến khi video hoàn tất.</p>
        <pre><code>{`curl -X POST "$DOLA_BASE_URL/v1/videos/generations" \\
  -H "Authorization: Bearer $SEEDANCE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"seedance-2.5","prompt":"A cinematic shot of a red boat crossing a misty lake.","duration":10,"ratio":"16:9"}'`}</code></pre>
      </div>
    </div>
  );
}
