import test from 'node:test';
import assert from 'node:assert/strict';
import { generationTimeout } from '../src/lib/ai/provider.ts';
test('90秒只供显式创意配置/实验，默认60秒不变且尊重配置上限',()=>{
 assert.equal(generationTimeout({},'creative',90000),60000);
 assert.equal(generationTimeout({AI_CREATIVE_TIMEOUT_MS:'90000'},'creative',90000),90000);
 assert.equal(generationTimeout({},undefined,90000),60000);
 assert.equal(generationTimeout({AI_REQUEST_TIMEOUT_MS:'20000'},'creative',90000),20000);
 assert.equal(generationTimeout({AI_CREATIVE_TIMEOUT_MS:'75000'},'creative',90000),75000);
 assert.equal(generationTimeout({AI_CREATIVE_TIMEOUT_MS:'200000'},'creative',200000),90000);
});
