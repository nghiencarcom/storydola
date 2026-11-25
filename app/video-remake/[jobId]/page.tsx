import { AppShell } from "../../components/app-shell";
import { VideoRemakeView } from "../../components/video-remake-view";

export default async function VideoRemakeJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <AppShell><VideoRemakeView initialJobId={jobId} /></AppShell>;
}
