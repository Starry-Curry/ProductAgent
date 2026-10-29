import { DemoBoundary } from "@/components/DemoBoundary";
export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import "./globals.css";
import "./home.css";
import "./life.css";
import "./belonging.css";
export const metadata: Metadata = {
  title: "物间 · Product Agent",
  description:
    "以真实物品为上下文的生活 Agent：可信帮助、生活创意、家庭协作与可授权故事记忆。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <DemoBoundary publicMode={process.env.AUTH_MODE === "public-demo"}>
          {children}
        </DemoBoundary>
      </body>
    </html>
  );
}
