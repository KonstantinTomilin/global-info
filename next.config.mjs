/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep Playwright out of the Next server webpack graph (instrumentation / API routes).
  // linkedom / @mozilla/readability: CJS named-export interop breaks when bundled
  // (live CANONICAL_PREPARE: "fz is not a function" on parseHTML).
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "linkedom",
    "@mozilla/readability",
  ],
};

export default nextConfig;
