import {validationFixture} from '../../scripts/life-validation-fixture.ts';
import {startGoal,confirmGoalOutcome} from './goal-feature.ts';
import {foundationMock} from './mock-provider.ts';

// Explicit protocol example only: isolated synthetic database, no provider I/O.
const f=validationFixture('.runtime/team-example-cli-'+crypto.randomUUID());
try{
 const itemId=f.add('[合成]分格盒','其他','无品牌','待确认',{attributes:{capabilities:['分隔调色']}});
 const result=await startGoal(f.db,f.read,'lin','利用已有物品分隔调色，不购买',foundationMock());
 const confirmation={requestId:crypto.randomUUID(),confirmed:true as const,notes:'[合成]只验证接入协议，未操作实物',reuse:true,allowCloud:false,goalStatus:'partial' as const};
 const outcome=confirmGoalOutcome(f.db,f.read,'lin',result,confirmation);
 const replay=confirmGoalOutcome(f.db,f.read,'lin',result,confirmation);
 console.log(JSON.stringify({basis:'offline_mock_not_Qwen_or_physical_validation',realUpstreamRequests:0,itemId,taskId:result.task.taskId,runId:result.turn.foundation?.runId,usedItems:result.turn.reply.usedItems?.length,outcomeId:outcome.outcomeId,idempotent:replay.outcomeId===outcome.outcomeId,allowCloud:outcome.allowCloud},null,2));
}finally{f.db.close();}
