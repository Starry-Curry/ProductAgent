import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {teamConfiguration} from '../scripts/team-dev.mjs';

test('team launcher overrides paid/network flags and foreign data paths without changing parent environment', () => {
  const inherited = {AI_ALLOW_PAID_CALLS:'true',WUJIAN_ALLOW_PAID_CALLS:'true',
    WUJIAN_ALLOW_PUBLIC_FETCH:'true',PRODUCT_AGENT_DATA_DIR:'foreign-private-data'};
  const c = teamConfiguration(['--name=alice','--port=3251'],process.cwd(),inherited);
  assert.equal(c.env.AI_ALLOW_PAID_CALLS,'false');
  assert.equal(c.env.WUJIAN_ALLOW_PAID_CALLS,'false');
  assert.equal(c.env.WUJIAN_ALLOW_PUBLIC_FETCH,'false');
  assert.equal(c.env.WUJIAN_ALLOW_SEARCH,'false');
  assert.equal(c.env.AUTH_MODE,'authenticated');
  assert.equal(c.env.PRODUCT_AGENT_DATA_DIR,path.resolve('.runtime/team-dev/alice'));
  assert.equal(c.env.WUJIAN_BUILD_DIR,'.next-team-alice');
  assert.equal(inherited.AI_ALLOW_PAID_CALLS,'true');
});
test('team members use distinct storage and build outputs; invalid paths/ports/unknown flags fail', () => {
  const a=teamConfiguration(['--name=alice','--port=3251'],process.cwd(),{});
  const b=teamConfiguration(['--name=bob','--port=3252'],process.cwd(),{});
  assert.notEqual(a.env.PRODUCT_AGENT_DATA_DIR,b.env.PRODUCT_AGENT_DATA_DIR);
  assert.notEqual(a.env.WUJIAN_BUILD_DIR,b.env.WUJIAN_BUILD_DIR);
  for(const args of [['--name=../private'],['--name=C:\\private'],['--port=80'],['--port=65536'],['--port=3251x'],['--paid'],['--name=a','--name=b']])
    assert.throws(()=>teamConfiguration(args,process.cwd(),{}));
});
