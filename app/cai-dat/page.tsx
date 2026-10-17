import { AppShell } from "../components/app-shell";
import { DolaStudioWorkspace } from "../components/dola-studio-workspace";

export default function DolaSettingsPage() {
  return <AppShell><DolaStudioWorkspace initialView="settings" /></AppShell>;
}
