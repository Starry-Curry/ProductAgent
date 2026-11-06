import { DemoBoundary } from "@/components/DemoBoundary";
export const dynamic = "force-dynamic";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./home.css";
import "./life.css";
import "./companion.css";
export const metadata: Metadata = {
  title: "物间 · 和生活里的东西好好相处",
  description: "随时问，用好身边的东西，也留住它们承载的心意。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "物间" },
  icons: { apple: "/companion/mobile-icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f7f2",
  interactiveWidget: "resizes-content",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <DemoBoundary
          publicMode={process.env.AUTH_MODE === "public-demo"}
          autoEnter={process.env.WUJIAN_MOBILE_DEMO === "true"}
        >
          {children}
        </DemoBoundary>
      </body>
    </html>
  );
}
