import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {finalResponseSchema,finalizeResponse} from '../src/lib/agent/response-contract.ts';
import type {Item} from '../src/lib/domain.ts';
import type {ActionSource} from '../src/lib/agent/practical-actions.ts';

// Synthetic domain operands and source assertions only; no model, network,
// provider scoring, device observation or real product answer is used here.
const device={id:'device-a',name:'合成设备A',model:'SYNTHETIC-A',owner:'lin',state:'在用',availability:'available',attributes:{}} as Item;
const other={...device,id:'device-b',name:'合成设备B',model:'SYNTHETIC-B'};
const source:ActionSource={id:'op-a',itemId:device.id,kind:'operation',text:'Synthetic guide: hold the marked key for five seconds.',conditions:['只作为合成操作原文，不是厂家资料']};
const operation=()=>({goal:'核对当前设备操作',itemIds:[device.id],steps:[{kind:'device_operation',items:[device.id],text:'依据合成原文核对标示键与时长',operationRef:source.id,conditions:[]}],sourceIds:[source.id],conditions:['尚未操作设备']});
const finalize=(raw:unknown,options:{requireGuidance?:boolean}={})=>finalizeResponse(raw,'怎样操作当前设备？',[device.id],[],[source],[device],options);

test('最终Schema只含message与显式nullable guidance，不接受原始自由草稿',()=>{
 const schema=z.toJSONSchema(finalResponseSchema,{io:'input'});
 assert.deepEqual(Object.keys(schema.properties||{}).sort(),['guidance','message']);
 assert.equal(finalResponseSchema.safeParse('原始模型草稿：去按按钮。').success,false);
 assert.equal(finalResponseSchema.safeParse({answer:'旧自由答复'}).success,false);
 assert.equal(finalResponseSchema.safeParse({message:'解释',guidance:null,executed:true}).success,false);
 assert.equal(finalResponseSchema.safeParse({message:'解释'}).success,false);
 assert.equal(finalResponseSchema.safeParse({message:'',guidance:null}).success,false);
});
test('纯解释可自然表达未知，但不自动成为事实认证或已完成操作',()=>{
 const result=finalize({message:'外壳材质尚不清楚；当前只有本人报告。没有执行操作。',guidance:null});
 assert.match(result.answer,/材质尚不清楚/);assert.equal(result.guidance,null);
 assert.equal(result.basis,'unverified_model_explanation');assert(result.limitations.some(s=>s.includes('不是已核验')));
 assert.equal('executed' in result,false);assert.equal('verified' in result,false);
});
test('领域要求行动时不能通过guidance=null的自由说明逃逸',()=>{
 assert.throws(()=>finalize({message:'直接按右侧PAIRING键即可。',guidance:null},{requireGuidance:true}),/不能以自由说明代替/);
 assert.doesNotThrow(()=>finalize({message:'先核对型号；未执行。',guidance:operation()},{requireGuidance:true}));
});
test('有操作依据的最终行动复用同一presentGuidance检查，仍不认证实物成功',()=>{
 const result=finalize({message:'下面是依据本轮合成资料的候选步骤。',guidance:operation()},{requireGuidance:true});
 assert.match(result.answer,/合成原文/);assert.equal(result.basis,'checked_dependencies_not_verified_physical_success');
 assert.equal(result.guidance!.plan.readiness,'conditional');assert(result.limitations.some(s=>s.includes('翻译准确')));
});
test('设备operationRef必须属于实际操作主体并列入sourceIds',()=>{
 for(const guidance of [
  {...operation(),steps:[{...operation().steps[0],operationRef:'invented-op'}]},
  {...operation(),sourceIds:[]},
  {...operation(),steps:[{...operation().steps[0],operationRef:undefined}]},
 ])assert.throws(()=>finalize({message:'这段解释也不能先发布',guidance}),/操作原文/);
 const b:ActionSource={...source,id:'op-b',itemId:other.id};
 assert.throws(()=>finalizeResponse({message:'不能借用另一件物品的操作',guidance:{...operation(),itemIds:[device.id,other.id],steps:[{...operation().steps[0],items:[device.id,other.id],operationRef:b.id}],sourceIds:[b.id]}},'操作A',[device.id,other.id],[],[b],[device,other]),/操作原文/);
 const noText={...source,text:undefined};
 assert.throws(()=>finalizeResponse({message:'只有来源元数据',guidance:operation()},'操作A',[device.id],[],[noText],[device]),/操作原文/);
 // Two owned instances may share a canonical product-operation ID. Resolve by
 // both operation and actual operand; never select the first unrelated row.
 assert.doesNotThrow(()=>finalizeResponse({message:'依照A对应资料',guidance:operation()},'操作A',[device.id],[],[{...source,itemId:other.id},source],[device]));
});
test('模型的fact/operation分类不是权限：有范围且有原文的候选不因组织标签被错误拦截',()=>{
 const candidate:ActionSource={...source,kind:'source_assertion'};
 const r=finalizeResponse({message:'依据有范围的原文候选。',guidance:operation()},'怎样操作？',[device.id],[],[candidate],[device],{requireGuidance:true});
 assert.equal(r.basis,'checked_dependencies_not_verified_physical_success');assert.ok(r.limitations.some(s=>s.includes('翻译准确')));
 assert.throws(()=>finalizeResponse({message:'只有元数据',guidance:operation()},'操作',[device.id],[],[{...candidate,text:undefined}],[device]),/操作原文/);
});
test('型号说明书指导不等于库存授权/设备控制，不强行伪造配套手机实例',()=>{
 const procedure={kind:'procedure',itemId:device.id,steps:[{text:'在你要连接的手机上选择该设备；手机是否具备所需功能仍需确认。',sourceId:source.id}],conditions:['需要支持对应连接方式的手机，未读取其型号或状态。']};
 const r=finalize({message:'这是说明书指导，未替你执行。',guidance:procedure},{requireGuidance:true});
 assert.equal(r.basis,'source_bound_manual_guidance_not_execution');assert.match(r.answer,/仍需确认/);assert.equal(r.guidance,null);assert.equal(r.procedure?.itemId,device.id);
 assert.throws(()=>finalizeResponse({message:'不能给其他实例指导',guidance:{...procedure,itemId:other.id}},'怎样连接',[device.id],[],[source],[device]),/未获授权/);
 assert.throws(()=>finalize({message:'无原文',guidance:{...procedure,steps:[{text:'猜测步骤',sourceId:'fake'}]}}),/缺少/);
 assert.throws(()=>finalizeResponse({message:'不能跳过已知条件',guidance:procedure},'使用',[device.id],[{itemIds:[device.id],satisfied:false,detail:'已记录必要条件不满足'}] as any,[source],[device]),/必要条件/);
});
test('当前资源权限、源ID、禁止条件任一失败时整份最终响应不发布',()=>{
 assert.throws(()=>finalizeResponse({message:'本条应整体撤下',guidance:operation()},'操作',[],[],[source],[device]),/未获授权|未登记/);
 assert.throws(()=>finalize({message:'不能先发表此说明',guidance:{...operation(),sourceIds:[source.id,'forged-source']}}),/不属于/);
 const purchase={...operation(),steps:[{kind:'purchase',items:[device.id],text:'购买新材料',conditions:[]}],sourceIds:[]};
 assert.throws(()=>finalizeResponse({message:'模型把目标缩写了',guidance:purchase},'只用现有物品，不买东西',[device.id],[],[],[device]),/违反/);
 const support={...operation(),steps:[{kind:'support',items:[device.id],target:'unowned-stand',text:'放在额外支架上',conditions:[]}],sourceIds:[]};
 assert.throws(()=>finalize({message:'没有原始草稿回退',guidance:support}),/未声明|未获授权/);
});
test('未知物理条件保留为条件方案，不因最终Function Calling变成实物验证',()=>{
 const raw={message:'这是需要核对支撑条件的设想。',guidance:{goal:'尝试新的排列方式',itemIds:[device.id],steps:[{kind:'other',items:[device.id],text:'探索一种新的摆放用途',conditions:['实际支撑未知']}],sourceIds:[],conditions:['需要先核对实际结构']}};
 const result=finalize(raw);assert.equal(result.guidance!.plan.readiness,'conditional');assert.match(result.answer,/未知|条件|核对/);
 assert(result.limitations.some(s=>s.includes('未证明完整物理可行')));
});
test('边界反例：Schema不识别说明文字真假，不能冒称语义校验器',()=>{
 const result=finalize({message:'这段自由说明可能错误，例如误称图示文字就是实物按钮印字。',guidance:null});
 assert.equal(result.basis,'unverified_model_explanation');assert(result.limitations.some(s=>s.includes('不证明所有文字正确')));
});
