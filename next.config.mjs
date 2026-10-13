/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: process.env.NODE_ENV === 'development' ? '.next' : 'build/renderer',
  trailingSlash: true,
  assetPrefix: process.env.VERCEL || process.env.NODE_ENV === 'development' ? undefined : './',
  typescript: { ignoreBuildErrors: false },
};
export default nextConfig;
