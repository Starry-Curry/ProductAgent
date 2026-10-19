import { fileURLToPath } from "node:url";
/** @type {import('next').NextConfig} */
const config = {
  devIndicators: false,
  experimental: { cpus: 1 },
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
};
export default config;
