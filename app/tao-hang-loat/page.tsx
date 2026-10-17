import { AppShell } from "../components/app-shell";
import { DolaStudioWorkspace } from "../components/dola-studio-workspace";

export default function BatchStudioPage() {
  return <AppShell><DolaStudioWorkspace initialView="batch" /></AppShell>;
}
