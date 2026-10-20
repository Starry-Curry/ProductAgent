import { fileURLToPath } from "node:url";
/** @type {import('next').NextConfig} */
const config = {
  // Isolated candidate builds must not replace the .next files used by an existing local service.
  distDir: /^\.next(?:-[a-z0-9-]+)?$/.test(
    process.env.WUJIAN_BUILD_DIR || ".next",
  )
    ? process.env.WUJIAN_BUILD_DIR || ".next"
    : (() => {
        throw Error("Invalid isolated Next build directory");
      })(),
  devIndicators: false,
  experimental: { cpus: 1 },
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "@napi-rs/canvas",
    "tesseract.js",
    "@tesseract.js-data/eng",
    "@tesseract.js-data/chi_sim",
  ],
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
};
export default config;
