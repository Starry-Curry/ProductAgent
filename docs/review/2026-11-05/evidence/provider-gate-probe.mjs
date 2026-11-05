// Offline audit reproduction, NOT an upstream request or a production change.
// Node.js 24: node --experimental-strip-types <this-file>
import assert from 'node:assert/strict';
import { createProvider } from '../../../../src/lib/ai/provider.ts';

globalThis.fetch = async () => { throw new Error('Audit forbids real network'); };
const env = {
  AUTH_MODE: 'authenticated',
  AI_BASE_URL: 'https://audit.invalid/v1',
  AI_API_KEY: 'offline-audit-placeholder',
  AI_MODEL: 'offline-protocol-double',
  AI_ALLOW_PAID_CALLS: 'true',
  WUJIAN_ALLOW_PAID_CALLS: 'false',
};
let mockTransportCalls = 0;
const mockFetch = async (url) => {
  assert.equal(String(url), 'https://audit.invalid/v1/chat/completions');
  mockTransportCalls++;
  return Response.json({
    id: 'offline-audit', object: 'chat.completion', created: 0,
    model: env.AI_MODEL,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic protocol response' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
};
const provider = createProvider(env, mockFetch);
assert.equal(provider.ready, true);
await provider.generate('Offline audit only', { synthetic: true });
assert.equal(mockTransportCalls, 1);

const denied = createProvider({ ...env, AI_ALLOW_PAID_CALLS: 'false' }, mockFetch);
assert.equal(denied.ready, false);
await assert.rejects(() => denied.generate('Offline audit only', {}), { code: 'payment_not_authorized' });
assert.equal(mockTransportCalls, 1);
console.log(JSON.stringify({
  sourceCommit: '32c6119d5f29f954fc78c15c74ea567833bbbfe1',
  mode: 'offline_injected_transport',
  paidRequests: 0, realNetworkRequests: 0, privateDatabaseAccess: false,
  secondFlagFalseRawProviderReady: provider.ready,
  mockTransportCalls, firstFlagFalseBlocked: true,
  scope: 'Raw createProvider only; legacy API call site established by static inspection, no real HTTP route or paid call attempted',
}, null, 2));
