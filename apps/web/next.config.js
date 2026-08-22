/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Motor SDR roda em 127.0.0.1:3100 — API routes fazem proxy para lá
  // não expor porta pública direto do motor
  async rewrites() {
    return [];
  },
};

module.exports = nextConfig;
