import { AppShell } from "../../components/app-shell";
import { AutoEditView } from "../../components/auto-edit-view";

export default async function AutoEditJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return (
    <AppShell>
      <AutoEditView initialJobId={jobId} />
    </AppShell>
  );
}
