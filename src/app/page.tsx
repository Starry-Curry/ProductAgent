import WujianApp from "@/components/life/WujianApp";
import { AccountBoundary } from "@/components/life/AccountBoundary";
export const dynamic = "force-dynamic";
export default function Page() {
  return process.env.AUTH_MODE === "authenticated" ? <AccountBoundary /> : <WujianApp />;
}
