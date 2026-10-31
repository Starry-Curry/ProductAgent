/** Necessary-condition calculators. No generic 3D simulation or device certification. */
export function rangeCondition(actual:number,min:number,max:number){
  if(![actual,min,max].every(Number.isFinite)||min>max)throw Error('invalid_range');
  return {satisfied:actual>=min&&actual<=max,actual,min,max,excess:Math.max(0,actual-max),basis:'deterministic_necessary_condition',notice:'仅证明这一数值条件，不证明完整兼容或安全'};
}
export function rectangleCondition(object:[number,number],space:[number,number],spaceKind:'internal'|'external'|'unknown',rotation=true){
  if([...object,...space].some(x=>!Number.isFinite(x)||x<=0))throw Error('invalid_rectangle');
  const fits=(object[0]<=space[0]&&object[1]<=space[1])||(rotation&&object[1]<=space[0]&&object[0]<=space[1]);
  return {satisfied:spaceKind==='internal'?fits:null,basis:'2d_footprint_only',notice:spaceKind==='internal'?'未核对高度、开口、间隙、变形、稳定或承重':'外形尺寸不能当净空间，需测量净尺寸'};
}
export function physicalPrerequisites(mode:'support'|'heat'|'optics'|'electrical'|'combine',known:string[]){
  const required={support:['质量','重心','支撑区域','连接或摩擦条件'],heat:['温度范围','材料耐热','热源条件'],optics:['光路几何','表面光学性质'],electrical:['电气额定值','连接兼容','授权'],combine:['尺寸或连接条件','资源持有状态']}[mode];
  return {missing:required.filter(r=>!known.includes(r)),status:required.every(r=>known.includes(r))?'necessary_conditions_listed':'needs_verification',physicallyVerified:false};
}
