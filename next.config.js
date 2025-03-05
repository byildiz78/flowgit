/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ['node-imap', 'imap', 'mailparser'],
    esmExternals: 'loose',
    serverActions: false
  },
  // Ensure public directory is properly copied to standalone output
  outputFileTracing: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        buffer: false
      };
    }
    return config;
  }
};

module.exports = nextConfig;