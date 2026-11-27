import { AppShell } from "../../components/app-shell";
import { MotionVideoView } from "../../components/motion-video-view";

export default async function MotionVideoJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return (
    <AppShell>
      <MotionVideoView initialJobId={jobId} />
    </AppShell>
  );
}
