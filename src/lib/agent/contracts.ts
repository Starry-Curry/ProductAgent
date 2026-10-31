import { z } from "zod";
import type { HomeRoute, ActionCard } from "../home/contracts.ts";
import type { TaskFrame,ClaimCheck } from "./kernel/contracts.ts";
export const turnInputSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    requestId: z.string().uuid(),
    itemId: z.string().max(100).optional(),
    question: z.string().trim().min(1).max(2000),
    mode: z
      .enum(["service", "ideas", "companion", "story", "auto"])
      .default("service"),
    temporary: z.boolean().default(false),
    memoryPolicy: z.enum(["legacy", "candidates", "off"]).optional(),
    uiContext: z
      .object({
        homeId: z.literal("young-apartment-v1").optional(),
        voiceItemId: z.string().max(100).optional(),
        page: z.enum([
          "home",
          "item",
          "assistant",
          "discover",
          "family",
          "social",
          "stories",
        ]),
        goal: z.string().max(500).optional(),
        companion: z.boolean().optional(),
        useItemMemories: z.boolean().optional(),
        taskPlanId: z.string().uuid().optional(),
        interfaceMode: z.enum(["standard", "care"]).optional(),
        planContext: z
          .object({
            previousIdeaIds: z.array(z.string().uuid()).max(64),
            feedbackIdeaIds: z.array(z.string().uuid()).max(64).optional(),
            continuation: z
              .object({
                goal: z.string().max(1000),
                minutes: z.number().int().min(1).max(240),
                itemIds: z.array(z.string().max(100)).max(30),
                excludedItemIds: z.array(z.string().max(100)).max(100),
                restrictions: z
                  .array(
                    z.enum([
                      "不买东西",
                      "在家",
                      "静音",
                      "不要拍照",
                      "不要手工",
                    ]),
                  )
                  .max(5),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type TurnInput = z.infer<typeof turnInputSchema>;
export type Citation = {
  id: string;
  title: string;
  url: string;
  kind: "official" | "user_report" | "third_party" | "open_knowledge";
  section?: string;
};
export type AssistantReply = {
  taskFrame?: TaskFrame;
  claimChecks?: ClaimCheck[];
  usedItems?: { id: string; name: string; model: string }[];
  task?: {
    goal: string;
    parts: { title: string; status: "addressed" | "needs_info" }[];
  };
  route?: HomeRoute;
  actionCards?: ActionCard[];
  outcome: "answered" | "needs_info" | "referred" | "unavailable" | "blocked";
  answer: string;
  steps: { id: string; text: string }[];
  questions: string[];
  evidenceIds: string[];
  citations: Citation[];
  memoryIds: string[];
  source:
    | "curated-guidance"
    | "model-with-evidence"
    | "model-general"
    | "local-memory"
    | "local-dialogue"
    | "local-planning"
    | "user-source"
    | "model-creative";
  presentation?: "short" | "detailed";
  model?: string;
  errorCode?: string;
  caveat?: string;
  taskProgress?: {
    guidance: "partial" | "ready-to-confirm";
    missing: string[];
    completionEvidence: "advice-only";
  };
};
export type SessionMessage = {
  memoryPolicy?: "legacy" | "candidates" | "off";
  capture?: boolean;
  itemId?: string;
  id: string;
  role: "user" | "assistant" | "feedback" | "action";
  text: string;
  at: string;
  reply?: AssistantReply;
};
export type ServiceSession = {
  itemScopes?: Record<string, string>;
  id: string;
  owner: string;
  itemId?: string;
  identity?: string;
  mode: TurnInput["mode"];
  revision: number;
  status: "active" | "waiting_user" | "user_resolved" | "closed";
  messages: SessionMessage[];
  known: Record<string, string>;
  tried: string[];
  memoryEpoch: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};
export type Trace = { stage: string; detail: string; at: string };
export type TurnResult = {
  foundation?: { taskId?: string; runId: string; status: string; basis: string };
  session: ServiceSession;
  reply: AssistantReply;
  trace: Trace[];
  tokens: { input: number; output: number } | null;
  modelCalls: number;
};
export class AgentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const memorySchema = z
  .object({
    kind: z.enum([
      "preference",
      "interest",
      "experience",
      "story",
      "method",
      "relationship",
      "fiction",
      "possession",
      "purchase",
      "requirement",
    ]),
    text: z.string().trim().min(1).max(1500),
    itemId: z.string().max(100).optional(),
    allowCloud: z.boolean().default(false),
    status: z.enum(["active", "candidate"]).default("active"),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export type MemoryRecord = z.infer<typeof memorySchema> & {
  /** Author-owned record retained after losing item access; excluded from ordinary task recall. */
  archived?: boolean;
  id: string;
  owner: string;
  version: number;
  source: "user" | "automatic";
  demo?: boolean;
  provenance?: {
    kind: "chat" | "item" | "story" | "operation" | "task" | "feedback";
    sourceId: string;
    sessionId?: string;
    basis: "user_statement" | "app_record" | "observation" | "user_feedback";
    at: string;
    extractor: string;
  };
  polarity?: "positive" | "negative";
  createdAt: string;
  updatedAt: string;
};
export type Persona = {
  enabled: boolean;
  nickname: string;
  avatar?: "object" | "sprout" | "sun" | "moon" | "frame" | "photo";
  style: "neutral" | "warm" | "playful";
  memoryUse?: "off" | "explicit" | "relevant";
  itemId?: string;
};
export const personaSchema = z
  .object({
    enabled: z.boolean(),
    nickname: z.string().trim().max(40),
    avatar: z
      .enum(["object", "sprout", "sun", "moon", "frame", "photo"])
      .optional(),
    style: z.enum(["neutral", "warm", "playful"]),
    memoryUse: z.enum(["off", "explicit", "relevant"]).optional(),
    itemId: z.string().max(100).optional(),
  })
  .strict();
