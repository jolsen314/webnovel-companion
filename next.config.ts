import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // App lives under src/app.
  // WP-17b render route: keep the serverless-Chromium package out of the bundler, AND
  // force the file-tracer to ship its bin/ binary (loaded via a computed path, so it's
  // otherwise pruned from the function — the "bin does not exist" runtime error).
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  outputFileTracingIncludes: {
    '/api/render': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
};

export default nextConfig;
