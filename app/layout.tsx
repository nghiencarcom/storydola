import type { Metadata } from "next";
import "../dola-studio/app/globals.css";
import "./globals.css";
import { ProjectProvider } from "./lib/project-store";

export const metadata: Metadata = {
  title: "StoryAI — Long-form Story Studio",
  description: "Biến nguồn truyện dài thành kịch bản cảnh 15 giây.",
  icons: {
    icon: "/branding/maivideo-avatar.png",
    apple: "/branding/maivideo-avatar.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body><ProjectProvider>{children}</ProjectProvider></body>
    </html>
  );
}
