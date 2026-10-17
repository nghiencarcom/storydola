"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body = isRegister
      ? { email: form.get("email"), password: form.get("password"), password_confirm: form.get("password_confirm") }
      : { email: form.get("email"), password: form.get("password") };
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Không thể đăng nhập.");
      const next = new URLSearchParams(window.location.search).get("next");
      const destination = next ? new URL(next, window.location.origin) : null;
      window.location.assign(destination?.origin === window.location.origin ? destination.href : "/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Đã xảy ra lỗi. Vui lòng thử lại.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link href="/login" className="auth-brand"><img src="/branding/maivideo-logo-accurate-header.png" alt="MaiVideo" /></Link>
        <div className="auth-heading">
          <span className="auth-kicker">STORYAI STUDIO</span>
          <h1>{isRegister ? "Tạo tài khoản MaiVideo" : "Đăng nhập MaiVideo"}</h1>
          <p>{isRegister ? "Tài khoản MaiVideo dùng chung cho StoryAI và các dịch vụ MaiVideo." : "Dùng email và mật khẩu tài khoản MaiVideo của bạn."}</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label className="auth-field"><span>Email MaiVideo</span><input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          <label className="auth-field"><span>Mật khẩu MaiVideo</span><input name="password" type="password" autoComplete={isRegister ? "new-password" : "current-password"} minLength={isRegister ? 8 : undefined} maxLength={256} required />{isRegister && <small>Tối thiểu 8 ký tự</small>}</label>
          {isRegister && <label className="auth-field"><span>Nhập lại mật khẩu</span><input name="password_confirm" type="password" autoComplete="new-password" minLength={8} maxLength={256} required /></label>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Đang xử lý…" : isRegister ? "Đăng ký MaiVideo" : "Đăng nhập"}</button>
        </form>
        <p className="auth-switch">{isRegister ? <>Đã có tài khoản? <Link href="/login">Đăng nhập</Link></> : <>Chưa có tài khoản? <Link href="/register">Đăng ký</Link></>}</p>
      </section>
    </main>
  );
}
