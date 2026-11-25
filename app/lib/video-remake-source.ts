const platforms = {
  youtube: { label: "YouTube", extractors: "youtube", maiVideo: true },
  facebook: { label: "Facebook", extractors: "facebook,facebook:reel", maiVideo: true },
  tiktok: { label: "TikTok", extractors: "TikTok", maiVideo: true },
  douyin: { label: "Douyin", extractors: "Douyin", maiVideo: false },
  instagram: { label: "Instagram", extractors: "Instagram", maiVideo: false },
} as const;

export function classifyRemakeSource(url: URL) {
  if (url.protocol !== "https:" || url.port || url.username || url.password) throw new Error("Link video phải dùng HTTPS công khai.");
  const { hostname: host, pathname, searchParams } = url;
  const source = (platform: keyof typeof platforms, href: string, short = false) => ({
    platform, ...platforms[platform], url: href, short,
  });
  const invalid = (label: string): never => { throw new Error(`Hãy nhập link trực tiếp của một video công khai trên ${label}.`); };

  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
    const id = host === "youtu.be" ? pathname.match(/^\/([\w-]+)\/?$/u)?.[1]
      : pathname === "/watch" ? searchParams.get("v") : pathname.match(/^\/(?:shorts|live)\/([\w-]+)\/?$/u)?.[1];
    if (!id || !/^[\w-]{11}$/u.test(id)) return invalid("YouTube");
    return source("youtube", `https://www.youtube.com/watch?v=${id}`);
  }

  if (["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"].includes(host)) {
    if ((host === "fb.watch" && /^\/[\w-]+\/?$/u.test(pathname))
      || (host !== "fb.watch" && /^\/share\/(?:r|v|p)\/[\w-]+\/?$/u.test(pathname))) {
      return source("facebook", `https://${host}${pathname}`, true);
    }
    if (host === "fb.watch") return invalid("Facebook");
    const reel = pathname.match(/^\/reels?\/(\d+)\/?$/u)?.[1];
    if (reel) return source("facebook", `https://www.facebook.com/reel/${reel}/`);
    const id = pathname.match(/^(?:\/[\w.-]+)*\/videos\/(?:[\w.-]+\/)?(\d+)\/?$/u)?.[1]
      || (/^\/(?:watch\/?|video\.php)$/u.test(pathname) ? searchParams.get("v") : "");
    if (!id || !/^\d+$/u.test(id)) return invalid("Facebook");
    return source("facebook", `https://www.facebook.com/watch/?v=${id}`);
  }

  if (["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(host)) {
    if ((["vm.tiktok.com", "vt.tiktok.com"].includes(host) && /^\/[\w-]+\/?$/u.test(pathname))
      || /^\/t\/[\w-]+\/?$/u.test(pathname)) return source("tiktok", `https://${host}${pathname}`, true);
    const video = pathname.match(/^\/(?:@[\w.-]+|share|embed)\/video\/\d+\/?$/u)?.[0]
      || pathname.match(/^\/embed(?:\/v2)?\/(\d+)\/?$/u)?.[1];
    if (!video) return invalid("TikTok");
    return source("tiktok", `https://www.tiktok.com${video.startsWith("/") ? video : `/share/video/${video}`}`);
  }

  if (["douyin.com", "www.douyin.com", "m.douyin.com", "v.douyin.com", "www.iesdouyin.com"].includes(host)) {
    if (host === "v.douyin.com" && /^\/[\w-]+\/?$/u.test(pathname)) return source("douyin", `https://${host}${pathname}`, true);
    const id = pathname.match(/^\/(?:share\/)?video\/(\d+)\/?$/u)?.[1]
      || (["/", "/jingxuan"].includes(pathname) ? searchParams.get("modal_id") : "");
    if (!id || !/^\d+$/u.test(id)) return invalid("Douyin");
    return source("douyin", `https://www.douyin.com/video/${id}`);
  }

  if (["instagram.com", "www.instagram.com", "m.instagram.com"].includes(host)) {
    const media = pathname.match(/^\/(?:p|reels?|tv)\/[\w-]+\/?$/u)?.[0];
    if (!media) return invalid("Instagram");
    return source("instagram", `https://www.instagram.com${media.replace(/^\/reels\//u, "/reel/")}`);
  }
  return undefined;
}
