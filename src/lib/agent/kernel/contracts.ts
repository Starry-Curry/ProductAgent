import { z } from "zod";

export const risks = ["ordinary", "maintenance", "structural", "electrical", "external_action", "private"] as const;
export const taskFrameSchema = z.object({
  goal: z.string().min(1).max(1000),
  itemIds: z.array(z.string()).max(30),
  parts: z.array(z.object({
    id: z.string().min(1).max(60),
    question: z.string().min(1).max(500),
    kind: z.enum(["fact", "procedure", "plan", "explore", "relationship", "app_help"]),
    itemIds: z.array(z.string()).max(12),
    risk: z.enum(risks),
    needed: z.array(z.string().max(200)).max(12).default([]),
    expectedResult: z.string().max(500),
  })).min(1).max(20),
  tried: z.array(z.string().max(600)).max(20).default([]),
  constraints: z.array(z.string().max(400)).max(20).default([]),
}).strip();
export type TaskFrame = z.infer<typeof taskFrameSchema> & {
  version: "task-frame/3";
  originalQuestion: string;
  evidenceIds: string[];
  permission: "read_only";
  progress: "proposed" | "partial" | "ready_to_confirm";
};
export const candidateSchema = z.object({
  id: z.string().min(1).max(60),
  partId: z.string().min(1).max(60),
  itemIds: z.array(z.string()).max(12),
  kind: z.enum(["fact", "operation", "user_report", "hypothesis", "advice"]),
  text: z.string().min(1).max(1500),
  sources: z.array(z.object({id:z.string(),quote:z.string().min(3).max(3000)})).max(10).default([]),
  conditions: z.array(z.string().max(500)).max(12).default([]),
  experienceIds: z.array(z.string()).max(10).default([]),
  // How the report changed this proposal, not a free-standing reminiscence.
  adaptation: z.string().max(800).optional(),
  changedConditions: z.string().max(600).optional(),
  calculation:z.object({kind:z.literal('range'),actual:z.number(),min:z.number(),max:z.number(),unit:z.string().max(20),sourceId:z.string(),quote:z.string().min(3).max(2000),inputQuote:z.string().min(3).max(800),assertion:z.enum(['within','outside'])}).optional(),
}).strip();
export type Candidate = z.infer<typeof candidateSchema>;
export const draftSchema = z.object({
  frame:taskFrameSchema,
  candidates:z.array(candidateSchema).max(50),
  gaps:z.array(z.object({partId:z.string(),reason:z.string().max(800)})).max(20).default([]),
  queries:z.array(z.string().max(300)).max(10).default([]),
}).strip();
export const reviewSchema = z.object({
  checks:z.array(z.object({
    id:z.string(),
    verdict:z.enum(["entailed","contradicted","insufficient","conflict"]),
    reason:z.string().min(3).max(1200),
    evidenceIds:z.array(z.string()).max(10).default([]),
    missingConditions:z.array(z.string().max(500)).max(12).default([]),
    repeatsFailedAction:z.boolean().default(false),
  })).max(50),
  omittedQuestions:z.array(z.string().max(500)).max(12).default([]),
}).strip();
export type EvidencePassage = {
  id:string; itemId:string; model:string; region:string; title:string; text:string;
  url?:string; documentId?:string; fetchedAt?:string; firmware?:string;
  basis:"official"|"user_report"|"experience";
};
export type ClaimCheck = {
  id:string; partId:string; text:string;
  verdict:"supported"|"refuted"|"insufficient"|"conflicting"|"user_report"|"conditional";
  published:boolean; reasons:string[]; sourceIds:string[]; conditions:string[];
  verification:"scope_quote_quantity_and_limited_semantic_review";
  sources?:{id:string;quote:string;url?:string;model:string;region:string;fetchedAt?:string;basis:string}[];
  necessaryCondition?:ReturnType<typeof import('./physical.ts').rangeCondition>;
};
