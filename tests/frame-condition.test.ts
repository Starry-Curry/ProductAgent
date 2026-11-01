import test from 'node:test';import assert from 'node:assert/strict';
import {frameCondition} from '../src/lib/agent/kernel/physical.ts';
test('画面完整容纳与铺满裁切分别计算，不把物理尺寸与纵横比混成同单位',()=>{
 const r=frameCondition([40,30],[16,9]);assert.ok(Math.abs(r.contain.fieldWidth-160/3)<1e-8);assert.equal(r.contain.fieldHeight,30);assert.ok(Math.abs(r.contain.objectWidthFraction-.75)<1e-8);assert.equal(r.fill.croppedHeight,7.5);
 const v=frameCondition([18,32],[9,16]);assert.equal(v.contain.objectWidthFraction,1);assert.equal(v.fill.croppedHeight,0);
 assert.throws(()=>frameCondition([NaN,2],[16,9]),/invalid/);assert.match(r.notice,/不确定镜头/);
});
