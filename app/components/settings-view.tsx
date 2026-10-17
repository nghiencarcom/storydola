"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./ui-icon";
import { DEFAULT_RUN_CONCURRENCY, MAX_RUN_CONCURRENCY, MIN_RUN_CONCURRENCY } from "../lib/run-concurrency-config";

type MaiVideoKeyStatus = { configured: boolean; source: "settings" | "server" | "none"; lastFour?: string; updatedAt?: string };
type MaiVideoKeyPayload = MaiVideoKeyStatus & { encryptionReady: boolean };
type OpenAIApiKeyStatus = { configured: boolean; source: "settings" | "server" | "none"; lastFour?: string; updatedAt?: string; encryptionReady: boolean };
type RunConcurrencySettings = { maxConcurrentJobs: number; min: number; max: number; default: number };
type DolaStatus = { reachable: boolean; profileCount?: number; profilePoolReady?: boolean; pendingTasks?: number };

export function SettingsView() {
  const [maiVideoKeyStatus, setMaiVideoKeyStatus] = useState<MaiVideoKeyPayload | null>(null);
  const [maiVideoKeysLoading, setMaiVideoKeysLoading] = useState(true);
  const [maiVideoKeysBusy, setMaiVideoKeysBusy] = useState(false);
  const [maiVideoKeyInput, setMaiVideoKeyInput] = useState("");
  const [maiVideoKeyNotice, setMaiVideoKeyNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [openAIKeyStatus, setOpenAIKeyStatus] = useState<OpenAIApiKeyStatus | null>(null);
  const [openAIKeyLoading, setOpenAIKeyLoading] = useState(true);
  const [openAIKeyBusy, setOpenAIKeyBusy] = useState(false);
  const [openAIKeyInput, setOpenAIKeyInput] = useState("");
  const [openAIKeyNotice, setOpenAIKeyNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [runConcurrency, setRunConcurrency] = useState(DEFAULT_RUN_CONCURRENCY);
  const [runConcurrencyInput, setRunConcurrencyInput] = useState(String(DEFAULT_RUN_CONCURRENCY));
  const [runConcurrencyLoading, setRunConcurrencyLoading] = useState(true);
  const [runConcurrencyBusy, setRunConcurrencyBusy] = useState(false);
  const [runConcurrencyNotice, setRunConcurrencyNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
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
    fetch("/api/openai/api-key", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Không thể đọc trạng thái OpenAI API key.");
        return payload as OpenAIApiKeyStatus;
      })
      .then((payload) => { if (!cancelled) setOpenAIKeyStatus(payload); })
      .catch(() => { if (!cancelled) setOpenAIKeyStatus(null); })
      .finally(() => { if (!cancelled) setOpenAIKeyLoading(false); });
    fetch("/api/settings/concurrency", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Không thể đọc cài đặt số luồng.");
        return payload as RunConcurrencySettings;
      })
      .then((payload) => {
        if (cancelled) return;
        setRunConcurrency(payload.maxConcurrentJobs);
        setRunConcurrencyInput(String(payload.maxConcurrentJobs));
      })
      .catch((cause) => {
        if (!cancelled) setRunConcurrencyNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể đọc cài đặt số luồng." });
      })
      .finally(() => { if (!cancelled) setRunConcurrencyLoading(false); });
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

  async function saveOpenAIApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiKey = openAIKeyInput.trim();
    if (openAIKeyBusy || !apiKey) return;
    setOpenAIKeyBusy(true);
    setOpenAIKeyNotice(null);
    try {
      const response = await fetch("/api/openai/api-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể lưu OpenAI API key.");
      setOpenAIKeyStatus(payload as OpenAIApiKeyStatus);
      setOpenAIKeyInput("");
      setOpenAIKeyNotice({ tone: "success", text: "OpenAI API key đã được mã hóa và lưu trên máy này. Key sẽ dùng cho viết kịch bản và các tính năng Script LLM." });
    } catch (cause) {
      setOpenAIKeyNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể lưu OpenAI API key." });
    } finally {
      setOpenAIKeyBusy(false);
    }
  }

  async function deleteOpenAIApiKey() {
    if (openAIKeyBusy) return;
    setOpenAIKeyBusy(true);
    setOpenAIKeyNotice(null);
    try {
      const response = await fetch("/api/openai/api-key", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể xóa OpenAI API key đã lưu.");
      setOpenAIKeyStatus(payload as OpenAIApiKeyStatus);
      setOpenAIKeyInput("");
      setOpenAIKeyNotice({ tone: "success", text: "Đã xóa key lưu trong Cài đặt. Nếu máy có OPENAI_API_KEY trong cấu hình server, key đó vẫn được dùng làm dự phòng." });
    } catch (cause) {
      setOpenAIKeyNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể xóa OpenAI API key đã lưu." });
    } finally {
      setOpenAIKeyBusy(false);
    }
  }

  async function saveRunConcurrency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const limit = Number(runConcurrencyInput);
    if (runConcurrencyBusy || !Number.isInteger(limit) || limit < MIN_RUN_CONCURRENCY || limit > MAX_RUN_CONCURRENCY) return;
    setRunConcurrencyBusy(true);
    setRunConcurrencyNotice(null);
    try {
      const response = await fetch("/api/settings/concurrency", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrentJobs: limit }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể lưu cài đặt số luồng.");
      setRunConcurrency(payload.maxConcurrentJobs);
      setRunConcurrencyInput(String(payload.maxConcurrentJobs));
      setRunConcurrencyNotice({ tone: "success", text: `Đã lưu tối đa ${payload.maxConcurrentJobs} luồng. Giới hạn mới áp dụng khi cấp tác vụ tiếp theo; các tác vụ đang chạy vẫn hoàn thành.` });
    } catch (cause) {
      setRunConcurrencyNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể lưu cài đặt số luồng." });
    } finally {
      setRunConcurrencyBusy(false);
    }
  }

  function maiVideoKeyStatusText(status: MaiVideoKeyStatus | null) {
    if (maiVideoKeysLoading) return "Đang kiểm tra cấu hình…";
    if (!status?.configured) return "Chưa lưu API key";
    const keyLabel = status.lastFour ? `key kết thúc bằng ${status.lastFour}` : "API key";
    return status.source === "settings" ? `Đang dùng ${keyLabel} đã lưu tại đây` : `Đang dùng ${keyLabel} từ cấu hình server`;
  }

  function openAIKeyStatusText(status: OpenAIApiKeyStatus | null) {
    if (openAIKeyLoading) return "Đang kiểm tra cấu hình…";
    if (!status?.configured) return "Chưa lưu OpenAI API key";
    const keyLabel = status.lastFour ? `key kết thúc bằng ${status.lastFour}` : "OpenAI API key";
    return status.source === "settings" ? `Đang dùng ${keyLabel} đã lưu tại đây` : `Đang dùng ${keyLabel} từ cấu hình server`;
  }

  const dolaStatusText = dolaLoading
    ? "Đang kiểm tra Dola Gateway…"
    : dolaStatus?.reachable
      ? `Đang kết nối · ${dolaStatus.profileCount ?? 0} profile · ${dolaStatus.profilePoolReady ? "có profile sẵn sàng" : "chưa có profile sẵn sàng"} · ${dolaStatus.pendingTasks ?? 0} task đang chạy`
      : "Chưa kết nối. Chạy npm start để bật Gateway.";

  return <>
    <section className="page-heading"><div><h1>Cài đặt</h1><p className="heading-subtitle">Cấu hình OpenAI viết kịch bản, MaiVideo tạo ảnh và Dola tạo video trên máy này.</p></div></section>
    <div className="settings-grid">
      <section className="settings-card settings-card-wide panel-card" id="run-concurrency">
        <div className="section-kicker">HIỆU NĂNG</div>
        <h2>Số luồng xử lý đồng thời</h2>
        <p>Chọn số job chạy cùng lúc trong mỗi lô hoặc hàng đợi: ảnh/video, tạo media trong tập, TTS hàng loạt và ảnh nhân vật/bối cảnh. Chọn từ {MIN_RUN_CONCURRENCY} đến {MAX_RUN_CONCURRENCY} luồng.</p>
        <form className="maivideo-api-key-form" onSubmit={(event) => void saveRunConcurrency(event)}>
          <div className="form-field">
            <label htmlFor="run-concurrency-input">Số luồng tối đa</label>
            <div className="maivideo-api-key-input">
              <input id="run-concurrency-input" name="run-concurrency" type="number" min={MIN_RUN_CONCURRENCY} max={MAX_RUN_CONCURRENCY} step={1} value={runConcurrencyInput} onChange={(event) => setRunConcurrencyInput(event.target.value)} disabled={runConcurrencyLoading} />
              <button className="primary-button compact" type="submit" disabled={runConcurrencyLoading || runConcurrencyBusy || !Number.isInteger(Number(runConcurrencyInput)) || Number(runConcurrencyInput) < MIN_RUN_CONCURRENCY || Number(runConcurrencyInput) > MAX_RUN_CONCURRENCY || Number(runConcurrencyInput) === runConcurrency}>{runConcurrencyBusy ? "Đang lưu…" : "Lưu số luồng"}</button>
            </div>
          </div>
          {runConcurrencyNotice && <div className={`seedance-account-notice ${runConcurrencyNotice.tone}`} role="status">{runConcurrencyNotice.text}</div>}
        </form>
        <div className="seedance-key-status maivideo-key-status" aria-live="polite">
          <Icon name={runConcurrencyLoading ? "alert" : "check"} size={15} />
          <span>{runConcurrencyLoading ? "Đang đọc cài đặt…" : `Đang dùng tối đa ${runConcurrency} luồng`}</span>
        </div>
      </section>

      <section className="settings-card settings-card-wide panel-card" id="openai-api-key">
        <div className="section-kicker">OPENAI</div>
        <h2>API key viết kịch bản</h2>
        <p>Nhập OpenAI API key để viết kịch bản và dùng các tính năng Script LLM. Key được mã hóa trong dữ liệu cục bộ, không gửi lại cho trình duyệt sau khi lưu.</p>
        {!openAIKeyLoading && !openAIKeyStatus && <div className="seedance-settings-alert">Không đọc được trạng thái OpenAI API key. Tải lại trang hoặc kiểm tra kết nối.</div>}
        {!openAIKeyLoading && openAIKeyStatus && !openAIKeyStatus.encryptionReady && <div className="seedance-settings-alert">Chưa có khóa mã hóa cục bộ. Khởi động ứng dụng để tạo cấu hình bảo mật cho máy này rồi thử lại.</div>}
        <form className="maivideo-api-key-form" onSubmit={(event) => void saveOpenAIApiKey(event)}>
          <div className="maivideo-api-key-heading"><strong>OpenAI</strong><small>{openAIKeyStatusText(openAIKeyStatus)}</small></div>
          <div className="form-field">
            <label htmlFor="openai-api-key">OpenAI API key</label>
            <div className="maivideo-api-key-input">
              <input id="openai-api-key" name="openai-api-key" type="password" value={openAIKeyInput} onChange={(event) => setOpenAIKeyInput(event.target.value)} autoComplete="off" spellCheck={false} maxLength={4_096} placeholder="Dán OpenAI API key vào đây" />
              <button className="primary-button compact" type="submit" disabled={!openAIKeyStatus?.encryptionReady || openAIKeyLoading || openAIKeyBusy || !openAIKeyInput.trim()}>{openAIKeyBusy ? "Đang lưu…" : "Lưu API key"}</button>
            </div>
          </div>
          {openAIKeyNotice && <div className={`seedance-account-notice ${openAIKeyNotice.tone}`} role="status">{openAIKeyNotice.text}</div>}
        </form>
        <div className="seedance-key-status maivideo-key-status" aria-live="polite">
          <Icon name={openAIKeyStatus?.configured ? "check" : "alert"} size={15} />
          <span>{openAIKeyLoading ? "Đang kiểm tra OpenAI API key…" : openAIKeyStatus?.configured ? "OpenAI API key đã cấu hình" : "Chưa lưu OpenAI API key"}</span>
          {openAIKeyStatus?.configured && <code className="maivideo-key-mask">•••••••• {openAIKeyStatus.lastFour || "••••"}</code>}
          {openAIKeyStatus?.source === "settings" && <button type="button" className="secondary-button compact" onClick={() => void deleteOpenAIApiKey()} disabled={openAIKeyBusy}>{openAIKeyBusy ? "Đang xóa…" : "Xóa key đã lưu"}</button>}
        </div>
      </section>

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
