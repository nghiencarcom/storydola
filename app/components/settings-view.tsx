"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./ui-icon";

type MaiVideoKeyStatus = { configured: boolean; source: "settings" | "server" | "none"; lastFour?: string; updatedAt?: string };
type MaiVideoKeyPayload = MaiVideoKeyStatus & { encryptionReady: boolean };
type DolaStatus = { reachable: boolean; profileCount?: number; profilePoolReady?: boolean; pendingTasks?: number };

export function SettingsView() {
  const [maiVideoKeyStatus, setMaiVideoKeyStatus] = useState<MaiVideoKeyPayload | null>(null);
  const [maiVideoKeysLoading, setMaiVideoKeysLoading] = useState(true);
  const [maiVideoKeysBusy, setMaiVideoKeysBusy] = useState(false);
  const [maiVideoKeyInput, setMaiVideoKeyInput] = useState("");
  const [maiVideoKeyNotice, setMaiVideoKeyNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dolaStatus, setDolaStatus] = useState<DolaStatus | null>(null);
  const [dolaLoading, setDolaLoading] = useState(true);

  const refreshDolaStatus = useCallback(async () => {
    setDolaLoading(true);
    try {
      const response = await fetch("/api/local/dola/status", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as DolaStatus;
      setDolaStatus(payload);
    } catch {
      setDolaStatus({ reachable: false });
    } finally {
      setDolaLoading(false);
    }
  }, []);

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
    void refreshDolaStatus();
    return () => { cancelled = true; };
  }, [refreshDolaStatus]);

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
      setMaiVideoKeyNotice({ tone: "success", text: "API key hợp lệ, đã lưu mã hóa và dùng cho giọng đọc, tạo ảnh, tạo video." });
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

  const dolaStatusText = dolaLoading
    ? "Đang kiểm tra Dola Gateway…"
    : dolaStatus?.reachable
      ? `Đang kết nối · ${dolaStatus.profileCount ?? 0} profile · ${dolaStatus.profilePoolReady ? "có profile sẵn sàng" : "chưa có profile sẵn sàng"} · ${dolaStatus.pendingTasks ?? 0} task đang chạy`
      : "Chưa kết nối. Chạy npm start để bật Gateway.";

  return <>
    <section className="page-heading"><div><h1>Cài đặt</h1><p className="heading-subtitle">Kết nối MaiVideo tạo ảnh và Dola tạo video Seedance trên máy này.</p></div></section>
    <div className="settings-grid">
      <section className="settings-card settings-card-wide panel-card" id="maivideo-api-keys">
        <div className="section-kicker">MAIVIDEO</div>
        <h2>API key tạo ảnh</h2>
        <p>Nhập API key MaiVideo một lần để tạo ảnh nhân vật, bối cảnh và ảnh theo từng cảnh. Key được xác thực rồi mã hóa trong dữ liệu cục bộ của StoryAI.</p>
        {!maiVideoKeysLoading && !maiVideoKeyStatus && <div className="seedance-settings-alert">Không đọc được trạng thái API key MaiVideo. Tải lại trang hoặc kiểm tra kết nối.</div>}
        {!maiVideoKeysLoading && maiVideoKeyStatus && !maiVideoKeyStatus.encryptionReady && <div className="seedance-settings-alert">Thiếu khóa mã hóa cục bộ. Khởi động bằng npm run dev để StoryAI tạo cấu hình riêng cho máy này.</div>}
        <form className="maivideo-api-key-form" onSubmit={(event) => void saveMaiVideoApiKey(event)}>
          <div className="maivideo-api-key-heading"><strong>MaiVideo Studio</strong><small>{maiVideoKeyStatusText(maiVideoKeyStatus)}</small></div>
          <div className="form-field">
            <label htmlFor="maivideo-api-key">API key MaiVideo</label>
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
      </section>

      <section className="settings-card settings-card-wide panel-card" id="dola-gateway">
        <div className="section-kicker">DOLA.COM · SEEDANCE</div>
        <h2>Tạo video bằng profile Dola trên máy này</h2>
        <p>StoryAI gửi prompt, ảnh cảnh và ảnh tham chiếu tới Dola Render Gateway cục bộ. Gateway dùng các profile Chromium đã đăng nhập, phân phối task và lưu video hoàn tất về thư mục media của project.</p>
        <div className={`seedance-key-status dola-status-line ${dolaStatus?.reachable ? "connected" : "disconnected"}`} aria-live="polite">
          <Icon name={dolaStatus?.reachable ? "check" : "alert"} size={15} />
          <span>{dolaStatusText}</span>
          <button type="button" className="secondary-button compact" onClick={() => void refreshDolaStatus()} disabled={dolaLoading}>{dolaLoading ? "Đang tải…" : "Kiểm tra lại"}</button>
        </div>
        <div className="settings-actions">
          <Link className="primary-button compact" href="/tai-khoan-seedance">Quản lý tài khoản/profile</Link>
          <Link className="secondary-button compact" href="/quan-ly-proxy">Quản lý proxy</Link>
        </div>
        <small className="seedance-key-help">Đăng nhập Dola và cấu hình proxy trong Studio. Pool tự chọn profile; hồ sơ và credential chỉ lưu trên máy đang chạy Gateway.</small>
      </section>
    </div>
  </>;
}
