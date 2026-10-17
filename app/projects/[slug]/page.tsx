import { AppShell } from "../../components/app-shell";
import { DashboardView } from "../../components/dashboard-view";
import { notFound } from "next/navigation";
import { readData } from "../../lib/server-store";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await readData();
  if (!data.projects.some((project) => project.slug === slug)) notFound();
  return <AppShell><DashboardView projectSlug={slug} /></AppShell>;
}
