"use client";

import { useEffect, useState } from "react";
import { Icon } from "./ui-icon";

type User = { name: string; email: string; local?: boolean };

export function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => { if (active) setUser(payload.user || null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  if (!user) return null;
  return (
    <div className="user-menu">
      <div className="user-avatar" aria-hidden="true">{(user.name || user.email).trim().charAt(0).toLocaleUpperCase("vi-VN")}</div>
      <div className="user-menu-copy"><strong>{user.name}</strong><span>{user.local ? "Đang chạy cục bộ · không cần đăng nhập" : user.email}</span></div>
      {!user.local && <button className="user-logout" onClick={logout} disabled={busy} aria-label="Đăng xuất" title="Đăng xuất"><Icon name="logout" size={16} /></button>}
    </div>
  );
}
