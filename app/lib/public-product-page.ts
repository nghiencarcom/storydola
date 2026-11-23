import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPublicIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113));
}

function isPublicIp(address: string) {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version !== 6) return false;
  const value = address.toLowerCase();
  return !(value === "::" || value === "::1" || value.startsWith("fe8") || value.startsWith("fe9")
    || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("fc")
    || value.startsWith("fd") || value.startsWith("ff") || value.startsWith("::ffff:"));
}

async function validatePublicHttpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname
    || url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")
    || url.hostname.endsWith(".internal") || isIP(url.hostname)) {
    throw new Error("Only public HTTPS product links are supported.");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error("The product link does not resolve to a public host.");
  }
  return url;
}

function decodeHtml(value: string) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number(code);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => {
      const point = parseInt(code, 16);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    });
}

function pageText(html: string) {
  const metadata = [...html.matchAll(/<meta\b[^>]*(?:name|property)=["'](?:description|og:title|og:description|product:brand|product:availability)["'][^>]*>/gi)]
    .map(([tag]) => tag.match(/content=["']([^"']*)["']/i)?.[1] || "");
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const visible = html.replace(/<(script|style|svg|noscript|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ").replace(/<[^>]+>/g, " ");
  return decodeHtml([title, ...metadata, visible].join(" ")).replace(/\s+/g, " ").trim().slice(0, 8_000);
}

export async function readPublicProductPage(value: string, signal: AbortSignal) {
  let url = await validatePublicHttpsUrl(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9", "User-Agent": "StoryAI/1.0" },
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("Too many redirects while reading product link.");
      url = await validatePublicHttpsUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !/^(?:text\/(?:html|xhtml)|application\/xhtml\+xml)/i.test(response.headers.get("content-type") || "")) {
      throw new Error(`Product page returned HTTP ${response.status}.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Product page has no readable body.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > 1_500_000) {
        await reader.cancel();
        throw new Error("Product page is too large to read safely.");
      }
      chunks.push(chunk);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    return pageText(html);
  }
  throw new Error("Could not read product page.");
}
