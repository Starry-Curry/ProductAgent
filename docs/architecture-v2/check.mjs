// L0 design checks only: never load application code, env, or an on-disk database.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const repo = resolve(process.argv.find(a => a.startsWith('--repo='))?.slice(7) || '.');
const folder = resolve(repo, 'docs/architecture-v2');
const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, status: 'passed' }); }
  catch (error) { results.push({ name, status: 'failed', error: error.message }); }
};
const text = file => readFileSync(resolve(folder, file), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${repo.replaceAll('\\','/')}`, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
const docs = ['README.md','DOMAIN_MODEL.md','AGENT_DESIGN.md','MEMORY_PERSONA.md','CREATIVITY_TASKS.md','DEVICE_EXPLORATION.md','MIGRATION_PLAN.md','DECISIONS.md','ACCEPTANCE.md','REVIEW.md'];

// The generated report is a legitimate local link, created by this invocation.
mkdirSync(resolve(folder, 'evidence'), { recursive: true });
for (const file of docs) {
  check(`document:${file}`, () => {
    const body = text(file);
    assert(body.length > 500, 'document too short');
    assert(/[\u4e00-\u9fff]/u.test(body), 'Chinese explanation missing');
    assert.equal((body.match(/^```/gm) || []).length % 2, 0, 'unclosed fence');
    for (const match of body.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) JSON.parse(match[1]);
  });
}
for (const file of [...docs, '../../AGENTS.md', '../../DEVELOPMENT_REPORT.md', '../../IMPLEMENTATION_STATUS.md', '../../REVIEW_HANDOFF.md', '../README.md']) {
  check(`local-links:${file}`, () => {
    const body = text(file);
    for (const m of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = m[1].replace(/^<|>$/g, '').split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      const path = resolve(dirname(resolve(folder, file)), decodeURIComponent(target));
      assert(path.startsWith(repo + sep) || path === repo, `link outside repo: ${target}`);
      if (['evidence/CHECK_REPORT.json','evidence/PUBLICATION_SCAN.json'].some(name => path === resolve(folder, name))) continue;
      assert(existsSync(path), `missing link: ${target}`);
    }
  });
}

const map = JSON.parse(text('contracts/source-map.json'));
for (const [label, sha] of Object.entries(map.refs)) {
  check(`pinned-source:${label}`, () => assert.equal(git('rev-parse', `${sha}^{commit}`), sha));
}
for (const anchor of map.anchors) {
  check(`source-anchor:${anchor.ref}:${anchor.path}`, () => {
    const source = git('show', `${map.refs[anchor.ref]}:${anchor.path}`);
    for (const fragment of anchor.contains) assert(source.includes(fragment), `missing anchor: ${fragment}`);
  });
}
check('formal-baseline-is-main', () => {
  assert.equal(git('merge-base', 'HEAD', map.refs.main), map.refs.main);
  assert.equal(git('diff', '--name-only', map.refs.main, '--', 'src', 'tests', 'package.json', 'package-lock.json'), '');
});

