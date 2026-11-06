import { useEffect, useState } from "react";
import type { Workspace, User } from "../api";
import { request } from "../api";

export type Section = "companion" | "items" | "memories" | "friends" | "care";
export type Route = {
  section: Section;
  itemId?: string;
  taskId?: string;
  friendId?: string;
  experienceId?: string;
  householdId?: string;
  scope?: string;
};
function parse(): Route {
  const [part, search = ""] = location.hash.slice(1).split("?");
  const section = (
    ["companion", "items", "memories", "friends", "care"].includes(part)
      ? part
      : "companion"
  ) as Section;
  const query = new URLSearchParams(search);
  return {
    section,
    itemId: query.get("item") || undefined,
    taskId: query.get("task") || undefined,
    friendId: query.get("friend") || undefined,
    experienceId: query.get("experience") || undefined,
    householdId: query.get("household") || undefined,
    scope: query.get("scope") || undefined,
  };
}
export function navigate(route: Route) {
  const query = new URLSearchParams();
  for (const [key, value] of [
    ["item", route.itemId],
    ["task", route.taskId],
    ["friend", route.friendId],
    ["experience", route.experienceId],
    ["household", route.householdId],
    ["scope", route.scope],
  ])
    if (value) query.set(key!, value);
  location.hash = route.section + (query.size ? "?" + query : "");
}
export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const changed = () => setRoute(parse());
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  return route;
}
export function useWorkspace(user: User) {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [error, setError] = useState("");
  async function refresh() {
    try {
      const next = await request<Workspace>("/workspace");
      setWorkspace(next);
      setError("");
      return next;
    } catch (error) {
      setError((error as Error).message);
      throw error;
    }
  }
  useEffect(() => {
    void refresh().catch(() => {});
  }, [user.id]);
  return { workspace, refresh, error };
}
