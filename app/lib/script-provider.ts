import { getCodingAgentConfigStatuses } from "./agent-config-manager";
import { getCurrentUserId } from "./auth-server";
import { generateWithCodingAgent, getCodingAgentCliStatuses, type CodingAgent } from "./coding-agent-cli";
import { getCodingAgentPreference, type CodingAgentPreference } from "./coding-agent-preferences";

export async function resolveConfiguredCodingAgent(userIdOverride?: string | null): Promise<CodingAgentPreference | undefined> {
  const userId = userIdOverride?.trim() || await getCurrentUserId().catch(() => "");
  const [preference, statuses] = await Promise.all([
    userId ? getCodingAgentPreference(userId).catch(() => undefined) : Promise.resolve(undefined),
    getCodingAgentCliStatuses({ includeModels: false }).catch(() => []),
  ]);
  const available = statuses.filter((item) => item.available);
  if (!available.length) return undefined;
  if (preference && available.some((item) => item.id === preference.agent)) {
    return preference;
  }
  const configStatuses = await getCodingAgentConfigStatuses().catch(() => undefined);
  if (configStatuses) {
    const connected = available.find((item) => configStatuses[item.id]?.installed && !configStatuses[item.id]?.error);
    if (connected) {
      return { agent: connected.id, model: "", quality: "auto", speed: "standard" };
    }
  }
  const envAgent = (process.env.STORYAI_SCRIPT_AGENT || process.env.STORYAI_SALES_UGC_AGENT || "").trim();
  const fromEnv = available.find((item) => item.id === envAgent);
  if (fromEnv) {
    return { agent: fromEnv.id, model: "", quality: "auto", speed: "standard" };
  }
  return { agent: available[0].id, model: "", quality: "auto", speed: "standard" };
}

export async function getCodeAgentProviderSummary(userIdOverride?: string | null) {
  const userId = userIdOverride?.trim() || await getCurrentUserId().catch(() => "");
  const [agent, statuses] = await Promise.all([
    resolveConfiguredCodingAgent(userId),
    getCodingAgentCliStatuses({ includeModels: false }).catch(() => []),
  ]);
  const available = statuses.filter((item) => item.available);
  return {
    baseUrl: "local-cli",
    primaryModel: agent ? (agent.model ? `${agent.agent} · ${agent.model}` : `${agent.agent} (mặc định)`) : "Chưa kết nối CLI",
    fallbackModels: available.filter((item) => item.id !== agent?.agent).map((item) => item.label),
    reasoningEffort: agent?.quality || "auto",
    serviceTier: agent?.speed || "standard",
    standard: "code-agent-cli",
    keyConfigured: Boolean(agent),
  };
}

export async function generateWithScriptProvider(
  prompt: string,
  options?: { promptOnlyJson?: boolean; userId?: string | null; agent?: CodingAgent },
) {
  const userId = options?.userId?.trim() || await getCurrentUserId().catch(() => "");
  let codingAgent: CodingAgentPreference | undefined;
  if (options?.agent) {
    const pref = userId ? await getCodingAgentPreference(userId).catch(() => undefined) : undefined;
    codingAgent = pref?.agent === options.agent
      ? pref
      : { agent: options.agent, model: "", quality: "auto", speed: "standard" };
  } else {
    codingAgent = await resolveConfiguredCodingAgent(userId);
  }
  if (!codingAgent) {
    const error = new Error("SCRIPT_LLM_NOT_CONFIGURED");
    error.name = "SCRIPT_LLM_NOT_CONFIGURED";
    throw error;
  }
  const generated = await generateWithCodingAgent(codingAgent.agent, prompt, {
    promptOnlyJson: options?.promptOnlyJson ?? true,
    model: codingAgent.model,
    quality: codingAgent.quality,
    speed: codingAgent.speed,
  });
  const raw = typeof generated.result === "string" ? generated.result : JSON.stringify(generated.result);
  return { model: generated.model, result: generated.result, raw };
}
