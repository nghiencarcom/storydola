export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: ["/docs", "/openapi.json", "/swagger", "/redoc"],
      disallow: "/api/"
    },
    sitemap: "https://seedance.maivideo.top/sitemap.xml"
  };
}
