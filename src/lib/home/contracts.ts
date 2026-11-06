import { z } from "zod";
import { preparationRequest } from "../life/task-planning.ts";

export const roomIds = [
  "living",
  "kitchen",
  "study",
  "bedroom",
  "entry",
  "other",
] as const;
export const rooms = [
  { id: "living", name: "客厅", hint: "把日常相处的片段，留给熟悉的物品" },
  { id: "kitchen", name: "厨房", hint: "一顿饭、一杯茶，都可以从这里开始" },
  { id: "study", name: "书房", hint: "一起读过的书，和慢慢积累的灵感" },
  { id: "bedroom", name: "卧室", hint: "留一点安静，照顾自己的日常" },
  { id: "entry", name: "玄关", hint: "出发前的准备，回家时的问候" },
  { id: "other", name: "待布置", hint: "位置还没有确认，也可以先和它聊聊" },
] as const;
export type RoomId = (typeof roomIds)[number];
export function roomFromLocation(location: string): RoomId {
  if (/客厅|餐厅|阅读角/.test(location)) return "living";
  if (/厨房/.test(location)) return "kitchen";
  if (/书房|工作|收纳柜/.test(location)) return "study";
  if (/卧室|床/.test(location)) return "bedroom";
  if (/玄关|门口/.test(location)) return "entry";
  return "other";
}
export type Placement = {
  itemId: string;
  roomId: RoomId;
  x: number;
  y: number;
  revision: number;
  saved: boolean;
};
export const placeSchema = z
  .object({
    requestId: z.string().uuid(),
    itemId: z.string().min(1).max(100),
    roomId: z.enum(roomIds),
    x: z.number().min(0.08).max(0.92),
    y: z.number().min(0.16).max(0.86),
    expectedRevision: z.number().int().nonnegative(),
    expectedLocation: z.string().max(2000),
  })
  .strict();
export type HomeIntent =
  | "app"
  | "help"
  | "story"
  | "companion"
  | "locate"
  | "plan"
  | "prepare"
  | "move"
  | "handoff"
  | "clarify";
export type HomeRoute = {
  intent: HomeIntent;
  mode: "service" | "story" | "companion" | "ideas";
  itemId?: string;
  itemName?: string;
  candidates?: { id: string; name: string }[];
  reason: string;
};
export const homeActionSchema = z.discriminatedUnion("kind", [
  preparationRequest.extend({
    kind: z.literal("taskPlan"),
    digest: z.string().min(1).max(64000),
    itemIds: z.array(z.string()).max(30),
  }),
  z
    .object({
      kind: z.literal("move"),
      itemId: z.string(),
      roomId: z.enum(roomIds),
      expectedRevision: z.number().int().nonnegative(),
      expectedLocation: z.string().max(2000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plan"),
      goal: z.string().min(1).max(150),
      itemIds: z.array(z.string()).max(30),
      checklist: z
        .array(
          z.object({ label: z.string().max(120), status: z.string().max(80) }),
        )
        .max(30),
    })
    .strict(),
  z
    .object({
      kind: z.literal("handoff"),
      itemId: z.string(),
      assignee: z.enum(["lin", "dad"]),
      summary: z.string().min(1).max(120),
    })
    .strict(),
]);
export type HomeAction = z.infer<typeof homeActionSchema>;
export type ActionCard = {
  id: string;
  title: string;
  detail: string[];
  confirmLabel: string;
  expiresAt: string;
  status: "pending" | "applied" | "cancelled";
  kind: HomeAction["kind"];
};
