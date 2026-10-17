import { AppShell } from "../components/app-shell";
import { ProjectsView } from "../components/projects-view";

export default function AiDramaPage() {
  return <AppShell><ProjectsView presetFilter="ai-drama" /></AppShell>;
}