const fixture = JSON.parse(text('fixtures/scenarios.json'));
check('fixtures:explicitly-synthetic-and-not-product-results', () => {
  assert.equal(fixture.synthetic, true);
  assert.equal(fixture.productAcceptanceExecuted, false);
  assert.deepEqual(fixture.scenarios.map(s => s.id), ['A','B','C']);
});
const [a,b,c] = fixture.scenarios;
check('fixture:A:cross-session-relation-and-unknown-material', () => {
  assert.equal(new Set(a.sessions).size, 3);
  assert.equal(a.relation.value.itemId, a.item.id);
  assert.equal(a.relation.basis, 'user_report');
  assert.equal(a.item.material, null);
});
check('fixture:A:privacy-and-forgetting-negative-cases-present', () => {
  assert.equal(a.storyPolicy.allowCloud, false);
  assert.equal(a.storyPolicy.allowShare, false);
  assert.equal(a.persona.isPrincipal, false);
  assert.deepEqual(a.persona.visibleOn, ['item_detail']);
  assert.equal(a.forget.suppressReextraction, true);
  assert(a.requiredNegativeCases.includes('restore_requires_latest_fence'));
});
check('fixture:B:canonical-states-and-constraints-present', () => {
  const states = ['unknown','available','loaned','gifted','lost','broken','consumed'];
  b.items.forEach(item => assert(states.includes(item.availability)));
  assert(b.items.some(item => item.availability === 'broken'));
  assert(b.goal.hardConstraints.onlyRegisteredItems && b.goal.hardConstraints.noHeat);
  assert(b.goal.hardConstraints.noPhotograph && b.goal.videoRequested);
});
check('fixture:B:unknown-is-not-verification', () => {
  assert(b.items[0].unknown.includes('heat_resistance'));
  assert(b.candidate.conditions.some(condition => condition.state === 'unknown'));
  assert.notEqual(b.candidate.status, 'verified');
  assert(['draft','needs_info','ready'].includes(b.candidate.status));
  assert.deepEqual(b.candidate.verificationRefs, []);
});
check('fixture:B:fair-evaluation-specification-not-result', () => {
  assert.equal(b.blindEvaluation.holdoutCases, 24);
  assert(b.blindEvaluation.independentRaters >= 3);
  assert.deepEqual(b.blindEvaluation.primaryComparison, ['D1','V2']);
  assert.equal(b.blindEvaluation.executed, false);
});
check('fixture:C:research-and-ack-are-not-control-or-verification', () => {
  assert.equal(c.device.isReal, false);
  assert.equal(c.research.controlAuthorized, false);
  assert.equal(c.adapter.status, 'candidate');
  assert.equal(c.receipt.state, 'acknowledged');
  assert.equal(c.receipt.observedAt, null);
  assert.equal(c.receipt.isVerified, false);
  assert(c.faultPoints.includes('after_dispatch_before_receipt'));
});

