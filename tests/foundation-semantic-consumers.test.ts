import test from 'node:test';
import assert from 'node:assert/strict';
import type { Item } from '../src/lib/domain.ts';
import type { Provider } from '../src/lib/ai/provider.ts';
import { productPacks, type ProductPack } from '../src/lib/products.ts';
import { projectReality } from '../src/lib/context/reality.ts';
import { evidenceInventory, complementGraph } from '../src/lib/life/affordances.ts';
import { creativeFacts } from '../src/lib/life/creative-reasoning.ts';
import { exploreOpen } from '../src/lib/life/open-exploration.ts';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: crypto.randomUUID(), name: '[合成]陌生物品', category: '其他', model: '待确认',
    location: 'PRIVATE-LOCATION', owner: 'lin', shared: false, state: '在用', availability: 'available',
    icon: '', note: 'PRIVATE-NOTE', source: '合成测试', synthetic: true, ...overrides,
  };
}
function bound(pack: ProductPack) {
  return item({ model: pack.model, productBinding: { packId: pack.id, version: pack.version,
    confirmedBy: 'lin', confirmedAt: '2026-11-02T00:00:00Z' } });
}

/** Assert semantic preservation, not a particular transport object's shape. */
function assertSemanticTransport(packet: any, card: ReturnType<typeof projectReality>) {
  assert.equal(packet.id, card.id);
  assert.equal(packet.revision, card.revision);
  for (const fact of card.facts) {
    const sentFact = packet.facts.find((f: any) => f.id === fact.id);
    assert.ok(sentFact, 'transport must retain source fact ' + fact.id);
    assert.deepEqual(sentFact.value, fact.value);
    assert.equal(sentFact.basis, fact.basis);
    assert.equal(sentFact.status, fact.status);
    assert.equal(sentFact.scope, fact.scope);
    assert.equal(sentFact.key, fact.predicate);
    assert.equal(sentFact.rawRef, fact.source.ref);
    assert.ok(Object.hasOwn(packet.sources, sentFact.sourceId), 'each fact must resolve a source dictionary entry');
    const source = packet.sources[sentFact.sourceId];
    assert.equal(source.url, fact.source.url);
    assert.equal(source.model, fact.source.model);
    assert.equal(source.version, fact.source.version);
  }
  for (const capability of card.capabilities) {
    const sentCapability = packet.capabilities.find((c: any) => c.id === capability.id);
    assert.ok(sentCapability);
    assert.equal(sentCapability.status, capability.status);
    assert.equal(sentCapability.basis, capability.basis);
    assert.deepEqual(sentCapability.evidenceIds, capability.evidenceIds);
    assert.deepEqual(sentCapability.requires, capability.requires);
  }
}

test('Gate1 consumers share authoritative semantic revision while retaining saved creative references', async () => {
  const physicalId = crypto.randomUUID();
  const i = item({ attributes: { material: '织物', dimensions: '20×15×10厘米', quantity: 2, quantityUnit: '件',
    capabilities: ['便携'], physicalFacts: [{ id: physicalId, key: 'reflective', value: false, basis: 'user_report', component: '本体' }] } });
  const card = projectReality(i), evidence = evidenceInventory([i]).items[0], creative = creativeFacts([i])[0];
  assert.equal(evidence.realityRevision, card.revision);
  assert.equal(creative.realityRevision, card.revision);
  assert.equal(creative.facts.find(f => f.ref === i.id + '/material')?.text, '织物');
  assert.equal(creative.facts.find(f => f.ref === i.id + '/dimensions')?.text, '20×15×10厘米');
  assert.equal(creative.facts.find(f => f.ref === i.id + '/capabilities')?.text, '便携');
  assert.deepEqual(evidence.facts.find(f => f.key === 'outer_mm')?.value, [200, 150, 100]);
  const negative = evidence.facts.find(f => f.key === 'reflective')!;
  assert.equal(negative.value, false);
  assert.equal(negative.sourceRef, i.id + '/physical/' + physicalId);
  assert.ok(card.facts.some(f => f.id === negative.semanticId && f.verification === negative.verification));
  let sent: any;
  const p: Provider = { ready: true, model: 'offline-substitute', generate: async (_system, input) => {
    sent = input; return { text: '离线替身输出，不是创意质量证明。', model: 'offline-substitute', tokens: null };
  } };
  const official = bound(productPacks.find(pack => pack.claims.length)!);
  await exploreOpen(p, [i, official], '找个新用途', { strategy: 'free', preferences: [], feedback: [] }, () => {});
  assert.equal(sent.availableItems.length, 2);
  assertSemanticTransport(sent.availableItems.find((c: any) => c.id === i.id), card);
  assertSemanticTransport(sent.availableItems.find((c: any) => c.id === official.id), projectReality(official));
  assert.ok(!JSON.stringify(sent).includes('PRIVATE-'));
});

