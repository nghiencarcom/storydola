import StudioShell from "@/components/studio-shell";

export default async function BatchPage({ searchParams }) {
  const params = await searchParams;
  return <StudioShell embedded={params?.embed === "storyai"} />;
}
