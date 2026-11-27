export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverSalesVideos } = await import("./app/lib/sales-video-recovery");
    void recoverSalesVideos().catch(error => console.error("Sales video recovery failed", error));
    const { runRemakeQueue } = await import("./app/lib/video-remake-worker");
    void runRemakeQueue().catch(error => console.error("Video remake recovery failed", error));
    const { runAutoEditQueue } = await import("./app/lib/auto-edit-worker");
    void runAutoEditQueue().catch(error => console.error("Auto edit recovery failed", error));
    const { runCreateVideoQueue } = await import("./app/lib/motion-video-worker");
    void runCreateVideoQueue().catch(error => console.error("Motion video recovery failed", error));
  }
}
