import { AppShell } from "../../../components/app-shell";
import { NewProjectView } from "../../../components/new-project-view";
import { notFound } from "next/navigation";
import { readData } from "../../../lib/server-store";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await readData();
  if (!data.projects.some((project) => project.slug === slug)) notFound();
  return <AppShell><NewProjectView projectSlug={slug} /></AppShell>;
}
