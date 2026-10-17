const nextConfig = {
  // Keep production artifacts separate from the .next directory used by
  // next dev. This allows npm start to build/check production without
  // invalidating an active development server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false,
  poweredByHeader: false,
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "seedance.maivideo.top"
  ],
  async rewrites() {
    const gatewayOrigin = (process.env.DOLA_GATEWAY_URL || "http://127.0.0.1:8200").replace(/\/+$/, "");
    return [
      { source: "/swagger", destination: gatewayOrigin + "/docs" },
      { source: "/redoc", destination: gatewayOrigin + "/redoc" },
      { source: "/openapi.json", destination: gatewayOrigin + "/openapi.json" },
      { source: "/v1/:path*", destination: gatewayOrigin + "/v1/:path*" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" }
        ]
      }
    ];
  }
};

export default nextConfig;
