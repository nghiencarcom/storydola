import { AppShell } from "../../../components/app-shell";
import { NewProjectView } from "../../../components/new-project-view";

export default function CreateAudioStoryPage() {
  return <AppShell><NewProjectView fixedPresetId="audio-story" /></AppShell>;
}
