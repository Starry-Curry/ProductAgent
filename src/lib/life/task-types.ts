export type PreparationBinding = {
  itemId: string;
  name: string;
  fingerprint: string;
  basis: string;
};
export type PreparationStep = {
  id: string;
  action: string;
  required: boolean;
  dependencies: string[];
  bindings: PreparationBinding[];
  conditions: string[];
  status: "pending" | "done" | "blocked" | "skipped";
  blockedReason?: string;
  reviewReason?: string;
  completionReport?: { source: "user"; at: string };
};
export type Preparation = {
  version: 1;
  scenario: "photography";
  revision: number;
  status: "preparing" | "blocked" | "ready";
  source: "local-rules";
  originSessionId?: string;
  constraints: {
    departureText?: string;
    preparationMinutes?: number;
    noPurchase: boolean;
    excludedItemIds: string[];
    unpoweredItemIds: string[];
  };
  completionCriteria: string;
  steps: PreparationStep[];
  history: {
    at: string;
    reason: string;
    preserved: string[];
    invalidated: string[];
  }[];
  receipts: { requestId: string; hash: string }[];
};
