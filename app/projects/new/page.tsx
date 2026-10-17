import { redirect } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { NewProjectChooser } from "../../components/new-project-chooser";

const supportedPresets = new Set(["ai-story", "audio-story", "ai-drama"]);

export default async function NewProjectPage({ searchParams }: { searchParams?: Promise<{ preset?: string }> }) {
  const preset = (await searchParams)?.preset;
  if (preset && supportedPresets.has(preset)) redirect(`/projects/new/${preset}`);
  return <AppShell><NewProjectChooser /></AppShell>;
}
