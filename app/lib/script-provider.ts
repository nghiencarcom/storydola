import { getOpenAIApiKey } from "./openai-api-keys";

type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  primaryModel: string;
  fallbackModels: string[];
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  serviceTier: "auto" | "default" | "flex" | "fast";
  standard: string;
};

type ScriptProviderFailure = Error & {
  statusCode?: number;
  providerCode?: string;
  retryAfterMs?: number;
};

const SCRIPT_PROVIDER_MAX_ATTEMPTS = 3;
const SCRIPT_PROVIDER_RETRY_DELAYS_MS = [1_000, 3_000] as const;

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15_000, seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.min(15_000, Math.max(0, timestamp - Date.now())) : undefined;
}

function isRetryableScriptProviderFailure(cause: unknown) {
  if (!(cause instanceof Error)) return false;
  const failure = cause as ScriptProviderFailure;
  if (cause.name === "TimeoutError" || cause.name === "AbortError") return false;

  if (failure.statusCode) {
    const code = (failure.providerCode || "").toLowerCase();
    if (/insufficient_quota|billing_hard_limit|invalid_api_key|model_not_found|unsupported_parameter|invalid_request_error/.test(code)) return false;
    return [408, 425, 429, 500, 502, 503, 504].includes(failure.statusCode);
  }

  const message = cause.message.toLowerCase();
  if (/^model_output_(invalid_json|incomplete):/.test(message) || message === "empty model response") return true;
  if (cause instanceof TypeError && (/^fetch failed$/.test(message) || /network|socket|connect|econnreset|eai_again|etimedout/.test(message))) return true;

  let nested: unknown = (cause as Error & { cause?: unknown }).cause;
  for (let depth = 0; depth < 4 && nested; depth += 1) {
    if (nested && typeof nested === "object") {
      const item = nested as { code?: unknown; cause?: unknown };
      const code = typeof item.code === "string" ? item.code : "";
      if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code)) return true;
      nested = item.cause;
    } else {
      break;
    }
  }
  return false;
}

function retryDelay(attempt: number, cause: unknown) {
  const fromProvider = cause instanceof Error ? (cause as ScriptProviderFailure).retryAfterMs : undefined;
  return fromProvider ?? SCRIPT_PROVIDER_RETRY_DELAYS_MS[Math.min(attempt - 1, SCRIPT_PROVIDER_RETRY_DELAYS_MS.length - 1)];
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function failureMessage(cause: unknown, timeoutMs: number) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const isTimeout = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
  return isTimeout
    ? `AI không phản hồi trong ${Math.ceil(timeoutMs / 60_000)} phút; chưa nhận được kết quả để lưu.`
    : message;
}

export async function getProviderConfig(): Promise<ProviderConfig & { keyConfigured: boolean }> {
  const apiKey = await getOpenAIApiKey();
  const baseUrl = process.env.HTMLVIDEO_SCRIPT_LLM_BASE_URL || "https://api.openai.com/v1";
  const primaryModel = process.env.HTMLVIDEO_SCRIPT_LLM_MODEL || "gpt-6-luna";
  const fallbackModels = (process.env.HTMLVIDEO_SCRIPT_LLM_FALLBACK_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const supportedEfforts = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
  const configuredEffort = process.env.HTMLVIDEO_SCRIPT_LLM_REASONING_EFFORT?.trim() || "max";
  const reasoningEffort = (supportedEfforts.has(configuredEffort) ? configuredEffort : "max") as ProviderConfig["reasoningEffort"];
  const supportedServiceTiers = new Set(["auto", "default", "flex", "fast"]);
  const configuredServiceTier = process.env.HTMLVIDEO_SCRIPT_LLM_SERVICE_TIER?.trim().toLowerCase() || "fast";
  const serviceTier = (supportedServiceTiers.has(configuredServiceTier) ? configuredServiceTier : "fast") as ProviderConfig["serviceTier"];
  const standard = process.env.HTMLVIDEO_SCRIPT_LLM_STANDARD || "openai";
  return { apiKey, baseUrl, primaryModel, fallbackModels, reasoningEffort, serviceTier, standard, keyConfigured: Boolean(apiKey) };
}

function parseJsonContent(content: unknown) {
  if (typeof content !== "string") return content;
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // A few compatible providers wrap JSON in a short preamble even when asked
    // for JSON only. Recover the object when possible, but fail the model
    // attempt if its output is truncated or malformed so the configured
    // fallback model can try instead of passing a fake `{ raw }` result down
    // the pipeline.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // Keep the original parse failure as a useful signal below.
      }
    }
    const error = new Error("MODEL_OUTPUT_INVALID_JSON: AI trả về JSON thiếu hoặc không hợp lệ.");
    error.name = "MODEL_OUTPUT_INVALID_JSON";
    throw error;
  }
}

