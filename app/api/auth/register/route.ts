import { NextResponse } from "next/server";
import { proxyMaiVideoPasswordAuth } from "../../../lib/maivideo-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const passwordConfirm = typeof body.password_confirm === "string" ? body.password_confirm : "";
  const referralCode = typeof body.referral_code === "string" ? body.referral_code.trim().slice(0, 80) : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ message: "Email chưa đúng định dạng." }, { status: 400 });
  }
  if (password.length < 8 || password.length > 256) {
    return NextResponse.json({ message: "Mật khẩu MaiVideo cần ít nhất 8 ký tự." }, { status: 400 });
  }
  if (password !== passwordConfirm) {
    return NextResponse.json({ message: "Mật khẩu nhập lại chưa khớp." }, { status: 400 });
  }

  return proxyMaiVideoPasswordAuth(request, "register", {
    email,
    password,
    password_confirm: passwordConfirm,
    ...(referralCode ? { referral_code: referralCode } : {}),
  });
}
