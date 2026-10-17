import { NextResponse } from "next/server";
import {
  BatchLocalMediaError,
  deleteBatchReferenceImages,
  isLocalOnlyRequest,
  listBatchReferenceImages,
  storeBatchReferenceImages
} from "../../../../lib/batch-local-media.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localOnlyResponse() {
  return NextResponse.json({ error: "Ảnh tham chiếu chỉ được quản lý trên máy local." }, { status: 403 });
}

function errorResponse(error) {
  const status = error instanceof BatchLocalMediaError ? error.status : 500;
  const message = error instanceof BatchLocalMediaError ? error.message : "Không thể xử lý thư viện ảnh local.";
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request) {
  if (!isLocalOnlyRequest(request)) return localOnlyResponse();
  try {
    const items = await listBatchReferenceImages(request);
    return NextResponse.json({ success: true, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  if (!isLocalOnlyRequest(request)) return localOnlyResponse();
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Dữ liệu upload không hợp lệ" }, { status: 400 });
  }

  const files = [...formData.getAll("files"), formData.get("file")];
  try {
    const items = await storeBatchReferenceImages(files, request);
    return NextResponse.json({ success: true, items, item: items[0] || null, uploaded_count: items.length }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request) {
  if (!isLocalOnlyRequest(request)) return localOnlyResponse();
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  try {
    const deletedIds = await deleteBatchReferenceImages(body?.ids);
    return NextResponse.json({ success: true, deleted_ids: deletedIds, deleted_count: deletedIds.length }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
