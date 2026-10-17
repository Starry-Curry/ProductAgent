import type { Person } from "../domain.ts";
import type { ProductPack } from "../products.ts";
export type Stage =
  | "created"
  | "identity_checked"
  | "retrieved"
  | "model_started"
  | "model_returned"
  | "validated"
  | "completed"
  | "failed";
export type TraceEvent = {
  sequence: number;
  stage: Stage;
  at: string;
  elapsedMs: number;
  detail: string;
};
export type Answer = {
  answer: string;
  evidenceIds: string[];
  uncertainties: string[];
  grounding?: "extractive-supported";
};
export type Run = {
  id: string;
  actor: Person;
  itemId: string;
  itemOwner: Person;
  identity: string;
  resourceScopes?: {
    itemId: string;
    owner: Person;
    identity: string;
    state: string;
  }[];
  mode: "service" | "ideas";
  status: "running" | "succeeded" | "needs_identity" | "unavailable" | "failed";
  startedAt: string;
  latencyMs: number;
  model: string | null;
  promptVersion: string;
  tools: { name: string; status: string }[];
  evidenceIds: string[];
  tokens: { input: number; output: number } | null;
  cost: null;
  errorCode?: string;
  objectivelyVerified: false;
  schemaVersion?: 2;
  events?: TraceEvent[];
  questionHash?: string;
  responseHash?: string;
  evidenceSnapshot?: ProductPack;
  validatedAnswer?: Answer;
  replayPolicy?: "validated-content-only";
  parentRunId?: string;
};
export type Feedback = {
  runId: string;
  outcome: "completed" | "unresolved";
  at: string;
  basis: "user_report";
};