const db = new DatabaseSync(':memory:');
const ddl = text('contracts/knowledge-core.sql');
check('sql:compile-seven-core-tables-and-enable-foreign-keys', () => {
  db.exec(ddl);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n, 7);
});
const resource = db.prepare('INSERT INTO v2_resources VALUES(?,?,?,?,?,?,?)');
check('sql:seed-painting-resources-in-two-workspaces', () => {
  for (const [id, kind] of [['painting','item'],['ning','person'],['lin','person'],['gift','event'],['source','source'],['claim','assertion'],['derived','assertion']]) {
    resource.run('home:a',id,kind,'principal:lin',1,'active',null);
  }
  resource.run('home:b','private','item','principal:other',1,'active',null);
});
const reject = sql => assert.throws(() => db.exec(sql), /constraint|FOREIGN KEY/i);
check('sql:seed-all-seven-tables-with-one-vertical-slice', () => {
  db.exec(`
    INSERT INTO v2_item_state VALUES('home:a','painting',1,'合成画','available',1,'幅',NULL);
    INSERT INTO v2_sources VALUES('home:a','source','user_statement','${'a'.repeat(64)}','synthetic:A1','2026-10-29','{}');
    INSERT INTO v2_assertions VALUES('home:a','claim',1,'painting','relation.gifted','{"giverId":"ning","recipientId":"lin","itemId":"painting","eventId":"gift"}','user_report','accepted',NULL,'2026-10-29',NULL);
    INSERT INTO v2_assertions VALUES('home:a','derived',1,'painting','preference.inferred','true','ai_inference','candidate',0.99,'2026-10-29',NULL);
    INSERT INTO v2_provenance VALUES('home:a','edge1','claim',1,'supports','source',NULL,NULL);
    INSERT INTO v2_provenance VALUES('home:a','edge2','derived',1,'derived_from',NULL,'claim',1);
    INSERT INTO v2_grants VALUES('home:a','grant','source','principal:lin','reflection','read','local','principal:lin',1,NULL,NULL);
    INSERT INTO v2_operations VALUES('home:a','op','principal:lin','request:1','${'b'.repeat(64)}',1,'acknowledged','{"synthetic":true}');
  `);
  for (const table of ['resources','item_state','sources','assertions','provenance','grants','operations']) {
    assert(db.prepare(`SELECT count(*) AS n FROM v2_${table}`).get().n > 0);
  }
});
check('sql:reject-cross-workspace-subject', () => reject("INSERT INTO v2_assertions VALUES('home:a','claim',2,'private','item.material','\"paper\"','user_report','accepted',NULL,'2026-10-29',NULL)"));
check('sql:reject-cross-workspace-product-binding', () => reject("UPDATE v2_item_state SET product_resource_id='private' WHERE workspace_id='home:a'"));
check('sql:reject-cross-workspace-grant', () => reject("UPDATE v2_grants SET resource_id='private' WHERE workspace_id='home:a'"));
check('sql:reject-legacy-invalid-availability', () => reject("UPDATE v2_item_state SET availability='unavailable'"));
check('sql:reject-verified-as-claim-status', () => reject("UPDATE v2_assertions SET status='verified'"));
check('sql:reject-invalid-json', () => reject("UPDATE v2_assertions SET value_json='not-json'"));
check('sql:reject-confidence-out-of-range', () => reject('UPDATE v2_assertions SET confidence=1.1'));
check('sql:reject-provenance-with-two-origins', () => reject("INSERT INTO v2_provenance VALUES('home:a','bad','derived',1,'supports','source','claim',1)"));
check('sql:reject-provenance-with-no-origin', () => reject("INSERT INTO v2_provenance VALUES('home:a','bad','derived',1,'supports',NULL,NULL,NULL)"));
check('sql:reject-missing-parent-revision', () => reject("INSERT INTO v2_provenance VALUES('home:a','bad','derived',1,'derived_from',NULL,'claim',9)"));
check('sql:reject-direct-self-dependency', () => reject("INSERT INTO v2_provenance VALUES('home:a','bad','derived',1,'derived_from',NULL,'derived',1)"));
check('sql:prevent-removing-referenced-source', () => reject("DELETE FROM v2_sources WHERE workspace_id='home:a' AND id='source'"));
check('sql:reject-duplicate-request-key-per-principal', () => reject(`INSERT INTO v2_operations VALUES('home:a','op2','principal:lin','request:1','${'c'.repeat(64)}',1,'prepared',NULL)`));
check('sql:reject-malformed-payload-digest', () => reject("UPDATE v2_operations SET payload_sha256='fixture-not-a-digest'"));
check('sql:confidence-does-not-promote-basis-or-status', () => {
  const row = db.prepare("SELECT basis,status FROM v2_assertions WHERE id='derived'").get();
  assert.equal(row.basis, 'ai_inference'); assert.equal(row.status, 'candidate');
});
check('sql:ack-is-not-verified', () => assert.equal(db.prepare('SELECT state FROM v2_operations').get().state, 'acknowledged'));
check('sql:foreign-key-check-clean', () => assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []));
db.close();

const failed = results.filter(r => r.status === 'failed');
const report = {
  schemaVersion: 'wujian-rfc-check-1', generatedAt: new Date().toISOString(),
  command: 'node docs/architecture-v2/check.mjs --repo=.',
  node: process.version, branch: git('branch','--show-current'), baseline: map.refs,
  scope: 'L0 documentation + in-memory DDL + fixture consistency; NOT product implementation or acceptance',
  paidModelRequests: 0, hardwareOperations: 0, privateDatabasesOpened: 0,
  notExecuted: ['V2 production behavior','historical 256 product tests','live model comparison','human blind evaluation','physical verification','production migration'],
  inputs: Object.fromEntries([...docs,'contracts/knowledge-core.sql','contracts/source-map.json','fixtures/scenarios.json','check.mjs'].map(file => [file, { sha256: hash(text(file)), bytes: statSync(resolve(folder,file)).size }])),
  passed: results.length-failed.length, failed: failed.length, results
};
writeFileSync(resolve(folder,'evidence/CHECK_REPORT.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, report: relative(repo,resolve(folder,'evidence/CHECK_REPORT.json')), failures: failed },null,2));
process.exitCode = failed.length ? 1 : 0;
