import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // App lives under src/app.
  // Keep the serverless-Chromium binary out of the bundler (WP-17b render route).
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
};

export default nextConfig;
