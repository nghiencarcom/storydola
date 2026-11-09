"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSeedanceAccounts } from "../lib/seedance-accounts-client";
import { Icon } from "./ui-icon";

type MaiVideoKeyStatus = { configured: boolean; source: "settings" | "server" | "none"; lastFour?: string; updatedAt?: string };
type MaiVideoKeyPayload = MaiVideoKeyStatus & { encryptionReady: boolean };

export function SettingsView() {
  const { accounts, defaultAccountId, encryptionReady, loading, refresh } = useSeedanceAccounts();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const activeAccount = accounts.find((account) => account.id === defaultAccountId) || accounts.find((account) => account.isDefault) || accounts[0];
  const [maiVideoKeyStatus, setMaiVideoKeyStatus] = useState<MaiVideoKeyPayload | null>(null);
  const [maiVideoKeysLoading, setMaiVideoKeysLoading] = useState(true);
  const [maiVideoKeysBusy, setMaiVideoKeysBusy] = useState(false);
  const [maiVideoKeyInput, setMaiVideoKeyInput] = useState("");
  const [maiVideoKeyNotice, setMaiVideoKeyNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/maivideo/api-keys", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Không thể đọc API key MaiVideo.");
        return payload as MaiVideoKeyPayload;
      })
      .then((payload) => { if (!cancelled) setMaiVideoKeyStatus(payload); })
      .catch(() => { if (!cancelled) setMaiVideoKeyStatus(null); })
      .finally(() => { if (!cancelled) setMaiVideoKeysLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function saveApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !apiKey.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/seedance/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể lưu API key Seedance.");
      setApiKey("");
      await refresh().catch(() => undefined);
      setNotice({ tone: "success", text: "API key hợp lệ, đã lưu và đặt làm key mặc định để tạo video." });
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể lưu API key Seedance." });
    } finally {
      setBusy(false);
    }
  }

  async function saveMaiVideoApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = maiVideoKeyInput.trim();
    if (maiVideoKeysBusy || !key) return;
    setMaiVideoKeysBusy(true);
    setMaiVideoKeyNotice(null);
    try {
      const response = await fetch("/api/maivideo/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể lưu API key MaiVideo.");
      setMaiVideoKeyStatus(payload as MaiVideoKeyPayload);
      setMaiVideoKeyInput("");
      setMaiVideoKeyNotice({ tone: "success", text: "API key hợp lệ, đã lưu mã hóa và sẽ dùng cho cả tạo ảnh lẫn tạo video." });
    } catch (cause) {
      setMaiVideoKeyNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể lưu API key MaiVideo." });
    } finally {
      setMaiVideoKeysBusy(false);
    }
  }

  function maiVideoKeyStatusText(status: MaiVideoKeyStatus | null) {
    if (maiVideoKeysLoading) return "Đang kiểm tra cấu hình…";
    if (!status?.configured) return "Chưa lưu API key";
    const keyLabel = status.lastFour ? `key kết thúc bằng ${status.lastFour}` : "API key";
    return status.source === "settings" ? `Đang dùng ${keyLabel} đã lưu tại đây` : `Đang dùng ${keyLabel} từ cấu hình server`;
  }

  return <>
    <section className="page-heading"><div><h1>Cài đặt</h1><p className="heading-subtitle">API key tạo media từ Seedance và MaiVideo.</p></div></section>
    <div className="settings-grid">
      <section className="settings-card settings-card-wide panel-card" id="maivideo-api-keys">
        <div className="section-kicker">MAIVIDEO</div>
        <h2>API key tạo ảnh và video</h2>
        <p>Nhập API key từ MaiVideo Studio một lần để dùng chung cho cả tạo ảnh và tạo video. Key được xác thực trước khi lưu, gắn với tài khoản StoryAI và mã hóa trên máy chủ.</p>
        {!maiVideoKeysLoading && !maiVideoKeyStatus && <div className="seedance-settings-alert">Không đọc được trạng thái API key MaiVideo. Tải lại trang hoặc kiểm tra kết nối máy chủ.</div>}
        {!maiVideoKeysLoading && maiVideoKeyStatus && !maiVideoKeyStatus.encryptionReady && <div className="seedance-settings-alert">Máy chủ chưa cấu hình khóa mã hóa key. Cần STORYAI_CREDENTIALS_ENCRYPTION_KEY hoặc SEEDANCE_CREDENTIALS_ENCRYPTION_KEY dài ít nhất 32 ký tự.</div>}
        <form className="maivideo-api-key-form" onSubmit={(event) => void saveMaiVideoApiKey(event)}>
          <div className="maivideo-api-key-heading"><strong>MaiVideo Studio</strong><small>{maiVideoKeyStatusText(maiVideoKeyStatus)}</small></div>
          <div className="form-field">
            <label htmlFor="maivideo-api-key">API key MaiVideo (dùng cho tạo ảnh và video)</label>
            <div className="maivideo-api-key-input">
              <input id="maivideo-api-key" name="maivideo-api-key" type="password" value={maiVideoKeyInput} onChange={(event) => setMaiVideoKeyInput(event.target.value)} autoComplete="off" spellCheck={false} maxLength={1_000} placeholder="Dán API key MaiVideo vào đây" />
              <button className="primary-button compact" type="submit" disabled={!maiVideoKeyStatus?.encryptionReady || maiVideoKeysLoading || maiVideoKeysBusy || !maiVideoKeyInput.trim()}>{maiVideoKeysBusy ? "Đang xác thực…" : "Lưu API key"}</button>
            </div>
          </div>
          {maiVideoKeyNotice && <div className={`seedance-account-notice ${maiVideoKeyNotice.tone}`} role="status">{maiVideoKeyNotice.text}</div>}
        </form>
        <div className="seedance-key-status maivideo-key-status" aria-live="polite">
          <Icon name={maiVideoKeyStatus?.configured ? "check" : "alert"} size={15} />
          <span>{maiVideoKeysLoading ? "Đang kiểm tra API key…" : maiVideoKeyStatus?.configured ? "API key đã lưu" : "Chưa lưu API key"}</span>
          {maiVideoKeyStatus?.configured && <code className="maivideo-key-mask">•••••••• {maiVideoKeyStatus.lastFour || "••••"}</code>}
        </div>
        <small className="seedance-key-help">Một API key được gửi cùng header X-API-Key cho cả hai dịch vụ theo tài liệu MaiVideo.</small>
      </section>
      <section className="settings-card settings-card-wide panel-card" id="seedance-login">
        <div className="section-kicker">SEEDANCE</div>
        <h2>API key</h2>
        <p>Dán API key từ <a href="https://seedance.maivideo.top" target="_blank" rel="noreferrer">Seedance Studio → Cài đặt → API cá nhân</a>. Khi lưu, StoryAI ghép key với phiên MaiVideo đang đăng nhập để tạo Flow/Muse. Project cũ cũng dùng key mặc định này, không giữ key riêng theo project.</p>
        {!encryptionReady && <div className="seedance-settings-alert">Máy chủ chưa cấu hình khóa mã hóa API key Seedance.</div>}
        <form className="seedance-key-form" onSubmit={(event) => void saveApiKey(event)}>
          <label className="form-field"><span>API key Seedance</span><input name="seedanceApiKey" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} maxLength={1_000} placeholder="Dán API key vào đây" required /></label>
          <button className="primary-button compact" type="submit" disabled={busy || loading || !encryptionReady || !apiKey.trim()}>{busy ? "Đang kiểm tra…" : "Lưu và sử dụng"}</button>
        </form>
        {notice && <div className={`seedance-account-notice ${notice.tone}`} role="status">{notice.text}</div>}
        <div className="seedance-key-status" aria-live="polite">
          <Icon name={activeAccount ? "check" : "alert"} size={15} />
          <span>{loading ? "Đang kiểm tra API key…" : activeAccount ? `Đang sử dụng API key kết thúc bằng ${activeAccount.lastFour}` : "Chưa lưu API key Seedance"}</span>
        </div>
        <small className="seedance-key-help">Key và token phiên được lưu mã hóa cùng nhau. Lưu key mới sẽ thay key mặc định hiện tại. Không cần nhập token phiên riêng.</small>
      </section>
    </div>
  </>;
}
