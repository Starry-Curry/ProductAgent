import test from 'node:test';
import assert from 'node:assert/strict';
import { validationFixture } from '../scripts/life-validation-fixture.ts';
import { migrateUnified } from '../src/lib/foundation/schema.ts';
import { compileTaskContext } from '../src/lib/context/compiler.ts';
import { makeKnowledgeDocument, storeOfficialDocument } from '../src/lib/life/acquisition.ts';
import { saveMemory } from '../src/lib/memory/store.ts';
import { mirrorItemGrant } from '../src/lib/foundation/policy.ts';
import { sharedItemKnowledge } from '../src/lib/context/knowledge.ts';
import { usable } from '../src/lib/life/availability.ts';
import { planResourceStamp, changedPlanResources } from '../src/lib/life/plan-resources.ts';
import { checkPlanResources } from '../src/lib/agent/practical-actions.ts';
import type { Person } from '../src/lib/domain.ts';

// Synthetic possession and document content only. No network, provider, real
// device or private database is involved; URLs are scope test data, not fetches.
function setup(t: { after: (f: () => void) => void }) {
  const f = validationFixture('.runtime/foundation-gate0-' + crypto.randomUUID());
  migrateUnified(f.db);
  t.after(() => f.db.close());
  const id = f.add('[合成持有]型号与权限保护样本', '电子设备', 'Sony', 'GATE0-NEW27', {
    region: 'us', synthetic: true,
    attributes: { physicalFacts: [{ id: crypto.randomUUID(), component: '本体', key: 'outer_mm', value: [100, 200, 30], basis: 'user_report' }] },
  });
  const context = (actor: Person = 'lin', question = '使用和尺寸', known: Record<string, string> = {}) =>
    compileTaskContext(f.db, f.read(), actor, { itemId: id, known: { memoryPolicy: 'off', ...known }, messages: [], tried: [] } as any, question, false, [], [], 18000);
  const document = (model: string, region: string, text: string, reading?: { limitations: string[]; figures: { url: string; caption: string }[] }) => {
    const item = f.read().items.find(i => i.id === id)!;
    const url = 'https://helpguide.sony.net/' + region + '/' + model + '/' + crypto.randomUUID();
    const d = makeKnowledgeDocument({ url, title: model + ' instructions', text: model + '\n' + text, links: [], reading }, item, [url], region);
    // Explicitly preserve the actual document subject, not the owner's model.
    d.model = model;
    d.chunks.forEach(c => { c.model = model; });
    storeOfficialDocument(f.db, 'lin', item, d);
    return d;
  };
  return { ...f, id, context, document };
}

test('Gate0 fixture uses exact model/region and nested typed facts; wrong model/region passages are excluded', t => {
  const f = setup(t);
  const stored = f.read().items.find(i => i.id === f.id)!;
  assert.equal(stored.model, 'GATE0-NEW27');
  assert.equal(stored.region, 'us');
  assert.equal((stored as any).physicalFacts, undefined);
  assert.deepEqual(stored.attributes?.physicalFacts?.[0].value, [100, 200, 30]);
  const good = f.document(stored.model, 'us', 'Press the power button briefly. CORRECT-SCOPE-FACT.');
  const wrongModel = f.document('GATE0-NEW270', 'us', 'Press a different button. WRONG-MODEL-SENTINEL.');
  const wrongRegion = f.document(stored.model, 'jp', 'Regional variant operation. WRONG-REGION-SENTINEL.');
  const c = f.context('lin', 'power button operation');
  assert.equal(c.items[0].model, stored.model);
  assert.equal(c.items[0].physicalFacts[0].basis, 'user_report');
  assert.ok(c.evidence.some(e => e.documentId === good.id));
  assert.ok(!c.evidence.some(e => e.documentId === wrongModel.id || e.documentId === wrongRegion.id));
  assert.ok(!c.constraintEvidence.some(e => e.id.startsWith(wrongModel.id) || e.id.startsWith(wrongRegion.id)));
});

test('Gate0 private story relationship remains local unless explicitly cloud-authorized; no-model keeps item identity', t => {
  const f = setup(t);
  const state = f.read(), item = state.items.find(i => i.id === f.id)!;
  item.brand = ''; item.model = '未确认'; item.name = '[合成]朋友送的纪念画'; f.write(state);
  const memory = saveMemory(f.db, f.read, 'lin', { kind: 'relationship', itemId: f.id, text: '[合成]小夏送的画 PRIVATE-GATE0-RELATION', allowCloud: false });
  const localOnly = f.context('lin', '谁送的这幅画，怎么安排？', { memoryPolicy: 'read', useItemMemories: 'yes' });
  assert.equal(localOnly.items[0].id, f.id);
  assert.equal(localOnly.items[0].model, null);
  assert.ok(!JSON.stringify(localOnly.evidence).includes('PRIVATE-GATE0-RELATION'));
  saveMemory(f.db, f.read, 'lin', { kind: 'relationship', itemId: f.id, text: memory.text, allowCloud: true }, memory.id);
  const permitted = f.context('lin', '谁送的这幅画，怎么安排？', { memoryPolicy: 'read', useItemMemories: 'yes' });
  assert.ok(permitted.evidence.some(e => e.id === memory.id && e.basis === 'user_report'));
  assert.ok(!JSON.stringify(sharedItemKnowledge(f.read(), 'lin', [f.id])).includes('PRIVATE-GATE0-RELATION'));
});