test('Gate1 names/material do not manufacture functions; hypotheses retain conditions and never become confirmed graph roles', () => {
  const misleading = item({ name: '磁力弹性灯盒', attributes: { material: '透明金属' } });
  const empty = evidenceInventory([misleading]);
  assert.deepEqual(complementGraph(empty).roles, []);
  assert.equal(empty.items[0].facts.some(f => ['magnetic', 'elastic', 'light', 'open_container', 'transparent'].includes(f.key)), false);
  const pack = productPacks.find(p => p.understanding?.possibilities.length)!;
  assert.ok(pack, 'fixture must use an existing reviewed pack with explicit inferred possibilities');
  const i = bound(pack), card = projectReality(i), inv = evidenceInventory([i]);
  const hypotheses = card.capabilities.filter(c => c.status === 'hypothesis');
  assert.ok(hypotheses.length);
  assert.ok(inv.items[0].capabilities?.some(c => c.status === 'hypothesis' && c.basis === 'inferred_unverified'));
  for (const c of hypotheses) {
    assert.equal(c.executable, false);
    assert.equal(c.verifiedForThisInstance, false);
    assert.ok(!inv.items[0].facts.some(f => f.semanticId === c.id));
  }
  assert.ok(creativeFacts([i])[0].capabilities.some(c => c.status === 'hypothesis'));
});

test('Gate1 synthetic procedure contract, existing limits and load constraints survive semantic adapter', t => {
  // Production packs currently contain no procedures. A labelled synthetic
  // source tests transport preservation, never a claim about a real appliance.
  const pack: ProductPack = { id: 'gate1-synthetic-procedure', product: '[合成]程序契约样本', model: 'SYNTHETIC-GATE1', version: 'fixture-only',
    source: { title: '合成资料，非真实商品说明书', url: 'https://example.com/gate1-fixture', section: 'synthetic', checkedAt: '2026-11-02', kind: 'official' },
    claims: [{ id: 'synthetic:operation', text: '[合成]将标记转到位置A。' }], limits: ['[合成]仅协议测试'],
    procedures: [{ id: 'synthetic:procedure', title: '合成步骤', goal: '适配不丢步骤', preconditions: ['[合成]前提待核对'],
      steps: [{ id: 'synthetic:step', text: '[合成]将标记转到位置A。', sourceSection: 'fixture-section' }],
      limits: ['[合成]不代表实际操作安全'], fieldChecks: ['[合成]核对实际状态'], sourceUrl: 'https://example.com/gate1-fixture', model: 'SYNTHETIC-GATE1' }] };
  productPacks.push(pack);
  t.after(() => { const index = productPacks.indexOf(pack); if (index >= 0) productPacks.splice(index, 1); });
  const i = bound(pack), card = projectReality(i), inv = evidenceInventory([i]).items[0];
  assert.equal(inv.operations[0].ref, 'op1_1');
  assert.deepEqual(inv.operations[0].steps, card.operations[0].steps.map(s => s.text));
  assert.deepEqual(inv.operations[0].conditions, card.operations[0].conditions);
  assert.deepEqual(creativeFacts([i])[0].limits, card.limits);
  for (const claim of pack.claims) assert.ok(creativeFacts([i])[0].facts.some(f => f.ref === i.id + '/' + claim.id));
  const loadPack = productPacks.find(p => p.constraints?.maxLoadKg !== undefined)!;
  const loadItem = bound(loadPack), load = evidenceInventory([loadItem]).items[0].facts.find(f => f.key === 'max_load_kg')!;
  assert.equal(load.value, loadPack.constraints!.maxLoadKg);
  assert.equal(load.basis, 'official_source');
  assert.equal(load.sourceRef, loadPack.id + '/maxLoadKg');
  assert.equal(load.url, loadPack.source.url);
});

test('Gate1 conflicting physical properties remain unknown instead of positive usable functions', async () => {
  const i = item({ attributes: { physicalFacts: [true, false].map(value => ({ id: crypto.randomUUID(),
    component: '本体', key: 'magnetic' as const, value, basis: 'user_report' as const })) } });
  const card = projectReality(i);
  assert.ok(card.facts.filter(f => f.predicate === 'magnetic').every(f => f.status === 'conflicting'));
  const magnetic = card.capabilities.filter(c => c.effect === 'magnetic');
  assert.ok(magnetic.length);
  assert.ok(!magnetic.some(c => c.status === 'conditional'));
  assert.ok(magnetic.every(c => c.status === 'conflicting'));
  const inv = evidenceInventory([i]);
  assert.deepEqual(complementGraph(inv).roles, []);
  assert.ok(inv.items[0].unknowns.some(s => s.includes('magnetic') && s.includes('冲突')));
  let sent: any;
  const provider: Provider = { ready: true, model: 'offline-substitute', generate: async (_s, input) => {
    sent = input; return { text: '合成协议测试：性质冲突不能作为已知能力。', model: 'offline-substitute', tokens: null };
  } };
  await exploreOpen(provider, [i], '这个物品能有什么新用途？', { strategy: 'free', preferences: [], feedback: [] }, () => {});
  assertSemanticTransport(sent.availableItems[0], card);
  assert.ok(sent.availableItems[0].capabilities.every((c: any) => c.status !== 'conditional'));
});
