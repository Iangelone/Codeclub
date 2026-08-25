/** @type {import('next').NextConfig} */
const nextConfig = { output: 'export', distDir: 'out', trailingSlash: true, assetPrefix: process.env.VERCEL || process.env.NODE_ENV === 'development' ? undefined : './', typescript: { ignoreBuildErrors: true } };
export default nextConfig;
