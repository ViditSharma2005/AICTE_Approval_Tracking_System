/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Allows the app to be opened through a proxied preview host in development.
  allowedDevOrigins: ["*.e2b.app", "*.arena.ai", "localhost:3000"],
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
      // Allows the app to be driven through a proxied/forwarded host (deploy demos).
      allowedOrigins: ["localhost:3000", "127.0.0.1:3000", "*.e2b.app"],
    },
  },
};

export default nextConfig;
