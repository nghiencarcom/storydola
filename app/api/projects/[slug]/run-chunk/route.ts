import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({
    ok: false,
    code: "SCRIPT_RUN_DISABLED",
    message: "Chạy kịch bản tự động đã tắt. Hãy nhập từng tập bằng JSON scene-script.v1.",
  }, { status: 403 });
}
