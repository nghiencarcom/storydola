import { headers } from "next/headers";
import StudioShell from "../../dola-studio/components/studio-shell.js";

type DolaView = "overview" | "batch" | "queue" | "services" | "accounts" | "proxies" | "settings";

function isLocalHostname(host: string) {
  try {
    const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    return hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname === "::1"
      || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  } catch {
    return false;
  }
}

export async function DolaStudioWorkspace({ initialView }: { initialView: DolaView }) {
  const requestHeaders = await headers();
  const localMode = isLocalHostname(requestHeaders.get("host") || "");
  return <StudioShell embedded initialView={initialView} initialLocalMode={localMode} />;
}
