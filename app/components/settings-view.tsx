"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSeedanceAccounts } from "../lib/seedance-accounts-client";
import { Icon } from "./ui-icon";

type MaiVideoKeyStatus = { configured: boolean; source: "settings" | "server" | "none"; lastFour?: string; updatedAt?: string };
type MaiVideoKeyPayload = MaiVideoKeyStatus & { encryptionReady: boolean };
type CodingAgentId = "codex" | "claude" | "antigravity";
type AgentAccessPayload = {
  configured: boolean;
  createdAt?: string;
  autoInstallReady: boolean;
  encryptionReady: boolean;
  baseUrl: string;
  commandPath: string;
  nodePath: string;
  platform: string;
};
type AgentConfigStatus = { installed: boolean; needsUpdate?: boolean; configPath: string; error?: "INVALID_JSON" | "INVALID_TOML" | "CONFIG_ACCESS_FAILED" };
type CodingAgentEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
type CodingAgentModel = { id: string; label: string; reasoningEffortLevels?: CodingAgentEffort[]; defaultReasoningEffort?: CodingAgentEffort; speedTiers?: "fast"[] };
type CodingAgentCliStatus = { id: CodingAgentId; label: string; available: boolean; mcpTargetAvailable?: boolean; models: CodingAgentModel[] };
type CodingAgentPreference = { agent: CodingAgentId; model: string; quality: "auto" | CodingAgentEffort; speed: "standard" | "fast" };
const codingAgents: { id: CodingAgentId; label: string; configName: string }[] = [
  { id: "codex", label: "Codex", configName: "~/.codex/config.toml" },
  { id: "claude", label: "Claude Code", configName: "~/.claude.json" },
  { id: "antigravity", label: "Antigravity", configName: "~/.gemini/config/mcp_config.json" },
];

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
  const [agentAccessStatus, setAgentAccessStatus] = useState<AgentAccessPayload | null>(null);
  const [agentConfigStatuses, setAgentConfigStatuses] = useState<Partial<Record<CodingAgentId, AgentConfigStatus>>>({});
  const [codingAgentCliStatuses, setCodingAgentCliStatuses] = useState<CodingAgentCliStatus[]>([]);
  const [codingAgentPreference, setCodingAgentPreference] = useState<CodingAgentPreference | null>(null);
  const [selectedCodingAgent, setSelectedCodingAgent] = useState<CodingAgentId | "">("");
  const [selectedCodingModel, setSelectedCodingModel] = useState("");
  const [selectedCodingQuality, setSelectedCodingQuality] = useState<CodingAgentPreference["quality"]>("auto");
  const [selectedCodingSpeed, setSelectedCodingSpeed] = useState<CodingAgentPreference["speed"]>("standard");
  const [customCodingModel, setCustomCodingModel] = useState(false);
  const [codingPreferenceBusy, setCodingPreferenceBusy] = useState(false);
  const [codingPreferenceNotice, setCodingPreferenceNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [agentAccessLoading, setAgentAccessLoading] = useState(true);
  const [agentAccessBusy, setAgentAccessBusy] = useState(false);
  const [installingAgyCli, setInstallingAgyCli] = useState(false);
  const [agentAccessNotice, setAgentAccessNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [generatedAgentToken, setGeneratedAgentToken] = useState("");
  const [agentTokenCopied, setAgentTokenCopied] = useState(false);

  const refreshAgentAccess = useCallback(async () => {
    setAgentAccessLoading(true);
    try {
      const [accessResponse, configResponse, cliResponse, preferenceResponse] = await Promise.all([
        fetch("/api/agent-access", { cache: "no-store" }),
        fetch("/api/agent-access/install", { cache: "no-store" }),
        fetch("/api/agent-access/cli-status", { cache: "no-store" }),
        fetch("/api/agent-access/preferences", { cache: "no-store" }),
      ]);
      const accessPayload = await accessResponse.json().catch(() => ({}));
      const configPayload = await configResponse.json().catch(() => ({}));
      const cliPayload = await cliResponse.json().catch(() => ({}));
      const preferencePayload = await preferenceResponse.json().catch(() => ({}));
      if (!accessResponse.ok) throw new Error(accessPayload.message || "Không tải được trạng thái kết nối Code Agent.");
      if (!configResponse.ok) throw new Error(configPayload.message || "Không đọc được cấu hình CLI.");
      setAgentAccessStatus(accessPayload as AgentAccessPayload);
      setAgentConfigStatuses(configPayload.agents || {});
      setCodingAgentCliStatuses(Array.isArray(cliPayload.agents) ? cliPayload.agents : []);
      const preference = preferencePayload.preference && typeof preferencePayload.preference.agent === "string"
        ? preferencePayload.preference as CodingAgentPreference : null;
      setCodingAgentPreference(preference);
      if (preference) {
        setSelectedCodingAgent(preference.agent);
        setSelectedCodingModel(preference.model || "");
        setSelectedCodingQuality(preference.quality || "auto");
        setSelectedCodingSpeed(preference.speed || "standard");
        setCustomCodingModel(false);
      } else {
        setSelectedCodingAgent((current) => current || (Array.isArray(cliPayload.agents) ? cliPayload.agents.find((item: CodingAgentCliStatus) => item.available)?.id : "") || "");
      }
      setAgentAccessNotice(null);
    } catch (cause) {
      setAgentAccessNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không tải được trạng thái Code Agent." });
    } finally {
      setAgentAccessLoading(false);
    }
  }, []);

  const selectedCliAgent = codingAgentCliStatuses.find((agent) => agent.id === selectedCodingAgent);
  const selectedCliModels = selectedCliAgent?.models || [];
  const selectedCodingModelInfo = selectedCliModels.find((item) => item.id === selectedCodingModel);
  const codingEffortLevels = selectedCodingModelInfo?.reasoningEffortLevels
    ?? (selectedCodingModel ? [] : [...new Set(selectedCliModels.flatMap((item) => item.reasoningEffortLevels || []))]);
  const codingSpeedAvailable = selectedCodingModelInfo
    ? Boolean(selectedCodingModelInfo.speedTiers?.includes("fast"))
    : !selectedCodingModel && selectedCliModels.some((item) => item.speedTiers?.includes("fast"));
  const codingQualityValue = selectedCodingQuality === "auto" || codingEffortLevels.includes(selectedCodingQuality)
    ? selectedCodingQuality : "auto";
  const selectedModelIsCustom = Boolean(selectedCodingModel) && !selectedCliModels.some((item) => item.id === selectedCodingModel);
  const codingModelSelectValue = customCodingModel || selectedModelIsCustom ? "__custom" : selectedCodingModel;

  async function saveCodingAgentPreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCodingAgent || codingPreferenceBusy) return;
    setCodingPreferenceBusy(true);
    setCodingPreferenceNotice(null);
    try {
      const response = await fetch("/api/agent-access/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: selectedCodingAgent, model: selectedCodingModel.trim(), quality: codingQualityValue, speed: codingSpeedAvailable ? selectedCodingSpeed : "standard" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể lưu lựa chọn Code Agent.");
      setCodingAgentPreference(payload.preference as CodingAgentPreference);
      setCodingPreferenceNotice({ tone: "success", text: "Đã lưu Code Agent, model, chất lượng và speed mặc định cho toàn bộ tác vụ AI." });
    } catch (cause) {
      setCodingPreferenceNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể lưu lựa chọn Code Agent." });
    } finally {
      setCodingPreferenceBusy(false);
    }
  }

  useEffect(() => { void refreshAgentAccess(); }, [refreshAgentAccess]);

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
      setMaiVideoKeyNotice({ tone: "success", text: "API key hợp lệ, đã lưu mã hóa và sẽ dùng cho tạo ảnh, video và voice." });
    } catch (cause) {
      setMaiVideoKeyNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể lưu API key MaiVideo." });
    } finally {
      setMaiVideoKeysBusy(false);
    }
  }

  async function createAgentToken() {
    if (agentAccessBusy || !agentAccessStatus?.encryptionReady) return;
    if (agentAccessStatus.configured && !window.confirm("Tạo token mới sẽ vô hiệu token cũ. Bạn cần cập nhật lại từng Code Agent đã cài. Tiếp tục?")) return;
    setAgentAccessBusy(true);
    setAgentAccessNotice(null);
    setGeneratedAgentToken("");
    try {
      const response = await fetch("/api/agent-access", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.token !== "string") throw new Error(payload.message || "Không tạo được token kết nối.");
      setGeneratedAgentToken(payload.token);
      setAgentTokenCopied(false);
      await refreshAgentAccess();
      setAgentAccessNotice({ tone: "success", text: "Đã tạo token. Chọn Kết nối/Cập nhật ở từng CLI bạn muốn dùng." });
    } catch (cause) {
      setAgentAccessNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không tạo được token kết nối." });
    } finally {
      setAgentAccessBusy(false);
    }
  }

  async function installAgent(agent: CodingAgentId) {
    if (agentAccessBusy || !agentAccessStatus?.encryptionReady) return;
    const repairInvalidConfig = ["INVALID_JSON", "INVALID_TOML"].includes(agentConfigStatuses[agent]?.error || "");
    if (repairInvalidConfig && !window.confirm("StoryAI sẽ sao lưu file cấu hình lỗi rồi tạo lại cấu hình StoryAI MCP. Các MCP khác cần khôi phục từ bản sao lưu. Tiếp tục?")) return;
    setAgentAccessBusy(true);
    setAgentAccessNotice(null);
    let tokenCreated = false;
    try {
      if (!agentAccessStatus.configured) {
        const tokenResponse = await fetch("/api/agent-access", { method: "POST" });
        const tokenPayload = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || typeof tokenPayload.token !== "string") throw new Error(tokenPayload.message || "Không tạo được token kết nối.");
        tokenCreated = true;
        setGeneratedAgentToken(tokenPayload.token);
        setAgentTokenCopied(false);
      }
      const response = await fetch("/api/agent-access/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, repairInvalidConfig }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không cài được cấu hình Code Agent.");
      await refreshAgentAccess();
      setAgentAccessNotice({ tone: "success", text: `${codingAgents.find((item) => item.id === agent)?.label || agent} đã được kết nối trên máy này. ${agent === "antigravity" ? "Khởi động lại Antigravity (hoặc tải lại MCP Servers) để nhận StoryAI MCP." : "Khởi động lại CLI để tải StoryAI MCP."}${tokenCreated ? " Token mới đã được tạo tự động." : ""}` });
    } catch (cause) {
      if (tokenCreated) await refreshAgentAccess();
      setAgentAccessNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không cài được cấu hình Code Agent." });
    } finally {
      setAgentAccessBusy(false);
    }
  }

  async function installAntigravityCli() {
    if (installingAgyCli || agentAccessBusy) return;
    setInstallingAgyCli(true);
    setAgentAccessNotice(null);
    try {
      const response = await fetch("/api/agent-access/cli-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "antigravity" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể tự cài agy CLI.");
      await refreshAgentAccess();
      setAgentAccessNotice({
        tone: "success",
        text: "Đã cài đặt agy CLI thành công! Nếu đây là lần đầu dùng agy trên máy này, hãy mở Terminal/PowerShell gõ agy một lần để đăng nhập tài khoản Google.",
      });
    } catch (cause) {
      setAgentAccessNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thể tự cài agy CLI." });
    } finally {
      setInstallingAgyCli(false);
    }
  }

  async function revokeAgentToken() {
    if (agentAccessBusy || !agentAccessStatus?.configured) return;
    if (!window.confirm("Thu hồi token sẽ ngắt quyền truy cập StoryAI của các CLI đã kết nối. Tiếp tục?")) return;
    setAgentAccessBusy(true);
    setAgentAccessNotice(null);
    try {
      const response = await fetch("/api/agent-access", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thu hồi được token.");
      setGeneratedAgentToken("");
      await refreshAgentAccess();
      setAgentAccessNotice({ tone: "success", text: "Đã thu hồi token truy cập StoryAI." });
    } catch (cause) {
      setAgentAccessNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Không thu hồi được token." });
    } finally {
      setAgentAccessBusy(false);
    }
  }

  async function copyAgentToken() {
    try {
      await navigator.clipboard.writeText(generatedAgentToken);
      setAgentTokenCopied(true);
    } catch {
      setAgentAccessNotice({ tone: "error", text: "Không sao chép được token. Hãy chọn và sao chép token thủ công." });
    }
  }

  function maiVideoKeyStatusText(status: MaiVideoKeyStatus | null) {
    if (maiVideoKeysLoading) return "Đang kiểm tra cấu hình…";
    if (!status?.configured) return "Chưa lưu API key";
    const keyLabel = status.lastFour ? `key kết thúc bằng ${status.lastFour}` : "API key";
    return status.source === "settings" ? `Đang dùng ${keyLabel} đã lưu tại đây` : `Đang dùng ${keyLabel} từ cấu hình server`;
  }

  return <>
    <section className="page-heading"><div><h1>Cài đặt</h1><p className="heading-subtitle">Kết nối Code Agent và quản lý API key tạo media.</p></div></section>
    <div className="settings-grid">
      <section className="settings-card settings-card-wide panel-card" id="agent-cli-connection">
        <div className="section-kicker">CODE AGENT CLI</div>
        <h2>Kết nối Codex, Claude Code hoặc Antigravity</h2>
        <p>Chọn CLI đã cài trên máy này rồi nhấn Kết nối. Nếu chưa có token, StoryAI tự tạo token, ghi cấu hình MCP vào CLI và kiểm tra kết nối local.</p>
        {!agentAccessLoading && agentAccessStatus && !agentAccessStatus.encryptionReady && <div className="seedance-settings-alert">Máy chủ chưa cấu hình khóa mã hóa token. Cần STORYAI_CREDENTIALS_ENCRYPTION_KEY hoặc SEEDANCE_CREDENTIALS_ENCRYPTION_KEY dài ít nhất 32 ký tự.</div>}
        <div className="agent-access-actions">
          <button className="primary-button compact" type="button" onClick={() => void createAgentToken()} disabled={agentAccessLoading || agentAccessBusy || !agentAccessStatus?.encryptionReady}>
            {agentAccessBusy ? "Đang xử lý…" : agentAccessStatus?.configured ? "Tạo lại token kết nối" : "Tạo token MCP"}
          </button>
          <button className="secondary-button compact" type="button" onClick={() => void refreshAgentAccess()} disabled={agentAccessLoading || agentAccessBusy}>Tải lại trạng thái</button>
          {agentAccessStatus?.configured && <button className="secondary-button compact" type="button" onClick={() => void revokeAgentToken()} disabled={agentAccessBusy}>Thu hồi token</button>}
        </div>
        {agentAccessStatus?.configured && <div className="seedance-key-status" aria-live="polite"><Icon name="check" size={15} /><span>{agentAccessStatus.autoInstallReady ? "Token MCP đã lưu an toàn" : "Token cũ cần tạo lại để tự cài cấu hình"}</span></div>}
        {generatedAgentToken && <div className="agent-token-reveal">
          <label htmlFor="storyai-agent-token">Token vừa tạo · chỉ hiển thị trong phiên này</label>
          <div><input id="storyai-agent-token" value={generatedAgentToken} readOnly /><button type="button" className="secondary-button compact" onClick={() => void copyAgentToken()}>{agentTokenCopied ? "Đã sao chép" : "Sao chép token"}</button></div>
          <small>Token được lưu mã hóa trên máy chủ. Cấu hình tự động bên dưới sẽ dùng token này.</small>
        </div>}
        <div className="agent-connect-grid">
          {codingAgents.map((agent) => {
            const status = agentConfigStatuses[agent.id];
            const needsFix = ["INVALID_JSON", "INVALID_TOML"].includes(status?.error || "");
            const cliEntry = codingAgentCliStatuses.find((item) => item.id === agent.id);
            const mcpTargetAvailable = Boolean(cliEntry?.available || cliEntry?.mcpTargetAvailable || status?.installed || needsFix);
            const cliMissing = !agentAccessLoading && codingAgentCliStatuses.length > 0 && !mcpTargetAvailable;
            const agyInstallCmd = agentAccessStatus?.platform === "win32"
              ? "irm https://antigravity.google/cli/install.ps1 | iex"
              : "curl -fsSL https://antigravity.google/cli/install.sh | bash";
            const statusLabel = agentAccessLoading ? "Đang kiểm tra" : needsFix ? "Cần sửa cấu hình" : cliMissing ? (agent.id === "antigravity" ? "Chưa cài app/CLI" : "CLI chưa cài") : status?.needsUpdate ? "Cần cập nhật" : status?.installed ? "Đã cài" : "Chưa kết nối";
            const statusClass = needsFix || (!cliMissing && status?.needsUpdate) ? "needs-fix" : status?.installed && !cliMissing ? "connected" : "disconnected";
            return <article className="agent-connect-card" key={agent.id}>
              <div className="agent-connect-card-heading"><strong>{agent.label}</strong><span className={statusClass}>{statusLabel}</span></div>
              <small>{status?.error === "CONFIG_ACCESS_FAILED" ? "Không đọc được file cấu hình. Kiểm tra quyền truy cập của tài khoản chạy StoryAI." : needsFix ? "File cấu hình bị lỗi. Nhấn bên dưới để sao lưu và tạo lại cấu hình." : cliMissing ? (agent.id === "antigravity" ? "Cài ứng dụng hoặc CLI Antigravity trên máy chạy StoryAI rồi tải lại trạng thái." : "Cài CLI này trên máy chạy StoryAI rồi tải lại trạng thái.") : status?.needsUpdate ? "Cấu hình MCP cũ hoặc token kết nối cần được cập nhật." : status?.installed ? (agent.id === "antigravity" ? "Đã tìm thấy cấu hình StoryAI MCP trong Antigravity." : "Đã tìm thấy cấu hình StoryAI MCP trong CLI.") : (agent.id === "antigravity" ? "Cài StoryAI MCP vào Antigravity để truy cập dự án và công cụ StoryAI." : "Cài StoryAI MCP vào CLI này để truy cập dự án và công cụ StoryAI.")}</small>
              {agent.id === "antigravity" && !agentAccessLoading && codingAgentCliStatuses.length > 0 && !cliEntry?.available && (
                <>
                  <small>Chưa cài <code>agy</code> CLI (cần nếu chọn Antigravity làm CLI chạy ngầm): <code>{agyInstallCmd}</code></small>
                  <button className="secondary-button compact" type="button" onClick={() => void installAntigravityCli()} disabled={installingAgyCli || agentAccessBusy}>
                    {installingAgyCli ? "Đang cài agy CLI…" : "Cài tự động agy CLI"}
                  </button>
                </>
              )}
              <code className="agent-config-path">{status?.configPath || agent.configName}</code>
              <button className={status?.installed && !status?.needsUpdate ? "secondary-button compact" : "primary-button compact"} type="button"
                onClick={() => void installAgent(agent.id)} disabled={!agentAccessStatus?.encryptionReady || agentAccessLoading || agentAccessBusy || status?.error === "CONFIG_ACCESS_FAILED" || (!needsFix && cliMissing)}>
                {needsFix ? "Sao lưu và sửa cấu hình" : cliMissing ? (agent.id === "antigravity" ? "Cài Antigravity trước" : "Cài CLI trước") : !agentAccessStatus?.configured ? "Tạo token & kết nối" : status?.installed && !status?.needsUpdate ? "Cập nhật cấu hình" : status?.needsUpdate ? "Kết nối lại" : "Kết nối"}
              </button>
            </article>;
          })}
        </div>
        <form className="agent-ugc-preference" onSubmit={(event) => void saveCodingAgentPreference(event)}>
          <div className="agent-ugc-preference-heading">
            <div><strong>Code Agent CLI mặc định</strong><small>CLI, model, chất lượng suy luận và speed được lưu trong tài khoản, dùng chung cho tạo title &amp; thumbnail, phân tích kịch bản, tách/dịch thoại và các template bán hàng.</small></div>
            {codingAgentPreference && <span>Đã lưu</span>}
          </div>
          <div className="agent-ugc-preference-fields">
            <label className="form-field"><span>CLI soạn kịch bản</span>
              <select value={selectedCodingAgent} onChange={(event) => {
                setSelectedCodingAgent(event.target.value as CodingAgentId);
                setSelectedCodingModel("");
                setSelectedCodingQuality("auto");
                setSelectedCodingSpeed("standard");
                setCustomCodingModel(false);
              }} disabled={agentAccessLoading || !codingAgentCliStatuses.some((agent) => agent.available)}>
                <option value="" disabled>{agentAccessLoading ? "Đang kiểm tra CLI…" : "Chưa tìm thấy CLI"}</option>
                {codingAgentCliStatuses.map((agent) => <option key={agent.id} value={agent.id} disabled={!agent.available}>{agent.label}{agent.available ? "" : " · chưa cài"}</option>)}
              </select>
            </label>
            <label className="form-field"><span>Model viết nội dung</span>
              <select value={codingModelSelectValue} onChange={(event) => {
                if (event.target.value === "__custom") { setSelectedCodingModel(""); setCustomCodingModel(true); }
                else {
                  setSelectedCodingModel(event.target.value);
                  setSelectedCodingQuality(selectedCliModels.find((model) => model.id === event.target.value)?.defaultReasoningEffort || "auto");
                  setSelectedCodingSpeed("standard");
                  setCustomCodingModel(false);
                }
              }} disabled={!selectedCliAgent?.available}>
                <option value="">Model mặc định của CLI</option>
                {selectedCliModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                <option value="__custom">Nhập model ID khác…</option>
              </select>
              {codingModelSelectValue === "__custom" && <input aria-label="Model ID Code Agent tùy chỉnh" value={selectedCodingModel} onChange={(event) => setSelectedCodingModel(event.target.value)} maxLength={120} placeholder="Model ID được CLI hỗ trợ" />}
              <small>{selectedCliAgent?.models.length ? "Danh sách được đọc từ CLI đã cài." : "Để trống dùng model mặc định; hoặc nhập model ID CLI hỗ trợ."}</small>
            </label>
          </div>
          <div className="agent-ugc-preference-fields">
            <label className="form-field"><span>Chất lượng soạn nội dung</span>
              <select value={codingQualityValue} onChange={(event) => setSelectedCodingQuality(event.target.value as CodingAgentPreference["quality"])} disabled={!codingEffortLevels.length}>
                <option value="auto">Tự động theo model</option>
                {codingEffortLevels.map((effort) => <option key={effort} value={effort}>{({ low: "Nhanh", medium: "Cân bằng", high: "Chất lượng cao", xhigh: "Rất cao", max: "Tối đa", ultra: "Ultra · mức cao nhất" } as Record<CodingAgentEffort, string>)[effort]} · {effort}</option>)}
              </select>
              <small>{codingEffortLevels.length ? "Mức cao hơn dành thêm thời gian suy luận để soạn kịch bản và prompt kỹ hơn." : "CLI hoặc model này không công bố mức chất lượng để chọn."}</small>
            </label>
            <label className="form-field"><span>Tốc độ Code Agent</span>
              <select value={codingSpeedAvailable ? selectedCodingSpeed : "standard"} onChange={(event) => setSelectedCodingSpeed(event.target.value as CodingAgentPreference["speed"])} disabled={!codingSpeedAvailable}>
                <option value="standard">Tiêu chuẩn</option>
                {codingSpeedAvailable && <option value="fast">Fast</option>}
              </select>
              <small>{codingSpeedAvailable ? "Fast gửi yêu cầu qua tier xử lý nhanh của model; mức phí có thể cao hơn." : "CLI hoặc model này không cung cấp lựa chọn speed riêng."}</small>
            </label>
          </div>
          <div className="agent-ugc-preference-footer">
            {codingPreferenceNotice && <div className={`seedance-account-notice ${codingPreferenceNotice.tone}`} role="status">{codingPreferenceNotice.text}</div>}
            <button type="submit" className="primary-button compact" disabled={!selectedCliAgent?.available || codingPreferenceBusy || Boolean(codingModelSelectValue === "__custom" && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/u.test(selectedCodingModel.trim()))}>{codingPreferenceBusy ? "Đang lưu…" : "Lưu cấu hình Code Agent"}</button>
          </div>
        </form>
        {agentAccessLoading && <p role="status">Đang đọc trạng thái token và cấu hình CLI…</p>}
        {agentAccessNotice && <div className={`seedance-account-notice ${agentAccessNotice.tone}`} role="status">{agentAccessNotice.text}</div>}
        <small className="seedance-key-help">Cấu hình được ghi trên máy chạy StoryAI vào thư mục CLI tương ứng. Sau khi kết nối, hãy khởi động lại terminal/agent. Tạo token mới sẽ yêu cầu cập nhật lại các CLI đã cài.</small>
        <small className="seedance-key-help">Mỗi máy tính cần chạy StoryAI riêng bằng npm start. Mở Cài đặt trên đúng máy đó rồi nhấn Kết nối; StoryAI sẽ ghi cấu hình MCP vào CLI đã cài trên chính máy, dùng localhost.</small>
      </section>
      <section className="settings-card settings-card-wide panel-card" id="maivideo-api-keys">
        <div className="section-kicker">MAIVIDEO</div>
        <h2>API key tạo ảnh, video và voice</h2>
        <p>Nhập API key từ MaiVideo Studio một lần để dùng chung cho tạo ảnh, video và TTS voice qua Public API. Key được xác thực trước khi lưu, gắn với tài khoản StoryAI và mã hóa trên máy chủ.</p>
        {!maiVideoKeysLoading && !maiVideoKeyStatus && <div className="seedance-settings-alert">Không đọc được trạng thái API key MaiVideo. Tải lại trang hoặc kiểm tra kết nối máy chủ.</div>}
        {!maiVideoKeysLoading && maiVideoKeyStatus && !maiVideoKeyStatus.encryptionReady && <div className="seedance-settings-alert">Máy chủ chưa cấu hình khóa mã hóa key. Cần STORYAI_CREDENTIALS_ENCRYPTION_KEY hoặc SEEDANCE_CREDENTIALS_ENCRYPTION_KEY dài ít nhất 32 ký tự.</div>}
        <form className="maivideo-api-key-form" onSubmit={(event) => void saveMaiVideoApiKey(event)}>
          <div className="maivideo-api-key-heading"><strong>MaiVideo Studio</strong><small>{maiVideoKeyStatusText(maiVideoKeyStatus)}</small></div>
          <div className="form-field">
            <label htmlFor="maivideo-api-key">API key MaiVideo (dùng cho tạo ảnh, video và voice)</label>
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
        <small className="seedance-key-help">API key được gửi qua header X-API-Key từ máy chủ StoryAI đến các endpoint MaiVideo; key không được đưa xuống trình duyệt.</small>
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
