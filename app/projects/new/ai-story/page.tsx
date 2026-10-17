import { AppShell } from "../../../components/app-shell";
import { NewProjectView } from "../../../components/new-project-view";

export default function CreateAiStoryPage() {
  return <AppShell><NewProjectView fixedPresetId="ai-story" /></AppShell>;
}
