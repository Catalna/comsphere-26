/** @type {import('next').NextConfig} */
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const nextConfig = {
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