test('Gate0 unavailable resource stays discoverable but cannot enter action-authorized IDs', t => {
  const f = setup(t), state = f.read(), item = state.items.find(i => i.id === f.id)!;
  item.availability = 'loaned'; item.state = '借出'; f.write(state);
  const c = f.context();
  assert.ok(c.catalogue.some(i => i.id === f.id));
  assert.equal(c.items[0].usable, false);
  const allowed = c.items.filter(i => i.usable).map(i => i.id);
  assert.throws(() => checkPlanResources({ kind: 'plan', goal: '用现有资源', itemIds: [f.id], steps: ['使用借出的物品'], sourceIds: [], conditions: [] }, allowed, [], [], f.read().items), /未获授权|未登记/);
});

test('Gate0 PDF text-layer fixture preserves unread-figure limitation instead of certifying button diagrams', t => {
  const f = setup(t);
  const d = f.document('GATE0-NEW27', 'us', 'PDF text layer says press the power button. Figure direction is not extracted.', {
    limitations: ['PDF取得文字层；页面图示、按钮符号和装配方向未由文字抽取验证。'], figures: [],
  });
  const c = f.context('lin', 'power button');
  const evidence = c.evidence.find(e => e.documentId === d.id)!;
  assert.ok(evidence);
  assert.match(evidence.reading!.limitations.join(' '), /未由文字抽取验证/);
  assert.deepEqual(evidence.reading!.figures, []);
  assert.equal((evidence as any).visualVerified, undefined);
});

test('Gate0 physical state revision invalidates dependent steps while private notes do not', t => {
  const f = setup(t), item = f.read().items.find(i => i.id === f.id)!;
  const plan = { itemIds: [f.id], resourceRevisions: { [f.id]: planResourceStamp(item) }, dependencies: [{ step: 0, resourceIds: [f.id] }] };
  assert.deepEqual(changedPlanResources(plan, [{ ...item, note: 'PRIVATE-UNRELATED' }]).changed, []);
  const changed = changedPlanResources(plan, [{ ...item, availability: 'broken', state: '损坏' }]);
  assert.deepEqual(changed.changed, [f.id]);
  assert.deepEqual(changed.affected, [0]);
});

test('Gate0 explicit grant revocation and expiry exclude the resource from current kernel compilation', t => {
  const f = setup(t), state = f.read(), item = state.items.find(i => i.id === f.id)!;
  item.owner = 'u_gate0_owner'; item.shared = true; item.sharedWith = ['lin']; f.write(state);
  const grant = mirrorItemGrant(f.db, state, item.owner, 'lin', f.id, true);
  assert.ok(f.context().catalogue.some(i => i.id === f.id));
  mirrorItemGrant(f.db, state, item.owner, 'lin', f.id, false);
  assert.ok(!f.context().catalogue.some(i => i.id === f.id));
  const regranted = mirrorItemGrant(f.db, state, item.owner, 'lin', f.id, true);
  f.db.prepare('UPDATE foundation_grants SET body=? WHERE id=?').run(JSON.stringify({ ...regranted, expiresAt: '2000-01-01T00:00:00Z' }), grant.grantId);
  assert.ok(!f.context().catalogue.some(i => i.id === f.id));
  assert.equal(f.context().items.length, 0);
});

test('Gate0 direct projection rejects an expired grant, with and without a DB handle', t => {
  const f = setup(t), state = f.read(), item = state.items.find(i => i.id === f.id)!;
  item.owner = 'u_gate0_owner'; item.shared = true; item.sharedWith = ['lin']; f.write(state);
  const grant = mirrorItemGrant(f.db, state, item.owner, 'lin', f.id, true);
  f.db.prepare('UPDATE foundation_grants SET body=? WHERE id=?').run(JSON.stringify({ ...grant, expiresAt: '2000-01-01T00:00:00Z' }), grant.grantId);
  assert.equal(f.context().items.length, 0);
  assert.throws(() => sharedItemKnowledge(f.read(), 'lin', [f.id]), /未获授权/);
  assert.throws(() => sharedItemKnowledge(f.read(), 'lin', [f.id],{db:f.db}), /未获授权/);
});
