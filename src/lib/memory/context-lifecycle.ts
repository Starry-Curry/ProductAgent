import type { DatabaseSync } from "node:sqlite";

// Separate destructive privacy changes from the epoch used by in-flight model runs.
// Reads are compatible with old databases; callers perform mutations in their domain transaction.
export function ensurePrivacyScopes(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS memory_privacy_scopes(owner TEXT NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner,scope))");
}
function revision(db: DatabaseSync, owner: string, scope: string) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_privacy_scopes'").get()) return 0;
  return Number((db.prepare("SELECT revision FROM memory_privacy_scopes WHERE owner=? AND scope=?").get(owner, scope) as { revision: number } | undefined)?.revision || 0);
}
export function privacyStamp(db: DatabaseSync, owner: string, itemIds: string[]) {
  return Object.fromEntries(["*", ...new Set(itemIds.map(id => "item:" + id))].map(scope => [scope, revision(db, owner, scope)]));
}
export function privacyCurrent(db: DatabaseSync, owner: string, stamp: Record<string, number>) {
  return Object.entries(stamp).every(([scope, value]) => revision(db, owner, scope) === value);
}
export function invalidatePrivacyScopes(db: DatabaseSync, owner: string, itemIds?: string[] | null) {
  ensurePrivacyScopes(db);
  const scopes = itemIds == null ? ["*"] : [...new Set(itemIds.map(id => "item:" + id))];
  for (const scope of scopes) db.prepare("INSERT INTO memory_privacy_scopes VALUES(?,?,1) ON CONFLICT(owner,scope) DO UPDATE SET revision=revision+1").run(owner, scope);
}
