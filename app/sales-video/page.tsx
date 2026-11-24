import { Suspense } from "react";
import { AppShell } from "../components/app-shell";
import { SalesVideoView } from "../components/sales-video-view";

export default function SalesVideoPage() {
  return <AppShell><Suspense fallback={<p role="status">Đang tải video bán hàng…</p>}><SalesVideoView /></Suspense></AppShell>;
}
