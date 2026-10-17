import { AppShell } from "../components/app-shell";
import { ProjectsView } from "../components/projects-view";

export default function StoryPage() {
  return <AppShell><ProjectsView presetFilter="story" /></AppShell>;
}
