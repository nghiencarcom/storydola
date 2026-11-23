/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build a minimal production server image for the local Docker installer.
  output: "standalone",
  // StoryAI reads and writes these files at runtime. They contain user
  // projects, media, and API credentials, so they must stay in the persistent
  // runtime data directory and must not enter Next.js deployment traces.
  outputFileTracingExcludes: {
    "/*": ["./data/**/*"],
  },
  experimental: {
    // Sales-video accepts up to 100 MiB of files plus multipart form overhead.
    proxyClientMaxBodySize: 105 * 1024 * 1024,
  },
};

export default nextConfig;
