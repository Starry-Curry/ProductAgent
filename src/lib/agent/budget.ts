/** Per-turn scheduling is distinct from the persistent per-HTTP spend quota. */
export const turnBudget = { modelTurns: 4, toolCalls: 6, repairs: 1 } as const;
