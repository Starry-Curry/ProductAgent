import fs from 'node:fs';
import path from 'node:path';

export const historicalKernelRef='0432ace33cc333bbbbe4bd9db59d3ec20760c7c7';
/** Fail before opening any paid gateway. Old flags must not silently evaluate
 * the new runtime while labeling its responses as historical Kernel V3. */
export function assertHistoricalKernelRuntime(root=process.cwd()){
 const executor=path.join(root,'src/lib/agent/kernel/execute.ts');
 const graph=path.join(root,'src/lib/agent/graph.ts');
 if(!fs.existsSync(executor)||!fs.existsSync(graph)||!fs.readFileSync(graph,'utf8').includes('return executeKernel('))
  throw Error('Kernel V3已退出当前生产执行链；本历史脚本不会启动费用网关。请在独立历史工作区检出 '+historicalKernelRef+' 复现原结果，保留原始台账并重新核实授权，不能在当前代码下冒充V3对照。');
}
