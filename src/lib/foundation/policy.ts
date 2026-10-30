import type { DatabaseSync } from "node:sqlite";
import { canRead, type Person, type State } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
import { fingerprint } from "./legacy.ts";
import { clearOwnerContext } from "../memory/store.ts";
export type Grant = {
  version: "grant/1";
  grantId: string;
  issuerId: Person;
  subjectId: Person;
  resourceId: string;
  actions: ("read" | "write" | "share" | "execute")[];
  revision: number;
  grantedAt: string;
  revokedAt?: string;
  expiresAt?: string;
};
export function policyRevision(db: DatabaseSync, state: State) {
  return fingerprint({
    items: state.items.map((i) => [i.id, i.owner, i.shared, i.sharedWith]),
    grants: db
      .prepare("SELECT id,revision FROM foundation_grants ORDER BY id")
      .all(),
  });
}
export function authorize(
  db: DatabaseSync,
  state: State,
  actor: Person,
  resourceId: string,
  action: "read" | "write" | "share" | "execute" = "read",
) {
  const item = state.items.find((i) => i.id === resourceId);
  if (!item) return { allowed: false, reasonCode: "not_found" };
  if (item.owner === actor) return { allowed: true, reasonCode: "owner" };
  const row = db
    .prepare(
      "SELECT body FROM foundation_grants WHERE issuer=? AND subject=? AND resource=?",
    )
    .get(item.owner, actor, item.id) as { body: string } | undefined;
  if (row) {
    const g = JSON.parse(row.body) as Grant;
    // A recorded grant does not override a revoked legacy share or ownership transfer.
    return {
      allowed:
        action === "read" &&
        canRead(item, actor) &&
        !g.revokedAt &&
        (!g.expiresAt || Date.parse(g.expiresAt) > Date.now()) &&
        g.actions.includes(action),
      reasonCode: "explicit_grant",
    };
  }
  return {
    allowed: action === "read" && canRead(item, actor),
    reasonCode: "legacy_item_grant",
  };
}
/** Must be called inside the same transaction as the legacy share update. */
export function mirrorItemGrant(
  db: DatabaseSync,
  state: State,
  issuer: Person,
  subject: Person,
  resourceId: string,
  enabled: boolean,
) {
  if (!state.items.some((i) => i.id === resourceId && i.owner === issuer))
    throw new AgentError("仅物主可变更授权", 403);
  const prior = db
    .prepare(
      "SELECT id,revision FROM foundation_grants WHERE issuer=? AND subject=? AND resource=?",
    )
    .get(issuer, subject, resourceId) as
    { id: string; revision: number } | undefined;
  const grant: Grant = {
    version: "grant/1",
    grantId: prior?.id || crypto.randomUUID(),
    issuerId: issuer,
    subjectId: subject,
    resourceId,
    actions: enabled ? ["read"] : [],
    revision: (prior?.revision || 0) + 1,
    grantedAt: new Date().toISOString(),
    ...(!enabled ? { revokedAt: new Date().toISOString() } : {}),
  };
  db.prepare(
    "INSERT INTO foundation_grants VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body",
  ).run(
    grant.grantId,
    issuer,
    subject,
    resourceId,
    grant.revision,
    JSON.stringify(grant),
  );
  if(!enabled)clearOwnerContext(db,subject,true,[resourceId]);
  return grant;
}
