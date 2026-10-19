import { fileURLToPath } from "node:url";
/** @type {import('next').NextConfig} */
const config = {
  devIndicators: false,
  experimental: { cpus: 1 },
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
};
export default config;
