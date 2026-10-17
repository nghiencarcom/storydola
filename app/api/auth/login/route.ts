import { NextResponse } from "next/server";
import { proxyMaiVideoPasswordAuth } from "../../../lib/maivideo-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ message: "Nhập email và mật khẩu MaiVideo để đăng nhập." }, { status: 400 });
  if (email.length > 254 || password.length > 256) return NextResponse.json({ message: "Email hoặc mật khẩu không hợp lệ." }, { status: 400 });
  return proxyMaiVideoPasswordAuth(request, "login", { email, password });
}
