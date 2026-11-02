import test from 'node:test';import assert from 'node:assert/strict';import {planResourceStamp,changedPlanResources} from '../src/lib/life/plan-resources.ts';
test('登记条件变更只标出依赖步骤；私密备注/分身修改不要求整份方案重做',()=>{
 const a:any={id:'a',model:'未知',state:'在用',attributes:{dimensions:'10×20cm'}},b:any={id:'b',model:'未知',state:'在用',attributes:{material:'纸'}};
 const plan={itemIds:['a','b'],resourceRevisions:{a:planResourceStamp(a),b:planResourceStamp(b)},dependencies:[{step:0,resourceIds:['a']},{step:1,resourceIds:['b']},{step:2,resourceIds:['a','b']}],checklist:[{label:'第一步'},{label:'第二步'},{label:'组合'}]};
 assert.deepEqual(changedPlanResources(plan,[{...a,note:'新私密',persona:{name:'新名字'}},b]).changed,[]);
 const changed=changedPlanResources(plan,[{...a,attributes:{dimensions:'5×8cm'}},b]);assert.deepEqual(changed.changed,['a']);assert.deepEqual(changed.affected,[0,2]);assert.match(changed.notice,/不代表/);
 assert.deepEqual(changedPlanResources({...plan,dependencies:undefined},[a,{...b,state:'损坏'}]).affected,[0,1,2]);
 const old=changedPlanResources({...plan,resourceRevisions:undefined},[a,b]);assert.deepEqual(old.changed,[]);assert.deepEqual(old.untracked,['a','b']);assert.deepEqual(old.affected,[0,1,2]);assert.match(old.notice,/无法判定/);
});
