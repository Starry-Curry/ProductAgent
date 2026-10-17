import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "物间 · Product Agent",
  description: "让已有的物品，陪生活走得更远。物品智能服务 Demo V0.1",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
