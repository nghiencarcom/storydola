import { AppShell } from "../components/app-shell";
import { DolaStudioWorkspace } from "../components/dola-studio-workspace";

export default function DolaOverviewPage() {
  return <AppShell><DolaStudioWorkspace initialView="overview" /></AppShell>;
}