export async function generateWithScriptProvider(prompt: string) {
  const config = await getProviderConfig();
  if (!config.keyConfigured) {
    const error = new Error("SCRIPT_LLM_NOT_CONFIGURED");
    error.name = "SCRIPT_LLM_NOT_CONFIGURED";
    throw error;
  }

  const configuredTimeout = Number(process.env.HTMLVIDEO_SCRIPT_LLM_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 10_000
    ? Math.min(configuredTimeout, 15 * 60_000)
    : 5 * 60_000;
  const errors: string[] = [];
  for (const model of [config.primaryModel, ...config.fallbackModels.filter((item) => item !== config.primaryModel)]) {
    for (let attempt = 1; attempt <= SCRIPT_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model,
            input: prompt,
            reasoning: { effort: config.reasoningEffort },
            service_tier: config.serviceTier,
            store: false,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const apiError = payload?.error || {};
          const error = new Error(apiError?.message || payload?.message || `HTTP ${response.status}`) as ScriptProviderFailure;
          error.statusCode = response.status;
          error.providerCode = typeof apiError?.code === "string" ? apiError.code : typeof apiError?.type === "string" ? apiError.type : undefined;
          error.retryAfterMs = retryAfterMs(response.headers.get("retry-after"));
          throw error;
        }
        if (payload?.status === "incomplete") {
          const reason = typeof payload?.incomplete_details?.reason === "string" ? payload.incomplete_details.reason : "unknown";
          throw new Error(`MODEL_OUTPUT_INCOMPLETE: AI dừng trước khi hoàn tất phản hồi (${reason}).`);
        }
        const content = typeof payload?.output_text === "string"
          ? payload.output_text
          : Array.isArray(payload?.output)
            ? payload.output
              .filter((item: { type?: unknown }) => item?.type === "message")
              .flatMap((item: { content?: unknown }) => Array.isArray(item.content) ? item.content : [])
              .filter((item: { type?: unknown; text?: unknown }) => item?.type === "output_text" && typeof item.text === "string")
              .map((item: { text: string }) => item.text)
              .join("")
            : "";
        if (!content) throw new Error("empty model response");
        return { model, result: parseJsonContent(content), raw: content };
      } catch (cause) {
        if (attempt < SCRIPT_PROVIDER_MAX_ATTEMPTS && isRetryableScriptProviderFailure(cause)) {
          const delay = retryDelay(attempt, cause);
          console.warn(`[script-provider] transient ${cause instanceof Error ? cause.name : "provider"} failure for ${model}; retry ${attempt + 1}/${SCRIPT_PROVIDER_MAX_ATTEMPTS} in ${delay}ms`);
          await wait(delay);
          continue;
        }
        const failure = cause as ScriptProviderFailure;
        const status = failure.statusCode ? `HTTP ${failure.statusCode}: ` : "";
        errors.push(`${model}: ${status}${failureMessage(cause, timeoutMs)}`);
        break;
      }
    }
  }
  const error = new Error(errors.join(" | ") || "All script models failed");
  error.name = "SCRIPT_LLM_FAILED";
  throw error;
}
