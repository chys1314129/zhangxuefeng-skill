/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['*.e2b.app', 'localhost:3000', '0.0.0.0:3000'],
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'node:sqlite': 'commonjs node:sqlite',
      });
    }
    return config;
  },
};

export default nextConfig;
