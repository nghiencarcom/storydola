/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    // Scene media uploads use 50 MiB raw chunks, matching FB and MaiVideo.
    // Leave room for form overhead before the request reaches the route.
    proxyClientMaxBodySize: 55 * 1024 * 1024,
  },
};

export default nextConfig;
