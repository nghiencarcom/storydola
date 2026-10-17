import { GET as getVideo, HEAD as headVideo } from "@/dola-studio/app/videos/[...path]/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = getVideo;
export const HEAD = headVideo;
