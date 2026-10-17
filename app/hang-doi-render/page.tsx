import { AppShell } from "../components/app-shell";
import { DolaStudioWorkspace } from "../components/dola-studio-workspace";

export default function DolaQueuePage() {
  return <AppShell><DolaStudioWorkspace initialView="queue" /></AppShell>;
}
