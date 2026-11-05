import type { components } from "./generated/api";

export type Item = components["schemas"]["ItemView"];
export type User = components["schemas"]["UserView"];
export type Experience = Required<components["schemas"]["ExperienceView"]>;
export type Conversation = components["schemas"]["ConversationView"];
export type ChatMessage = components["schemas"]["ChatMessageView"];
export type Run = components["schemas"]["RunView"];
export type Friend = components["schemas"]["FriendView"];
export type Gift = components["schemas"]["GiftView"];
export type Reminder = Required<components["schemas"]["ReminderView"]>;
export type Memory = components["schemas"]["MemoryView"];
export type Health = components["schemas"]["HealthView"];
export type DeviceStatus = components["schemas"]["DeviceStatusView"];
export type Workspace = Omit<
  components["schemas"]["WorkspaceView"],
  "preferences" | "experiences" | "reminders" | "wishes"
> & {
  preferences: Preferences;
  experiences: Experience[];
  reminders: Reminder[];
  wishes: Wish[];
};
export type Household = components["schemas"]["HouseholdView"];
export type Preferences = Required<components["schemas"]["Preferences"]>;
export type Task = components["schemas"]["TaskView"];
export type TaskEntry = Required<components["schemas"]["TaskEntry"]>;
export type TaskBoard = Omit<
  components["schemas"]["TaskBoardView"],
  "entries" | "sources" | "participants" | "access"
> & {
  entries: TaskEntry[];
  sources: Record<string, unknown>[];
  participants: Record<string, unknown>[];
  access: "owner" | "invited" | "active";
};
export type Wish = Required<components["schemas"]["WishView"]>;
export type FriendSpace = Omit<
  components["schemas"]["FriendSpace"],
  "wishes" | "experiences"
> & { wishes: Wish[]; experiences: Experience[] };
export type EntryContext = components["schemas"]["EntryContext"];

export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers:
      body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(
      typeof value.detail === "string"
        ? value.detail
        : "这次操作没有完成，请检查后再试",
    );
  }
  return response.json();
}

export async function upload(file: File): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  return request("/assets", "POST", form);
}
