/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@crawlee/cheerio"],
  },
};

export default nextConfig;
