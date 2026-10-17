import "./globals.css";

// This dashboard reads account- and task-specific data in the browser. Keep
// the HTML/RSC shell request-time rendered so a browser or intermediary cannot
// retain a year-long static snapshot across deployments.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dola Studio · Seedance Batch",
  description: "Điều phối tạo video Seedance hàng loạt cùng hệ sinh thái MaiVideo.",
  applicationName: "Dola Studio",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
