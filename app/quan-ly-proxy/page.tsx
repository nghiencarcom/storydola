import { AppShell } from "../components/app-shell";
import { DolaStudioWorkspace } from "../components/dola-studio-workspace";

export default function ProxyManagementPage() {
  return <AppShell><DolaStudioWorkspace initialView="proxies" /></AppShell>;
}
