-- RFC prototype only. The checker compiles this in an in-memory database.
-- Not a production migration. Authorization, predicate typing, source closure,
-- relation participant validation and cycle checks belong to domain services.
PRAGMA foreign_keys = ON;

CREATE TABLE v2_resources (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('item','product','person','event','assertion','source','memory','persona','plan','adapter')),
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('active','archived','tombstoned')),
  legacy_key TEXT,
  PRIMARY KEY(workspace_id, id),
  UNIQUE(workspace_id, kind, legacy_key)
) STRICT;

CREATE TABLE v2_item_state (
  workspace_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  display_name TEXT NOT NULL,
  availability TEXT NOT NULL CHECK(availability IN ('unknown','available','loaned','gifted','lost','broken','consumed')),
  quantity REAL CHECK(quantity IS NULL OR quantity >= 0),
  quantity_unit TEXT,
  product_resource_id TEXT,
  PRIMARY KEY(workspace_id, item_id),
  FOREIGN KEY(workspace_id, item_id) REFERENCES v2_resources(workspace_id, id),
  FOREIGN KEY(workspace_id, product_resource_id) REFERENCES v2_resources(workspace_id, id)
) STRICT;

CREATE TABLE v2_sources (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('user_statement','document','photo','observation','model_output')),
  artifact_sha256 TEXT NOT NULL CHECK(length(artifact_sha256)=64 AND artifact_sha256 NOT GLOB '*[^0-9a-f]*'),
  locator TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  model_applicability_json TEXT NOT NULL CHECK(json_valid(model_applicability_json)),
  PRIMARY KEY(workspace_id, id),
  FOREIGN KEY(workspace_id, id) REFERENCES v2_resources(workspace_id, id)
) STRICT;

CREATE TABLE v2_assertions (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  basis TEXT NOT NULL CHECK(basis IN ('user_report','source_extract','ai_inference','user_observation','device_observation')),
  status TEXT NOT NULL CHECK(status IN ('candidate','accepted','disputed','superseded','retracted')),
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  PRIMARY KEY(workspace_id, id, revision),
  FOREIGN KEY(workspace_id, id) REFERENCES v2_resources(workspace_id, id),
  FOREIGN KEY(workspace_id, subject_id) REFERENCES v2_resources(workspace_id, id)
) STRICT;

CREATE TABLE v2_provenance (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL,
  relation TEXT NOT NULL CHECK(relation IN ('supports','derived_from','contradicts')),
  source_id TEXT,
  parent_id TEXT,
  parent_revision INTEGER,
  CHECK((source_id IS NOT NULL AND parent_id IS NULL AND parent_revision IS NULL)
     OR (source_id IS NULL AND parent_id IS NOT NULL AND parent_revision IS NOT NULL)),
  CHECK(parent_id IS NULL OR NOT(target_id=parent_id AND target_revision=parent_revision)),
  PRIMARY KEY(workspace_id, id),
  FOREIGN KEY(workspace_id, target_id, target_revision) REFERENCES v2_assertions(workspace_id, id, revision),
  FOREIGN KEY(workspace_id, source_id) REFERENCES v2_sources(workspace_id, id),
  FOREIGN KEY(workspace_id, parent_id, parent_revision) REFERENCES v2_assertions(workspace_id, id, revision)
) STRICT;

CREATE TABLE v2_grants (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('item_help','creative','task','reflection','device_exploration','share')),
  action TEXT NOT NULL CHECK(action IN ('read','write','share','execute')),
  processor TEXT NOT NULL CHECK(processor IN ('local','model_provider','recipient')),
  granted_by TEXT NOT NULL,
  policy_epoch INTEGER NOT NULL CHECK(policy_epoch >= 1),
  expires_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY(workspace_id, id),
  FOREIGN KEY(workspace_id, resource_id) REFERENCES v2_resources(workspace_id, id)
) STRICT;

CREATE TABLE v2_operations (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
  policy_epoch INTEGER NOT NULL CHECK(policy_epoch >= 1),
  state TEXT NOT NULL CHECK(state IN ('prepared','dispatched','acknowledged','observed','verified','failed','indeterminate')),
  receipt_json TEXT CHECK(receipt_json IS NULL OR json_valid(receipt_json)),
  PRIMARY KEY(workspace_id, id),
  UNIQUE(workspace_id, principal_id, request_key)
) STRICT;

CREATE INDEX v2_assertion_lookup ON v2_assertions(workspace_id, subject_id, predicate, status);
CREATE INDEX v2_provenance_source ON v2_provenance(workspace_id, source_id);
CREATE INDEX v2_provenance_parent ON v2_provenance(workspace_id, parent_id, parent_revision);
CREATE INDEX v2_grant_lookup ON v2_grants(workspace_id, principal_id, resource_id, purpose, action, processor);
