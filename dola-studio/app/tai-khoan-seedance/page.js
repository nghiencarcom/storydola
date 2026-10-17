import StudioShell from "@/components/studio-shell";

export default async function AccountsPage({ searchParams }) {
  const params = await searchParams;
  return <StudioShell embedded={params?.embed === "storyai"} />;
}
