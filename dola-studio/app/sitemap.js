const publicOrigin = "https://seedance.maivideo.top";

export default function sitemap() {
  return ["/docs", "/openapi.json", "/swagger", "/redoc"].map((path) => ({
    url: `${publicOrigin}${path}`
  }));
}
