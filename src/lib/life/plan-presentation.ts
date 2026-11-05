/** Presentation of an existing assessment, never an extra physics validator. */
export function planStepStatus(status?:string){
 if(status==='concept'||status==='unstructured_idea')return '仅构想 · 暂不作为操作';
 if(status==='conditional')return '条件未齐 · 先核对';
 if(status==='low_risk')return '低风险候选 · 未实测';
 return '旧步骤 · 待重新核对';
}
