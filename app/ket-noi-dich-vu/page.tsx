import { AppShell } from "../components/app-shell";
import { DolaStudioWorkspace } from "../components/dola-studio-workspace";

export default function DolaServicesPage() {
  return <AppShell><DolaStudioWorkspace initialView="services" /></AppShell>;
}
