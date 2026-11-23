const templatePhotos: Record<string, string> = {
  general: "general", fashion: "fashion", home: "home", snacks: "snacks",
  consumer: "consumer", beauty: "beauty", baby: "baby", tech: "tech",
  accessories: "accessories", footwear: "footwear", decor: "decor", school: "school",
  supplements: "supplements", toys: "toys", vehicles: "vehicles", pets: "pets",
  "poses-2": "poses-2", "poses-4": "poses-4", "poses-6": "poses-6",
  "poses-narrated": "poses-narrated", "replace-background": "replace-background", "ad-remake": "ad-remake",
};

export function SalesVideoTemplateArtwork({ id }: { id: string }) {
  const photo = templatePhotos[id] || "general";
  return <img
    className="sales-template-artwork"
    src={`/sales-video/templates/${photo}.webp`}
    alt=""
    loading="lazy"
    decoding="async"
  />;
}
