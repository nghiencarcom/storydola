import { NextResponse } from "next/server";
import { deleteSeedanceAccount, setDefaultSeedanceAccount } from "../../../../lib/seedance-accounts";
import { readProjectScenes } from "../../../../lib/scene-store";
import { readData } from "../../../../lib/server-store";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  const body = await request.json().catch(() => ({})) as { isDefault?: unknown };
  if (body.isDefault !== true) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 400 });
  try {
    await setDefaultSeedanceAccount(accountId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Không tìm thấy tài khoản Seedance." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  try {
    const data = await readData();
    for (const project of data.projects) {
      if (project.mediaGeneration?.seedanceAccountId === accountId) {
        return NextResponse.json({ message: `Đang dùng tài khoản này trong project “${project.title}”. Hãy đổi tài khoản của project trước khi xoá.` }, { status: 409 });
      }
      const scenes = await readProjectScenes(project);
      if (scenes.some((scene) => {
        const setting = scene.mediaGeneration || scene.media_generation;
        return setting && typeof setting === "object" && !Array.isArray(setting)
          && (setting as Record<string, unknown>).seedanceAccountId === accountId;
      })) {
        return NextResponse.json({ message: `Đang dùng tài khoản này trong cảnh của project “${project.title}”. Hãy đổi tài khoản của cảnh trước khi xoá.` }, { status: 409 });
      }
    }
    await deleteSeedanceAccount(accountId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ message: "Không thể xoá tài khoản Seedance." }, { status: 404 });
  }
}
